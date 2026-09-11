/**
 * Synthetic ground truth needs arrangement dynamics and realistic transient spectra: relative
 * detectors cannot be calibrated on clicks. Ramp kicks, sustain snares, and band-limit hats.
 */
export interface Stage {
	bars: number;
	kick: number;
	snare: number;
	hat: number;
	bass: number;
	pad: number;
	riser: boolean;
	silent?: boolean;
}

export interface Fixture {
	mono: Float32Array;
	sampleRate: number;
	duration: number;
	bpm: number;
	beatsPerBar: number;
	/** Exact onset times, by instrument. */
	kick: number[];
	snare: number[];
	hat: number[];
	/** Bar index where each stage begins. */
	stageBars: number[];
}

export const ARRANGEMENT: Stage[] = [
	{ bars: 4, kick: 0, snare: 0, hat: 0, bass: 0, pad: 0.6, riser: false },
	{ bars: 8, kick: 0.9, snare: 0.7, hat: 0.5, bass: 0.7, pad: 0.5, riser: false },
	{ bars: 8, kick: 0, snare: 0, hat: 0.3, bass: 0, pad: 0.8, riser: false },
	{ bars: 4, kick: 0.5, snare: 0.8, hat: 0.6, bass: 0, pad: 0.7, riser: true },
	{ bars: 2, kick: 0, snare: 0, hat: 0, bass: 0, pad: 0, riser: false, silent: true },
	{ bars: 16, kick: 1, snare: 0.8, hat: 0.6, bass: 0.9, pad: 0.6, riser: false },
	{ bars: 8, kick: 0.9, snare: 0.7, hat: 0.5, bass: 0.7, pad: 0.5, riser: false },
	{ bars: 4, kick: 0, snare: 0, hat: 0.2, bass: 0, pad: 0.4, riser: false }
];

export function synthesise(
	bpm = 128,
	stages: readonly Stage[] = ARRANGEMENT,
	sampleRate = 22050
): Fixture {
	const beat = 60 / bpm;
	const barLength = beat * 4;
	const totalBars = stages.reduce((n, s) => n + s.bars, 0);
	const duration = totalBars * barLength;
	const mono = new Float32Array(Math.ceil(duration * sampleRate));

	let seed = 12345;
	const rand = () => {
		seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
		return seed / 4294967296 - 0.5;
	};

	const add = (t: number, len: number, gen: (s: number) => number) => {
		const i0 = Math.floor(t * sampleRate);
		const n = Math.floor(len * sampleRate);
		for (let i = 0; i < n && i0 + i < mono.length; i++) mono[i0 + i] += gen(i / sampleRate);
	};

	const kick: number[] = [];
	const snare: number[] = [];
	const hat: number[] = [];
	const stageBars: number[] = [];

	let bar = 0;
	for (const stage of stages) {
		stageBars.push(bar);
		for (let b = 0; b < stage.bars; b++, bar++) {
			const barStart = bar * barLength;
			if (stage.silent) continue;

			for (let k = 0; k < 4; k++) {
				const t = barStart + k * beat;

				if (stage.kick > 0) {
					kick.push(t);
					add(t, 0.14, (s) => {
						const f = 55 + 60 * Math.exp(-s * 40);
						const attack = Math.min(1, s / 0.002);
						return Math.sin(2 * Math.PI * f * s) * attack * Math.exp(-s * 30) * stage.kick;
					});
				}

				if (stage.snare > 0 && k % 2 === 1) {
					snare.push(t);
					add(t, 0.2, (s) => {
						const body = Math.sin(2 * Math.PI * 200 * s) * 0.3 * Math.exp(-s * 25);
						const noise = rand() * 0.6 * Math.exp(-s * 12);
						return (body + noise) * stage.snare;
					});
				}

				if (stage.hat > 0) {
					const t2 = t + beat / 2;
					hat.push(t2);
					add(t2, 0.04, (s) => {
						return rand() * Math.cos(2 * Math.PI * 9000 * s) * Math.exp(-s * 120) * stage.hat;
					});
				}
			}

			if (stage.bass > 0) {
				for (let e = 0; e < 8; e++) {
					add(barStart + e * (beat / 2), 0.24, (s) => {
						return Math.sin(2 * Math.PI * 110 * s) * Math.exp(-s * 8) * stage.bass * 0.5;
					});
				}
			}

			if (stage.pad > 0) {
				add(barStart, barLength, (s) => {
					const t = barStart + s;
					return (
						(Math.sin(2 * Math.PI * 440 * t) + Math.sin(2 * Math.PI * 660 * t)) * 0.09 * stage.pad
					);
				});
			}

			if (stage.riser) {
				const climb = b / Math.max(1, stage.bars - 1);
				add(barStart, barLength, () => rand() * 0.3 * (0.25 + climb));
			}
		}
	}

	for (let i = 0; i < mono.length; i++) mono[i] = Math.max(-1, Math.min(1, mono[i]));
	return { mono, sampleRate, duration, bpm, beatsPerBar: 4, kick, snare, hat, stageBars };
}

/** Greedy one-to-one matching within `tol`, the standard onset and beat F-measure. */
export function fMeasure(reference: readonly number[], estimate: readonly number[], tol = 0.05) {
	if (reference.length === 0 || estimate.length === 0) return { f: 0, precision: 0, recall: 0 };
	const used = new Array<boolean>(estimate.length).fill(false);
	let hits = 0;
	for (const r of reference) {
		let best = -1;
		let bestDistance = tol;
		for (let j = 0; j < estimate.length; j++) {
			if (used[j]) continue;
			const d = Math.abs(estimate[j] - r);
			if (d <= bestDistance) {
				bestDistance = d;
				best = j;
			}
		}
		if (best >= 0) {
			used[best] = true;
			hits++;
		}
	}
	const precision = hits / estimate.length;
	const recall = hits / reference.length;
	return {
		f: precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : 0,
		precision,
		recall
	};
}
