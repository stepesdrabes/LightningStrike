import fs from 'node:fs';

const circuit = JSON.parse(fs.readFileSync('dist/index/circuit.json', 'utf8'));
const components = circuit.filter(e => e.type === 'source_component');
const placement = new Map(circuit.filter(e => e.type === 'pcb_component').map(e => [e.source_component_id, e]));
const csv = rows => rows.map(row => row.map(v => `"${String(v ?? '').replaceAll('"', '""')}"`).join(',')).join('\r\n') + '\r\n';
const groups = new Map();
const positions = [['Reference', 'MPN', 'X_mm', 'Y_mm', 'Side', 'CAD_rotation_deg']];
for (const part of components) {
	if (part.ftype === 'simple_test_point') continue;
	const mpn = part.manufacturer_part_number;
	if (!mpn) throw Error(`Missing manufacturer part number for ${part.name}`);
	if (!groups.has(mpn)) groups.set(mpn, { refs: [], value: part.resistance ?? part.capacitance ?? '', supplier: part.supplier_part_numbers?.jlcpcb?.[0] ?? '' });
	groups.get(mpn).refs.push(part.name);
	const p = placement.get(part.source_component_id);
	if (!p) throw Error(`Missing placement for ${part.name}`);
	positions.push([part.name, mpn, p.center.x.toFixed(4), p.center.y.toFixed(4), p.layer, p.rotation]);
}
const bom = [['References', 'Quantity', 'Manufacturer_part_number', 'Value_SI', 'LCSC_reference']];
for (const [mpn, group] of groups) bom.push([group.refs.join(' '), group.refs.length, mpn, group.value, group.supplier]);
fs.mkdirSync('dist/assembly', { recursive: true });
fs.writeFileSync('dist/assembly/bom.csv', csv(bom));
fs.writeFileSync('dist/assembly/placement-cad.csv', csv(positions));
fs.writeFileSync('dist/assembly/README.txt', `LightningStrike R2 assembly review files

Status: supplier DFM and physical validation are required before release.
Read R2-REVIEW.md and release-status.json in the review package/repository.
These files do not establish successful physical operation.
The placement file uses the tscircuit board origin at center, millimeters,
X to the right and Y up in the top-view board frame. Bottom coordinates
are NOT mirrored. Rotation is the CAD footprint rotation, NOT a verified
assembler nozzle/tape rotation. Match every polarized part against the
assembly preview and manufacturer drawing before assembly approval.

Specify ESP32-C3-MINI-1U-N4X explicitly. Do not substitute the older N4
supplier code used only to import the compatible land pattern.
External antenna, mating JST housings and crimp terminals are off-board
items listed in HARDWARE.md. Test pads need no purchased parts.
`);
console.log(`Exported ${positions.length - 1} placements and ${groups.size} BOM lines`);
