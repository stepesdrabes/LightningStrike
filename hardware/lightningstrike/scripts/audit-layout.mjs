import fs from 'node:fs';
import crypto from 'node:crypto';
const bytes=fs.readFileSync('dist/index/circuit.json'),c=JSON.parse(bytes);
const routing=JSON.parse(fs.readFileSync('routing.json'));
const parts=new Map(c.filter(e=>e.type==='source_component').map(e=>[e.source_component_id,e.name]));
const pcs=new Map(c.filter(e=>e.type==='pcb_component').map(e=>[e.pcb_component_id,parts.get(e.source_component_id)]));
const vias=c.filter(e=>e.type==='pcb_via'),pads=c.filter(e=>e.type==='pcb_smtpad');
const nearPad=[];
for(const v of vias)for(const p of pads){
 const dx=Math.max(0,Math.abs(v.x-p.x)-(p.width??2*p.radius)/2);
 const dy=Math.max(0,Math.abs(v.y-p.y)-(p.height??2*p.radius)/2);
 const distance=p.shape==='circle'?Math.max(0,Math.hypot(v.x-p.x,v.y-p.y)-p.radius):Math.hypot(dx,dy);
 const edge=distance-(v.hole_diameter??.2)/2;
 if(edge<.099)nearPad.push({via:v.pcb_via_id,x:v.x,y:v.y,part:pcs.get(p.pcb_component_id),pad:p.pcb_smtpad_id,holeToLandMm:+edge.toFixed(4)});
}
const names=['VSYS','SW','BST','V3V3','V1V1','XIN','XOUT','XTAL_OUT','USB_DP','USB_DM','USB_DP_MCU','USB_DM_MCU'];
const nets=names.map(name=>{
 let length=0;const v=new Set(),layers=new Set();
 for(const t of routing.traces.filter(t=>t.net===name))for(let i=0;i<t.route.length;i++){
  const a=t.route[i],b=t.route[i+1];
  if(a.route_type==='via')v.add(`${a.x},${a.y}`);
  else if(b?.route_type==='wire'&&a.layer===b.layer){const d=Math.hypot(a.x-b.x,a.y-b.y);if(d>.0011){length+=d;layers.add(a.layer);}}
 }
 return {name,totalCopperMm:+length.toFixed(3),throughVias:v.size,routingLayers:[...layers]};
});
const report={date:new Date().toISOString(),revision:'R2',circuitSha256:crypto.createHash('sha256').update(bytes).digest('hex'),
 method:'Sum of wire segments, including branches; not point-to-point length or an impedance measurement.',nets,
 viaHoleToSmtLandMinimumMm:.1,viaHoleNearSmtLand:nearPad,
 notes:'Checks hole edge to solderable land (not copper annulus). A flagged hole requires relocation or an explicitly approved filled/capped process.'};
fs.writeFileSync('routing-audit.json',JSON.stringify(report,null,2));
console.log(JSON.stringify({nets,viaHoleNearSmtLand:nearPad},null,2));
if(nearPad.length)process.exitCode=1;
