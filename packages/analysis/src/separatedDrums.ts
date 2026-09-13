import type { DrumStream } from './drums.ts';
import { snapTimesToOnsets } from './drums.ts';
import { computeSpectrogram, logFilterBank } from './dsp/spectrogram.ts';
import { RealFft, hannWindow } from './dsp/fft.ts';
import { conditionCurve, onsetStrength, pickPeaks, refinePeakTime } from './onsets.ts';

export interface SeparatedDrumAudio {
	kick: Float32Array;
	snare: Float32Array;
	cymbal?: Float32Array;
	sampleRate: number;
}

interface Evidence {
	time: number;
	level: number;
	ratio: number;
	rise: boolean;
}

function rms(audio: Float32Array, rate: number, time: number, from = -0.02, to = 0.06): number {
	const start = Math.max(0, Math.floor((time + from) * rate));
	const end = Math.min(audio.length, Math.ceil((time + to) * rate));
	let sum = 0;
	for (let i = start; i < end; i++) sum += audio[i] ** 2;
	return Math.sqrt(sum / Math.max(1, end - start));
}

function midrangePower(source: Float32Array, rate: number): (time: number) => number {
	const fft = new RealFft(2048);
	const window = hannWindow(2048);
	const magnitude = new Float32Array(fft.bins);
	return (time) => {
		fft.magnitudes(source, Math.round((time + 0.04) * rate) - 1024, window, magnitude, 1);
		let total = 0;
		let mid = 0;
		for (let bin = 0; bin < magnitude.length; bin++) {
			const power = magnitude[bin] ** 2;
			total += power;
			if (bin * rate / 2048 >= 1000 && bin * rate / 2048 < 3000) mid += power;
		}
		return mid / Math.max(1e-20, total);
	};
}

function snareCymbalVeto(sources: SeparatedDrumAudio, midPower = midrangePower(sources.snare, sources.sampleRate)): (time: number) => boolean {
	return (time) => {
		if (!sources.cymbal) return false;
		const ratio = rms(sources.cymbal, sources.sampleRate, time) / Math.max(1e-20, rms(sources.snare, sources.sampleRate, time));
		if (ratio <= 1) return false;
		const fraction = midPower(time);
		return (ratio > 1.5 && fraction < 0.1) || fraction < 0.01;
	};
}

interface FinalDrums { times: number[]; levels: number[]; invented: boolean[] }

/** Preserve quiet legacy hits where separation suppresses them, but verify their class and source energy. */
export function mergeSeparatedSnare(
	legacy: FinalDrums, source: DrumStream, audio: SeparatedDrumAudio, mix: Float32Array, mixRate: number,
	independentDspSnare?: Pick<DrumStream, 'times'>
): FinalDrums {
	const midPower = midrangePower(audio.snare, audio.sampleRate);
	const veto = snareCymbalVeto(audio, midPower);
	const pairs: { a: number; b: number; distance: number }[] = [];
	for (let a = 0; a < legacy.times.length; a++) for (let b = 0; b < source.times.length; b++) {
		const distance = Math.abs(legacy.times[a] - source.times[b]);
		if (distance <= 0.05) pairs.push({ a, b, distance });
	}
	pairs.sort((a, b) => a.distance - b.distance || a.a - b.a || a.b - b.b);
	const usedLegacy = new Set<number>();
	const usedSource = new Set<number>();
	const levels = [...source.levels];
	for (const { a, b } of pairs) {
		if (usedLegacy.has(a) || usedSource.has(b)) continue;
		usedLegacy.add(a);
		usedSource.add(b);
		// Separation can attenuate a genuine hit; agreement must not weaken an existing light trigger.
		levels[b] = Math.max(levels[b], legacy.levels[a]);
	}
	const hits = source.times.map((time, i) => ({ time, level: levels[i], invented: false }));
	for (let i = 0; i < legacy.times.length; i++) {
		const time = legacy.times[i];
		if (usedLegacy.has(i) || veto(time)) continue;
		const ratio = rms(audio.snare, audio.sampleRate, time) / Math.max(1e-8, rms(mix, mixRate, time));
		if (ratio < 0.005) {
			// Separation can nearly erase a quiet clap. Keep a measured model hit only
			// when independent DSP hears its attack and the remaining source has snare body.
			// A DSP-only fallback or a completed grid position cannot corroborate itself.
			if (legacy.invented[i] || ratio < 0.001 || !independentDspSnare?.times.some((at) => Math.abs(at - time) <= 0.05)
				|| midPower(time) < 0.3) continue;
		}
		hits.push({ time, level: legacy.levels[i], invented: legacy.invented[i] });
	}
	hits.sort((a, b) => a.time - b.time);
	return { times: hits.map((hit) => hit.time), levels: hits.map((hit) => hit.level), invented: hits.map((hit) => hit.invented) };
}

/** Source separation provides class evidence; original audio supplies the final attack time. */
export function detectSeparatedDrums(
	sources: SeparatedDrumAudio,
	mix: Float32Array,
	mixRate: number,
	mixOdf: Float32Array,
	mixFps: number,
	primary: Record<'kick' | 'snare', DrumStream>,
	independentDspSnare?: Pick<DrumStream, 'times'>
): { kick: DrumStream; snare: DrumStream } {
	const rate = sources.sampleRate;
	if (rate !== 22050) throw new Error('Separated drum onset analysis requires 22050 Hz audio.');
	const bank = logFilterBank(2048, rate, 24, 30, 17000);
	const snareMidPower = midrangePower(sources.snare, rate);
	const cymbalLeakage = snareCymbalVeto(sources, snareMidPower);
	const streams = {} as { kick: DrumStream; snare: DrumStream };
	let kickAttacks: number[] = [];
	for (const kind of ['kick', 'snare'] as const) {
		const source = sources[kind];
		const spec = computeSpectrogram(source, rate, { fftSize: 2048, hop: Math.round(rate / 100), bank });
		const curves = onsetStrength(spec);
		const odf = conditionCurve(curves.flux, curves.fps);
		const peaks = pickPeaks(odf, curves.fps, {
			localMaxSec: 0.025, movingMeanSec: 0.15, refractorySec: 0.06,
			delta: kind === 'snare' ? 0.1 : 0.4
		});
		const times = peaks.map((peak) => refinePeakTime(odf, peak.frame, curves.fps));
		if (kind === 'kick') kickAttacks = times;
		const energy = times.map((time) => rms(source, rate, time)).sort((a, b) => a - b);
		const reference = Math.max(1e-8, energy[Math.floor(energy.length * 0.9)] ?? 0);
		const measure = (time: number): Evidence => {
			const amplitude = rms(source, rate, time);
			return {
				time, level: Math.min(1, amplitude / reference),
				ratio: amplitude / Math.max(1e-8, rms(mix, mixRate, time)),
				rise: rms(source, rate, time, 0, 0.08) > rms(source, rate, time, -0.06, -0.01)
			};
		};
		// A quiet snare may have strong isolated evidence even when both transcribers
		// miss it. Require snare dominance for that path so kick leakage cannot vote itself in.
		const selected = times.map(measure).filter((event) => event.ratio >= 0.01 &&
			(event.level >= 0.25 ||
				(kind === 'snare' && event.level >= 0.1 && event.ratio >= 0.05 && event.rise &&
					snareMidPower(event.time) >= 0.3 && rms(sources.kick, rate, event.time) <= rms(source, rate, event.time)) ||
				primary[kind].times.some((time) => Math.abs(time - event.time) <= 0.05) ||
				(kind === 'snare' && event.level >= 0.2 && event.rise &&
					independentDspSnare?.times.some((time) => Math.abs(time - event.time) <= 0.05) &&
					snareMidPower(event.time) >= 0.3 && sources.cymbal &&
					rms(sources.cymbal, rate, event.time) <= 1.5 * rms(source, rate, event.time))));
		// A missed source peak may retain an existing hit only with an actual source attack.
		for (const time of primary[kind].times) {
			if (selected.some((event) => Math.abs(event.time - time) <= 0.05)) continue;
			const event = measure(time);
			if (event.rise && event.ratio >= (kind === 'kick' ? 0.03 : 0.01)) selected.push(event);
		}
		// A clap under a kick may survive only as a quiet, midrange-rich snare residue.
		// Recover it at the actual attack; metrical position alone never creates a hit.
		if (kind === 'snare' && sources.cymbal) for (const time of kickAttacks) {
			if (selected.some((event) => Math.abs(event.time - time) <= 0.05)) continue;
			const event = measure(time);
			if (event.ratio >= 0.005 && snareMidPower(time) > 0.7 &&
				rms(sources.cymbal, rate, time) <= 1.5 * rms(source, rate, time)) {
				// Residual loudness understates the hit after separation; keep a conservative confidence.
				selected.push({ ...event, level: Math.max(0.1, event.level) });
			}
		}
		// A sharp cymbal transient can fool both transcription and the snare source.
		// Require cymbal dominance AND missing snare midrange before overruling either.
		const classified = selected.filter((event) => kind !== 'snare' || !cymbalLeakage(event.time));
		classified.sort((a, b) => a.time - b.time);
		const snapped = snapTimesToOnsets(classified.map((event) => event.time), mixOdf, mixFps, 0.05);
		const accepted: Evidence[] = [];
		for (let i = 0; i < classified.length; i++) {
			const event = { ...classified[i], time: snapped[i] };
			// Snapping can move a source peak into a different transient. Class evidence
			// must still support the actual output time, especially beside a cymbal hit.
			if (kind === 'snare' && cymbalLeakage(event.time)) continue;
			const previous = accepted[accepted.length - 1];
			// Two source peaks can resolve to one original attack. Keep it exactly once.
			if (previous && event.time - previous.time < 0.03) {
				if (event.level > previous.level) accepted[accepted.length - 1] = event;
			} else accepted.push(event);
		}
		streams[kind] = {
			times: accepted.map((event) => event.time), levels: accepted.map((event) => event.level),
			curve: odf, fps: curves.fps
		};
	}
	return streams;
}
