// Does a hit READ? How far the room moves at the instant a kick lands.
//
//   node bench/punchprobe.ts                     # every kick-driven effect, ranked
//   node bench/punchprobe.ts emberBump pump      # named effects only
//
// `measureEffect`'s `react` column cannot answer this. It measures bytes moved across a whole
// journey against a deafened run, normalised by the effect's own mean - so a full-room look
// that answers every kick modestly scores LOWER than a beam-only look that answers a few
// hugely, and a constant-flux design (a saturation walk, a conserved trade) scores near zero
// by construction while still landing visibly. Both readings are true and neither is "is this
// punchy".
//
// So this asks the direct question: at each kick, how far does the furthest pixel move within
// 120 ms (the eye's own integration window plus a little) against the frame before it? The
// `approach` column asks the same of the window BEFORE the hit, because one archetype puts all
// its movement there - `lean` measures 87 approaching and 1 arriving, and reading only the
// arrival would call it dead when it is doing exactly what it was written to do. And it
// reports the WEAKEST tenth of those hits beside the median, because an effect whose average
// kick reads and whose quiet ones vanish stutters - which is exactly what separates the calm
// kick effects from the wild ones. The wild ones have enormous maxima and a weakest of ZERO:
// they fire rarely and hugely. The calm ones sit near their own median every time.
//
// Reference band, measured 2026-08-31 at SHOW 20 (weakest / median / max, then approach):
//
//   emberBump 26/27/27 a26    crossbeam 20/26/31 a24    counterweight 17/29/53 a19
//   pump 36/52/71 a48         impulseSpin 80/118/133 a105
//   lean 1/1/1 a58            moshSlam 0/0/155 a0       ricochet 158/164/170 a164
//
// These are BYTES, so they move whenever the room's calibration does. They were first taken
// at GAMMA 2.2 with no master dimmer and read about 40% higher; re-taken here at GAMMA 2.45
// and MASTER 0.7. The ORDERING did not move at all, which is the part worth trusting - read
// this table as a ranking and re-run it rather than comparing absolute numbers across
// calibrations.
//
// Three shapes fall out of the ranking. The calm kick effects sit near their own median on
// every hit and CANNOT SPIKE - the ones added in round 9 have the lowest maxima of any kick
// effect in the catalog (27 and 31, against counterweight's 53 and everything else's 71 to
// 170). The wild ones invert it: a weakest of zero and a maximum near the top of the range,
// because they fire rarely and enormously. And the ANTICIPATION shape reads as nothing at all
// in the arrival columns while moving 58 in the approach - `lean` is the only member today,
// and the approach column exists because without it that effect measured 1/1/1 and looked
// broken.
//
// A caution the numbers earned: `lean` scored a healthy-looking 33/35/72 here before a bug in
// it was fixed, and those numbers were measuring the BUG - a snap at the beat that the gesture
// was written not to have. A punch reading that looks healthy is not evidence the effect is
// right.
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
