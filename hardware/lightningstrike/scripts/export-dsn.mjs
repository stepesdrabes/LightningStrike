import fs from 'node:fs';

// Use unique images: the bundled DSN exporter merges equal-size footprints
// even when their pad layers and orientations differ.
const input = process.argv[2] ?? 'dist/index/circuit.json';
const output = process.argv[3] ?? 'dist/lightningstrike.dsn';
const circuit = JSON.parse(fs.readFileSync(input, 'utf8'));
const byType = type => circuit.filter(e => e.type === type);
const index = (type, key) => new Map(byType(type).map(e => [e[key], e]));
const ports = index('pcb_port', 'pcb_port_id');
const sourcePorts = index('source_port', 'source_port_id');
const priority = ['USB_DP', 'USB_DM', 'USB_DP_MCU', 'USB_DM_MCU', 'LED_A_3V3', 'RADIO_CLK'];
const nets = byType('source_net').sort((a, b) =>
	(priority.includes(a.name) ? priority.indexOf(a.name) : 100) -
	(priority.includes(b.name) ? priority.indexOf(b.name) : 100));
const netByKey = new Map(nets.map(n => [n.subcircuit_connectivity_map_key, n.name]));
const board = byType('pcb_board')[0];
const layers = { top: 'F.Cu', inner1: 'In1.Cu', inner2: 'In2.Cu', inner3: 'In3.Cu', inner4: 'In4.Cu', bottom: 'B.Cu' };
if (board.num_layers !== 6) throw Error('This export requires the six-layer stack');
if (board.width !== 42 || board.height !== 34) throw Error('Update the ground-plane boundaries for the new board size');
const um = n => +(n * 1000).toFixed(3);
const quote = s => JSON.stringify(s);
const pads = [...byType('pcb_smtpad'), ...byType('pcb_plated_hole')];
const pinNets = new Map();
const padstacks = [];
const images = [];
const placements = [];
const manifest = [];
const components = index('pcb_component', 'pcb_component_id');
const imagePins = new Map();
for (const [i, pad] of pads.entries()) {
	const id = `P${i}`;
	const component = components.get(pad.pcb_component_id);
	if (!component) throw Error(`Pad ${id} has no component`);
	const ref = pad.pcb_component_id.replace('pcb_component_', 'C');
	const port = ports.get(pad.pcb_port_id);
	const sourcePort = sourcePorts.get(port?.source_port_id);
	const net = netByKey.get(sourcePort?.subcircuit_connectivity_map_key);
	if (net) pinNets.set(`${ref}-${id}`, net);
	const padLayers = pad.layers ?? [pad.layer];
	const width = pad.outer_width ?? pad.width ?? pad.radius * 2;
	const height = pad.outer_height ?? pad.height ?? pad.radius * 2;
	if (!Number.isFinite(width) || !Number.isFinite(height)) throw Error(`Unknown pad: ${id}`);
	const shapes = padLayers.map(l => {
		const layer = layers[l];
		if (!layer) throw Error(`Unknown layer ${l}`);
		return pad.shape === 'circle'
			? `(shape (circle ${layer} ${um(width)}))`
			: `(shape (rect ${layer} ${um(-width / 2)} ${um(-height / 2)} ${um(width / 2)} ${um(height / 2)}))`;
	});
	padstacks.push(`(padstack ${id} ${shapes.join(' ')} (attach off))`);
	if (!imagePins.has(ref)) {
		imagePins.set(ref, []);
		placements.push(`(component ${ref} (place ${ref} ${um(component.center.x)} ${um(component.center.y)} front 0))`);
	}
	imagePins.get(ref).push(`(pin ${id} ${id} ${um(pad.x - component.center.x)} ${um(pad.y - component.center.y)})`);
	manifest.push({ id, net, pcbPort: pad.pcb_port_id, x: pad.x, y: pad.y, width, height, layers: padLayers });
}
for (const [ref, pins] of imagePins) images.push(`(image ${ref} ${pins.join(' ')})`);
const netDefs = nets.map(n => {
	const members = [...pinNets].filter(([, net]) => net === n.name).map(([id]) => id);
	if (members.length < 2) throw Error(`Incomplete physical net ${n.name}`);
	return `(net ${quote(n.name)} (pins ${members.join(' ')}))`;
});
const widths = new Map();
for (const n of nets) {
	const width = /^(V5_|VSYS|VBUS|SW$)/.test(n.name) ? 600 : n.name === 'V3V3' ? 250 : 150;
	if (!widths.has(width)) widths.set(width, []);
	widths.get(width).push(n.name);
}
const classes = [...widths].map(([width, names]) =>
	`(class W${width} ${names.map(quote).join(' ')} (circuit (use_via Via450_200)) (rule (width ${width}) (clearance 150)))`);
const outline = board.outline.flatMap(p => [um(p.x), um(p.y)]).join(' ');
const critical = JSON.parse(fs.readFileSync('critical-routes.json', 'utf8'));
const criticalVias = JSON.parse(fs.readFileSync('critical-vias.json', 'utf8'));
const seedWires = critical.map(t => {
	for (const point of [t.points[0], t.points.at(-1)]) {
		if (!manifest.some(p => p.net === t.net && p.layers.includes(t.layer) && Math.hypot(p.x - point[0], p.y - point[1]) < 0.001)
			&& !criticalVias.some(p=>p.net===t.net && Math.hypot(p.x-point[0],p.y-point[1])<.001)) {
			throw Error(`Critical route endpoint no longer matches ${t.net}`);
		}
	}
	return `(wire (path ${layers[t.layer]} ${um(t.width)} ${t.points.flatMap(p => p.map(um)).join(' ')}) (net ${quote(t.net)}) (type protect))`;
});
// Independent DRC can consume the actual final copper, including protected USB
// tracks that a router session may omit when it only saves newly routed wires.
let wiring = [...seedWires,...criticalVias.map(v=>`(via Via450_200 ${um(v.x)} ${um(v.y)} (net ${quote(v.net)}) (type protect))`)];
if (process.argv.includes('--routed')) {
	wiring = [];
	for (const trace of byType('pcb_trace')) {
		const net = netByKey.get(trace.subcircuit_connectivity_map_key);
		if (!net) throw Error(`Missing net for ${trace.pcb_trace_id}`);
		for (let i = 1; i < trace.route.length; i++) {
			const a = trace.route[i - 1], b = trace.route[i];
			if (a.route_type !== 'wire' || b.route_type !== 'wire' || a.layer !== b.layer) continue;
			wiring.push(`(wire (path ${layers[a.layer]} ${um(a.width)} ${um(a.x)} ${um(a.y)} ${um(b.x)} ${um(b.y)}) (net ${quote(net)}) (type protect))`);
		}
	}
	for (const via of byType('pcb_via')) {
		const net = netByKey.get(via.subcircuit_connectivity_map_key);
		if (!net) throw Error(`Missing net for ${via.pcb_via_id}`);
		wiring.push(`(via Via450_200 ${um(via.x)} ${um(via.y)} (net ${quote(net)}) (type protect))`);
	}
}
const holeKeepouts = byType('pcb_hole').flatMap((hole, i) => {
	if (hole.hole_shape !== 'circle') throw Error(`Unsupported nonplated hole ${hole.pcb_hole_id}`);
	return Object.values(layers).map(l =>
		`(keepout NPTH${i}_${l} (circle ${l} ${um(hole.hole_diameter + 0.4)} ${um(hole.x)} ${um(hole.y)}))`);
});
const dsn = `(pcb LightningStrike
  (parser (string_quote ") (space_in_quoted_tokens on))
  (resolution um 10) (unit um)
  (structure
    ${Object.values(layers).map((l, i) => `(layer ${l} (type signal) (property (index ${i})))`).join('\n    ')}
    (boundary (path pcb 0 ${outline}))
    (plane GND (rect In1.Cu -20000 -16000 20000 16000))
    (plane GND (rect In4.Cu -20000 -16000 20000 16000))
    ${holeKeepouts.join('\n    ')}
    (via Via450_200)
    (rule (width 150) (clearance 150) (clearance 150 (type smd_smd)))
  )
  (placement ${placements.join('\n    ')})
  (library
    ${images.join('\n    ')}
    (padstack Via450_200 ${Object.values(layers).map(l => `(shape (circle ${l} 450))`).join(' ')} (attach off))
    ${padstacks.join('\n    ')}
  )
  (network ${netDefs.join('\n    ')} ${classes.join('\n    ')})
  (wiring ${wiring.join('\n    ')})
)`;
fs.writeFileSync(output, dsn);
fs.writeFileSync(output.replace(/\.dsn$/, '.pads.json'), JSON.stringify(manifest, null, 2));
console.log(`Exported ${pads.length} physical pads on ${nets.length} nets to ${output}`);
