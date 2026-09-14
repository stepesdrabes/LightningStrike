import { describe, expect, it } from 'vitest';
import { pullOntoReturn, pushOntoDeparture } from './structure.ts';
import { SECTION_KINDS, SPECTRUM_BANDS, barTimeAt, decodeBase64, encodeBase64 } from '@mv/core';
import { analyzeTrack } from './analyze.ts';
import { dominantHue } from './artwork.ts';
import { detectBeats } from './beats.ts';
import { extractFeatures } from './features.ts';
import { measureLoudness } from './loudness.ts';
import { analyseStereo } from './stereo.ts';
import { ARRANGEMENT, fMeasure, synthesise } from './fixture.ts';
import { onsetsFromActivations } from './adtof.ts';
import { CANDIDATE_REVISION, FUSION_FEATURES, type FusionModel } from './drumFusion.ts';

const fixture = synthesise();
const analysis = analyzeTrack({
	mono: fixture.mono,
	sampleRate: fixture.sampleRate,
	duration: fixture.duration,
	hash: 'test',
	trackId: 'file-000000000000',
	title: 'Synthetic Arrangement'
});

describe('tempo', () => {
	it('recovers the true bpm to within a tenth', () => {
		expect(Math.abs(analysis.tempo.bpm - fixture.bpm)).toBeLessThan(0.1);
	});

	it('does not settle on a multiple or a fraction of it', () => {
		expect(analysis.tempo.bpm).toBeGreaterThan(fixture.bpm * 0.8);
		expect(analysis.tempo.bpm).toBeLessThan(fixture.bpm * 1.25);
	});

	it('locks phase within 30 ms of a real beat', () => {
		const period = 60 / fixture.bpm;
		const phase = analysis.tempo.firstBeat % period;
		expect(Math.min(phase, period - phase)).toBeLessThan(0.03);
	});

	it('holds the grid to the end of the track', () => {
		// A period error is what accumulates; a phase offset is a constant and is checked above.
		const beats = Math.floor(fixture.duration / (60 / fixture.bpm));
		const drift = Math.abs(beats * (60 / analysis.tempo.bpm - 60 / fixture.bpm));
		expect(drift).toBeLessThan(0.03);
	});

	it('reports the grid as constant on programmed material', () => {
		expect(analysis.tempo.constant).toBe(true);
	});

	it('finds the beats themselves, not just the tempo', () => {
		const truth: number[] = [];
		for (let t = 0; t < fixture.duration; t += 60 / fixture.bpm) truth.push(t);
		expect(fMeasure(truth, analysis.beats, 0.07).f).toBeGreaterThan(0.9);
	});

	it('counts four beats to the bar', () => {
		expect(analysis.tempo.beatsPerBar).toBe(4);
	});
});

describe('bar table', () => {
	it('covers the track at one row per bar', () => {
		const expected = ARRANGEMENT.reduce((n, s) => n + s.bars, 0);
		expect(analysis.bars.length).toBeGreaterThanOrEqual(expected - 2);
		expect(analysis.bars.length).toBeLessThanOrEqual(expected + 1);
	});

	it('agrees with the tempo grid about where each bar starts', () => {
		for (const row of analysis.bars.slice(0, 40)) {
			expect(Math.abs(row.t - barTimeAt(analysis.tempo, row.bar))).toBeLessThan(0.05);
		}
	});

	it('normalises energy across the whole track so a peak exists', () => {
		const energies = analysis.bars.map((b) => b.energy);
		expect(Math.max(...energies)).toBeGreaterThan(80);
		expect(Math.min(...energies)).toBeLessThan(20);
	});

	it('emits only known event tags', () => {
		const known = new Set([
			'drop_downbeat',
			'crash',
			'riser',
			'snare_roll',
			'silence',
			'kick_in',
			'kick_out',
			'bass_in',
			'bass_out',
			'filter_sweep'
		]);
		for (const row of analysis.bars) for (const e of row.events) expect(known.has(e)).toBe(true);
	});

	it('counts more kicks where the kick plays than where it does not', () => {
		const perBar = (rows: typeof analysis.bars) =>
			rows.reduce((n, b) => n + b.kicks, 0) / Math.max(1, rows.length);
		const drop = analysis.bars.filter((b) => b.section === 'drop');
		const quiet = analysis.bars.filter((b) => b.section === 'intro' || b.section === 'breakdown');
		expect(perBar(drop)).toBeGreaterThan(3);
		expect(perBar(quiet)).toBeLessThan(perBar(drop) * 0.5);
	});
});

describe('spectrum', () => {
	const spectrum = analysis.spectrum;
	const bytes = decodeBase64(spectrum.data);

	it('covers the track at the declared rate and band count', () => {
		expect(spectrum.bands).toBe(SPECTRUM_BANDS);
		expect(spectrum.centreHz).toHaveLength(SPECTRUM_BANDS);
		const frames = bytes.length / spectrum.bands;
		expect(Number.isInteger(frames)).toBe(true);
		expect(frames / spectrum.fps).toBeCloseTo(analysis.duration, 0);
	});

	it('names its band centres in ascending order across the audible range', () => {
		for (let i = 1; i < spectrum.centreHz.length; i++) {
			expect(spectrum.centreHz[i]).toBeGreaterThan(spectrum.centreHz[i - 1]);
		}
		expect(spectrum.centreHz[0]).toBeGreaterThan(20);
		expect(spectrum.centreHz[spectrum.centreHz.length - 1]).toBeLessThan(16000);
	});

	it('uses the whole byte range in every band rather than one flat level', () => {
		for (let k = 0; k < spectrum.bands; k++) {
			let lo = 255;
			let hi = 0;
			for (let f = 0; f < bytes.length / spectrum.bands; f++) {
				const v = bytes[f * spectrum.bands + k];
				if (v < lo) lo = v;
				if (v > hi) hi = v;
			}
			expect(hi - lo).toBeGreaterThan(64);
		}
	});

	it('puts more energy low where the fixture plays a kick and a bass than where it does not', () => {
		// Stage 5 is the loudest thing in the arrangement; stage 2 has no kick and no bass.
		const meanLow = (stage: number) => {
			const from = barTimeAt(analysis.tempo, fixture.stageBars[stage]);
			const to = barTimeAt(analysis.tempo, fixture.stageBars[stage] + ARRANGEMENT[stage].bars);
			let acc = 0;
			let n = 0;
			for (let f = Math.round(from * spectrum.fps); f < Math.round(to * spectrum.fps); f++) {
				for (let k = 0; k < 4; k++) acc += bytes[f * spectrum.bands + k];
				n += 4;
			}
			return acc / Math.max(1, n);
		};
		expect(meanLow(5)).toBeGreaterThan(meanLow(2));
	});

	it('round-trips its own encoding exactly', () => {
		const sample = Uint8Array.from({ length: 500 }, (_, i) => (i * 37) % 256);
		expect([...decodeBase64(encodeBase64(sample))]).toEqual([...sample]);
		for (const n of [0, 1, 2, 3, 4, 5]) {
			const bit = sample.subarray(0, n);
			expect([...decodeBase64(encodeBase64(bit))]).toEqual([...bit]);
		}
	});
});

describe('sections', () => {
	it('tiles the track with no gaps or overlaps', () => {
		expect(analysis.sections[0].startBar).toBe(0);
		for (let i = 1; i < analysis.sections.length; i++) {
			expect(analysis.sections[i].startBar).toBe(analysis.sections[i - 1].endBar);
		}
		expect(analysis.sections.at(-1)!.endBar).toBe(analysis.bars.length);
	});

	it('leaves no section start one bar off the phrase grid', () => {
		// Snap only within one bar; more distant boundaries may be real off-grid changes.
		const anchor = analysis.tempo.phraseAnchorBar;
		const nearMiss = analysis.sections
			.filter((s) => s.startBar > 0)
			.map((s) => ({ s, off: (((s.startBar - anchor) % 4) + 4) % 4 }))
			.filter(({ off }) => off === 1 || off === 3)
			.map(({ s }) => `${s.kind}@${s.startBar}`);
		expect(nearMiss).toEqual([]);
	});

	it('puts most section starts on the phrase grid', () => {
		const anchor = analysis.tempo.phraseAnchorBar;
		const starts = analysis.sections.filter((s) => s.startBar > 0);
		const on = starts.filter((s) => (((s.startBar - anchor) % 4) + 4) % 4 === 0);
		expect(on.length * 2).toBeGreaterThan(starts.length);
	});

	it('emits no section shorter than two bars except a void', () => {
		const runts = analysis.sections
			.filter((s) => s.kind !== 'void' && s.lengthBars < 2)
			.map((s) => `${s.kind}@${s.startBar}`);
		expect(runts).toEqual([]);
	});

	it('agrees with the bar table about which section each bar is in', () => {
		for (const s of analysis.sections) {
			for (let b = s.startBar; b < s.endBar; b++) expect(analysis.bars[b].section).toBe(s.kind);
		}
	});

	it('uses only known section kinds', () => {
		for (const s of analysis.sections) expect(SECTION_KINDS).toContain(s.kind);
	});

	it('ranks exactly one section as the peak', () => {
		expect(analysis.sections.filter((s) => s.energyRank === 1).length).toBe(1);
	});

	it('gives the peak rank to the loudest arrangement stage', () => {
		const peak = analysis.sections.find((s) => s.energyRank === 1)!;
		// Stage 5 is the sixteen-bar drop; the peak has to fall inside it.
		const dropStart = fixture.stageBars[5];
		const dropEnd = dropStart + ARRANGEMENT[5].bars;
		expect(peak.startBar).toBeGreaterThanOrEqual(dropStart - 2);
		expect(peak.startBar).toBeLessThan(dropEnd);
	});

	it('finds the two silent bars as the quietest in the track', () => {
		const voidStart = fixture.stageBars[4];
		const quietest = analysis.bars
			.filter((b) => b.bar >= voidStart - 1 && b.bar < voidStart + 2)
			.reduce((a, b) => (b.energy < a.energy ? b : a));
		const drop = analysis.bars.filter((b) => b.section === 'drop');
		const dropEnergy = drop.reduce((n, b) => n + b.energy, 0) / Math.max(1, drop.length);
		expect(quietest.energy).toBeLessThan(dropEnergy * 0.5);
	});

	it('reads quiet sections as quieter than loud ones', () => {
		const loud = analysis.sections.filter((s) => s.kind === 'drop' || s.kind === 'groove');
		const quiet = analysis.sections.filter((s) => s.kind === 'breakdown' || s.kind === 'intro');
		if (quiet.length === 0 || loud.length === 0) return;
		expect(Math.max(...quiet.map((s) => s.meanEnergy))).toBeLessThan(
			Math.max(...loud.map((s) => s.meanEnergy))
		);
	});

	it('points repeats at an earlier section', () => {
		for (const s of analysis.sections) {
			if (s.repeatOf === null) continue;
			expect(s.repeatOf).toBeLessThan(s.index);
		}
	});
});

describe('onsets', () => {
	it('finds the kick pattern', () => {
		expect(fMeasure(fixture.kick, analysis.onsets.kick.times, 0.05).f).toBeGreaterThan(0.8);
	});

	it('finds the hat pattern', () => {
		expect(fMeasure(fixture.hat, analysis.onsets.hat.times, 0.05).f).toBeGreaterThan(0.7);
	});

	it('finds most of the snares', () => {
		// Snare spectra overlap hats and bass. This floor pins measured DSP accuracy, below kick/hat recall.
		expect(fMeasure(fixture.snare, analysis.onsets.snare.times, 0.05).recall).toBeGreaterThan(0.6);
	});

	it('keeps every onset inside the track', () => {
		for (const list of [analysis.onsets.kick.times, analysis.onsets.snare.times, analysis.onsets.hat.times]) {
			for (const t of list) {
				expect(t).toBeGreaterThanOrEqual(0);
				expect(t).toBeLessThanOrEqual(analysis.duration);
			}
		}
	});

	it('reports onsets in time order', () => {
		for (const list of [analysis.onsets.kick.times, analysis.onsets.snare.times, analysis.onsets.hat.times]) {
			for (let i = 1; i < list.length; i++) expect(list[i]).toBeGreaterThanOrEqual(list[i - 1]);
		}
	});
});

describe('moments', () => {
	it('are sorted by time and inside the track', () => {
		for (let i = 1; i < analysis.moments.length; i++) {
			expect(analysis.moments[i].t).toBeGreaterThanOrEqual(analysis.moments[i - 1].t);
		}
		for (const m of analysis.moments) {
			expect(m.t).toBeGreaterThanOrEqual(0);
			expect(m.t).toBeLessThanOrEqual(analysis.duration + 1);
		}
	});

	it('name the peak section', () => {
		expect(analysis.moments.some((m) => m.note.includes('the peak of the track'))).toBe(true);
	});

	it('address every moment by a bar that exists', () => {
		for (const m of analysis.moments) {
			expect(m.bar).toBeGreaterThanOrEqual(0);
			expect(m.bar).toBeLessThan(analysis.bars.length);
		}
	});
});

describe('loudness', () => {
	it('reads a -23 dBFS sine as -23 LUFS', () => {
		// EBU Tech 3341 case 1. The K-weighting is flat enough at 1 kHz that the -0.691 offset
		// should cancel it exactly.
		const sampleRate = 22050;
		const signal = new Float32Array(sampleRate * 10);
		const amplitude = Math.pow(10, -23 / 20) * Math.SQRT2;
		for (let i = 0; i < signal.length; i++) {
			signal[i] = amplitude * Math.sin((2 * Math.PI * 997 * i) / sampleRate);
		}
		expect(measureLoudness(signal, sampleRate).integrated).toBeCloseTo(-23, 1);
	});

	it('gates out silence rather than averaging it in', () => {
		const sampleRate = 22050;
		const signal = new Float32Array(sampleRate * 20);
		const amplitude = Math.pow(10, -23 / 20) * Math.SQRT2;
		// Ten seconds of tone, ten of silence: gating means the answer is still -23.
		for (let i = 0; i < sampleRate * 10; i++) {
			signal[i] = amplitude * Math.sin((2 * Math.PI * 997 * i) / sampleRate);
		}
		expect(measureLoudness(signal, sampleRate).integrated).toBeCloseTo(-23, 0);
	});

	it('reports a loudness range and a peak-to-loudness ratio', () => {
		expect(analysis.loudnessRange).toBeGreaterThan(0);
		expect(analysis.peakToLoudness).toBeGreaterThan(0);
	});
});

describe('determinism', () => {
	it('produces an identical analysis from an identical input', () => {
		const again = analyzeTrack({
			mono: fixture.mono,
			sampleRate: fixture.sampleRate,
			duration: fixture.duration,
			hash: 'test',
			trackId: 'file-000000000000',
			title: 'Synthetic Arrangement'
		});
		expect(JSON.stringify(again)).toBe(JSON.stringify(analysis));
	});

	it('does not consume the caller’s buffer', () => {
		const before = fixture.mono.slice(0, 1000);
		analyzeTrack({
			mono: fixture.mono,
			sampleRate: fixture.sampleRate,
			duration: fixture.duration,
			hash: 'test',
			trackId: 'file-000000000000',
			title: 'x'
		});
		expect(Array.from(fixture.mono.slice(0, 1000))).toEqual(Array.from(before));
	});
});

describe('tempo hints', () => {
	it('honours a hint that contradicts the detected reading', () => {
		const half = synthesise(96);
		const features = extractFeatures(half.mono, half.sampleRate);
		const hinted = detectBeats(features.odf, features.curves.fps, half.duration, { bpmHint: 144 });
		expect(hinted.bpm).toBeGreaterThan(144 * 0.94);
		expect(hinted.bpm).toBeLessThan(144 * 1.06);
	});
});

describe('degenerate input', () => {
	const blank = new Float32Array(22050 * 5);

	it('survives silence without throwing or emitting NaN', () => {
		const quiet = analyzeTrack({
			mono: blank,
			sampleRate: 22050,
			duration: 5,
			hash: 'silent',
			trackId: 'file-000000000000',
			title: 'Silence'
		});
		expect(Number.isFinite(quiet.tempo.bpm)).toBe(true);
		expect(quiet.tempo.bpm).toBeGreaterThan(0);
		for (const row of quiet.bars) {
			expect(Number.isFinite(row.energy)).toBe(true);
			expect(row.energy).toBeGreaterThanOrEqual(0);
		}
		expect(JSON.stringify(quiet)).not.toContain('null,');
	});

	it('survives a track shorter than one bar', () => {
		const stub = analyzeTrack({
			mono: new Float32Array(2205),
			sampleRate: 22050,
			duration: 0.1,
			hash: 'stub',
			trackId: 'file-000000000000',
			title: 'Stub'
		});
		expect(Number.isFinite(stub.tempo.bpm)).toBe(true);
		expect(stub.sections.length).toBeGreaterThanOrEqual(0);
	});
});

describe('grid locking', () => {
	it('keeps every drum onset within a sixteenth of the real beat grid', () => {
		// Detected hits keep their timing; only missing hits use grid slots. Compare against tracked
		// beats so tempo drift does not masquerade as timing error.
		const beats = analysis.beats;
		expect(beats.length).toBeGreaterThan(8);

		const sixteenthNear = (t: number): number => {
			let lo = 0;
			let hi = beats.length - 1;
			while (hi - lo > 1) {
				const mid = (lo + hi) >> 1;
				if (beats[mid] <= t) lo = mid;
				else hi = mid;
			}
			const span = beats[lo + 1] - beats[lo];
			if (!(span > 1e-6)) return Math.abs(t - beats[lo]);
			const step = span / 4;
			const k = Math.round((t - beats[lo]) / step);
			return Math.abs(t - (beats[lo] + k * step));
		};

		// Half a sixteenth is the quantiser's own tolerance: inside it a hit is called on the
		// grid, outside it the hit is genuinely unquantised and is reported where it was heard.
		const bound = analysis.tempo.beatPeriod / 8;
		for (const list of [analysis.onsets.kick.times, analysis.onsets.snare.times, analysis.onsets.hat.times]) {
			for (const t of list) {
				if (t < beats[0] || t > beats[beats.length - 1]) continue;
				expect(sixteenthNear(t)).toBeLessThanOrEqual(bound);
			}
		}
	});

	it('carries enough tempo precision that the grid does not drift', () => {
		// The player multiplies the period by the bar index, so rounding it to three decimals is
		// eighty milliseconds of drift by the end of a four-minute track: nothing looks broken,
		// everything arrives late.
		const last = analysis.bars.length - 1;
		expect(Math.abs(barTimeAt(analysis.tempo, last) - analysis.bars[last].t)).toBeLessThan(0.01);
	});

	it('completes a kick pattern rather than leaving gaps in it', () => {
		const drop = analysis.sections.find((s) => s.kind === 'drop');
		if (!drop) return;
		const bars = analysis.bars.filter((b) => b.bar >= drop.startBar && b.bar < drop.endBar);
		const withKick = bars.filter((b) => b.kicks > 0).length;
		expect(withKick / bars.length).toBeGreaterThan(0.9);
	});
});

describe('stereo', () => {
	it('reports no image when the caller passes only a mono sum', () => {
		expect(analysis.stereo.pan).toEqual([]);
		expect(analysis.stereo.width).toEqual([]);
	});

	it('finds a hard-panned source and says which side it is on', () => {
		const sampleRate = 22050;
		const n = sampleRate * 4;
		const left = new Float32Array(n);
		const right = new Float32Array(n);
		for (let i = 0; i < n; i++) {
			// A 1 kHz tone that switches sides every half second, which is the gesture this
			// exists to see: it is identical in the mono sum and invisible to every other feature.
			const v = Math.sin((2 * Math.PI * 1000 * i) / sampleRate) * 0.5;
			if (Math.floor(i / (sampleRate / 2)) % 2 === 0) left[i] = v;
			else right[i] = v;
		}
		const image = analyseStereo(left, right, sampleRate);
		const at = (t: number) => image.pan[Math.round(t * image.fps)];
		expect(at(0.25)).toBeLessThan(-0.8);
		expect(at(0.75)).toBeGreaterThan(0.8);
		expect(at(1.25)).toBeLessThan(-0.8);
	});

	it('reads a centred mono source as centred', () => {
		const sampleRate = 22050;
		const n = sampleRate * 2;
		const both = new Float32Array(n);
		for (let i = 0; i < n; i++) both[i] = Math.sin((2 * Math.PI * 1000 * i) / sampleRate) * 0.5;
		const image = analyseStereo(both, Float32Array.from(both), sampleRate);
		for (let i = 5; i < image.pan.length - 5; i++) expect(Math.abs(image.pan[i])).toBeLessThan(0.05);
	});
});

describe('metrical level', () => {
	it('doubles the reading without moving the beats that were already there', () => {
		const doubled = analyzeTrack({
			mono: fixture.mono,
			sampleRate: fixture.sampleRate,
			duration: fixture.duration,
			hash: 'test',
			trackId: 'file-000000000000',
			title: 'Doubled',
			metricalLevel: 2
		});
		expect(doubled.tempo.bpm).toBeGreaterThan(fixture.bpm * 1.9);
		expect(doubled.tempo.bpm).toBeLessThan(fixture.bpm * 2.1);
		// Every original beat survives: a doubled reading is a superset, not a re-detection.
		for (const t of analysis.beats.slice(0, 40)) {
			expect(doubled.beats.some((x) => Math.abs(x - t) < 0.01)).toBe(true);
		}
	});

	it('halves the reading by keeping every other beat', () => {
		const halved = analyzeTrack({
			mono: fixture.mono,
			sampleRate: fixture.sampleRate,
			duration: fixture.duration,
			hash: 'test',
			trackId: 'file-000000000000',
			title: 'Halved',
			metricalLevel: 0.5
		});
		expect(halved.tempo.bpm).toBeGreaterThan(fixture.bpm * 0.45);
		expect(halved.tempo.bpm).toBeLessThan(fixture.bpm * 0.55);
		for (const t of halved.beats.slice(0, 20)) {
			expect(analysis.beats.some((x) => Math.abs(x - t) < 0.01)).toBe(true);
		}
	});

	it('reports whether the level it chose is contested', () => {
		expect(typeof analysis.tempo.ambiguous).toBe('boolean');
		for (const alt of analysis.tempo.alternativeBpm) expect(alt).toBeGreaterThan(0);
	});
});

describe('artwork', () => {
	/** A sheet of one colour with a blob of another on it, as a sleeve usually is. */
	const sheet = (bg: [number, number, number], blob: [number, number, number]): Uint8Array => {
		const n = 48;
		const out = new Uint8Array(n * n * 3);
		for (let y = 0; y < n; y++) {
			for (let x = 0; x < n; x++) {
				const inBlob = Math.hypot(x - n / 2, y - n / 2) < n * 0.22;
				const c = inBlob ? blob : bg;
				const o = (y * n + x) * 3;
				out[o] = c[0];
				out[o + 1] = c[1];
				out[o + 2] = c[2];
			}
		}
		return out;
	};

	it('reads the sheet, not the thing drawn on it', () => {
		// Full-value yellow behind a saturated cyan character. A ceiling on value, meant to drop
		// blown highlights, threw away every yellow pixel here and returned the cyan.
		const art = dominantHue(sheet([255, 214, 10], [0, 190, 200]));
		expect(art.hue).not.toBeNull();
		expect(art.hue!).toBeGreaterThan(35);
		expect(art.hue!).toBeLessThan(65);
		expect(art.share).toBeGreaterThan(0.7);
	});

	it('takes no colour from a grey sleeve', () => {
		expect(dominantHue(sheet([40, 41, 40], [200, 201, 200])).hue).toBeNull();
	});

	it('ignores a black background rather than counting it as a colour', () => {
		const art = dominantHue(sheet([0, 0, 0], [30, 200, 90]));
		expect(art.hue!).toBeGreaterThan(110);
		expect(art.hue!).toBeLessThan(160);
	});
});

describe('the ring-out', () => {
	it('ends a track that finishes inside its loudest section with an outro', () => {

		const rings = synthesise(128, [
			{ bars: 4, kick: 0, snare: 0, hat: 0, bass: 0, pad: 0.6, riser: false },
			{ bars: 8, kick: 0.9, snare: 0.7, hat: 0.5, bass: 0.7, pad: 0.5, riser: false },
			{ bars: 4, kick: 0.5, snare: 0.8, hat: 0.6, bass: 0, pad: 0.7, riser: true },
			{ bars: 12, kick: 1, snare: 0.8, hat: 0.6, bass: 0.9, pad: 0.6, riser: false },
			{ bars: 2, kick: 0, snare: 0, hat: 0, bass: 0, pad: 0.5, riser: false }
		]);
		const a = analyzeTrack({
			mono: rings.mono,
			sampleRate: rings.sampleRate,
			duration: rings.duration,
			hash: 'rings-out',
			trackId: 'file-000000000000',
			title: 'Rings Out'
		});
		const last = a.sections.at(-1)!;
		expect(last.kind).toBe('outro');

		expect(a.bars[last.startBar].t).toBeGreaterThanOrEqual(rings.kick.at(-1)! - 0.05);
	});
});

describe('trailing silence', () => {
	it('ends as an outro, never as a void', () => {
		// Trailing silence is an ending, not a held-breath blackout.
		const fades = synthesise(128, [
			{ bars: 4, kick: 0, snare: 0, hat: 0, bass: 0, pad: 0.6, riser: false },
			{ bars: 8, kick: 0.9, snare: 0.7, hat: 0.5, bass: 0.7, pad: 0.5, riser: false },
			{ bars: 4, kick: 0.5, snare: 0.8, hat: 0.6, bass: 0, pad: 0.7, riser: true },
			{ bars: 12, kick: 1, snare: 0.8, hat: 0.6, bass: 0.9, pad: 0.6, riser: false },
			{ bars: 4, kick: 0, snare: 0, hat: 0, bass: 0, pad: 0, riser: false, silent: true }
		]);
		const a = analyzeTrack({
			mono: fades.mono,
			sampleRate: fades.sampleRate,
			duration: fades.duration,
			hash: 'fades-out',
			trackId: 'file-000000000000',
			title: 'Fades Out'
		});
		expect(a.sections.at(-1)!.kind).toBe('outro');
		expect(a.sections.some((s) => s.kind === 'void' && s.startBar >= 28)).toBe(false);
	});
});

describe('re-reading a settled grid', () => {
	/** A full reanalysis given its settled grid must reproduce it exactly; correction must not drift. */
	it('reproduces itself from its own beats and bar times', () => {
		const again = analyzeTrack({
			mono: fixture.mono,
			sampleRate: fixture.sampleRate,
			duration: fixture.duration,
			hash: 'test',
			trackId: 'file-000000000000',
			title: 'Synthetic Arrangement',
			beats: analysis.beats,
			downbeats: analysis.tempo.barTimes,
			octaveGuard: false
		});

		expect(again.tempo.bpm).toBeCloseTo(analysis.tempo.bpm, 9);
		expect(again.tempo.beatsPerBar).toBe(analysis.tempo.beatsPerBar);
		expect(again.tempo.barTimes.length).toBe(analysis.tempo.barTimes.length);
		expect(again.sections.map((s) => `${s.startBar}:${s.kind}`)).toEqual(
			analysis.sections.map((s) => `${s.startBar}:${s.kind}`)
		);
	});
});

describe('marked movements', () => {
	/** The fixture's own stage boundaries, so a mark lands where the material really changes. */
	const stageTime = (stage: number) =>
		barTimeAt(analysis.tempo, fixture.stageBars[stage]);

	const withMovement = (t: number) =>
		analyzeTrack({
			mono: fixture.mono,
			sampleRate: fixture.sampleRate,
			duration: fixture.duration,
			hash: 'test',
			trackId: 'file-000000000000',
			title: 'Synthetic Arrangement',
			movements: [t]
		});

	it('changes nothing at all when nothing is marked', () => {
		const unmarked = analyzeTrack({
			mono: fixture.mono,
			sampleRate: fixture.sampleRate,
			duration: fixture.duration,
			hash: 'test',
			trackId: 'file-000000000000',
			title: 'Synthetic Arrangement',
			movements: []
		});
		expect(JSON.stringify(unmarked)).toBe(JSON.stringify(analysis));
		expect(analysis.movements).toBeUndefined();
	});

	// Reaction lag makes movement marks bar-level evidence; model downbeats supply the exact beat.
	it('places a movement on the model downbeat rather than on the pressed beat', () => {
		const period = 60 / fixture.bpm;
		const beats = Array.from({ length: Math.floor(fixture.duration / period) }, (_, i) => i * period);
		// Downbeats on phase 2, so the mark's own nearest beat is never the answer by luck.
		const downbeats = beats.filter((_, i) => i >= 2 && (i - 2) % 4 === 0);
		const trueDownbeat = 82;
		const base = {
			mono: fixture.mono,
			sampleRate: fixture.sampleRate,
			duration: fixture.duration,
			hash: 'test',
			trackId: 'file-000000000000' as const,
			title: 'Synthetic Arrangement',
			// Pressed nine tenths of a beat late, so the nearest beat is the WRONG one.
			movements: [beats[trueDownbeat] + period * 0.9]
		};
		const guided = analyzeTrack({ ...base, beats, downbeats });
		const blind = analyzeTrack({ ...base, beats });
		const barOf = (a: ReturnType<typeof analyzeTrack>) => barTimeAt(a.tempo, a.movements![1].startBar);
		expect(barOf(guided)).toBeCloseTo(beats[trueDownbeat], 2);
		// Without model downbeats, the marked beat is the fallback.
		expect(barOf(blind)).toBeCloseTo(beats[trueDownbeat + 1], 2);
	});

	it('starts a section on the marked bar and reports it', () => {
		const marked = withMovement(stageTime(3));
		expect(marked.movements).toHaveLength(2);
		const bar = marked.movements![1].startBar;
		expect(marked.movements![1].source).toBe('mark');
		expect(marked.movements![0].endBar).toBe(bar);
		expect(marked.sections.some((s) => s.startBar === bar)).toBe(true);
		// Every section knows which song it belongs to.
		expect(marked.sections.every((s) => s.movement === (s.startBar >= bar ? 1 : 0))).toBe(true);
		// The mark is a grid cut, so the movement begins its own bar rather than landing
		// wherever the previous song's count of one happened to fall.
		expect(Math.abs(barTimeAt(marked.tempo, bar) - stageTime(3))).toBeLessThan(0.2);
	});

	it('keeps the seam even where both sides read as the same material', () => {
		// Mark inside one repeated drop so same-kind merging must explicitly preserve the movement seam.
		const mid = barTimeAt(analysis.tempo, fixture.stageBars[5] + 8);
		const marked = withMovement(mid);
		const bar = marked.movements![1].startBar;
		expect(marked.sections.find((s) => s.endBar === bar)).toBeDefined();
		expect(marked.sections.find((s) => s.startBar === bar)).toBeDefined();
	});

	it('levels each movement against itself', () => {
		// Every band and the loudness curve are normalised within the movement, so the two
		// sides cannot share one scale: at least one bar has to read differently.
		const marked = withMovement(stageTime(3));
		const moved = marked.bars.some((b, i) => b.energy !== analysis.bars[i]?.energy);
		expect(moved).toBe(true);
	});

	it('ignores a mark outside the track', () => {
		expect(withMovement(fixture.duration + 30).movements).toBeUndefined();
		expect(withMovement(0).movements).toBeUndefined();
	});
});

describe('pullOntoReturn', () => {
	const arrivals = (at: Record<number, number>, n = 16) => {
		const a = new Float32Array(n);
		for (const [b, v] of Object.entries(at)) a[Number(b)] = v;
		return a;
	};
	const kicks = (zeros: number[], n = 16) => Int32Array.from({ length: n }, (_, b) => (zeros.includes(b) ? 0 : 6));

	it('moves a boundary off the bar the kit drops out of, onto the decisive return', () => {
		const segments = [
			{ startBar: 0, endBar: 8, kind: 'groove' },
			{ startBar: 8, endBar: 16, kind: 'groove' }
		];
		const moved = pullOntoReturn(segments, arrivals({ 8: 0.8, 9: 4.5 }), kicks([8]), 2, new Set());
		expect(moved).toEqual([9]);
		expect(segments[0].endBar).toBe(9);
		expect(segments[1].startBar).toBe(9);
	});

	it('leaves a boundary the kit plays through, a pinned one, and a weak return alone', () => {
		const plays = [{ startBar: 0, endBar: 8, kind: 'groove' }, { startBar: 8, endBar: 16, kind: 'drop' }];
		expect(pullOntoReturn(plays, arrivals({ 9: 4.5 }), kicks([]), 2, new Set())).toEqual([]);
		const pinned = [{ startBar: 0, endBar: 8, kind: 'groove' }, { startBar: 8, endBar: 16, kind: 'drop' }];
		expect(pullOntoReturn(pinned, arrivals({ 9: 4.5 }), kicks([8]), 2, new Set([8]))).toEqual([]);
		const weak = [{ startBar: 0, endBar: 8, kind: 'groove' }, { startBar: 8, endBar: 16, kind: 'drop' }];
		expect(pullOntoReturn(weak, arrivals({ 9: 1.2 }), kicks([8]), 2, new Set())).toEqual([]);
		expect(weak[1].startBar).toBe(8);
	});

	it('never pulls a breakdown off the bar the kit leaves', () => {
		const segments = [{ startBar: 0, endBar: 8, kind: 'chorus' }, { startBar: 8, endBar: 16, kind: 'breakdown' }];
		expect(pullOntoReturn(segments, arrivals({ 9: 4.5 }), kicks([8]), 2, new Set())).toEqual([]);
		expect(segments[1].startBar).toBe(8);
	});
});

describe('pushOntoDeparture', () => {
	const kicks = (zeros: number[], n = 16) => Int32Array.from({ length: n }, (_, b) => (zeros.includes(b) ? 0 : 6));

	/** Low band per bar: full until `from`, then the floor. */
	const level = (from: number, n = 16, floor = 0.2) => Float32Array.from({ length: n }, (_, b) => (b < from ? 0.85 : floor));

	it('moves a breakdown back onto the bar the kit left and the floor fell', () => {
		const segments = [
			{ startBar: 0, endBar: 9, kind: 'chorus' },
			{ startBar: 9, endBar: 16, kind: 'breakdown' }
		];
		expect(pushOntoDeparture(segments, kicks([8, 9, 10, 11]), level(8), level(8, 16, 30), new Set())).toEqual([8]);
		expect(segments[0].endBar).toBe(8);
		expect(segments[1].startBar).toBe(8);
	});

	it('moves an outro forward onto the bar the kit leaves when the boundary sits a bar before it', () => {
		const segments = [{ startBar: 0, endBar: 8, kind: 'chorus' }, { startBar: 8, endBar: 16, kind: 'outro' }];
		expect(pushOntoDeparture(segments, kicks([9, 10, 11, 12]), level(9), level(9, 16, 30), new Set())).toEqual([9]);
		expect(segments[0].endBar).toBe(9);
		expect(segments[1].startBar).toBe(9);
	});

	it('never moves a build forward: it begins under the kit, on the riser', () => {
		const segments = [{ startBar: 0, endBar: 8, kind: 'chorus' }, { startBar: 8, endBar: 16, kind: 'build' }];
		expect(pushOntoDeparture(segments, kicks([9, 10, 11, 12]), level(9), level(9, 16, 30), new Set())).toEqual([]);
		expect(segments[1].startBar).toBe(8);
	});

	it('holds where the level stays up, where the kit comes back, into a kit-carried kind, or on a drawn bar', () => {
		// SICKO MODE: the kick pauses a bar early while the 808 holds the floor at six tenths.
		const held = [{ startBar: 0, endBar: 9, kind: 'chorus' }, { startBar: 9, endBar: 16, kind: 'breakdown' }];
		const holds = Float32Array.from({ length: 16 }, (_, b) => (b < 8 ? 0.85 : b === 8 ? 0.5 : 0.2));
		expect(pushOntoDeparture(held, kicks([8, 9, 10, 11]), holds, level(9, 16, 30), new Set())).toEqual([]);
		const back = [{ startBar: 0, endBar: 9, kind: 'chorus' }, { startBar: 9, endBar: 16, kind: 'breakdown' }];
		expect(pushOntoDeparture(back, kicks([8]), level(8), level(8, 16, 30), new Set())).toEqual([]);
		const groove = [{ startBar: 0, endBar: 9, kind: 'chorus' }, { startBar: 9, endBar: 16, kind: 'groove' }];
		expect(pushOntoDeparture(groove, kicks([8, 9, 10]), level(8), level(8, 16, 30), new Set())).toEqual([]);
		const drawn = [{ startBar: 0, endBar: 9, kind: 'chorus' }, { startBar: 9, endBar: 16, kind: 'breakdown' }];
		expect(pushOntoDeparture(drawn, kicks([8, 9, 10]), level(8), level(8, 16, 30), new Set([9]))).toEqual([]);
	});
});

describe('drum fusion', () => {
	const frames = Math.ceil(fixture.duration * 100) + 1;
	const activations = (times: Record<number, readonly number[]>) => {
		const act = new Float32Array(frames * 5);
		for (const [channel, list] of Object.entries(times)) {
			for (const t of list) act[Math.round(t * 100) * 5 + Number(channel)] = 0.9;
		}
		return act;
	};
	const stem = activations({ 0: fixture.kick, 1: fixture.snare, 3: fixture.hat });
	const silence = new Float32Array(fixture.mono.length);
	const stemSplit = (column: number) => ({ feature: [column], threshold: [0.5], left: [~0], right: [~1], leaf: [-4, 4] });
	const inputs = {
		mono: fixture.mono, sampleRate: fixture.sampleRate, duration: fixture.duration, hash: 'test',
		trackId: 'file-000000000000', title: 'Synthetic Arrangement',
		drums: { ...onsetsFromActivations(new Float32Array(frames * 5)) },
		separatedDrums: { kick: silence, snare: silence, hat: silence, cymbal: silence, sampleRate: fixture.sampleRate },
		stemActivations: stem,
		sourceActivations: { kick: stem, snare: stem, hat: stem, cymbal: stem }
	};
	const model: FusionModel = {
		version: 'test', candidates: CANDIDATE_REVISION, features: [...FUSION_FEATURES],
		classes: {
			kick: { threshold: 0.5, trees: [stemSplit(FUSION_FEATURES.indexOf('stem0'))] },
			snare: { threshold: 0.5, trees: [stemSplit(FUSION_FEATURES.indexOf('stem1'))] },
			hat: { threshold: 0.5, trees: [stemSplit(FUSION_FEATURES.indexOf('stem3'))] },
			cymbal: { threshold: 0.5, trees: [stemSplit(FUSION_FEATURES.indexOf('stem4'))] },
			tom: { threshold: 0.5, trees: [stemSplit(FUSION_FEATURES.indexOf('stem2'))] }
		}
	};

	it('takes every class from the classifier instead of the rule-based merges', () => {
		const fused = analyzeTrack({ ...inputs, drumFusion: model });
		expect(fused.drumFusion).toBe('test');
		expect(analyzeTrack({ ...inputs, sourceActivations: undefined, drumFusion: model }).drumFusion).toBeUndefined();
		expect(fMeasure(fixture.kick, fused.onsets.kick.times, 0.05).f).toBeGreaterThan(0.95);
		expect(fMeasure(fixture.snare, fused.onsets.snare.times, 0.05).f).toBeGreaterThan(0.95);
		expect(fMeasure(fixture.hat, fused.onsets.hat.times, 0.05).f).toBeGreaterThan(0.95);
		const unfused = analyzeTrack(inputs);
		expect(unfused.onsets.kick.times.length).toBeLessThan(fixture.kick.length / 2);
	});
});
