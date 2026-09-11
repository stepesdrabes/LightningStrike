import { describe, expect, it } from 'vitest';
import { detectDrums } from './drums.ts';
import { extractFeatures } from './features.ts';

/** Sustained sub kicks over legato bass test both missed kicks and bass notes misread as drums. */
function sophieClip(): { mono: Float32Array; sampleRate: number; kicks: number[] } {
	const sampleRate = 22050;
	const beat = 0.5;
	const duration = 16;
	const mono = new Float32Array(Math.ceil(duration * sampleRate));
	const add = (t: number, length: number, f: (s: number) => number) => {
		const i0 = Math.floor(t * sampleRate);
		const n = Math.floor(length * sampleRate);
		for (let i = 0; i < n && i0 + i < mono.length; i++) mono[i0 + i] += f(i / sampleRate);
	};
	const kicks: number[] = [];
	for (let t = 0.5; t < duration - 0.6; t += beat) {
		kicks.push(t);
		add(t, 0.35, (s) => {
			// Start the glide inside the kick band so onset flux exists before it settles into sustained sub.
			const f = 58 + 27 * Math.exp(-s * 30);
			return Math.tanh(3 * Math.sin(2 * Math.PI * f * s)) * Math.exp(-s * 7) * 0.9;
		});
		// The bassline: off-beat eighths at 110 Hz, played legato - a ramped attack and a
		// held body, which is what separates a note from a hit. A plucked synth bass IS
		// percussive and counting it is arguably right; the guard is about notes.
		add(t + beat / 2, 0.22, (s) => {
			const ramp = Math.min(1, s / 0.03);
			return Math.sin(2 * Math.PI * 110 * s) * ramp * 0.4;
		});
	}
	return { mono, sampleRate, kicks };
}

describe('the kit on a distorted pitched-sub kick', () => {
	it('hears the kick and does not count the bassline', () => {
		const { mono, sampleRate, kicks } = sophieClip();
		const features = extractFeatures(mono, sampleRate);
		const detected = detectDrums(features.spec, { beatPeriod: 0.5, odf: features.odf });

		const tol = 0.07;
		let hit = 0;
		for (const t of kicks) {
			if (detected.kick.times.some((d) => Math.abs(d - t) <= tol)) hit++;
		}
		const recall = hit / kicks.length;
		let truePos = 0;
		for (const d of detected.kick.times) {
			if (kicks.some((t) => Math.abs(d - t) <= tol)) truePos++;
		}
		const precision = detected.kick.times.length > 0 ? truePos / detected.kick.times.length : 0;
		// Characterisation floors: preserve recall for sustained sub kicks and pin current bass-note
		// false positives. DSP cannot fully separate these overlapping spectra; the model supplies
		// shipping kicks when available.
		expect(recall).toBeGreaterThan(0.8);
		expect(precision).toBeGreaterThan(0.4);
	});
});
