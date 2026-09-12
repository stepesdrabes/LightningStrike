import type { EffectDef, RenderCtx } from '../contracts/effect.ts';
import type { Geometry } from '../contracts/room.ts';
import type { SectionKind, ShowFrame } from '../contracts/frame.ts';
import { createShowFrame } from '../contracts/frame.ts';
import { makePalette } from '../color/palette.ts';
import { clamp } from '../dsl/math.ts';

const FPS = 60;
const PIXEL_CAP = 64;

interface Beat {
	bars: number;
	section: SectionKind;
	energy: number;
	drums: boolean;
}

/** groove -> build -> void -> drop, the journey every effect has to survive. */
const SCRIPT: Beat[] = [
	{ bars: 8, section: 'groove', energy: 0.6, drums: true },
	{ bars: 4, section: 'build', energy: 0.8, drums: true },
	{ bars: 1, section: 'void', energy: 0.02, drums: false },
	{ bars: 8, section: 'drop', energy: 1, drums: true }
];

/** Deterministic synthetic journey, requiring no audio. */
export function scriptFrames(bpm = 130): ShowFrame[] {
	const beatPeriod = 60 / bpm;
	const frames: ShowFrame[] = [];
	const dt = 1 / FPS;

	let t = 0;
	let lastBeat = Number.NaN;
	let lastBar = Number.NaN;
	let lastPhrase = Number.NaN;
	let kickEnv = 0;
	let snareEnv = 0;
	let hatEnv = 0;

	const buildStart = SCRIPT[0].bars * 4 * beatPeriod;
	const dropStart = (SCRIPT[0].bars + SCRIPT[1].bars + SCRIPT[2].bars) * 4 * beatPeriod;

	for (const stage of SCRIPT) {
		const stageFrames = Math.round((stage.bars * 4 * beatPeriod) / dt);
		for (let k = 0; k < stageFrames; k++) {
			const beatsF = t / beatPeriod;
			const barsF = beatsF / 4;
			const beatIndex = Math.floor(beatsF);
			const barIndex = Math.floor(barsF);
			const phraseIndex = Math.floor(barsF / 8);
			const beatPhase = beatsF - beatIndex;

			const beat = beatIndex !== lastBeat;
			const downbeat = barIndex !== lastBar;
			const phraseStart = phraseIndex !== lastPhrase;
			lastBeat = beatIndex;
			lastBar = barIndex;
			lastPhrase = phraseIndex;

			const eighth = Math.floor(beatsF * 2);
			const kick = stage.drums && beat;
			const snare = stage.drums && beat && beatIndex % 4 >= 2 && beatIndex % 2 === 0;
			const hat = stage.drums && eighth !== Math.floor((beatsF - dt / beatPeriod) * 2);

			if (kick) kickEnv = 1;
			if (snare) snareEnv = 1;
			if (hat) hatEnv = 1;
			kickEnv *= 0.9;
			snareEnv *= 0.9;
			hatEnv *= 0.85;

			const f = createShowFrame();
			f.t = t;
			f.dt = dt;
			f.beat = beat;
			f.downbeat = downbeat;
			f.phraseStart = phraseStart;
			f.beatIndex = beatIndex;
			f.barIndex = barIndex;
			f.beatPhase = beatPhase;
			f.barPhase = barsF - barIndex;
			f.phrasePhase = barsF / 8 - phraseIndex;
			f.beatPeriod = beatPeriod;
			f.bpm = bpm;
			f.section = stage.section;
			f.sectionProgress = k / stageFrames;
			f.buildProgress =
				t >= buildStart && t < dropStart ? clamp((t - buildStart) / (dropStart - buildStart)) : 0;
			f.timeToDrop = t < dropStart ? dropStart - t : Infinity;
			f.timeSinceDrop = t >= dropStart ? t - dropStart : Infinity;
			f.energy = stage.energy;
			f.bands[0] = stage.energy * 0.9;
			f.bands[1] = stage.energy * 0.8;
			f.bands[2] = stage.energy * 0.6;
			f.bands[3] = stage.section === 'build' ? f.buildProgress : stage.energy * 0.5;
			// Exercise spectrum readers with a moving shape as well as four-band envelopes.
			for (let k = 0; k < f.spectrum.length; k++) {
				const u = f.spectrum.length > 1 ? k / (f.spectrum.length - 1) : 0;
				const tilt = stage.section === 'build' ? f.buildProgress : 0.25;
				const shape = Math.exp(-((u - tilt) ** 2) / 0.12);
				f.spectrum[k] = clamp(stage.energy * shape * (0.7 + 0.3 * Math.sin(t * 3 + k)));
			}
			f.kick = kick;
			f.snare = snare;
			f.hat = hat;
			f.level = clamp(stage.energy * (0.55 + 0.45 * kickEnv));
			f.kickEnv = kickEnv;
			f.snareEnv = snareEnv;
			f.hatEnv = hatEnv;

			frames.push(f);
			t += dt;
		}
	}

	return frames;
}

function makeCtx(g: Geometry, def: EffectDef): RenderCtx {
	const p: Record<string, number> = {};
	for (const spec of def.params) p[spec.key] = spec.default;
	// Trigger masters so the gate tests their active output.
	if ('trigger' in p) p.trigger = 1;
	return {
		g,
		f: createShowFrame(),
		p,
		palette: makePalette({ base: 320, accent: 185 }),
		hueShift: 0,
		motion: 1
	};
}

function runOnce(def: EffectDef, g: Geometry, frames: ShowFrame[]): Float32Array[] {
	const effect = def.create(g);
	const ctx = makeCtx(g, def);
	const out = new Float32Array(g.count * 3);
	const snapshots: Float32Array[] = [];
	for (let i = 0; i < frames.length; i++) {
		ctx.f = frames[i];
		effect.render(out, ctx);
		if (i % 37 === 0) snapshots.push(Float32Array.from(out));
	}
	snapshots.push(Float32Array.from(out));
	return snapshots;
}

interface GateResult {
	id: string;
	ok: boolean;
	failures: string[];
	/** False for effects that legitimately render darkness, like `blackout`. */
	producesLight: boolean;
}

/** Validate bounds, reset and determinism for built-in and generated effects. */
export function runGate(def: EffectDef, g: Geometry): GateResult {
	const failures: string[] = [];
	const frames = scriptFrames();

	let a: Float32Array[];
	try {
		a = runOnce(def, g, frames);
	} catch (err) {
		return {
			id: def.id,
			ok: false,
			failures: [`threw during render: ${(err as Error).message}`],
			producesLight: false
		};
	}

	let maxSeen = 0;
	for (const snap of a) {
		for (let i = 0; i < snap.length; i++) {
			const v = snap[i];
			if (!Number.isFinite(v)) {
				failures.push(`non-finite pixel (${v}) at index ${i}`);
				break;
			}
			if (v < 0) {
				failures.push(`negative pixel (${v}) at index ${i}`);
				break;
			}
			if (v > maxSeen) maxSeen = v;
		}
		if (failures.length > 0) break;
	}
	if (maxSeen > PIXEL_CAP) failures.push(`pixel value ${maxSeen} exceeds cap ${PIXEL_CAP}`);

	const b = runOnce(def, g, frames);
	for (let s = 0; s < a.length; s++) {
		for (let i = 0; i < a[s].length; i++) {
			if (a[s][i] !== b[s][i]) {
				failures.push(`not deterministic: snapshot ${s} index ${i} differs between instances`);
				s = a.length;
				break;
			}
		}
	}

	const effect = def.create(g);
	const ctx = makeCtx(g, def);
	const scratch = new Float32Array(g.count * 3);
	for (let i = 0; i < 200; i++) {
		ctx.f = frames[i];
		effect.render(scratch, ctx);
	}
	effect.reset();
	scratch.fill(0);
	const fresh = def.create(g);
	const freshOut = new Float32Array(g.count * 3);
	for (let i = 0; i < 40; i++) {
		ctx.f = frames[i];
		effect.render(scratch, ctx);
		fresh.render(freshOut, ctx);
	}
	for (let i = 0; i < scratch.length; i++) {
		if (scratch[i] !== freshOut[i]) {
			failures.push(`reset() does not restore a fresh instance (index ${i})`);
			break;
		}
	}

	return { id: def.id, ok: failures.length === 0, failures, producesLight: maxSeen > 1e-3 };
}

/**
 * Quiet, kit-free journey for quality measurement. Keep it separate from SCRIPT so admission
 * results remain comparable. Sparse moving spectra expose effects that only animate on drums.
 */
export function quietFrames(bpm = 96, bars = 16): ShowFrame[] {
	const beatPeriod = 60 / bpm;
	const dt = 1 / FPS;
	const frames: ShowFrame[] = [];
	const total = Math.round((bars * 4 * beatPeriod) / dt);

	let lastBeat = Number.NaN;
	let lastBar = Number.NaN;
	let lastPhrase = Number.NaN;

	for (let k = 0; k < total; k++) {
		const t = k * dt;
		const beatsF = t / beatPeriod;
		const barsF = beatsF / 4;
		const beatIndex = Math.floor(beatsF);
		const barIndex = Math.floor(barsF);
		const phraseIndex = Math.floor(barsF / 8);

		const f = createShowFrame();
		f.t = t;
		f.dt = dt;
		f.beat = beatIndex !== lastBeat;
		f.downbeat = barIndex !== lastBar;
		f.phraseStart = phraseIndex !== lastPhrase;
		lastBeat = beatIndex;
		lastBar = barIndex;
		lastPhrase = phraseIndex;

		f.beatIndex = beatIndex;
		f.barIndex = barIndex;
		f.beatPhase = beatsF - beatIndex;
		f.barPhase = barsF - barIndex;
		f.phrasePhase = barsF / 8 - phraseIndex;
		f.beatPeriod = beatPeriod;
		f.bpm = bpm;
		f.section = barsF < bars / 2 ? 'intro' : 'outro';
		f.sectionProgress = (barsF % (bars / 2)) / (bars / 2);
		f.energy = 0.2 + 0.04 * Math.sin(t * 0.4);

		// No kit: test whether the effect has a response without hits.
		f.kick = false;
		f.snare = false;
		f.hat = false;
		f.level = clamp(0.3 + 0.1 * Math.sin(t * 0.9));
		f.kickEnv = 0;
		f.snareEnv = 0;
		f.hatEnv = 0;

		const tilt = 0.5 + 0.5 * Math.sin(t * 0.23);
		f.bands[0] = 0.22 + 0.14 * Math.sin(t * 0.31);
		f.bands[1] = 0.3 + 0.18 * Math.sin(t * 0.19 + 1);
		f.bands[2] = 0.28 + 0.2 * Math.sin(t * 0.27 + 2);
		f.bands[3] = 0.18 + 0.16 * tilt;

		for (let i = 0; i < f.spectrum.length; i++) {
			const u = f.spectrum.length > 1 ? i / (f.spectrum.length - 1) : 0;
			// A moving peak exercises both spectral position and single-band readers.
			const peak = Math.exp(-((u - tilt) ** 2) / 0.05);
			f.spectrum[i] = clamp(0.15 + 0.6 * peak + 0.1 * Math.sin(t * 0.7 + i * 0.9));
		}

		frames.push(f);
	}
	return frames;
}
