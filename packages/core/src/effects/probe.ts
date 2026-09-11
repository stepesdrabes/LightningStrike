import type { EffectDef } from '../contracts/effect.ts';
import type { Geometry } from '../contracts/room.ts';
import type { ShowFrame } from '../contracts/frame.ts';
import { PALETTE_ANCHORS } from '../contracts/palette.ts';
import { makePalette } from '../color/palette.ts';
import { trueHue } from '../color/hsv.ts';
import { Mixer } from '../mixer.ts';
import { quietFrames, scriptFrames } from './gate.ts';

/**
 * Measure delivered appearance separately from gate legality: coverage, concentration,
 * palette fidelity and musical response, including kit-free passages.
 */
export interface EffectCharacter {
	/** Share of the room above byte 24, which is where a pixel reads as lit in a dark room. */
	fill: number;
	/** Share of delivered light in the brightest tenth. A wash is near 0.1, a spotlight near 1. */
	top10: number;
	/** Share of lit bytes on a hue the palette could produce. */
	hue: number;
	/** How far the output moves when the music drives it, as a share of its own mean level. */
	react: number;
	/** The same over a quiet passage with no kit. */
	quiet: number;
}

/** Use a fixed, separated-hue palette so measurements stay comparable across shows. */
const PROBE_PALETTE = makePalette({
	base: 0,
	accent: 180,
	third: 60,
	sat: 0.94,
	shade: 0.14,
	white: 0.06
});
/**
 * Compare with hues actually emitted by the FastLED ramp, not declared HSV degrees.
 * Include only bright anchors: near-black interpolation passes through otherwise undeclared
 * hues.
 */
/** Where an anchor is bright enough that a pixel above `LIT` could have been sampled from it. */
const ANCHOR_LEVEL = 0.5;
const DECLARED = deliveredHues();
const TOLERANCE = 22;

function deliveredHues(): number[] {
	const seen: number[] = [];
	for (let i = 0; i < PALETTE_ANCHORS; i++) {
		const o = i * 3;
		const r = PROBE_PALETTE[o];
		const g = PROBE_PALETTE[o + 1];
		const b = PROBE_PALETTE[o + 2];
		const max = Math.max(r, g, b);
		// A near-grey anchor has no hue to declare; the grey exemption below covers those pixels.
		if (max < ANCHOR_LEVEL || max - Math.min(r, g, b) < 0.05) continue;
		seen.push(trueHue(r, g, b));
	}
	return seen;
}
/** Byte a pixel starts reading as lit in a dark room, rather than merely as not-off. */
const LIT = 24;
/** A near-grey pixel has no hue to be wrong about, and white is a declared colour here. */
const GREY = 24;

function hueOf(r: number, g: number, b: number): number {
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	const d = max - min;
	if (d < 1e-6) return -1;
	let h: number;
	if (max === r) h = ((g - b) / d) % 6;
	else if (max === g) h = (b - r) / d + 2;
	else h = (r - g) / d + 4;
	return (((h * 60) % 360) + 360) % 360;
}

function arc(a: number, b: number): number {
	const d = Math.abs(((a - b) % 360) + 360) % 360;
	return Math.min(d, 360 - d);
}

/** Flatten everything the music drives, leaving the frame's clock and structure alone. */
function deafen(frames: readonly ShowFrame[]): ShowFrame[] {
	return frames.map((f) => {
		const copy: ShowFrame = {
			...f,
			bands: Float32Array.from(f.bands),
			spectrum: Float32Array.from(f.spectrum)
		};
		copy.bands.fill(0.5);
		copy.spectrum.fill(0.5);
		copy.energy = 0.5;
		copy.kick = false;
		copy.snare = false;
		copy.hat = false;
		copy.kickEnv = 0;
		copy.snareEnv = 0;
		copy.hatEnv = 0;
		return copy;
	});
}

interface Run {
	bytes: Uint8Array[];
	mean: number;
}

/** Measure through the mixer so gamma and the output chain determine delivered brightness. */
function run(def: EffectDef, g: Geometry, frames: readonly ShowFrame[]): Run {
	const mixer = new Mixer(g);
	mixer.palette = PROBE_PALETTE;
	mixer.intensity = 1;
	mixer.floor = 0;
	mixer.layers[def.role].setEffect(def, g);

	const bytes: Uint8Array[] = [];
	let total = 0;
	for (const f of frames) {
		mixer.render(f);
		const snap = Uint8Array.from(mixer.bytes);
		bytes.push(snap);
		for (let i = 0; i < snap.length; i++) total += snap[i];
	}
	return { bytes, mean: total / Math.max(1, bytes.length * bytes[0].length) };
}

/**
 * Compare against a deafened journey and normalize by mean level, with a near-black guard
 * to avoid inflating response from almost-zero output.
 */
function reactivity(live: Run, deaf: Run): number {
	if (live.mean < 0.5) return 0;
	let delta = 0;
	const n = Math.min(live.bytes.length, deaf.bytes.length);
	for (let k = 0; k < n; k++) {
		const a = live.bytes[k];
		const b = deaf.bytes[k];
		for (let i = 0; i < a.length; i++) delta += Math.abs(a[i] - b[i]);
	}
	return delta / Math.max(1, n * live.bytes[0].length) / live.mean;
}

export function measureEffect(def: EffectDef, g: Geometry): EffectCharacter {
	const frames = scriptFrames();
	const quiet = quietFrames();
	const live = run(def, g, frames);
	const deaf = run(def, g, deafen(frames));

	let litPixels = 0;
	let pixels = 0;
	let onHue = 0;
	let litBytes = 0;
	let concentration = 0;
	let framesCounted = 0;
	const levels: number[] = [];

	for (const snap of live.bytes) {
		const n = snap.length / 3;
		levels.length = 0;
		let frameTotal = 0;
		for (let k = 0; k < n; k++) {
			const i = k * 3;
			const r = snap[i];
			const gr = snap[i + 1];
			const b = snap[i + 2];
			const v = Math.max(r, gr, b);
			pixels++;
			levels.push(v);
			frameTotal += v;
			if (v < LIT) continue;
			litPixels++;
			litBytes += v;
			const h = hueOf(r, gr, b);
			const grey = v - Math.min(r, gr, b);
			if (h < 0 || grey < GREY || DECLARED.some((d) => arc(h, d) <= TOLERANCE)) onHue += v;
		}
		if (frameTotal < 1) continue;
		levels.sort((a, b) => b - a);
		let top = 0;
		const tenth = Math.max(1, Math.round(n / 10));
		for (let k = 0; k < tenth; k++) top += levels[k];
		concentration += top / frameTotal;
		framesCounted++;
	}

	return {
		fill: pixels > 0 ? litPixels / pixels : 0,
		top10: framesCounted > 0 ? concentration / framesCounted : 0,
		hue: litBytes > 0 ? onHue / litBytes : 1,
		react: reactivity(live, deaf),
		quiet: reactivity(run(def, g, quiet), run(def, g, deafen(quiet)))
	};
}
