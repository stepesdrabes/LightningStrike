import { RealFft, hannWindow } from '../../packages/analysis/src/dsp/fft.ts';

interface Stream { times: number[]; levels: number[]; invented?: boolean[] }
export function kickSourceCandidate(legacy: Stream, dsp: Stream, source: Float32Array, mix: Float32Array, model: { curve: ArrayLike<number>; fps: number }, rate = 22050) {
	const rms = (audio: Float32Array, time: number, from = -.02, to = .06) => {
		const start = Math.max(0, Math.floor((time + from) * rate)), end = Math.min(audio.length, Math.ceil((time + to) * rate));
		let sum = 0;
		for (let i = start; i < end; i++) sum += audio[i] ** 2;
		return Math.sqrt(sum / Math.max(1, end - start));
	};
	const fft = new RealFft(2048), window = hannWindow(2048), magnitude = new Float32Array(1025);
	const subFraction = (time: number) => {
		fft.magnitudes(source, Math.round((time + .04) * rate) - 1024, window, magnitude, 1);
		let total = 0, sub = 0;
		for (let i = 0; i < magnitude.length; i++) {
			const power = magnitude[i] ** 2, hz = i * rate / 2048;
			total += power;
			if (hz >= 20 && hz < 90) sub += power;
		}
		return sub / Math.max(1e-20, total);
	};
	const energy = dsp.times.map(time => rms(source, time)).sort((a, b) => a - b);
	const reference = Math.max(1e-8, energy[Math.floor(energy.length * .9)] ?? 0);
	const measure = (time: number) => ({ time,
		level: rms(source, time) / reference,
		ratio: rms(source, time) / Math.max(1e-8, rms(mix, time)), sub: subFraction(time),
		rise: rms(source, time, 0, .08) / Math.max(1e-8, rms(source, time, -.06, -.01)) });
	const removed: ReturnType<typeof measure>[] = [];
	const hits = legacy.times.flatMap((time, i) => {
		const e = measure(time);
		if (legacy.levels[i] < .8 && e.ratio < .01 && e.sub < .1 && e.rise <= 1.2
			&& !dsp.times.some(t => Math.abs(t - time) <= .05)) {
			removed.push(e); return [];
		}
		return [{ time, level: legacy.levels[i], invented: legacy.invented?.[i] ?? false }];
	});
	const added: ReturnType<typeof measure>[] = [];
	for (const time of dsp.times) {
		if (hits.some(hit => Math.abs(hit.time - time) <= .06)) continue;
		let support = 0;
		for (let frame = Math.max(0, Math.floor((time - .04) * model.fps)); frame <= Math.min(model.curve.length - 1, Math.ceil((time + .04) * model.fps)); frame++) {
			support = Math.max(support, model.curve[frame]);
		}
		if (support < .04) continue;
		const e = measure(time);
		if (e.ratio < .3 || e.sub < .6 || e.level < .25 || e.rise < 1.5) continue;
		added.push(e);
		hits.push({ time, level: Math.min(.85, e.level), invented: false });
	}
	hits.sort((a, b) => a.time - b.time);
	return { times: hits.map(e => e.time), levels: hits.map(e => e.level), invented: hits.map(e => e.invented), added, removed };
}
