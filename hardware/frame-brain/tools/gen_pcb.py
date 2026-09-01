#!/usr/bin/env python3
# Builds ../frame-brain.kicad_pcb with the bundled pcbnew API, from the official
# KiCad 10 footprint libraries and the netlist KiCad extracts from the schematic.
# Run with KiCad's own python:
#   /Applications/KiCad/KiCad.app/Contents/Frameworks/Python.framework/Versions/Current/bin/python3

import re
import subprocess
import sys
import tempfile
from pathlib import Path

import pcbnew

HERE = Path(__file__).resolve().parent.parent
KICAD_CLI = '/Applications/KiCad/KiCad.app/Contents/MacOS/kicad-cli'
FP_LIBS = Path('/Applications/KiCad/KiCad.app/Contents/SharedSupport/footprints')

# Board rectangle in page coordinates; everything below is local to its top-left corner.
ORG = (100.0, 100.0)
W, H = 80.0, 68.0

FOOTPRINTS = {
	'U1': ('Module', 'RaspberryPi_Pico_Common_THT'),
	'U2': ('Package_DIP', 'DIP-14_W7.62mm_Socket'),
	'J1': ('TerminalBlock_Phoenix', 'TerminalBlock_Phoenix_MKDS-1,5-2-5.08_1x02_P5.08mm_Horizontal'),
	'J2': ('TerminalBlock_Phoenix', 'TerminalBlock_Phoenix_MKDS-1,5-2-5.08_1x02_P5.08mm_Horizontal'),
	'J3': ('TerminalBlock_Phoenix', 'TerminalBlock_Phoenix_MKDS-1,5-2-5.08_1x02_P5.08mm_Horizontal'),
	'J4': ('TerminalBlock_Phoenix', 'TerminalBlock_Phoenix_MKDS-1,5-2-5.08_1x02_P5.08mm_Horizontal'),
	'J5': ('TerminalBlock_Phoenix', 'TerminalBlock_Phoenix_MKDS-1,5-2-5.08_1x02_P5.08mm_Horizontal'),
	'F1': ('Fuse', 'Fuse_Bourns_MF-RHT100'),
	'D1': ('Diode_THT', 'D_DO-41_SOD81_P10.16mm_Horizontal'),
	'D2': ('Diode_THT', 'D_DO-41_SOD81_P10.16mm_Horizontal'),
	'D3': ('LED_THT', 'LED_D3.0mm'),
	'C1': ('Capacitor_THT', 'CP_Radial_D10.0mm_P5.00mm'),
	'C2': ('Capacitor_THT', 'C_Disc_D5.0mm_W2.5mm_P5.00mm'),
	'R1': ('Resistor_THT', 'R_Axial_DIN0207_L6.3mm_D2.5mm_P10.16mm_Horizontal'),
	'R2': ('Resistor_THT', 'R_Axial_DIN0207_L6.3mm_D2.5mm_P10.16mm_Horizontal'),
	'R3': ('Resistor_THT', 'R_Axial_DIN0207_L6.3mm_D2.5mm_P10.16mm_Horizontal'),
	'R4': ('Resistor_THT', 'R_Axial_DIN0207_L6.3mm_D2.5mm_P10.16mm_Horizontal'),
	'R5': ('Resistor_THT', 'R_Axial_DIN0207_L6.3mm_D2.5mm_P10.16mm_Horizontal'),
	'SW1': ('Button_Switch_THT', 'SW_PUSH_6mm'),
	'H1': ('MountingHole', 'MountingHole_3.2mm_M3'),
	'H2': ('MountingHole', 'MountingHole_3.2mm_M3'),
	'H3': ('MountingHole', 'MountingHole_3.2mm_M3'),
	'H4': ('MountingHole', 'MountingHole_3.2mm_M3'),
}

VALUES = {
	'U1': 'Pico W', 'U2': 'SN74HCT125N', 'J1': '5V in', 'J2': 'data A', 'J3': 'data B',
	'J4': 'data C', 'J5': 'data D spare', 'F1': 'MF-RHT100', 'D1': '1N5817', 'D2': '1N5817',
	'D3': 'green', 'C1': '1000uF 25V', 'C2': '100n', 'R1': '330', 'R2': '330', 'R3': '330',
	'R4': '330', 'R5': '1k', 'SW1': 'reset', 'H1': 'M3', 'H2': 'M3', 'H3': 'M3', 'H4': 'M3',
}

# Anchors are each footprint's pad 1. The Pico sits USB toward the left edge with
# pins 1-20 along its lower row; U2 is flipped so pin 14 lands beside C2. The
# diode pair stands upright in the left column so the GP descent corridor under
# the Pico stays empty, which is what lets the four GP traces cross nothing.
PLACE = {
	'U1': (11.0, 27.0, 90),
	'U2': (55.24, 32.88, 270),
	'J1': (11.0, 60.5, 0),
	'J2': (24.33, 60.5, 0),
	'J3': (37.66, 60.5, 0),
	'J4': (51.0, 60.5, 0),
	'J5': (64.33, 60.5, 0),
	'F1': (8.0, 47.0, 0),
	'D1': (4.5, 31.5, 270),
	'D2': (8.5, 31.5, 270),
	'C1': (27.0, 46.0, 0),
	'C2': (58.3, 40.5, 0),
	'R1': (20.0, 53.0, 0),
	'R2': (36.5, 53.0, 0),
	'R3': (49.0, 53.0, 0),
	'R4': (61.5, 53.0, 0),
	'R5': (77.0, 10.0, 270),
	'D3': (77.0, 26.0, 90),
	'SW1': (64.0, 12.0, 0),
	'H1': (4.0, 4.0, 0),
	'H2': (76.0, 4.0, 0),
	'H3': (4.0, 64.0, 0),
	'H4': (77.0, 64.0, 0),
}

# (net, layer, width mm, [(x, y), ...]) in local coordinates.
# GP lines run on the back so the front stays free for the +5V tree and the
# output fan-out; every pad is through-hole, so a track may end on either side.
F, B = 'F', 'B'
ROUTES = [
	('/5V_IN', F, 1.0, [(11, 60.5), (11, 56), (8, 53), (8, 47)]),
	('/+5V', F, 1.0, [(13.1, 48.2), (13.1, 31.5), (8.5, 31.5)]),
	('/+5V', F, 1.0, [(4.5, 41.66), (4.5, 42.9), (5.5, 43.9), (13.1, 43.9)]),
	('/+5V', F, 1.0, [(13.1, 46), (27, 46)]),
	('/+5V', F, 1.0, [(27, 46), (29, 44), (29, 32.4), (30.5, 30.9), (57.3, 30.9)]),
	('/+5V', B, 1.0, [(57.3, 30.9), (58.3, 31.9), (58.3, 40.5)]),
	('/+5V', B, 1.0, [(58.3, 40.5), (55.24, 40.5)]),
	('/+5V', F, 0.8, [(57.3, 30.9), (63, 30.9), (69.1, 24.8), (69.1, 21), (73.7, 16.4), (73.7, 13.7), (77, 10.4), (77, 10)]),
	('/VSYS', F, 1.0, [(4.5, 31.5), (4.5, 8.5), (6.9, 6.1), (13.54, 6.1), (13.54, 9.22)]),
	('/RUN', F, 0.5, [(36.4, 9.22), (36.4, 6.5), (60, 6.5), (64, 10.5), (64, 12)]),
	('/RUN', F, 0.5, [(64, 12), (70.5, 12)]),
	('/LED_A', F, 0.5, [(77, 20.16), (77, 23.46)]),
	('/GP2', B, 0.5, [(18.62, 27), (18.62, 35.4), (25.72, 42.5), (42.54, 42.5), (42.54, 40.5)]),
	('/GP3', F, 0.5, [(21.16, 27), (21.16, 43.1), (21.86, 43.8)]),
	('/GP3', B, 0.5, [(21.86, 43.8), (48.86, 43.8), (50.16, 42.5), (50.16, 40.5)]),
	('/GP4', B, 0.5, [(23.7, 27), (23.7, 28.42), (25.68, 30.4), (43.6, 30.4), (45.08, 31.88), (45.08, 32.88)]),
	('/GP5', B, 0.5, [(26.24, 27), (26.24, 27.9), (27.44, 29.1), (51.5, 29.1), (52.7, 30.3), (52.7, 32.88)]),
	('/A_Y', F, 0.5, [(40, 40.5), (40, 41.4), (37.8, 43.6), (37.8, 45)]),
	('/A_Y', B, 0.5, [(37.8, 45), (34.9, 47.9), (30.6, 47.9)]),
	('/A_Y', F, 0.5, [(30.6, 47.9), (25.5, 53), (20, 53)]),
	('/B_Y', F, 0.5, [(47.62, 40.5), (47.62, 44.9), (44.52, 48), (39.7, 48), (36.5, 51.2), (36.5, 53)]),
	('/C_Y', F, 0.5, [(42.54, 32.88), (43.9, 34.24), (43.9, 37.5), (56.6, 37.5), (56.6, 42.3), (54, 44.9), (50, 44.9), (49, 45.9), (49, 53)]),
	('/D_Y', F, 0.5, [(50.16, 32.88), (51.46, 34.18), (51.46, 35.8), (56.9, 35.8), (59.7, 38.6), (59.7, 43.9), (63, 43.9), (63, 51.5), (61.5, 53)]),
	('/DATA_A', F, 0.5, [(30.16, 53), (30.16, 54.67), (24.33, 60.5)]),
	('/DATA_B', F, 0.5, [(46.66, 53), (46.66, 54.4), (44.2, 56.86), (41.3, 56.86), (37.66, 60.5)]),
	('/DATA_C', F, 0.5, [(59.16, 53), (59.16, 53.84), (54.5, 58.5), (51, 58.5), (51, 60.5)]),
	('/DATA_D', F, 0.5, [(71.66, 53), (71.66, 53.84), (67, 58.5), (64.33, 58.5), (64.33, 60.5)]),
]

VIAS = [('/A_Y', 37.8, 45.0), ('/A_Y', 30.6, 47.9), ('/+5V', 57.3, 30.9), ('/GP3', 21.86, 43.8)]

# The line labels live in the strip below the terminal bodies, where they stay
# visible with the blocks mounted; the strip above is C1's silk circle.
SILK = [
	('LightningStrike  frame brain  rev A', 40, 2.5, 1.3, 'F'),
	('5 V in', 11, 66.9, 1.0, 'F'),
	('+', 11, 53.9, 1.2, 'F'),
	('-', 16.08, 53.9, 1.2, 'F'),
	('A north+east', 24.33, 66.9, 1.0, 'F'),
	('B south+west', 37.66, 66.9, 1.0, 'F'),
	('C beam', 51.0, 66.9, 1.0, 'F'),
	('D spare', 64.33, 66.9, 1.0, 'F'),
]

# Reference text goes where it stays readable next to the soldered part.
REF_POS = {
	'U1': (35.0, 17.5), 'U2': (36.9, 36.7), 'F1': (8.0, 44.7),
	'D1': (4.5, 29.2), 'D2': (8.5, 29.2), 'C1': (27.0, 39.9), 'C2': (60.8, 38.2),
	'R1': (17.5, 51.0), 'R2': (34.2, 51.0), 'R3': (46.8, 51.0), 'R4': (59.3, 51.0),
	'R5': (74.0, 8.2), 'D3': (74.5, 28.4), 'SW1': (67.25, 9.3),
}
HIDE_REFS = ('H1', 'H2', 'H3', 'H4', 'J1', 'J2', 'J3', 'J4', 'J5')


def mm(x, y):
	return pcbnew.VECTOR2I_MM(ORG[0] + x, ORG[1] + y)


def netlist():
	with tempfile.NamedTemporaryFile(suffix='.net') as tmp:
		subprocess.run([KICAD_CLI, 'sch', 'export', 'netlist', '--format', 'kicadsexpr',
			'--output', tmp.name, str(HERE / 'frame-brain.kicad_sch')],
			check=True, capture_output=True)
		text = Path(tmp.name).read_text()
	pads = {}
	for m in re.finditer(r'\(net\s*\(code "\d+"\)\s*\(name "([^"]+)"\)\s*\(class "[^"]*"\)(.*?)(?=\(net\s*\(code|\Z)', text, re.S):
		for ref, pin in re.findall(r'\(ref "([^"]+)"\)\s*\(pin "([^"]+)"\)', m.group(2)):
			pads[(ref, pin)] = m.group(1)
	return pads


pads_to_net = netlist()

board = pcbnew.CreateEmptyBoard()
nets = {}
for name in sorted(set(pads_to_net.values())):
	net = pcbnew.NETINFO_ITEM(board, name)
	board.Add(net)
	nets[name] = net

for ref in sorted(FOOTPRINTS):
	lib, name = FOOTPRINTS[ref]
	fp = pcbnew.FootprintLoad(str(FP_LIBS / (lib + '.pretty')), name)
	if fp is None:
		sys.exit('footprint %s:%s not found' % (lib, name))
	fp.SetFPID(pcbnew.LIB_ID(lib, name))
	x, y, rot = PLACE[ref]
	fp.SetPosition(mm(x, y))
	fp.SetOrientationDegrees(rot)
	fp.SetReference(ref)
	fp.SetValue(VALUES[ref])
	if ref in REF_POS:
		fp.Reference().SetPosition(mm(*REF_POS[ref]))
		fp.Reference().SetTextSize(pcbnew.VECTOR2I_MM(0.9, 0.9))
		fp.Reference().SetTextThickness(pcbnew.FromMM(0.13))
		fp.Reference().SetTextAngleDegrees(0)
	if ref in HIDE_REFS:
		fp.Reference().SetVisible(False)
	board.Add(fp)
	for pad in fp.Pads():
		net = pads_to_net.get((ref, pad.GetNumber()))
		if net:
			pad.SetNet(nets[net])

outline = pcbnew.PCB_SHAPE(board)
outline.SetShape(pcbnew.SHAPE_T_RECT)
outline.SetStart(mm(0, 0))
outline.SetEnd(mm(W, H))
outline.SetLayer(pcbnew.Edge_Cuts)
outline.SetWidth(pcbnew.FromMM(0.1))
board.Add(outline)

LAYERS = {'F': pcbnew.F_Cu, 'B': pcbnew.B_Cu}
for net, layer, width, points in ROUTES:
	for a, b in zip(points, points[1:]):
		t = pcbnew.PCB_TRACK(board)
		t.SetStart(mm(*a))
		t.SetEnd(mm(*b))
		t.SetWidth(pcbnew.FromMM(width))
		t.SetLayer(LAYERS[layer])
		t.SetNet(nets[net])
		board.Add(t)
for net, x, y in VIAS:
	v = pcbnew.PCB_VIA(board)
	v.SetPosition(mm(x, y))
	v.SetDrill(pcbnew.FromMM(0.4))
	v.SetWidth(pcbnew.FromMM(0.8))
	v.SetNet(nets[net])
	board.Add(v)

GND = nets['GND' if 'GND' in nets else '/GND']
for layer in (pcbnew.F_Cu, pcbnew.B_Cu):
	zone = pcbnew.ZONE(board)
	zone.SetLayer(layer)
	zone.SetNet(GND)
	zone.Outline().NewOutline()
	for x, y in [(-0.5, -0.5), (W + 0.5, -0.5), (W + 0.5, H + 0.5), (-0.5, H + 0.5)]:
		zone.Outline().Append(mm(x, y))
	zone.SetPadConnection(pcbnew.ZONE_CONNECTION_THERMAL)
	zone.SetMinThickness(pcbnew.FromMM(0.25))
	zone.SetLocalClearance(pcbnew.FromMM(0.3))
	zone.SetIslandRemovalMode(pcbnew.ISLAND_REMOVAL_MODE_ALWAYS)
	board.Add(zone)

for text, x, y, size, side in SILK:
	t = pcbnew.PCB_TEXT(board)
	t.SetText(text)
	t.SetPosition(mm(x, y))
	t.SetLayer(pcbnew.F_SilkS if side == 'F' else pcbnew.B_SilkS)
	t.SetTextSize(pcbnew.VECTOR2I_MM(size, size))
	t.SetTextThickness(pcbnew.FromMM(size * 0.15))
	board.Add(t)

pcbnew.ZONE_FILLER(board).Fill(board.Zones())
out = HERE / 'frame-brain.kicad_pcb'
board.SetFileName(str(out))
pcbnew.SaveBoard(str(out), board)
print('wrote', out)

if '--dump' in sys.argv:
	for fp in sorted(board.GetFootprints(), key=lambda f: f.GetReference()):
		bb = fp.GetCourtyard(pcbnew.F_CrtYd).BBox()
		def L(v):
			return '%.2f,%.2f' % (pcbnew.ToMM(v.x) - ORG[0], pcbnew.ToMM(v.y) - ORG[1])
		print('%s rot %.0f court %s..%s' % (fp.GetReference(),
			fp.GetOrientationDegrees(), L(bb.GetPosition()), L(bb.GetEnd())))
		for pad in sorted(fp.Pads(), key=lambda p: p.GetNumber()):
			p = pad.GetPosition()
			print('   pad %-3s %6.2f %6.2f  %s' % (pad.GetNumber(),
				pcbnew.ToMM(p.x) - ORG[0], pcbnew.ToMM(p.y) - ORG[1], pad.GetNetname()))
