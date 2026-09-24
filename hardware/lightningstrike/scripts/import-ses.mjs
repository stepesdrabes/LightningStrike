import fs from 'node:fs';
import parse from 's-expression';

const input = process.argv[2] ?? 'dist/lightningstrike.ses';
const output = process.argv[3] ?? 'routing.json';
const tree = parse(fs.readFileSync(input, 'utf8'));
if (tree instanceof Error) throw tree;
const child = (node, tag) => node.find(n => Array.isArray(n) && String(n[0]) === tag);
const routes = child(tree, 'routes');
const resolution = child(routes, 'resolution');
if (String(resolution[1]) !== 'um') throw Error('Expected micrometer SES units');
const scale = Number(resolution[2]) * 1000;
const layers = { 'F.Cu': 'top', 'In1.Cu': 'inner1', 'In2.Cu': 'inner2', 'In3.Cu': 'inner3', 'In4.Cu': 'inner4', 'B.Cu': 'bottom' };
const traces = [];
for (const net of child(routes, 'network_out').slice(1)) {
	if (!Array.isArray(net) || net[0] !== 'net') continue;
	const name = String(net[1]);
	for (const item of net.slice(2)) {
		if (item[0] === 'wire') {
			const path = child(item, 'path');
			const layer = layers[String(path[1])];
			if (!layer) throw Error(`Unsupported routing layer: ${path[1]}`);
			const width = Number(path[2]) / scale;
			const route = [];
			for (let i = 3; i < path.length; i += 2) route.push({
				route_type: 'wire', x: Number(path[i]) / scale, y: Number(path[i + 1]) / scale,
				width, layer,
			});
			traces.push({ net: name, route });
		} else if (item[0] === 'via') {
			if (String(item[1]) !== 'Via450_200') throw Error(`Unknown via ${item[1]}`);
			const x = Number(item[2]) / scale;
			const y = Number(item[3]) / scale;
			// Tiny wire contacts stay wholly inside the annulus and let core's
			// segment-based connectivity checker see the through barrel on every layer.
			const route = [];
			const stack = ['top', 'inner1', 'inner2', 'inner3', 'inner4', 'bottom'];
			for (const [i, layer] of stack.entries()) {
				route.push({ route_type: 'wire', x, y, width: 0.15, layer });
				route.push({ route_type: 'wire', x: x + 0.001, y, width: 0.15, layer });
				route.push({ route_type: 'wire', x, y, width: 0.15, layer });
				if (i < stack.length - 1) route.push({ route_type: 'via', x, y, from_layer: layer, to_layer: stack[i + 1], via_diameter: 0.45, via_hole_diameter: 0.2 });
			}
			traces.push({ net: name, route });
		}
	}
}
const pads = JSON.parse(fs.readFileSync('dist/lightningstrike.pads.json', 'utf8'));
// SES may terminate a track on the 1 um compatibility contact rather than the
// barrel center. Canonicalize that sub-grid offset so both physical DRC and
// core agree on the same junction; all final copper is checked afterward.
const seedVias=JSON.parse(fs.readFileSync('critical-vias.json','utf8'));
const centers=[];
for(const t of traces){const v=t.route.find(p=>p.route_type==='via');if(!v)continue;
 const exact=seedVias.find(p=>p.net===t.net&&Math.hypot(p.x-v.x,p.y-v.y)<.002)??v;
 centers.push({net:t.net,x:exact.x,y:exact.y});
 for(const p of t.route){p.x=exact.x;p.y=exact.y;}
 // Retain the all-layer contacts needed by core, referenced to the exact center.
 for(let i=1;i<t.route.length;i++)if(t.route[i].route_type==='wire'&&t.route[i-1].route_type==='wire'){
  if(t.route[i+1]?.route_type==='wire')t.route[i].x+=.001;
 }
}
for(const t of traces)if(t.route.every(p=>p.route_type==='wire')){
 for(const p of t.route){const v=centers.find(v=>v.net===t.net&&Math.hypot(v.x-p.x,v.y-p.y)<.002);if(v){p.x=v.x;p.y=v.y;}}
 t.route=t.route.filter((p,i,a)=>i===0||p.x!==a[i-1].x||p.y!==a[i-1].y||p.layer!==a[i-1].layer);
}
// Protected fanout/ground vias may also be omitted from a router session.
for(const v of JSON.parse(fs.readFileSync('critical-vias.json','utf8'))){
 if(traces.some(t=>t.net===v.net&&t.route.some(p=>p.route_type==='via'&&Math.hypot(p.x-v.x,p.y-v.y)<.001)))continue;
 const route=[], stack=['top','inner1','inner2','inner3','inner4','bottom'];
 for(const [i,layer] of stack.entries()){
  route.push({route_type:'wire',x:v.x,y:v.y,width:.15,layer},{route_type:'wire',x:v.x+.001,y:v.y,width:.15,layer},{route_type:'wire',x:v.x,y:v.y,width:.15,layer});
  if(i<stack.length-1)route.push({route_type:'via',x:v.x,y:v.y,from_layer:layer,to_layer:stack[i+1],via_diameter:.45,via_hole_diameter:.2});
 }traces.push({net:v.net,route});
}
// SES exports may omit pre-existing protected copper. Retain the source routes.
for (const t of JSON.parse(fs.readFileSync('critical-routes.json', 'utf8'))) {
	const start = t.points[0];
	const end = t.points.at(-1);
	const touches = (p, xy) => p?.route_type === 'wire' && p.layer === t.layer && Math.hypot(p.x - xy[0], p.y - xy[1]) < 0.001;
	if (!traces.some(r => r.net === t.net && r.route.length === t.points.length && r.route.every((p,i)=>touches(p,t.points[i])&&Math.hypot(p.x-t.points[i][0],p.y-t.points[i][1])<1e-7))) {
		traces.push({ net: t.net, route: t.points.map(([x, y]) => ({ route_type: 'wire', x, y, width: t.width, layer: t.layer })) });
	}
}
const circuit = JSON.parse(fs.readFileSync('dist/index/circuit.json', 'utf8'));
const nets = circuit.filter(e => e.type === 'source_net').map(n => ({
	name: n.name, id: n.source_net_id, key: n.subcircuit_connectivity_map_key,
	traceId: circuit.find(e => e.type === 'source_trace' && e.connected_source_net_ids?.includes(n.source_net_id))?.source_trace_id,
}));
// A resumed DSN can repeat the 1 um contacts used only by core's connectivity
// checker. The via records below already reproduce those contacts on all layers.
const viaCenters=traces.filter(t=>t.route.some(p=>p.route_type==='via')).map(t=>({net:t.net,p:t.route[0]}));
const seen=new Set();
const clean=traces.filter(t=>{
 if(t.route.every(p=>p.route_type==='wire')&&t.route.every(p=>Math.hypot(p.x-t.route[0].x,p.y-t.route[0].y)<.002)&&
  viaCenters.some(v=>v.net===t.net&&Math.hypot(v.p.x-t.route[0].x,v.p.y-t.route[0].y)<.002))return false;
 const key=t.net+JSON.stringify(t.route);if(seen.has(key))return false;seen.add(key);return true;
});
fs.writeFileSync(output, JSON.stringify({ layerCount: circuit.find(e => e.type === 'pcb_board').num_layers, nets, pads, traces:clean }, null, 2));
console.log(`Imported ${clean.length} wire/via records to ${output}`);
