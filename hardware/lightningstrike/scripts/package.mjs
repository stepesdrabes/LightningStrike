import fs from 'node:fs';
import crypto from 'node:crypto';
import { zipSync, unzipSync, strToU8 } from 'fflate';

const read = path => fs.readFileSync(path);
const hash = data => crypto.createHash('sha256').update(data).digest('hex');
const json = read('dist/index/circuit.json');
const release = JSON.parse(read('release-status.json'));
if (release.reviewedCircuitSha256 !== hash(json)) {
	throw Error('Circuit changed since manufacturing review. Update release-status.json after reviewing the new circuit.');
}
const holdNotice = `R2 PROTOTYPE REVIEW - FABRICATOR APPROVAL REQUIRED\n\nUnbuilt board. Confirm JLC06121H-3313 (1.2 mm), USB 90 ohm differential\nimpedance, BOM availability, stencil and component orientation with the assembler.\nSee R2-REVIEW.md and release-status.json. Digital DRC is not functional validation.\n`;
if (hash(json) !== read('dist/validated-circuit.sha256').toString().trim().toLowerCase()) {
	throw Error('Circuit changed since independent DRC. Run npm run check:routes.');
}
const circuit = JSON.parse(json);
const errors = circuit.filter(e => e.type.endsWith('_error'));
if (errors.length) throw Error(`${errors.length} circuit errors prevent packaging`);
const board = circuit.find(e => e.type === 'pcb_board');
if (board.num_layers !== 6 || board.thickness !== 1.2) throw Error('Unexpected stack-up');
const source = circuit.filter(e => e.type === 'source_component');
const j2 = source.find(e => e.name === 'J2');
const dataNets = circuit.filter(e => e.type === 'source_port' && e.source_component_id === j2.source_component_id)
	.map(e => circuit.find(n => n.type === 'source_net' && n.subcircuit_connectivity_map_key === e.subcircuit_connectivity_map_key)?.name)
	.filter(Boolean).sort();
if (JSON.stringify(dataNets) !== JSON.stringify(['DATA_A', 'DATA_B', 'DATA_C'])) throw Error('Data connector pinout mismatch');
const drc = JSON.parse(read('dist/final-drc.json'));
if (drc.violations.length || drc.unconnectedItems.length) throw Error('Independent DRC has findings');
const review = JSON.parse(read('dist/electrical-review.json'));
if (review.circuitSha256 !== hash(json) || review.failed.length) throw Error('Electrical review is stale or failed');
const audit = JSON.parse(read('routing-audit.json'));
if (audit.circuitSha256 !== hash(json) || audit.viaHoleNearSmtLand.length) throw Error('Via-to-land audit is stale or failed');
const gerbers = unzipSync(read('dist/lightningstrike-gerbers.zip'));
const cam = JSON.parse(read('dist/gerber-review.json'));
if (cam.failures.length || Object.entries(cam.layerSha256).some(([name, sha]) => !gerbers[name] || hash(gerbers[name]) !== sha)) throw Error('Gerber review is stale or failed');
for (const name of ['F_Cu.gbr', 'In1_Cu.gbr', 'In2_Cu.gbr', 'In3_Cu.gbr', 'In4_Cu.gbr', 'B_Cu.gbr',
	'F_Mask.gbr', 'B_Mask.gbr', 'F_Paste.gbr', 'B_Paste.gbr', 'Edge_Cuts.gbr', 'drill-L1-L6.drl', 'drill_npth.drl']) {
	if (!gerbers[name]?.length) throw Error(`Missing manufacturing layer ${name}`);
}
// Use the explicit MPN BOM and documented CAD-coordinate placements, avoiding
// the generic supplier export's unverified nozzle rotations and substitutions.
delete gerbers['bom.csv'];
delete gerbers['pick_and_place.csv'];
delete gerbers['README-DO-NOT-ORDER.txt'];
gerbers['README-REVIEW-REQUIRED.txt'] = strToU8(holdNotice);
fs.writeFileSync('dist/lightningstrike-gerbers.zip', zipSync(gerbers));
const entries = {};
for (const [name, content] of Object.entries(gerbers)) entries[`fabrication/${name}`] = content;
for (const path of ['assembly/bom.csv', 'assembly/placement-cad.csv', 'assembly/README.txt',
	'assembly-top.svg', 'assembly-bottom.svg', 'index/schematic.svg', 'index/pcb.svg',
	'index/circuit.json', 'netlist.txt', 'lightningstrike.glb', 'preview-3d.png', 'final-drc.json',
	'electrical-review.json', 'gerber-review.json', 'schematic-review.log', 'usb-field-check.json', 'manufacturing-adjustments.json', 'pcb-top.svg', 'pcb-bottom.svg']) {
	entries[path] = read(`dist/${path}`);
}
entries['HARDWARE.md'] = read('../../HARDWARE.md');
for (const path of ['R2-REVIEW.md', 'MANUFACTURING.md', 'release-status.json', 'routing-audit.json']) entries[path] = read(path);
entries['README.txt'] = strToU8(`LightningStrike R2 prototype review package
Unbuilt design. Fabricator DFM and assembly approval required; see R2-REVIEW.md and release-status.json.
42 x 34 mm, six copper layers, 1.2 mm FR4, black mask, white silk, ENIG.
0.15 mm signal tracks/clearance; 0.45 mm through-via pads, 0.20 mm drills.
Layer order: F.Cu / In1 GND / In2 signal / In3 signal / In4 GND / B.Cu.
79 assembly placements. Two-sided SMT assembly. No mounting holes.

Digital connectivity, placement, short-circuit and independent routing DRC pass.
R2 corrects the recorded R1 crystal/USB, output-enable and manufacturing-aperture issues.
These files are for prototype review. Firmware is unchanged and needs the migration
described in HARDWARE.md before the ESP32-C3 radio can operate.

fabrication/: Gerbers and separate plated/nonplated drill files.
assembly/: exact MPN BOM and CAD-coordinate placement file; read its README.
assembly-*.svg: component/reference drawings for both sides.
index/: authoritative circuit JSON, schematic SVG and PCB SVG.
lightningstrike.glb: assembled 3D review model; preview-3d.png: rendered view.
final-drc.json: independent Freerouting check of all six layers.

The KiCad export is excluded because of upstream sheet/thickness export bugs.
The editable master is hardware/lightningstrike/index.circuit.tsx in the repository.
Do not use this controller's connectors for 12 V or strip power.
`);
const validation = {
	revision: 'R2 prototype', generatedAt: new Date().toISOString(),
	circuitSha256: hash(json), dimensionsMm: [board.width, board.height, board.thickness],
	layers: board.num_layers, circuitErrors: errors.length,
	independentOpenConnections: drc.unconnectedItems.length,
	independentClearanceViolations: drc.violations.length,
	dataConnectorNets: dataNets,
	placements: source.filter(e => e.ftype !== 'simple_test_point').length,
	vias: circuit.filter(e => e.type === 'pcb_via').length,
	physicalValidation: 'not yet built or tested',
	approvedForManufacture: release.approvedForManufacture,
	manufacturingStatus: release.status,
};
entries['validation.json'] = strToU8(JSON.stringify(validation, null, 2));
entries['SHA256SUMS.txt'] = strToU8(Object.entries(entries).map(([name, content]) => `${hash(content)}  ${name}`).join('\n') + '\n');
fs.writeFileSync('dist/validation.json', JSON.stringify(validation, null, 2));
fs.writeFileSync('dist/lightningstrike-r2-prototype.zip', zipSync(entries, { level: 6 }));
console.log('Packaged lightningstrike-r2-prototype.zip. Supplier DFM and physical validation remain required.');
