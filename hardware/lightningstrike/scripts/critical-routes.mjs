import fs from 'node:fs';
// Explicit, reviewable copper for clock, USB and buck loops. The general router
// may route other nets around these but must not replace these paths.
const c=JSON.parse(fs.readFileSync('dist/index/circuit.json'));
const sc=new Map(c.filter(x=>x.type==='source_component').map(x=>[x.source_component_id,x.name]));
const pc=new Map(c.filter(x=>x.type==='pcb_component').map(x=>[x.pcb_component_id,sc.get(x.source_component_id)]));
const sp=new Map(c.filter(x=>x.type==='source_port').map(x=>[x.source_port_id,x]));
const pp=new Map(c.filter(x=>x.type==='pcb_port').map(x=>[x.pcb_port_id,sp.get(x.source_port_id)]));
const pads=new Map(c.filter(x=>x.type==='pcb_smtpad'||x.type==='pcb_plated_hole').map(p=>[pc.get(p.pcb_component_id)+'.'+pp.get(p.pcb_port_id).pin_number,p]));
const xy=id=>{const p=pads.get(id);if(!p)throw Error(id);return [+p.x.toFixed(6),+p.y.toFixed(6)];};
const paths=[];
const vias=[];
const route=(net,a,b,mid=[],width=.15)=>paths.push({net,layer:'top',width,from:a,to:b,points:[xy(a),...mid,xy(b)]});
route('XIN','U1.20','Y1.1',[[-7.599948,-3.05],[-8.2,-3.650052],[-8.2,-5.949915]]);
route('XIN','Y1.1','C24.1');
route('XOUT','U1.21','R4.1');
route('XTAL_OUT','R4.2','C25.1',[[-7,-4.91],[-7,-7.65],[-6.15,-8.5]]);
route('XTAL_OUT','C25.1','Y1.3');
// USB-C mirrored contacts: one bridge above and one below the contact row.
route('USB_DM','J3.19','J3.21',[[-13.250065,10.5],[-14.250063,10.5]]);
route('USB_DP','J3.20','J3.22',[[-13.749937,8.7],[-14.749935,8.7]]);
route('USB_DP','J3.22','D3.6',[[-14.749935,8.4]]);
route('USB_DM','J3.19','D3.4',[[-13.250065,8.4]]);
route('USB_DP','D3.6','D3.1');
route('USB_DM','D3.4','D3.3');
route('USB_DP','D3.1','R16.1',[[-14.94996,4.6],[-12.6,4.6],[-11,6.2],[-7.9,6.2],[-7.09,7.01]]);
route('USB_DM','D3.3','R5.1',[[-13.05004,4.92],[-12.73255,4.92],[-11.13255,6.52],[-8.03255,6.52],[-6.90255,7.65],[-5.4,7.65]]);
route('USB_DP_MCU','U1.47','R16.2',[[-6.000002,5.19],[-6.4,5.59]]);
route('USB_DM_MCU','U1.46','R5.2',[[-5.599952,5.39],[-5.4,5.589952]]);
// Short local buck loops and bootstrap. VIN and output paths are deliberately wide.
route('VSYS','U4.3','C2.1',[],.6);
route('VSYS','U4.2','U4.3',[],.3);
route('VSYS','C2.1','C3.1',[[6.51,-9.375]],.4);
route('GND','U4.4','C3.2',[],.3);
route('SW','U4.5','L1.1',[[3,-6.8],[1.499876,-5.299876]],.6);
route('SW','C4.2','L1.1',[[.6,-6.7]],.25);
route('BST','U4.6','C4.1',[[2.05004,-8.7],[.6,-8.7]],.2);
route('V3V3','L1.2','C5.1',[[5.05,-4.9125]],.6);
route('V3V3','C5.1','C6.1',[],.6);
// Feedback returns to output capacitor positive, away from the switch node.
route('V3V3','U4.1','C6.1',[[2.05004,-11.8],[8.5,-11.8]],.2);
// Escape crowded QFN pins inward before the general router. These also keep
// the local core decouplers directly connected instead of following long buses.
const escape=(net,pin,at,mid=[],width=.15)=>{
 vias.push({net,x:at[0],y:at[1]});
 paths.push({net,layer:'top',width,from:pin,to:'via',points:[xy(pin),...mid,at]});
};
escape('QSPI_CLK','U1.52',[-8.4,3.5],[[-7.999998,3.9]]);
escape('V1V1','U1.23',[-5.6,-1.1],[[-6.400052,-1.96],[-5.6,-1.159948]]);
escape('SWDIO','U1.25',[-4.8,-1.1],[[-5.599952,-1.96],[-4.8,-1.160048]]);
escape('RADIO_READY','U1.17',[-9.3,-.8],[[-8.800098,-1.8],[-9.3,-1.300098]]);
escape('GND','U1.19',[-8.1,-.95],[[-7.999998,-1.050002]]);
escape('GND','U1.57',[-9.0,1.000127],[],.3);
escape('V1V1','U1.45',[-4.9,5.25],[[-5.200156,4.949844]]);
escape('V1V1','U1.50',[-7.6,3.3],[[-7.200152,3.699848]]);
paths.push({net:'V1V1',layer:'bottom',width:.25,from:'via',to:'C16.1',points:[[-4.9,5.25],[-5.7,6.05],xy('C16.1')]});
paths.push({net:'V1V1',layer:'bottom',width:.25,from:'via',to:'C18.1',points:[[-7.6,3.3],[-8.01,2.89],xy('C18.1')]});
escape('GND','U4.4',[4.8,-8.5],[],.3);
escape('GND','C2.2',[7.5125,-9.0],[],.4);
escape('GND','C5.2',[6.5,-2.1],[],.4);
escape('GND','C6.2',[8.5,-2.1],[],.4);
escape('GND','C24.2',[-10.6,-7.3]);
escape('GND','C25.2',[-2,-8.5]);
escape('GND','D3.2',[-14.3,6.5]);
escape('GND','U3.51',[17.2,2.8],[[16.95,3.050175]]);
route('GND','J3.15','J3.13',[],.3);
route('GND','J3.26','J3.14',[],.3);
route('GND','J3.13','J3.27',[],.3);
route('GND','J3.14','J3.28',[],.3);
// Local exits for fine-pitch supply pins and otherwise enclosed pad islands.
escape('GND','Y1.2',[-9.4,-8.5]);
escape('GND','LED1.1',[12.25,-8]);
escape('VBUS','D3.5',[-13.7,6.9]);
escape('V3V3','U1.22',[-6.3,-4.05],[[-6.800102,-3.0],[-6.3,-3.500102]]);
escape('V3V3','C6.1',[9.7,-4.9125],[],.3);
escape('RUN','SW3.1',[-6.6849,13.8]);
escape('WIFI_SELECT','U1.29',[-2.5,-1.6001]);
escape('V3V3','U4.1',[7,-12.0156],[[2.05004,-11.8],[7,-11.8]],.2);
escape('RADIO_BOOT','U1.28',[-3.9001,-2.2251]);
// Reviewed inner-layer connection for the slow boot strap. The saved general
// router could not complete this escape; it is checked with all other copper.
const bootRoute=JSON.parse(fs.readFileSync('radio-boot-route.json'));
paths.push(bootRoute);
for(const [x,y] of [bootRoute.points[0],bootRoute.points.at(-1)])
 if(!vias.some(v=>v.net===bootRoute.net&&Math.hypot(v.x-x,v.y-y)<.001))vias.push({net:bootRoute.net,x,y});
fs.writeFileSync('critical-routes.json',JSON.stringify(paths,null,2)+'\n');
fs.writeFileSync('critical-vias.json',JSON.stringify(vias,null,2)+'\n');
console.log(`Saved ${paths.length} protected routes`);
