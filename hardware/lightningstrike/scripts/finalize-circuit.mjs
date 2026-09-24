import fs from 'node:fs';
import { convertCircuitJsonToPcbSvg } from 'circuit-to-svg';
import { Resvg } from '@resvg/resvg-js';
// Manufacturing adjustments not currently expressible as global tscircuit props.
// Run after EVERY build and before DRC/hash/export. Copper/netlist is not changed.
const file='dist/index/circuit.json';
let c=JSON.parse(fs.readFileSync(file));
const parts=new Map(c.filter(x=>x.type==='source_component').map(x=>[x.source_component_id,x.name]));
const components=new Map(c.filter(x=>x.type==='pcb_component').map(x=>[x.pcb_component_id,parts.get(x.source_component_id)]));
const pads=c.filter(x=>x.type==='pcb_smtpad');
const oldPaste=new Map(c.filter(x=>x.type==='pcb_solder_paste').map(x=>[x.pcb_smtpad_id,x]));
c=c.filter(x=>x.type!=='pcb_solder_paste'&&!(x.type==='pcb_silkscreen_text'&&x.pcb_component_id));
for(const e of c){
 if(['pcb_silkscreen_path','pcb_silkscreen_circle'].includes(e.type))e.stroke_width=Math.max(.15,e.stroke_width??.15);
 if(e.type==='pcb_silkscreen_text')e.font_size=Math.max(.8,e.font_size);
}
let pasteCount=0;
for(const p of pads){
  const ref=components.get(p.pcb_component_id);
  if(ref?.startsWith('TP')||p.is_covered_with_solder_mask)continue;
  const base={...oldPaste.get(p.pcb_smtpad_id),type:'pcb_solder_paste',pcb_smtpad_id:p.pcb_smtpad_id,
    pcb_component_id:p.pcb_component_id,subcircuit_id:p.subcircuit_id,layer:p.layer,x:p.x,y:p.y,shape:p.shape};
  if(ref==='U1'&&p.width>3&&p.height>3){
    for(const dx of [-.75,.75])for(const dy of [-.75,.75])c.push({...base,
      pcb_solder_paste_id:`reviewed_paste_${pasteCount++}`,x:p.x+dx,y:p.y+dy,width:1.25,height:1.25});
  }else{
    const scale=ref==='U3'&&p.width>1? .85:.95;
    c.push({...base,pcb_solder_paste_id:`reviewed_paste_${pasteCount++}`,
      ...(p.shape==='circle'?{radius:p.radius*scale}:{width:p.width*scale,height:p.height*scale})});
  }
}
// Clip graphic strokes against solderable features with 0.20 mm clearance.
// Tented vias are intentionally not mask openings; exposed through holes are.
const openings=[...pads,...c.filter(x=>x.type==='pcb_plated_hole')];
const rects=layer=>openings.filter(p=>(p.layer===layer||p.layers?.includes(layer))&&!p.is_covered_with_solder_mask)
 .map(p=>({x:p.x,y:p.y,w:p.width??p.outer_width??2*p.radius,h:p.height??p.outer_height??2*p.radius}));
const interval=(a,b,r,inflate)=>{
  let lo=0,hi=1;
  for(const [dim,size] of [['x','w'],['y','h']]){
    const min=r[dim]-r[size]/2-inflate,max=r[dim]+r[size]/2+inflate,d=b[dim]-a[dim];
    if(Math.abs(d)<1e-12){if(a[dim]<min||a[dim]>max)return null;}
    else{let u=(min-a[dim])/d,v=(max-a[dim])/d;if(u>v)[u,v]=[v,u];lo=Math.max(lo,u);hi=Math.min(hi,v);if(lo>hi)return null;}
  }return [lo,hi];
};
let clipped=0,serial=0;
c=c.flatMap(e=>{
 if(e.type!=='pcb_silkscreen_path')return [e];
 const out=[], obstacles=rects(e.layer),half=(e.stroke_width??.15)/2;
 for(let i=1;i<e.route.length;i++){
  const a=e.route[i-1],b=e.route[i];
  const onBoard=interval(a,b,{x:0,y:0,w:42,h:34},-.2-half);
  let intervals=onBoard?[onBoard]:[];
  for(const r of obstacles){const cut=interval(a,b,r,.20+half);if(!cut)continue;
   intervals=intervals.flatMap(([lo,hi])=>cut[1]<=lo||cut[0]>=hi?[[lo,hi]]:
    [[lo,Math.min(hi,cut[0])],[Math.max(lo,cut[1]),hi]].filter(([l,h])=>h-l>1e-7));
  }
  if(intervals.length!==1||intervals[0]?.[0]!==0||intervals[0]?.[1]!==1)clipped++;
  for(const [lo,hi] of intervals){if((hi-lo)*Math.hypot(b.x-a.x,b.y-a.y)<.12)continue;
   out.push({...e,pcb_silkscreen_path_id:`reviewed_silk_${serial++}`,route:[lo,hi].map(t=>({x:a.x+t*(b.x-a.x),y:a.y+t*(b.y-a.y)}))});}
 }return out;
});
fs.writeFileSync(file,JSON.stringify(c,null,2));
fs.writeFileSync('dist/manufacturing-adjustments.json',JSON.stringify({pasteApertures:pasteCount,
 normalPasteLinearScale:.95,rp2040ExposedPadWindows:4,rp2040WindowMm:1.25,
 rp2040PasteAreaRatio:6.25/(3.1*3.1),radioExposedPadLinearScale:.85,
 graphicSegmentsClipped:clipped,silkToPadClearanceMm:.2,silkToBoardEdgeMm:.2,minimumGraphicStrokeMm:.15,minimumLegendHeightMm:.8,copperChanged:false},null,2));
for(const layer of ['top','bottom']){
 let svg=convertCircuitJsonToPcbSvg(c,{
 layer,width:1600,height:1300,showSolderMask:true,showCourtyards:false,showPinNumbers:false,showFabricationNotes:false,
 backgroundColor:'#121a24',colorOverrides:{copper:{top:'#d7bc76',bottom:'#d7bc76'},drill:'#0a0d12',silkscreen:{top:'#f6f2e7',bottom:'#f6f2e7'},
 soldermask:{top:'#121a20',bottom:'#121a20'},soldermaskWithCopperUnderneath:{top:'#18242a',bottom:'#18242a'},
 soldermaskOverCopper:{top:'#18242a',bottom:'#18242a'}}});
 // CAD bottom export is viewed through the board. Mirror the entire drawing to
 // produce a face-on bottom inspection image, including readable physical text.
 if(layer==='bottom')svg=svg.replace(/(<svg\b[^>]*>)/,'$1<g transform="translate(1600 0) scale(-1 1)">').replace('</svg>','</g></svg>');
 fs.writeFileSync(`dist/pcb-${layer}.svg`,svg);
 const png=new Resvg(svg,{fitTo:{mode:'width',value:1400}}).render().asPng();
 fs.writeFileSync(`dist/pcb-${layer}.png`,png);
 if(layer==='top'){fs.writeFileSync('dist/index/pcb.svg',svg);fs.writeFileSync('dist/index/pcb.png',png);}
}
console.log(`Manufacturing finalization: ${pasteCount} paste apertures, ${clipped} silk segments clipped; copper unchanged.`);
