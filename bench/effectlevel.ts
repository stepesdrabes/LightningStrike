// What every effect delivers to the strips, alone, through the real output chain.
//
//   node bench/effectlevel.ts                 # the whole catalog
//   node bench/effectlevel.ts vortex pump     # named effects only
//   node bench/effectlevel.ts --raw           # opacity 1, intensity 1: the effect's own output
//
// Each effect is rendered alone in a Mixer at its ROLE'S opacity budget and the cue intensity the
// engine writes for the section (groove 0.68, build 0.62, drop 0.9, intro 0.46, outro 0.5), with
// no house floor, over the gate's groove/build/void/drop journey and the quiet intro/outro
// journey. So a row is what that layer contributes to a cue, in bytes, not what the effect asks
// for in the authoring domain: the compressor, gamma and the 1.4 headroom are all in the number.
//
// Columns per section: auth (the mean of the authoring-domain frame after the intensity scale,
// which is the domain the four layers ADD in before gamma, so a stack's level is roughly the sum
// of its layers' auth), mean byte over the room, p90 (the pixel a tenth of the room is above,
// which is how bright the room LOOKS), strike (the brightest the room mean gets over the section:
// what an event effect delivers when it fires), fill (share of pixels over byte 24), on (share of frames
// the room is lit at all, which separates an event from a level), punch (median max-pixel move
// within 120 ms of a kick) and ripple (mean frame-to-frame move of the room mean: whole-room
// flicker) and shim (mean per-pixel move against an 80 ms average: twinkle, texture and jitter,
// which the room mean cannot see). Masters are armed for the first bar of the drop only.
import {
	BUILT_IN_EFFECTS,
	DEFAULT_OPACITY,
	DEFAULT_ROOM,
	Mixer,
	buildGeometry,
	makePalette,
	quietFrames,
	scriptFrames,
	type EffectDef,
	type SectionKind,
	type ShowFrame
} from '@mv/core';

const g = buildGeometry(DEFAULT_ROOM);
const PALETTE = makePalette({ base: 0, accent: 180, third: 60, sat: 0.94, shade: 0.14, white: 0.06 });
const argv = process.argv.slice(2);
const raw = argv.includes('--raw');
const named = argv.filter((a) => !a.startsWith('--'));
const chosen = named.length
	? named.map((id) => BUILT_IN_EFFECTS.find((e) => e.id === id)).filter((e): e is EffectDef => !!e)
	: [...BUILT_IN_EFFECTS];

/** The engine's own cue intensities, `intensityFor` in plan.ts, at the fixture's energies. */
const INTENSITY: Partial<Record<SectionKind, number>> = {
	intro: 0.46,
	groove: 0.68,
	build: 0.62,
	void: 0.05,
	drop: 0.9,
	outro: 0.5
};

const LIT = 24;
const WINDOW = 0.12;

interface Cell {
	frames: number;
	sum: number;
	/** Mean of the authoring-domain frame (post intensity scale), which is what the layers ADD in. */
	auth: number;
	p90: number;
	lit: number;
	on: number;
	ripple: number;
	/** Per-pixel movement against an 80 ms average, in bytes: texture, twinkle, jitter. */
	shimmer: number;
	punches: number[];
	/** Every frame's room mean, for the strike column: how bright the room gets when it fires. */
	means: number[];
}

function cell(): Cell {
	return { frames: 0, sum: 0, auth: 0, p90: 0, lit: 0, on: 0, ripple: 0, shimmer: 0, punches: [], means: [] };
}

const hist = new Uint32Array(256);

function run(def: EffectDef, frames: ShowFrame[], sections: SectionKind[]): Map<SectionKind, Cell> {
	const mixer = new Mixer(g);
	mixer.palette = PALETTE;
	mixer.floor = 0;
	const layer = mixer.layers[def.role];
	layer.setEffect(def, g);
	if (!raw) layer.opacity = DEFAULT_OPACITY[def.role];
	else layer.opacity = 1;

	const cells = new Map<SectionKind, Cell>();
	for (const s of sections) cells.set(s, cell());
	const n = g.count;
	const level = new Float32Array(n);
	const fast = new Float32Array(n);
	const snaps: Uint8Array[] = [];
	let prevMean = Number.NaN;
	const fps = 1 / Math.max(1e-4, frames[1].t - frames[0].t);
	const win = Math.max(1, Math.round(WINDOW * fps));
	const aFast = 1 - Math.exp(-1 / (fps * 0.08));
	let first = true;

	for (const f of frames) {
		mixer.intensity = raw ? 1 : (INTENSITY[f.section] ?? 0.7);
		// Hit performers render black until the player arms them: one bar of the drop is the hit.
		// By time rather than bar index, which rounds down on the drop's first frame.
		if (def.taste.hitOnly) {
			layer.params.trigger = f.section === 'drop' && f.timeSinceDrop < f.beatPeriod * 4 ? 1 : 0;
		}
		mixer.render(f);
		const bytes = mixer.bytes;
		let authSum = 0;
		for (let k = 0; k < n; k++) {
			const i = k * 3;
			authSum += Math.max(mixer.frame[i], mixer.frame[i + 1], mixer.frame[i + 2]);
		}
		let sum = 0;
		let lit = 0;
		let shimmer = 0;
		hist.fill(0);
		for (let k = 0; k < n; k++) {
			const i = k * 3;
			const v = Math.max(bytes[i], bytes[i + 1], bytes[i + 2]);
			level[k] = v;
			sum += v;
			if (v >= LIT) lit++;
			hist[v]++;
			if (first) fast[k] = v;
			shimmer += Math.abs(v - fast[k]);
			fast[k] += (v - fast[k]) * aFast;
		}
		first = false;
		const mean = sum / n;
		let seen = 0;
		let p90 = 0;
		for (let v = 255; v >= 0; v--) {
			seen += hist[v];
			if (seen >= n / 10) {
				p90 = v;
				break;
			}
		}
		const c = cells.get(f.section);
		if (c) {
			c.frames++;
			c.sum += mean;
			c.auth += authSum / n;
			c.p90 += p90;
			c.lit += lit / n;
			if (mean >= 8) c.on++;
			if (!Number.isNaN(prevMean)) c.ripple += Math.abs(mean - prevMean);
			c.shimmer += shimmer / n;
			c.means.push(mean);
		}
		prevMean = mean;
		snaps.push(Uint8Array.from(bytes));
	}

	// Punch: the furthest any pixel moves inside the window after each kick, against the frame before it.
	const furthest = (a: Uint8Array, b: Uint8Array) => {
		let m = 0;
		for (let i = 0; i < a.length; i++) {
			const d = Math.abs(a[i] - b[i]);
			if (d > m) m = d;
		}
		return m;
	};
	for (let k = 1; k < frames.length - win; k++) {
		if (!frames[k].kick) continue;
		const c = cells.get(frames[k].section);
		if (!c) continue;
		let best = 0;
		for (let j = k; j <= k + win; j++) best = Math.max(best, furthest(snaps[j], snaps[k - 1]));
		c.punches.push(best);
	}
	return cells;
}

function fmt(c: Cell | undefined): string {
	if (!c || c.frames === 0) return '      -     -     -     -    -    -    -    -    -';
	const punches = [...c.punches].sort((a, b) => a - b);
	const punch = punches.length ? punches[punches.length >> 1] : 0;
	let strike = 0;
	for (const m of c.means) if (m > strike) strike = m;
	return (
		(c.auth / c.frames).toFixed(2).padStart(6) +
		(c.sum / c.frames).toFixed(0).padStart(6) +
		strike.toFixed(0).padStart(6) +
		(c.p90 / c.frames).toFixed(0).padStart(6) +
		`${Math.round((100 * c.lit) / c.frames)}%`.padStart(5) +
		`${Math.round((100 * c.on) / c.frames)}%`.padStart(5) +
		String(punch).padStart(5) +
		(c.ripple / Math.max(1, c.frames - 1)).toFixed(1).padStart(5) +
		(c.shimmer / c.frames).toFixed(1).padStart(5)
	);
}

const journey = scriptFrames();
const quiet = quietFrames();

console.log(
	`${'effect'.padEnd(18)}${'role'.padEnd(10)}e ` +
		`${'groove: auth mean strike  p90 fill   on punch ripp shim'.padStart(56)}` +
		`${'build: auth mean strike  p90 fill   on punch ripp shim'.padStart(56)}` +
		`${'drop: auth mean strike  p90 fill   on punch ripp shim'.padStart(56)}` +
		`${'intro: auth mean strike  p90 fill   on punch ripp shim'.padStart(56)}`
);
const order: Record<string, number> = { bed: 0, rhythm: 1, transient: 2, accent: 3, master: 4 };
chosen.sort((a, b) => order[a.role] - order[b.role] || a.taste.energy - b.taste.energy || a.id.localeCompare(b.id));
for (const def of chosen) {
	const loud = run(def, journey, ['groove', 'build', 'drop']);
	const still = run(def, quiet, ['intro', 'outro']);
	const tags = [def.taste.kit ? `kit:${def.taste.kit}` : '', def.taste.character ?? '', def.taste.carries === false ? 'nocarry' : ''].filter(Boolean).join(' ');
	console.log(
		`${def.id.padEnd(18)}${def.role.padEnd(10)}${def.taste.energy} ` +
			`${fmt(loud.get('groove')).padStart(56)}${fmt(loud.get('build')).padStart(56)}${fmt(loud.get('drop')).padStart(56)}${fmt(still.get('intro')).padStart(56)}  ${tags}`
	);
}
