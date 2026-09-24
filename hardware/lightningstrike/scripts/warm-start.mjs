import fs from 'node:fs';
// Retain already proven R1 routes only for nets whose pads have not changed.
// Seed clearance is checked before any resumed routing; rejected nets are removed.
const original=JSON.parse(fs.readFileSync(process.env.ROUTING_BASE??'.tools/r1-routing.json'));
const pads=JSON.parse(fs.readFileSync('dist/lightningstrike.pads.json'));
const changed=new Set([...(process.env.PRESERVE_ROUTES?[]:['GND','V3V3','V1V1','VSYS','SW','BST','VBUS',
 'XIN','XOUT','XTAL_OUT','USB_DP','USB_DM','USB_DP_MCU','USB_DM_MCU','QSPI_CLK','RADIO_READY','SWDIO']),
 ...process.argv.slice(2)]);
for(const p of original.pads)if(!pads.some(q=>p.net===q.net&&Math.hypot(p.x-q.x,p.y-q.y)<.001))changed.add(p.net);
const layers={top:'F.Cu',inner1:'In1.Cu',inner2:'In2.Cu',inner3:'In3.Cu',inner4:'In4.Cu',bottom:'B.Cu'};
const wires=[],seen=new Set(),um=x=>+(1000*x).toFixed(3);
for(const t of original.traces){
 if(changed.has(t.net))continue;
 // Obsolete D3 ground exit from the pre-review R2 iteration.
 if(t.net==='GND'&&t.route.some(p=>Math.hypot(p.x+14,p.y-6.5)<.002))continue;
 for(let i=0;i<t.route.length;i++){
  const a=t.route[i],b=t.route[i+1];
  if(a.route_type==='via'){
   const key=`${t.net}:${a.x}:${a.y}`;if(seen.has(key))continue;seen.add(key);
   wires.push(`(via Via450_200 ${um(a.x)} ${um(a.y)} (net "${t.net}") (type route))`);
  }else if(b?.route_type==='wire'&&a.layer===b.layer){
   wires.push(`(wire (path ${layers[a.layer]} ${um(a.width)} ${um(a.x)} ${um(a.y)} ${um(b.x)} ${um(b.y)}) (net "${t.net}") (type route))`);
  }
 }
}
let dsn=fs.readFileSync('dist/lightningstrike.dsn','utf8');
// Protected seeds must precede retained routes: duplicate vias otherwise lose
// their protected status when the DSN importer keeps the first occurrence.
dsn=dsn.replace(/\(wiring ([\s\S]*)\)\s*\)\s*$/,(_,seed)=>`(wiring ${seed}\n${wires.join('\n')})\n)`);
fs.writeFileSync('dist/r2-warm.dsn',dsn);
console.log(`Warm start: ${wires.length} retained items; excluded nets: ${[...changed].join(', ')}`);
