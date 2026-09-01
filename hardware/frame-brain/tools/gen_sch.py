#!/usr/bin/env python3
# Generates ../frame-brain.kicad_sch from the official KiCad 10 symbol libraries.
# Every pin is connected through a short stub and a local net label rather than long
# drawn wires: the netlist cannot silently diverge from what the layout intends.
# Rerun after editing PARTS below; hand edits in KiCad survive only until then.

import re
import uuid
from pathlib import Path

KC_SYMBOLS = Path('/Applications/KiCad/KiCad.app/Contents/SharedSupport/symbols')
OUT = Path(__file__).resolve().parent.parent / 'frame-brain.kicad_sch'
NS = uuid.uuid5(uuid.NAMESPACE_URL, 'lightningstrike-frame-brain')


def uid(key):
	return str(uuid.uuid5(NS, key))


# ---------- s-expression handling ----------

def extract_symbol(lib_text, name):
	"""Return the balanced (symbol "name" ...) block, quote-aware."""
	marker = '(symbol "%s"' % name
	start = lib_text.find(marker)
	if start < 0:
		raise SystemExit('symbol %s not found' % name)
	depth = 0
	in_str = False
	i = start
	while i < len(lib_text):
		c = lib_text[i]
		if in_str:
			if c == '\\':
				i += 2
				continue
			if c == '"':
				in_str = False
		elif c == '"':
			in_str = True
		elif c == '(':
			depth += 1
		elif c == ')':
			depth -= 1
			if depth == 0:
				return lib_text[start:i + 1]
		i += 1
	raise SystemExit('unbalanced block for %s' % name)


def tokenize(text):
	toks = re.findall(r'"(?:[^"\\]|\\.)*"|[()]|[^\s()"]+', text)
	pos = 0

	def parse():
		nonlocal pos
		assert toks[pos] == '('
		pos += 1
		out = []
		while toks[pos] != ')':
			if toks[pos] == '(':
				out.append(parse())
			else:
				out.append(toks[pos])
				pos += 1
		pos += 1
		return out

	return parse()


def walk_pins(tree, prefix):
	"""Yield (unit, number, x, y, angle) for every pin in a parsed symbol tree."""
	for node in tree:
		if not isinstance(node, list):
			continue
		if node[0] == 'symbol':
			sub = node[1].strip('"')
			m = re.match(re.escape(prefix) + r'_(\d+)_(\d+)$', sub)
			unit = int(m.group(1)) if m else 0
			for inner in node:
				if isinstance(inner, list) and inner[0] == 'pin':
					at = next(n for n in inner if isinstance(n, list) and n[0] == 'at')
					num = next(n for n in inner if isinstance(n, list) and n[0] == 'number')
					yield unit, num[1].strip('"'), float(at[1]), float(at[2]), float(at[3])


def top_level_blocks(block, tag):
	"""Yield (start, end) spans of depth-1 (tag ...) blocks inside a symbol block."""
	depth = 0
	in_str = False
	i = 0
	spans = []
	while i < len(block):
		c = block[i]
		if in_str:
			if c == '\\':
				i += 2
				continue
			if c == '"':
				in_str = False
		elif c == '"':
			in_str = True
		elif c == '(':
			if depth == 1 and block[i:i + len(tag) + 2] == '(%s ' % tag:
				j, d, s = i, 0, False
				while True:
					ch = block[j]
					if s:
						if ch == '"':
							s = False
					elif ch == '"':
						s = True
					elif ch == '(':
						d += 1
					elif ch == ')':
						d -= 1
						if d == 0:
							break
					j += 1
				spans.append((i, j + 1))
				i = j + 1
				continue
			depth += 1
		elif c == ')':
			depth -= 1
		i += 1
	return spans


class Symbol:
	def __init__(self, lib, name):
		self.lib, self.name = lib, name
		text = (KC_SYMBOLS / (lib + '.kicad_sym')).read_text()
		self.block = extract_symbol(text, name)
		m = re.search(r'\(extends "([^"]+)"\)', self.block)
		self.parent = None
		if m:
			self.parent = Symbol(lib, m.group(1))
			self.block = self._flatten()
		tree = tokenize(self.block)
		self.pins = {}  # (unit, number) -> (x, y, angle)
		for unit, num, x, y, ang in walk_pins(tree, self.name):
			self.pins[(unit, num)] = (x, y, ang)

	def _flatten(self):
		# lib_symbols cannot hold (extends): KiCad flattens derived symbols on save,
		# so inline the parent's body under the derived name and properties.
		derived_props = [self.block[a:b] for a, b in top_level_blocks(self.block, 'property')]
		body = self.parent.block
		spans = top_level_blocks(body, 'property')
		first = spans[0][0] if spans else None
		for a, b in reversed(spans):
			body = body[:a] + body[b:]
		if first is not None:
			glue = '\n\t\t'.join(derived_props)
			body = body[:first] + glue + body[first:]
		body = body.replace('"%s_' % self.parent.name, '"%s_' % self.name)
		body = body.replace('(symbol "%s"' % self.parent.name, '(symbol "%s"' % self.name, 1)
		return body

	def pin_abs(self, unit, num, X, Y, rot):
		# Library pins live in y-up coordinates, the sheet is y-down; rotation is CCW.
		if (unit, num) not in self.pins and (0, num) in self.pins:
			unit = 0
		px, py, ang = self.pins[(unit, num)]
		for _ in range(int(rot) // 90):
			px, py = -py, px
			ang = (ang + 90) % 360
		return X + px, Y - py, ang

	def emit_lib(self):
		return self.block.replace('(symbol "%s"' % self.name, '(symbol "%s:%s"' % (self.lib, self.name), 1)


def pin_blocks(block):
	"""Yield (start, end) spans of every (pin ...) block, quote-aware."""
	i = 0
	while True:
		i = block.find('(pin ', i)
		if i < 0:
			return
		j, d, s = i, 0, False
		while True:
			c = block[j]
			if s:
				if c == '"':
					s = False
			elif c == '"':
				s = True
			elif c == '(':
				d += 1
			elif c == ')':
				d -= 1
				if d == 0:
					break
			j += 1
		yield i, j + 1
		i = j + 1


def customize(sym, new_name, value, footprint, retypes):
	"""Turn a library symbol into a project-library copy under a new name.

	The Pico module symbol types its ground pins power-out, which makes tying
	them together an ERC error; the project copy types them power-in instead.
	"""
	block = sym.block
	out, last = [], 0
	for a, b in pin_blocks(block):
		pin = block[a:b]
		num = re.search(r'\(number "([^"]+)"', pin)
		if num and num.group(1) in retypes:
			pin = re.sub(r'^\(pin \S+', '(pin %s' % retypes[num.group(1)], pin)
		out.append(block[last:a])
		out.append(pin)
		last = b
	out.append(block[last:])
	block = ''.join(out)
	block = block.replace('"%s_' % sym.name, '"%s_' % new_name)
	block = block.replace('(symbol "%s"' % sym.name, '(symbol "%s"' % new_name, 1)
	block = re.sub(r'\(property "Value" "[^"]*"', '(property "Value" "%s"' % value, block, count=1)
	block = re.sub(r'\(property "Footprint" "[^"]*"', '(property "Footprint" "%s"' % footprint, block, count=1)
	sym.block, sym.name, sym.lib = block, new_name, 'frame-brain'
	sym.pins = {}
	for unit, num, x, y, ang in walk_pins(tokenize(block), new_name):
		sym.pins[(unit, num)] = (x, y, ang)


# ---------- circuit ----------

FP = {
	'R': 'Resistor_THT:R_Axial_DIN0207_L6.3mm_D2.5mm_P10.16mm_Horizontal',
	'CP': 'Capacitor_THT:CP_Radial_D10.0mm_P5.00mm',
	'C': 'Capacitor_THT:C_Disc_D5.0mm_W2.5mm_P5.00mm',
	'D': 'Diode_THT:D_DO-41_SOD81_P10.16mm_Horizontal',
	'LED': 'LED_THT:LED_D3.0mm',
	'PF': 'Fuse:Fuse_Bourns_MF-RHT100',
	'TERM': 'TerminalBlock_Phoenix:TerminalBlock_Phoenix_MKDS-1,5-2-5.08_1x02_P5.08mm_Horizontal',
	'SW': 'Button_Switch_THT:SW_PUSH_6mm',
	'PICO': 'Module:RaspberryPi_Pico_Common_THT',
	'HCT': 'Package_DIP:DIP-14_W7.62mm_Socket',
	'MH': 'MountingHole:MountingHole_3.2mm_M3',
}

SYMBOLS = {
	'R': Symbol('Device', 'R'),
	'C': Symbol('Device', 'C'),
	'CP': Symbol('Device', 'C_Polarized'),
	'D': Symbol('Device', 'D_Schottky'),
	'LED': Symbol('Device', 'LED'),
	'PF': Symbol('Device', 'Polyfuse'),
	'TERM': Symbol('Connector', 'Screw_Terminal_01x02'),
	'SW': Symbol('Switch', 'SW_Push'),
	'PICO': Symbol('MCU_Module', 'RaspberryPi_Pico_W'),
	'HCT': Symbol('74xx', '74AHCT125'),
	'FLAG': Symbol('power', 'PWR_FLAG'),
	'MH': Symbol('Mechanical', 'MountingHole'),
}

customize(SYMBOLS['PICO'], 'Pico_W', 'Pico W', FP['PICO'],
	{p: 'power_in' for p in ('3', '8', '13', '18', '23', '28', '33', '38')})
customize(SYMBOLS['HCT'], 'SN74HCT125N', 'SN74HCT125N', FP['HCT'], {})

# The frame drives lines A/B/C on GP2/GP3/GP4 (firmware/node/src/fixture/frame.rs);
# the fourth buffer goes to GP5 and a spare terminal instead of being grounded.
PICO_PINS = {
	'3': 'GND', '8': 'GND', '13': 'GND', '18': 'GND', '23': 'GND', '28': 'GND',
	'33': 'GND', '38': 'GND',
	'4': 'GP2', '5': 'GP3', '6': 'GP4', '7': 'GP5',
	'30': 'RUN', '39': 'VSYS',
}
PICO_NC = ['1', '2', '9', '10', '11', '12', '14', '15', '16', '17', '19', '20', '21',
	'22', '24', '25', '26', '27', '29', '31', '32', '34', '35', '36', '37', '40']

PARTS = [
	dict(ref='J1', sym='TERM', value='5V in', at=(33.02, 45.72), rot=180, pins={'1': '5V_IN', '2': 'GND'}),
	dict(ref='F1', sym='PF', value='MF-RHT100', at=(53.34, 43.18), rot=90, pins={'1': '5V_IN', '2': '+5V'}),
	dict(ref='D1', sym='D', value='1N5817', at=(78.74, 43.18), rot=0, pins={'1': 'VSYS', '2': '+5V'}),
	dict(ref='D2', sym='D', value='1N5817', at=(63.5, 60.96), rot=90, pins={'1': '+5V', '2': 'GND'}),
	dict(ref='C1', sym='CP', value='1000uF 25V', at=(76.2, 60.96), rot=0, pins={'1': '+5V', '2': 'GND'}),
	dict(ref='R5', sym='R', value='1k', at=(88.9, 58.42), rot=0, pins={'1': '+5V', '2': 'LED_A'}),
	dict(ref='D3', sym='LED', value='green', at=(88.9, 73.66), rot=270, pins={'1': 'GND', '2': 'LED_A'}),
	dict(ref='SW1', sym='SW', value='reset', at=(55.88, 78.74), rot=0, pins={'1': 'RUN', '2': 'GND'}),
	dict(ref='U1', sym='PICO', value='Pico W', at=(139.7, 96.52), rot=0, pins=PICO_PINS, nc=PICO_NC),
	# Units are assigned to lines so the four GP traces cross nothing on the board:
	# the buffers are identical, the pick is pure layout.
	dict(ref='U2', sym='HCT', value='SN74HCT125N', at=(203.2, 55.88), rot=0, unit=3, pins={'10': 'GND', '9': 'GP2', '8': 'A_Y'}),
	dict(ref='U2', sym='HCT', value='SN74HCT125N', at=(203.2, 86.36), rot=0, unit=4, pins={'13': 'GND', '12': 'GP3', '11': 'B_Y'}),
	dict(ref='U2', sym='HCT', value='SN74HCT125N', at=(203.2, 116.84), rot=0, unit=2, pins={'4': 'GND', '5': 'GP4', '6': 'C_Y'}),
	dict(ref='U2', sym='HCT', value='SN74HCT125N', at=(203.2, 147.32), rot=0, unit=1, pins={'1': 'GND', '2': 'GP5', '3': 'D_Y'}),
	dict(ref='U2', sym='HCT', value='SN74HCT125N', at=(147.32, 165.1), rot=0, unit=5, pins={'14': '+5V', '7': 'GND'}),
	dict(ref='C2', sym='C', value='100n', at=(162.56, 165.1), rot=0, pins={'1': '+5V', '2': 'GND'}),
	dict(ref='R1', sym='R', value='330', at=(228.6, 55.88), rot=90, pins={'1': 'A_Y', '2': 'DATA_A'}),
	dict(ref='R2', sym='R', value='330', at=(228.6, 86.36), rot=90, pins={'1': 'B_Y', '2': 'DATA_B'}),
	dict(ref='R3', sym='R', value='330', at=(228.6, 116.84), rot=90, pins={'1': 'C_Y', '2': 'DATA_C'}),
	dict(ref='R4', sym='R', value='330', at=(228.6, 147.32), rot=90, pins={'1': 'D_Y', '2': 'DATA_D'}),
	dict(ref='J2', sym='TERM', value='data A', at=(254.0, 55.88), rot=0, pins={'1': 'DATA_A', '2': 'GND'}),
	dict(ref='J3', sym='TERM', value='data B', at=(254.0, 86.36), rot=0, pins={'1': 'DATA_B', '2': 'GND'}),
	dict(ref='J4', sym='TERM', value='data C', at=(254.0, 116.84), rot=0, pins={'1': 'DATA_C', '2': 'GND'}),
	dict(ref='J5', sym='TERM', value='data D spare', at=(254.0, 147.32), rot=0, pins={'1': 'DATA_D', '2': 'GND'}),
	dict(ref='#FLG01', sym='FLAG', value='PWR_FLAG', at=(35.56, 99.06), rot=0, pins={'1': '+5V'}),
	dict(ref='#FLG02', sym='FLAG', value='PWR_FLAG', at=(48.26, 99.06), rot=0, pins={'1': 'GND'}),
	dict(ref='#FLG03', sym='FLAG', value='PWR_FLAG', at=(60.96, 99.06), rot=0, pins={'1': 'VSYS'}),
	dict(ref='H1', sym='MH', value='M3', at=(33.02, 124.46), rot=0, pins={}, in_bom=False),
	dict(ref='H2', sym='MH', value='M3', at=(45.72, 124.46), rot=0, pins={}, in_bom=False),
	dict(ref='H3', sym='MH', value='M3', at=(58.42, 124.46), rot=0, pins={}, in_bom=False),
	dict(ref='H4', sym='MH', value='M3', at=(71.12, 124.46), rot=0, pins={}, in_bom=False),
]

NOTES = [
	(20.32, 30.48, 'power in: 5 V straight from the salvaged PC supply'),
	(20.32, 35.56, 'F1 protects the feed wire, the supply can source far more than it'),
	(96.52, 40.64, 'D1 keeps a USB laptop from back-feeding the 5 V rail'),
	(50.8, 68.58, 'D2 makes a reversed input trip F1 instead of killing anything'),
	(190.5, 33.02, 'level shift: SK6812 wants 5 V data, the Pico drives 3.3 V'),
	(243.84, 40.64, 'one twisted pair per line, each with its own ground'),
	(190.5, 170.18, '100 nF tight against pin 14'),
]

STUB = 2.54


def fmt(v):
	s = '%.4f' % v
	s = s.rstrip('0').rstrip('.')
	return s if s else '0'


def prop(name, value, x, y, hide):
	h = '\n\t\t\t\t(hide yes)' if hide else ''
	return ('\t\t(property "%s" "%s"\n\t\t\t(at %s %s 0)\n\t\t\t(effects\n\t\t\t\t(font\n\t\t\t\t\t(size 1.27 1.27)\n\t\t\t\t)%s\n\t\t\t)\n\t\t)'
		% (name, value, fmt(x), fmt(y), h))


root_uuid = uid('root-sheet')
body = []
lib_parts = []
seen = set()
for key, sym in SYMBOLS.items():
	if sym.name in seen:
		continue
	seen.add(sym.name)
	lib_parts.append(sym.emit_lib())

for part in PARTS:
	sym = SYMBOLS[part['sym']]
	ref, X, Y, rot = part['ref'], part['at'][0], part['at'][1], part['rot']
	unit = part.get('unit', 1)
	# Reference above and value below the pin bounding box, so text stays off the body.
	unit_pins = [(u, n) for (u, n) in sym.pins if u in (0, unit)]
	if unit_pins:
		ys = [sym.pin_abs(u, n, X, Y, rot)[1] for (u, n) in unit_pins]
		ref_y, val_y = min(ys) - 3.81, max(ys) + 3.81
	else:
		ref_y, val_y = Y - 3.81, Y + 3.81
	lines = ['\t(symbol', '\t\t(lib_id "%s:%s")' % (sym.lib, sym.name),
		'\t\t(at %s %s %d)' % (fmt(X), fmt(Y), rot), '\t\t(unit %d)' % unit,
		'\t\t(exclude_from_sim no)',
		'\t\t(in_bom %s)' % ('yes' if part.get('in_bom', True) else 'no'),
		'\t\t(on_board yes)', '\t\t(dnp no)',
		'\t\t(uuid "%s")' % uid('sym-%s-%d' % (ref, unit))]
	lines.append(prop('Reference', ref, X, ref_y, ref.startswith('#')))
	lines.append(prop('Value', part['value'], X, val_y, False))
	lines.append(prop('Footprint', FP.get(part['sym'], ''), X, Y, True))
	lines.append(prop('Datasheet', '', X, Y, True))
	for (u, n) in sorted(unit_pins, key=lambda p: (p[0], p[1])):
		lines.append('\t\t(pin "%s"\n\t\t\t(uuid "%s")\n\t\t)' % (n, uid('pin-%s-%d-%s' % (ref, unit, n))))
	lines.append('\t\t(instances\n\t\t\t(project "frame-brain"\n\t\t\t\t(path "/%s"\n\t\t\t\t\t(reference "%s")\n\t\t\t\t\t(unit %d)\n\t\t\t\t)\n\t\t\t)\n\t\t)'
		% (root_uuid, ref, unit))
	lines.append('\t)')
	body.append('\n'.join(lines))

	for num, net in part['pins'].items():
		px, py, ang = sym.pin_abs(unit, num, X, Y, rot)
		# Pin angle points toward the body; the stub leaves the other way (sheet y is down).
		dx = {0: -1, 90: 0, 180: 1, 270: 0}[ang % 360]
		dy = {0: 0, 90: 1, 180: 0, 270: -1}[ang % 360]
		ex, ey = px + dx * STUB, py + dy * STUB
		body.append('\t(wire\n\t\t(pts\n\t\t\t(xy %s %s) (xy %s %s)\n\t\t)\n\t\t(stroke\n\t\t\t(width 0)\n\t\t\t(type default)\n\t\t)\n\t\t(uuid "%s")\n\t)'
			% (fmt(px), fmt(py), fmt(ex), fmt(ey), uid('stub-%s-%d-%s' % (ref, unit, num))))
		if dx > 0:
			l_ang, just = 0, 'left'
		elif dx < 0:
			l_ang, just = 0, 'right'
		elif dy > 0:
			l_ang, just = 90, 'right'
		else:
			l_ang, just = 90, 'left'
		body.append('\t(label "%s"\n\t\t(at %s %s %d)\n\t\t(effects\n\t\t\t(font\n\t\t\t\t(size 1.27 1.27)\n\t\t\t)\n\t\t\t(justify %s bottom)\n\t\t)\n\t\t(uuid "%s")\n\t)'
			% (net, fmt(ex), fmt(ey), l_ang, just, uid('label-%s-%d-%s' % (ref, unit, num))))

	for num in part.get('nc', []):
		px, py, _ = sym.pin_abs(unit, num, X, Y, rot)
		body.append('\t(no_connect\n\t\t(at %s %s)\n\t\t(uuid "%s")\n\t)' % (fmt(px), fmt(py), uid('nc-%s-%s' % (ref, num))))

for i, (x, y, note) in enumerate(NOTES):
	body.append('\t(text "%s"\n\t\t(exclude_from_sim no)\n\t\t(at %s %s 0)\n\t\t(effects\n\t\t\t(font\n\t\t\t\t(size 1.27 1.27)\n\t\t\t)\n\t\t\t(justify left bottom)\n\t\t)\n\t\t(uuid "%s")\n\t)'
		% (note, fmt(x), fmt(y), uid('note-%d' % i)))

out = []
out.append('(kicad_sch')
out.append('\t(version 20231120)')
out.append('\t(generator "eeschema")')
out.append('\t(generator_version "8.0")')
out.append('\t(uuid "%s")' % root_uuid)
out.append('\t(paper "A4")')
out.append('\t(title_block')
out.append('\t\t(title "The Frame brain board")')
out.append('\t\t(date "2026-09-01")')
out.append('\t\t(rev "A")')
out.append('\t\t(comment 1 "LightningStrike")')
out.append('\t)')
out.append('\t(lib_symbols')
for block in lib_parts:
	out.append('\t\t' + block.replace('\n', '\n\t\t'))
out.append('\t)')
out.extend(body)
out.append('\t(sheet_instances')
out.append('\t\t(path "/"')
out.append('\t\t\t(page "1")')
out.append('\t\t)')
out.append('\t)')
out.append(')')

OUT.write_text('\n'.join(out) + '\n')

lib = ['(kicad_symbol_lib', '\t(version 20231120)', '\t(generator "kicad_symbol_editor")',
	'\t(generator_version "8.0")']
for key in ('PICO', 'HCT'):
	lib.append('\t' + SYMBOLS[key].block.replace('\n', '\n\t'))
lib.append(')')
(OUT.parent / 'frame-brain.kicad_sym').write_text('\n'.join(lib) + '\n')

(OUT.parent / 'sym-lib-table').write_text(
	'(sym_lib_table\n\t(version 7)\n'
	'\t(lib (name "frame-brain")(type "KiCad")(uri "${KIPRJMOD}/frame-brain.kicad_sym")'
	'(options "")(descr "project symbols for the frame brain board"))\n)\n')

print('wrote', OUT)
