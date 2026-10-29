// A synthetic drum groove whose hit times are known: kick on 1 and 3, snare on 2 and 4, hi-hat on
// every eighth. The annotator's tests decode it, and example/groove.wav is one.

export type GrooveClass = 'kick' | 'snare' | 'hat';

export interface Groove {
	mono: Float32Array;
	rate: number;
	/** Each hit's first sample, in seconds. */
	hits: Record<GrooveClass, number[]>;
}

export function groove(seconds: number, { bpm = 120, rate = 44100, first = 0.25 } = {}): Groove {
	const mono = new Float32Array(Math.round(seconds * rate));
	const hits: Groove['hits'] = { kick: [], snare: [], hat: [] };
	let seed = 1;
	const noise = () => {
		seed = (seed * 1664525 + 1013904223) >>> 0;
		return seed / 2 ** 31 - 1;
	};
	const add = (cls: GrooveClass, at: number, length: number, sample: (k: number) => number) => {
		const start = Math.round(at * rate);
		hits[cls].push(start / rate);
		for (let k = 0; k < Math.min(length * rate, mono.length - start); k++) mono[start + k] += sample(k);
	};
	const eighth = 30 / bpm;
	for (let i = 0; first + i * eighth < seconds - 0.3; i++) {
		const at = first + i * eighth;
		let previous = 0;
		add('hat', at, 0.04, (k) => {
			const n = noise();
			const high = n - previous;
			previous = n;
			return 0.18 * high * Math.exp(-k / (0.008 * rate));
		});
		if (i % 4 === 0) {
			let phase = 0;
			add('kick', at, 0.25, (k) => {
				phase += (2 * Math.PI * (45 + 75 * Math.exp(-k / (0.03 * rate)))) / rate;
				return 0.7 * Math.sin(phase) * Math.exp(-k / (0.09 * rate));
			});
		}
		if (i % 4 === 2) {
			add('snare', at, 0.2, (k) => (0.35 * noise() + 0.3 * Math.sin((2 * Math.PI * 190 * k) / rate))
				* Math.exp(-k / (0.05 * rate)));
		}
	}
	return { mono, rate, hits };
}
