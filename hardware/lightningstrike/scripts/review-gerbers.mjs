import fs from 'node:fs';
import crypto from 'node:crypto';
import { unzipSync, strFromU8 } from 'fflate';
const zip=fs.readFileSync('dist/lightningstrike-gerbers.zip');
const files=unzipSync(zip), c=JSON.parse(fs.readFileSync('dist/index/circuit.json'));
const net=new Map(c.filter(e=>e.type==='source_net').map(e=>[e.subcircuit_connectivity_map_key,e.name]));
const vias=[...new Map(c.filter(e=>e.type==='pcb_via').map(e=>[`${e.x},${e.y}`,e])).values()];
const inside=(p,poly)=>{let hit=false;for(let i=0,j=poly.length-1;i<poly.length;j=i++){
 const a=poly[i],b=poly[j];if((a.y>p.y)!==(b.y>p.y)&&p.x<(b.x-a.x)*(p.y-a.y)/(b.y-a.y)+a.x)hit=!hit;
}return hit;};
const distance=(p,a,b)=>{const dx=b.x-a.x,dy=b.y-a.y,d=dx*dx+dy*dy;
 const t=d?Math.max(0,Math.min(1,((p.x-a.x)*dx+(p.y-a.y)*dy)/d)):0;
 return Math.hypot(p.x-a.x-t*dx,p.y-a.y-t*dy);};
const failures=[],planes=[];
for(const name of ['In1_Cu.gbr','In4_Cu.gbr']){
 const text=strFromU8(files[name]);let clear=false,polygon=null;const cuts=[];
 for(const line of text.split('\n')){
  if(line==='%LPC*%')clear=true;if(line==='%LPD*%')clear=false;
  if(line==='G36*')polygon=[];
  if(line==='G37*'){if(clear)cuts.push(polygon);polygon=null;}
  const m=line.match(/^X(-?\d+)Y(-?\d+)D0[12]\*/);if(m&&polygon)polygon.push({x:+m[1]/1e6,y:+m[2]/1e6});
 }
 let isolated=0,grounded=0;
 for(const v of vias){
  const holes=cuts.filter(p=>inside(v,p));
  if(net.get(v.subcircuit_connectivity_map_key)==='GND'){
   if(holes.length)failures.push(`${name}: GND via ${v.x},${v.y} inside antipad`);else grounded++;
  }else{
   const margin=Math.max(-1,...holes.map(p=>Math.min(...p.map((a,i)=>distance(v,a,p[(i+1)%p.length])))-v.outer_diameter/2));
   if(margin<.149)failures.push(`${name}: signal via ${v.x},${v.y} plane clearance ${margin}`);else isolated++;
  }
 }
 planes.push({name,clearPolygons:cuts.length,groundViasConnected:grounded,signalViasIsolated:isolated});
}
for(const side of ['F','B']){
 const mask=strFromU8(files[`${side}_Mask.gbr`]);
 const flashes=[...mask.matchAll(/X(-?\d+)Y(-?\d+)D03\*/g)].map(m=>({x:+m[1]/1e6,y:+m[2]/1e6}));
 for(const v of vias)if(flashes.some(p=>Math.hypot(p.x-v.x,p.y-v.y)<.001))failures.push(`${side}: unexpected mask opening at via ${v.x},${v.y}`);
}
const result={generatedAt:new Date().toISOString(),layerSha256:Object.fromEntries(Object.entries(files).filter(([n])=>/\.(gbr|drl)$/.test(n)).map(([n,data])=>[n,crypto.createHash('sha256').update(data).digest('hex')])),
 scope:'Exported ground-plane antipads at every via and absence of via-centered mask flashes; not a full CAM connectivity test.',
 uniqueVias:vias.length,planes,failures};
fs.writeFileSync('dist/gerber-review.json',JSON.stringify(result,null,2));
console.log(JSON.stringify(result,null,2));if(failures.length)process.exitCode=1;
