// Measure max-pixel movement within 120 ms after each kick and in the approach window before
// it.
// node bench/punchprobe.ts [effect ...]
// Report median, weakest tenth and maximum: sparse bursts differ from consistent kick
// responses.
// Approach catches anticipation effects such as lean. Values are bytes and depend on
// calibration;
// compare rankings or rerun after gamma/dimmer changes. A strong punch alone does not prove
// correct timing.
import { buildGeometry, DEFAULT_ROOM } from '../packages/core/src/geometry.ts';
import { scriptFrames } from '../packages/core/src/effects/gate.ts';
import { makePalette } from '../packages/core/src/color/palette.ts';
import { Mixer } from '../packages/core/src/mixer.ts';
import { BUILT_IN_EFFECTS } from '../packages/core/src/effects/index.ts';

const g = buildGeometry(DEFAULT_ROOM);
const frames = scriptFrames();
/** Fixed rather than taken from a show, so a number measured today compares with one from months ago. */
const PALETTE = makePalette({ base: 0, accent: 180, third: 60, sat: 0.94, shade: 0.14, white: 0.06 });
/** The eye integrates over roughly this long, and perceived brightness peaks inside it. */
const WINDOW_SECONDS = 0.12;

const named = process.argv.slice(2).filter((a) => !a.startsWith('-'));
const chosen = named.length
	? named.map((id) => BUILT_IN_EFFECTS.find((e) => e.id === id)).filter((e) => e !== undefined)
	: BUILT_IN_EFFECTS.filter((e) => e.taste.kit === 'kick' || e.taste.kit === 'any');

interface Row {
	id: string;
	energy: number;
	weakest: number;
	median: number;
	max: number;
	approach: number;
	mean: number;
}

const rows: Row[] = [];
for (const def of chosen) {
	const mixer = new Mixer(g);
	mixer.palette = PALETTE;
	mixer.intensity = 1;
	mixer.floor = 0;
	mixer.layers[def.role].setEffect(def, g);
	const snaps: Uint8Array[] = [];
	for (const f of frames) {
		mixer.render(f);
		snaps.push(Uint8Array.from(mixer.bytes));
	}

	const fps = 1 / Math.max(1e-4, frames[1].t - frames[0].t);
	const win = Math.max(1, Math.round(WINDOW_SECONDS * fps));
	const furthest = (a: Uint8Array, b: Uint8Array): number => {
		let m = 0;
		for (let i = 0; i < a.length; i++) {
			const d = Math.abs(a[i] - b[i]);
			if (d > m) m = d;
		}
		return m;
	};
	const jumps: number[] = [];
	const approach: number[] = [];
	for (let k = win + 1; k < frames.length - win; k++) {
		if (!frames[k].kick) continue;
		// The approach: what the room did in the window BEFORE the hit. An anticipation
		// gesture puts all of its movement here and none at the beat, and reading only the
		// arrival column would call it dead.
		approach.push(furthest(snaps[k], snaps[k - win]));
		let best = 0;
		for (let j = k; j <= k + win; j++) best = Math.max(best, furthest(snaps[j], snaps[k - 1]));
		jumps.push(best);
	}
	let sum = 0;
	let lit = 0;
	for (const s of snaps) {
		for (let i = 0; i < s.length; i++) {
			if (s[i] > 0) {
				sum += s[i];
				lit++;
			}
		}
	}
	jumps.sort((a, b) => a - b);
	rows.push({
		id: def.id,
		energy: def.taste.energy,
		weakest: jumps.length ? jumps[Math.floor(jumps.length * 0.1)] : 0,
		median: jumps.length ? jumps[jumps.length >> 1] : 0,
		max: jumps.length ? jumps[jumps.length - 1] : 0,
		approach: approach.length ? approach.slice().sort((a, b) => a - b)[approach.length >> 1] : 0,
		mean: sum / Math.max(1, lit)
	});
}

rows.sort((a, b) => a.median - b.median);
console.log(
	`${'effect'.padEnd(20)}${'e'.padStart(3)}${'weakest'.padStart(9)}${'median'.padStart(8)}` +
		`${'max'.padStart(7)}${'approach'.padStart(10)}${'lit mean'.padStart(10)}`
);
for (const r of rows) {
	console.log(
		`${r.id.padEnd(20)}${String(r.energy).padStart(3)}${String(r.weakest).padStart(9)}` +
			`${String(r.median).padStart(8)}${String(r.max).padStart(7)}` +
			`${String(r.approach).padStart(10)}${r.mean.toFixed(0).padStart(10)}`
	);
}
