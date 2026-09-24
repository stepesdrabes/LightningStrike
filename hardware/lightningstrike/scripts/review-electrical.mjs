import fs from 'node:fs';
import crypto from 'node:crypto';
// Independent pin contract: physical pin numbers from manufacturer datasheets,
// not the source file's net definitions. Checks the built output used for export.
const bytes=fs.readFileSync('dist/index/circuit.json'),c=JSON.parse(bytes);
const parts=new Map(c.filter(x=>x.type==='source_component').map(x=>[x.source_component_id,x]));
const nets=new Map(c.filter(x=>x.type==='source_net').map(x=>[x.subcircuit_connectivity_map_key,x.name]));
const ports=c.filter(x=>x.type==='source_port');
const portNets=new Map(ports.map(p=>[`${parts.get(p.source_component_id)?.name}.${p.pin_number}`,nets.get(p.subcircuit_connectivity_map_key)]));
const checks=[];
const check=(name,ok,detail='')=>{checks.push({name,pass:!!ok,detail});};
const contract={
 U1:{1:'V3V3',10:'V3V3',19:'GND',20:'XIN',21:'XOUT',22:'V3V3',23:'V1V1',24:'SWCLK',25:'SWDIO',26:'RUN',
 33:'V3V3',42:'V3V3',43:'V3V3',44:'V3V3',45:'V1V1',46:'USB_DM_MCU',47:'USB_DP_MCU',48:'V3V3',49:'V3V3',50:'V1V1',
 51:'QSPI_D3',52:'QSPI_CLK',53:'QSPI_D0',54:'QSPI_D2',55:'QSPI_D1',56:'QSPI_CS',57:'GND',
 4:'LED_A_3V3',5:'LED_B_3V3',6:'LED_C_3V3',7:'LED_ENABLE',13:'RADIO_CLK',14:'RADIO_MOSI',15:'RADIO_MISO',
 16:'RADIO_CS',17:'RADIO_READY',18:'RADIO_HANDSHAKE',27:'RADIO_EN',28:'RADIO_BOOT',29:'WIFI_SELECT',30:'USB_PRESENT',31:'FIXTURE_PRESENT',37:'STATUS'},
 U2:{1:'QSPI_CS',2:'QSPI_D1',3:'QSPI_D2',4:'GND',5:'QSPI_D0',6:'QSPI_CLK',7:'QSPI_D3',8:'V3V3',9:'GND'},
 U3:{1:'GND',2:'GND',3:'V3V3',5:'RADIO_STRAP2',6:'RADIO_MISO_TERM',8:'ESP_EN',11:'GND',14:'GND',16:'RADIO_CS',
 18:'RADIO_READY',19:'RADIO_HANDSHAKE',20:'RADIO_CLK_TERM',21:'RADIO_MOSI_TERM',22:'RADIO_STRAP8',23:'RADIO_BOOT',30:'RADIO_UART_RX',31:'RADIO_UART_TX',
 ...Object.fromEntries(Array.from({length:26},(_,i)=>[36+i,'GND']))},
 U4:{1:'V3V3',2:'VSYS',3:'VSYS',4:'GND',5:'SW',6:'BST'},
 U5:{1:'LED_N_OE',2:'LED_A_3V3',3:'LED_A_DRIVE',4:'LED_N_OE',5:'LED_B_3V3',6:'LED_B_DRIVE',7:'GND',
 8:'LED_C_DRIVE',9:'LED_C_3V3',10:'LED_N_OE',12:'GND',13:'V5_OUT',14:'V5_OUT'},
 Q1:{1:'GND',2:'V5_OUT',3:'V5_FUSED'},Q2:{1:'LED_ENABLE',2:'GND',3:'LED_N_OE'},
 D1:{1:'VSYS',2:'V5_OUT'},D2:{1:'VSYS',2:'VBUS'},D3:{1:'USB_DP',2:'GND',3:'USB_DM',4:'USB_DM',5:'VBUS',6:'USB_DP'},
 J1:{1:'V5_IN',2:'GND',3:'GND',4:'GND'},J2:{1:'DATA_A',2:'DATA_B',3:'DATA_C'},
 J3:{13:'GND',14:'GND',15:'GND',16:'VBUS',18:'USB_CC1',19:'USB_DM',20:'USB_DP',21:'USB_DM',22:'USB_DP',24:'USB_CC2',25:'VBUS',26:'GND',27:'GND',28:'GND'},
 R8:{1:'V5_OUT',2:'LED_N_OE'},R32:{1:'LED_ENABLE',2:'GND'},R14:{1:'USB_CC1',2:'GND'},R15:{1:'USB_CC2',2:'GND'},
 C4:{1:'BST',2:'SW'},C5:{1:'V3V3',2:'GND'},C6:{1:'V3V3',2:'GND'},
 C16:{1:'V1V1',2:'GND'},C17:{1:'V1V1',2:'GND'},C18:{1:'V1V1',2:'GND'},C22:{1:'ESP_EN',2:'GND'},
 Y1:{1:'XIN',2:'GND',3:'XTAL_OUT',4:'GND'},
};
for(const [ref,pins] of Object.entries(contract))for(const [pin,net] of Object.entries(pins))
 check(`${ref}.${pin} = ${net}`,portNets.get(`${ref}.${pin}`)===net,`actual: ${portNets.get(`${ref}.${pin}`)}`);
for(const ref of ['D4','D5','D6'])check(`${ref} bidirectional ESD part`,[...parts.values()].find(p=>p.name===ref)?.manufacturer_part_number==='PESD5V0S1BLN');
for(const key of ['J2.4','J2.5','J3.17','J3.23','U5.11'])check(`${key} intentional no-connect`,!portNets.get(key));
const part=ref=>[...parts.values()].find(p=>p.name===ref);
for(const [ref,val] of Object.entries({R5:27,R16:27,R8:10000,R32:100000,R14:5100,R15:5100,R4:1000,R21:150,R22:150,R23:150}))
 check(`${ref} resistance`,part(ref)?.resistance===val,String(part(ref)?.resistance));
check('Exact external-antenna radio',part('U3')?.manufacturer_part_number==='ESP32-C3-MINI-1U-N4X');
check('Bare RP2040',part('U1')?.manufacturer_part_number==='RP2040');
check('5 V tolerant isolation at OE',!ports.some(p=>p.source_component_id===part('U1').source_component_id&&nets.get(p.subcircuit_connectivity_map_key)==='LED_N_OE'));
check('Core decoupling populated',[16,17,18].every(n=>part('C'+n)?.capacitance>0));
const critical=JSON.parse(fs.readFileSync('critical-routes.json'));
const routing=JSON.parse(fs.readFileSync('routing.json'));
for(const name of ['XIN','XOUT','XTAL_OUT','USB_DP','USB_DM','USB_DP_MCU','USB_DM_MCU']){
 const ts=routing.traces.filter(t=>t.net===name);
 check(`${name}: top copper only, no vias`,ts.length>0&&ts.every(t=>t.route.every(p=>p.route_type==='wire'&&p.layer==='top')));
}
// Confirm every protected segment survives in saved routing, in either direction.
for(const [i,t] of critical.entries()){
 const near=(p,q)=>Math.hypot(p.x-q[0],p.y-q[1])<.001;
 check(`Protected route ${i}: ${t.net}`,routing.traces.some(r=>r.net===t.net&&r.route.length===t.points.length&&
  (r.route.every((p,j)=>near(p,t.points[j]))||r.route.every((p,j)=>near(p,t.points.at(-1-j))))));
}
const board=c.find(e=>e.type==='pcb_board');
check('Compact six-layer dimensions',board.width===42&&board.height===34&&board.thickness===1.2&&board.num_layers===6);
check('No circuit error records',!c.some(e=>e.type.endsWith('_error')));
const adjusted=JSON.parse(fs.readFileSync('dist/manufacturing-adjustments.json'));
check('Four-window RP2040 paste',adjusted.rp2040ExposedPadWindows===4&&adjusted.rp2040PasteAreaRatio>=.6&&adjusted.rp2040PasteAreaRatio<=.7);
const report={date:new Date().toISOString(),revision:'R2',circuitSha256:crypto.createHash('sha256').update(bytes).digest('hex'),
 checks,passed:checks.filter(x=>x.pass).length,failed:checks.filter(x=>!x.pass),
 limits:'Static CAD and pin-contract checks, not powered functional tests, RF qualification or supplier DFM approval.'};
fs.writeFileSync('dist/electrical-review.json',JSON.stringify(report,null,2));
console.log(`${report.passed}/${checks.length} electrical/CAD review checks passed`);
if(report.failed.length){console.log(report.failed);process.exitCode=1;}
