import { TYPE_C_16PIN_2MD_073_ } from './imports/TYPE_C_16PIN_2MD_073_';
import { savedRouter } from './saved-router';
import { LTST_C190KGKT } from './imports/LTST_C190KGKT';
import { RP2040 } from './imports/RP2040';
import { ESP32_C3_MINI_1U_N4 } from './imports/ESP32_C3_MINI_1U_N4';
import { AP63203WU_7 } from './imports/AP63203WU_7';
import { SN74AHCT125PWR } from './imports/SN74AHCT125PWR';
import { BM02B_GHS_TBT_LF__SN_ } from './imports/BM02B_GHS_TBT_LF__SN_';
import { BM03B_GHS_TBT_LF__SN_ } from './imports/BM03B_GHS_TBT_LF__SN_';
import { W25Q16JVUXIQ } from './imports/W25Q16JVUXIQ';
import { ABM8_272_T3 } from './imports/ABM8_272_T3';
import { TS_1088_AR02016 } from './imports/TS_1088_AR02016';
import { USBLC6_2SC6 } from './imports/USBLC6_2SC6';
import { AO3401A } from './imports/AO3401A';
import { AO3400A } from './imports/AO3400A';
import { StormCrest } from './storm-crest';
import { B5819W_SL } from './imports/B5819W_SL';
import { FNR4030S4R7MT } from './imports/FNR4030S4R7MT';
import { PESD5V0S1BLN } from './imports/PESD5V0S1BLN';

const sections = ['Power', 'RP2040', 'Radio', 'Outputs', 'USB', 'Service'] as const;
type Section = typeof sections[number];
const origin: Record<Section, [number, number]> = {
	Power: [-40, 24], RP2040: [0, 24], Radio: [40, 24],
	Outputs: [-40, -20], USB: [0, -20], Service: [40, -20],
};
const sch = (section: Section, x: number, y: number) => ({
	schSheetName: 'Controller', schSectionName: section,
	schX: origin[section][0] + x, schY: origin[section][1] + y,
});

// Numeric pins are the physical manufacturer pad numbers, including exposed grounds.
export const nets: Record<string, string[]> = {
	GND: ['U1.19', 'U1.57', 'U2.4', 'U2.9', 'U3.1', 'U3.2', 'U3.11', 'U3.14',
		...Array.from({ length: 26 }, (_, i) => `U3.${36 + i}`),
		'U4.4', 'U5.7', 'U5.12', 'J1.2', 'J1.3', 'J1.4', 'Q1.1',
		'Y1.2', 'Y1.4', 'SW1.2', 'SW2.2', 'SW3.2', 'D3.2',
		'J3.GND1', 'J3.GND2', 'J3.SHELL1', 'J3.SHELL2', 'J3.SHELL3', 'J3.SHELL4',
		'TP1.1', 'TP7.1', 'R9.2', 'R10.2', 'R11.2', 'R12.2',
		'R14.2', 'R15.2', 'R26.2', 'R17.1', 'D4.1', 'D5.1', 'D6.1', 'LED1.1',
		...Array.from({ length: 21 }, (_, i) => `C${i + 1}.2`).filter(p => p !== 'C4.2'),
		'C23.2', 'C24.2', 'C25.2', 'Q2.2', 'R32.2'],
	V5_IN: ['J1.1', 'F1.1'],
	V5_FUSED: ['F1.2', 'Q1.3'],
	V5_OUT: ['Q1.2', 'D1.2', 'U5.14', 'U5.13', 'C1.1', 'C20.1', 'TP3.1', 'R25.1', 'R8.1'],
	VBUS: ['J3.VBUS1', 'J3.VBUS2', 'D2.2', 'D3.5', 'R13.1'],
	VSYS: ['D1.1', 'D2.1', 'U4.3', 'U4.2', 'C2.1', 'C3.1'],
	SW: ['U4.5', 'L1.1', 'C4.2'],
	BST: ['U4.6', 'C4.1'],
	V3V3: ['L1.2', 'U4.1', 'C5.1', 'C6.1', 'U2.8', 'U3.3',
		'U1.1', 'U1.10', 'U1.22', 'U1.33', 'U1.42', 'U1.43', 'U1.44', 'U1.48', 'U1.49',
		...Array.from({ length: 9 }, (_, i) => `C${7 + i}.1`), 'C19.1', 'C21.1', 'C23.1',
		'R1.1', 'R2.1', 'R6.1', 'R18.1', 'R19.1', 'R20.1', 'TP2.1'],
	V1V1: ['U1.45', 'U1.23', 'U1.50', 'C16.1', 'C17.1', 'C18.1', 'TP4.1'],
	QSPI_CS: ['U1.56', 'U2.1', 'R1.2', 'R3.1'],
	QSPI_CLK: ['U1.52', 'U2.6'], QSPI_D0: ['U1.53', 'U2.5'],
	QSPI_D1: ['U1.55', 'U2.2'], QSPI_D2: ['U1.54', 'U2.3'], QSPI_D3: ['U1.51', 'U2.7'],
	BOOTSEL: ['R3.2', 'SW2.1'], RUN: ['U1.26', 'R2.2', 'SW3.1', 'TP6.1'],
	XIN: ['U1.20', 'Y1.1', 'C24.1'], XOUT: ['U1.21', 'R4.1'],
	XTAL_OUT: ['R4.2', 'Y1.3', 'C25.1'],
	WIFI_SELECT: ['U1.29', 'SW1.1', 'R6.2'],
	LED_N_OE: ['Q2.3', 'U5.1', 'U5.4', 'U5.10', 'R8.2'],
	LED_ENABLE: ['U1.7', 'Q2.1', 'R32.1'],
	LED_A_3V3: ['U1.4', 'U5.2', 'R9.1'],
	LED_B_3V3: ['U1.5', 'U5.5', 'R10.1'],
	LED_C_3V3: ['U1.6', 'U5.9', 'R11.1'],
	LED_A_DRIVE: ['U5.3', 'R21.1'], LED_B_DRIVE: ['U5.6', 'R22.1'],
	LED_C_DRIVE: ['U5.8', 'R23.1'],
	DATA_A: ['R21.2', 'J2.1', 'D4.2'], DATA_B: ['R22.2', 'J2.2', 'D5.2'],
	DATA_C: ['R23.2', 'J2.3', 'D6.2'],
	USB_DP: ['J3.DP1', 'J3.DP2', 'D3.1', 'D3.6', 'R16.1'],
	USB_DM: ['J3.DM1', 'J3.DM2', 'D3.3', 'D3.4', 'R5.1'],
	USB_DP_MCU: ['R16.2', 'U1.47'], USB_DM_MCU: ['R5.2', 'U1.46'],
	USB_CC1: ['J3.CC1', 'R14.1'], USB_CC2: ['J3.CC2', 'R15.1'],
	USB_PRESENT: ['R13.2', 'R12.1', 'U1.30'],
	FIXTURE_PRESENT: ['R25.2', 'R26.1', 'U1.31'],
	RADIO_CLK: ['U1.13', 'R27.1'], RADIO_CLK_TERM: ['R27.2', 'U3.20'],
	RADIO_MOSI: ['U1.14', 'R28.1'], RADIO_MOSI_TERM: ['R28.2', 'U3.21'],
	RADIO_MISO: ['U1.15', 'R29.2'], RADIO_MISO_TERM: ['R29.1', 'U3.6'],
	RADIO_CS: ['U1.16', 'U3.16', 'R20.2'],
	RADIO_READY: ['U1.17', 'U3.18'], RADIO_HANDSHAKE: ['U1.18', 'U3.19'],
	RADIO_EN: ['U1.27', 'R31.1'],
	ESP_EN: ['R31.2', 'U3.8', 'R17.2', 'C22.1', 'TP10.1'],
	RADIO_BOOT: ['U1.28', 'U3.23', 'R18.2', 'TP11.1'],
	RADIO_STRAP2: ['U3.5', 'R19.2'], RADIO_STRAP8: ['U3.22', 'R30.2'],
	RADIO_UART_RX: ['U3.30', 'TP8.1'], RADIO_UART_TX: ['U3.31', 'TP9.1'],
	SWCLK: ['U1.24', 'TP5.1'], SWDIO: ['U1.25', 'TP12.1'],
	STATUS: ['U1.37', 'R24.1'], STATUS_LED: ['R24.2', 'LED1.2'],
};
nets.GND.push('C22.2');
nets.V3V3.push('R30.1');

type Passive = { name: string; value: string; x: number; y: number; section: Section;
	sx: number; sy: number; rotation?: number; bottom?: boolean; footprint?: string };
const resistors: Passive[] = [
	{ name: 'R1', value: '10k', x: -7, y: 9, section: 'RP2040', sx: -9, sy: 10, bottom: true },
	{ name: 'R2', value: '10k', x: -4, y: -3.5, section: 'RP2040', sx: 7, sy: -7, bottom: true },
	{ name: 'R3', value: '1k', x: -5, y: 10, section: 'RP2040', sx: -5, sy: 10, bottom: true },
	{ name: 'R4', value: '1k', x: -7.2, y: -4.2, rotation: 270, section: 'RP2040', sx: -9, sy: -10 },
	{ name: 'R5', value: '27', x: -5.4, y: 6.5, section: 'USB', sx: 6, sy: -3, rotation: 270 },
	{ name: 'R6', value: '10k', x: 14, y: -8.6, section: 'Service', sx: -8, sy: 3 },
	{ name: 'R8', value: '10k', x: -12, y: -3, section: 'Outputs', sx: -8, sy: 7, bottom: true },
	{ name: 'R9', value: '100k', x: -12, y: -4.5, section: 'Outputs', sx: -8, sy: 4, bottom: true },
	{ name: 'R10', value: '100k', x: -12, y: -6, section: 'Outputs', sx: -8, sy: 1, bottom: true },
	{ name: 'R11', value: '100k', x: -12, y: -7.5, section: 'Outputs', sx: -8, sy: -2, bottom: true },
	{ name: 'R12', value: '100k', x: -19, y: 6.5, section: 'USB', sx: -5, sy: -7, rotation: 180, bottom: true },
	{ name: 'R13', value: '100k', x: -19, y: 8, section: 'USB', sx: -5, sy: -4, bottom: true },
	{ name: 'R14', value: '5.1k', x: -16, y: 9, section: 'USB', sx: -9, sy: -4, bottom: true },
	{ name: 'R15', value: '5.1k', x: -17, y: 7, section: 'USB', sx: -9, sy: -7, bottom: true },
	{ name: 'R16', value: '27', x: -6.4, y: 6.5, section: 'USB', sx: 6, sy: 0, rotation: 270 },
	{ name: 'R17', value: '100k', x: 3, y: 6, section: 'Radio', sx: -9, sy: 5, bottom: true },
	{ name: 'R18', value: '10k', x: 8, y: 1, section: 'Radio', sx: 7, sy: -5, bottom: true },
	{ name: 'R19', value: '10k', x: 3, y: 8, section: 'Radio', sx: -9, sy: 2, bottom: true },
	{ name: 'R20', value: '10k', x: 5, y: 1, section: 'Radio', sx: -9, sy: -4, bottom: true },
	{ name: 'R21', value: '150', x: -16, y: -8.3, section: 'Outputs', sx: 6, sy: 4 },
	{ name: 'R22', value: '150', x: -13.5, y: -8.3, section: 'Outputs', sx: 6, sy: 1 },
	{ name: 'R23', value: '150', x: -11, y: -8.3, section: 'Outputs', sx: 6, sy: -2 },
	{ name: 'R24', value: '1k', x: 10, y: -10, section: 'Service', sx: 5, sy: 3, bottom: true },
	{ name: 'R25', value: '100k', x: 0, y: -11, section: 'Power', sx: 11, sy: 0, rotation: 180, bottom: true },
	{ name: 'R26', value: '100k', x: 0, y: -12.5, section: 'Power', sx: 11, sy: -3, bottom: true },
	{ name: 'R27', value: '33', x: -12, y: -1.2, section: 'Radio', sx: -7, sy: -10, bottom: true },
	{ name: 'R28', value: '33', x: -6, y: -3, section: 'Radio', sx: -3, sy: -10, bottom: true },
	{ name: 'R29', value: '33', x: 3, y: 3, section: 'Radio', sx: 1, sy: -10, bottom: true },
	{ name: 'R30', value: '10k', x: 10, y: 1, section: 'Radio', sx: 11, sy: -5, bottom: true },
	{ name: 'R31', value: '1k', x: 0, y: 3, section: 'Radio', sx: -12, sy: 8, bottom: true },
	{ name: 'R32', value: '100k', x: -17, y: -3, section: 'Outputs', sx: -12, sy: 7, bottom: true },
];
const capacitors: Passive[] = [
	{ name: 'C1', value: '10uF', x: -6, y: -8, footprint: '0805', section: 'Power', sx: -5, sy: 7, bottom: true },
	{ name: 'C2', value: '10uF', x: 6.6, y: -10.2, footprint: '0805', section: 'Power', sx: 0, sy: 7 },
	{ name: 'C3', value: '100nF', x: 6, y: -7.8, section: 'Power', sx: 3, sy: 7, rotation: 180 },
	{ name: 'C4', value: '100nF', x: 0.6, y: -8.3, section: 'Power', sx: 3, sy: 3, rotation: 90 },
	{ name: 'C5', value: '22uF', x: 6.5, y: -4, footprint: '0805', section: 'Power', sx: 7, sy: 7, rotation: 90 },
	{ name: 'C6', value: '22uF', x: 8.5, y: -4, footprint: '0805', section: 'Power', sx: 10, sy: 7, rotation: 90 },
	{ name: 'C7', value: '100nF', x: -10, y: 3, section: 'RP2040', sx: -12, sy: 5, bottom: true },
	{ name: 'C8', value: '100nF', x: -10, y: 0, section: 'RP2040', sx: -12, sy: 2, bottom: true },
	{ name: 'C9', value: '100nF', x: -7, y: -1.5, section: 'RP2040', sx: -12, sy: -1, bottom: true },
	{ name: 'C10', value: '100nF', x: -4, y: 0, section: 'RP2040', sx: -12, sy: -4, bottom: true },
	{ name: 'C11', value: '100nF', x: -4, y: 3, section: 'RP2040', sx: 12, sy: 5, bottom: true },
	{ name: 'C12', value: '100nF', x: -6.3, y: 3.5, section: 'RP2040', sx: 12, sy: 2, bottom: true },
	{ name: 'C13', value: '100nF', x: -4, y: 4.5, section: 'RP2040', sx: 12, sy: -1, bottom: true },
	{ name: 'C14', value: '1uF', x: -4, y: 6, section: 'RP2040', sx: 12, sy: -4, bottom: true },
	{ name: 'C15', value: '100nF', x: -7, y: 5, section: 'RP2040', sx: 12, sy: -7, bottom: true },
	{ name: 'C16', value: '1uF', x: -7, y: 6.5, section: 'RP2040', sx: -5, sy: -7, bottom: true },
	{ name: 'C17', value: '100nF', x: -9.3, y: -1.5, section: 'RP2040', sx: -1, sy: -7, bottom: true },
	{ name: 'C18', value: '100nF', x: -7.5, y: 1.5, section: 'RP2040', sx: 3, sy: -7, rotation: 180, bottom: true },
	{ name: 'C19', value: '100nF', x: -7, y: 12.9, section: 'RP2040', sx: -1, sy: 10 },
	{ name: 'C20', value: '100nF', x: -18.5, y: -2, section: 'Outputs', sx: 6, sy: 7 },
	{ name: 'C21', value: '100nF', x: 2, y: 11, section: 'Radio', sx: 8, sy: 5, bottom: true },
	{ name: 'C22', value: '100nF', x: 0, y: 5, section: 'Radio', sx: -9, sy: -1, bottom: true },
	{ name: 'C23', value: '10uF', x: 0, y: 7.5, footprint: '0805', section: 'Radio', sx: 12, sy: 5, bottom: true },
	{ name: 'C24', value: '15pF', x: -10.4, y: -6.3, rotation: 180, section: 'RP2040', sx: -5, sy: -10 },
	{ name: 'C25', value: '15pF', x: -4, y: -8.5, section: 'RP2040', sx: 3, sy: -10 },
];

const resistorParts: Record<string, string> = {
	'10k': 'RC0402FR-0710KL', '1k': 'RC0402FR-071KL', '27': 'RC0402FR-0727RL',
	'100k': 'RC0402FR-07100KL', '5.1k': 'RC0402FR-075K1L',
	'150': 'RC0402FR-07150RL', '33': 'RC0402FR-0733RL',
};
const capacitorParts: Record<string, string> = {
	'100nF': 'GRM155R71C104KA88D', '1uF': 'GRM155R61C105KE01D',
	'10uF': 'GRM21BR61C106KE15L', '22uF': 'GRM21BR61C226ME44L',
	'15pF': 'GRM1555C1H150JA01D',
};

export default () => <board width={42} height={34} borderRadius={2} layers={6}
	thickness={1.2} title="LightningStrike R2" solderMaskColor="black" silkscreenColor="white"
	doubleSidedAssembly defaultViaTenting="both_sides" minTraceWidth={0.15}
	autorouter={{ local: true, algorithmFn: savedRouter, traceClearance: 0.15 }} schTraceAutoLabelEnabled
	schMaxTraceDistance={4} pcbStyle={{ silkscreenTextPosition: 'none', viaHoleDiameter: 0.2, viaPadDiameter: 0.45 }}>
	{/* Sheet sizes are physical millimeters; schematic coordinates use 10 mm units. */}
	<schematicsheet name="Controller" displayName="LightningStrike R2 controller" sheetWidth={1300} sheetHeight={950} />
	{sections.map(name => <schematicsection name={name} displayName={name} />)}
	{sections.map(name => <schematictext text={name} schX={origin[name][0]} schY={origin[name][1] + 16} fontSize={0.8} />)}
	<RP2040 name="U1" pcbX={-7} pcbY={1} {...sch('RP2040', 0, 1)} />
	<W25Q16JVUXIQ name="U2" pcbX={-7} pcbY={10} {...sch('RP2040', -6, 6)} />
	<ESP32_C3_MINI_1U_N4 name="U3" pcbX={10} pcbY={8} {...sch('Radio', 0, 1)}
		manufacturerPartNumber="ESP32-C3-MINI-1U-N4X" supplierPartNumbers={{}} />
	<AP63203WU_7 name="U4" pcbX={3} pcbY={-9} {...sch('Power', 0, 0)} />
	<SN74AHCT125PWR name="U5" pcbX={-14.5} pcbY={-3.5} {...sch('Outputs', 0, 1)} />
	<BM02B_GHS_TBT_LF__SN_ name="J1" pcbX={-4} pcbY={-13} {...sch('Power', -12, 0)} />
	<BM03B_GHS_TBT_LF__SN_ name="J2" pcbX={-13} pcbY={-13} {...sch('Outputs', 12, 1)} />
	<TYPE_C_16PIN_2MD_073_ name="J3" pcbX={-14} pcbY={11.7} pcbRotation={180} {...sch('USB', -6, 2)} />
	<ABM8_272_T3 name="Y1" pcbX={-7} pcbY={-7.4} pcbRotation={270} {...sch('RP2040', -1, -10)} />
	<TS_1088_AR02016 name="SW1" pcbX={13} pcbY={-11} {...sch('Service', -4, 3)} />
	<TS_1088_AR02016 name="SW2" pcbX={-1} pcbY={11.5} {...sch('Service', -4, -1)} />
	<TS_1088_AR02016 name="SW3" pcbX={-4.5} pcbY={15.2} {...sch('Service', -4, -5)} />
	<AO3401A name="Q1" pcbX={-2} pcbY={-8} layer="bottom" {...sch('Power', -7, 0)} />
	<AO3400A name="Q2" pcbX={-17} pcbY={-5.5} layer="bottom" {...sch('Outputs', -12, 4)} />
	<fuse name="F1" currentRating="750mA" footprint="1206" pcbX={-4} pcbY={-12}
		layer="bottom" manufacturerPartNumber="SMD1206P075TFT" {...sch('Power', -10, 4)} />
	<B5819W_SL name="D1" pcbX={2} pcbY={-13} pcbRotation={180} {...sch('Power', -4, 3)} />
	<B5819W_SL name="D2" pcbX={-18} pcbY={2.9} {...sch('Power', -4, -3)} />
	<USBLC6_2SC6 name="D3" pcbX={-14} pcbY={6.7} {...sch('USB', 1, 2)} />
	{['D4', 'D5', 'D6'].map((name, i) => <PESD5V0S1BLN key={name} name={name}
		pcbX={-15.2 + i * 1.7} pcbY={-10} layer="bottom" pcbRotation={90}
		{...sch('Outputs', 5 + i * 4, -6)} />)}
	<FNR4030S4R7MT name="L1" pcbX={3} pcbY={-4.5} {...sch('Power', 5, 0)} />
	<LTST_C190KGKT name="LED1" color="green" pcbX={13} pcbY={-7}
		manufacturerPartNumber="LTST-C190KGKT" {...sch('Service', 9, 3)} />
	{resistors.map(r => <resistor key={r.name} name={r.name} resistance={r.value}
		manufacturerPartNumber={resistorParts[r.value]}
		footprint={r.footprint ?? '0402'} pcbX={r.x} pcbY={r.y} pcbRotation={r.rotation ?? 0}
		schRotation={r.name === 'R17' ? 90 : nets.GND.some(p => p.startsWith(r.name + '.')) || nets.V3V3.includes(r.name + '.1') || ['R13', 'R25'].includes(r.name) ? -90 : 0}
		layer={r.bottom ? 'bottom' : 'top'} {...sch(r.section, r.sx, r.sy)} />)}
	{capacitors.map(c => <capacitor key={c.name} name={c.name} capacitance={c.value}
		manufacturerPartNumber={capacitorParts[c.value]}
		maxVoltageRating={c.value === '15pF' ? 50 : 16} footprint={c.footprint ?? '0402'}
		pcbX={c.x} pcbY={c.y} pcbRotation={c.rotation ?? 0}
		schRotation={-90} layer={c.bottom ? 'bottom' : 'top'} {...sch(c.section, c.sx, c.sy)} />)}
	{Array.from({ length: 12 }, (_, i) => <testpoint key={i} name={`TP${i + 1}`} padDiameter={1.2} footprintVariant="pad"
		pcbX={5 + (i % 6) * 2} pcbY={-13 - Math.floor(i / 6) * 2} layer="bottom"
		{...sch('Service', -10 + (i % 6) * 4, -12 - Math.floor(i / 6) * 4)} />)}
	{Object.keys(nets).map(name => <net name={name}
		isGroundNet={name === 'GND'} isPowerNet={/^(V5_|VBUS|VSYS|V3V3|V1V1)/.test(name)} />)}
	{Object.entries(nets).flatMap(([name, pins]) => pins.map(p => {
		const [part, pin] = p.split('.');
		return <trace key={`${name}:${p}`} width={/^(V5_|VSYS|VBUS|SW$)/.test(name) ? 0.6 : name === "V3V3" ? 0.25 : 0.15} from={`.${part} > .${/^\d+$/.test(pin) ? `pin${pin}` : pin}`} to={`net.${name}`} />;
	}))}
	<copperpour name="GroundPlane" layer="inner1" connectsTo="net.GND" unbroken
		clearance={0.2} boardEdgeMargin={0.4} useThermalReliefs={false} />
	<copperpour name="BottomGroundPlane" layer="inner4" connectsTo="net.GND" unbroken
		clearance={0.2} boardEdgeMargin={0.4} useThermalReliefs={false} />
	<silkscreentext text="LightningStrike" pcbX={6} pcbY={-0.5} fontSize={1} />
	<silkscreentext text="WiFi" pcbX={13} pcbY={-13.5} fontSize={0.9} />
	<silkscreentext text="C  B  A" pcbX={-13} pcbY={-16.2} fontSize={0.75} />
	<silkscreentext text="GND  5V" pcbX={-4} pcbY={-16.2} fontSize={0.65} />
	<silkscreentext text="BOOT" pcbX={-1} pcbY={8.9} fontSize={0.8} />
	<silkscreentext text="R2" pcbX={18} pcbY={-15} fontSize={0.8} />
	<silkscreentext text="RP2040 + WiFi" pcbX={-12} pcbY={-14.4} layer="bottom" fontSize={0.8} />
	<silkscreentext text="5V only / A B C data" pcbX={-12} pcbY={-15.9} layer="bottom" fontSize={0.7} />
	<StormCrest />
</board>;



