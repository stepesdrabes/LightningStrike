#!/usr/bin/env python3
# Compares the netlist KiCad extracts from the schematic against the pin map the
# generator intended. A label typo splits a net silently; this catches it.

import re
import subprocess
import sys
import tempfile
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent))
from gen_sch import PARTS  # noqa: E402  (importing runs the generator, which is wanted)

KICAD_CLI = '/Applications/KiCad/KiCad.app/Contents/MacOS/kicad-cli'
SCH = Path(__file__).resolve().parent.parent / 'frame-brain.kicad_sch'

expected = {}
expected_nc = set()
for part in PARTS:
	if part['ref'].startswith('#'):
		continue
	for pin, net in part['pins'].items():
		expected.setdefault(net, set()).add((part['ref'], pin))
	for pin in part.get('nc', []):
		expected_nc.add((part['ref'], pin))

with tempfile.NamedTemporaryFile(suffix='.net') as tmp:
	subprocess.run([KICAD_CLI, 'sch', 'export', 'netlist', '--format', 'kicadsexpr',
		'--output', tmp.name, str(SCH)], check=True, capture_output=True)
	text = Path(tmp.name).read_text()

actual = {}
for m in re.finditer(r'\(net\s*\(code "\d+"\)\s*\(name "([^"]+)"\)\s*\(class "[^"]*"\)(.*?)(?=\(net\s*\(code|\Z)', text, re.S):
	name = m.group(1).lstrip('/')
	nodes = set(re.findall(r'\(ref "([^"]+)"\)\s*\(pin "([^"]+)"\)', m.group(2)))
	actual[name] = nodes

fail = False
seen_nc = set()
for net in list(actual):
	if net.startswith('unconnected-'):
		seen_nc |= actual.pop(net)
if seen_nc != expected_nc:
	fail = True
	for n in sorted(expected_nc - seen_nc):
		print('NC pin %s.%s is missing or got connected' % n)
	for n in sorted(seen_nc - expected_nc):
		print('pin %s.%s is floating without a no-connect' % n)
for net in sorted(set(expected) | set(actual)):
	want, got = expected.get(net, set()), actual.get(net, set())
	if want != got:
		fail = True
		print('NET %s' % net)
		for n in sorted(want - got):
			print('   missing %s.%s' % n)
		for n in sorted(got - want):
			print('   extra   %s.%s' % n)
if fail:
	sys.exit('netlist does not match intent')
print('netlist matches: %d nets, %d pins, %d no-connects' %
	(len(expected), sum(len(v) for v in expected.values()), len(expected_nc)))
