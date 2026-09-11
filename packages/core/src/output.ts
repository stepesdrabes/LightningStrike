import type { BlendMode } from './contracts/effect.ts';
import { alphaFor, clamp } from './dsl/math.ts';

export function blend(
	dst: Float32Array,
	src: Float32Array,
	mode: BlendMode,
	opacity: number
): void {
	if (opacity <= 0) return;
	const n = dst.length;
	switch (mode) {
		case 'add':
			for (let i = 0; i < n; i++) dst[i] += src[i] * opacity;
			return;
		case 'max':
			for (let i = 0; i < n; i++) {
				const v = src[i] * opacity;
				if (v > dst[i]) dst[i] = v;
			}
			return;
		case 'screen':
			for (let i = 0; i < n; i++) {
				const s = src[i] * opacity;
				dst[i] = dst[i] + s - dst[i] * s;
			}
			return;
		case 'multiply':
			for (let i = 0; i < n; i++) dst[i] *= 1 - opacity + src[i] * opacity;
			return;
		default:
			for (let i = 0; i < n; i++) dst[i] += (src[i] - dst[i]) * opacity;
	}
}

/** Uniform compression preserves hue; optional desaturation lifts the other channels. */
export function compressHighlights(buf: Float32Array, knee = 0.84, desat = 0.05): void {
	const range = 1 - knee;
	for (let i = 0; i < buf.length; i += 3) {
		const max = Math.max(buf[i], buf[i + 1], buf[i + 2]);
		if (max <= knee) continue;
		const over = max - knee;
		const compressed = knee + (range * over) / (range + over);
		const k = compressed / max;
		buf[i] *= k;
		buf[i + 1] *= k;
		buf[i + 2] *= k;
		if (desat > 0) {
			const lift = desat * (1 - k);
			buf[i] += lift * (compressed - buf[i]);
			buf[i + 1] += lift * (compressed - buf[i + 1]);
			buf[i + 2] += lift * (compressed - buf[i + 2]);
		}
	}
}

/** Caller-owned histogram size for allocation-free level measurement. */
export const LEVEL_BINS = 256;

/** The brightest tenth represents the room's perceived level. */
const LEVEL_PERCENTILE = 90;

/**
 * Perceived room level, 0..1, from a histogram percentile.
 * An average would incorrectly dim the reading when only part of the fixture is lit.
 */
export function perceivedLevel(buf: Float32Array, hist: Uint32Array): number {
	const n = buf.length / 3;
	if (n === 0) return 0;

	hist.fill(0);
	for (let i = 0; i < buf.length; i += 3) {
		const max = Math.max(buf[i], buf[i + 1], buf[i + 2]);
		hist[max <= 0 ? 0 : max >= 1 ? 255 : (max * 255) | 0]++;
	}

	// Rounded up, so a mostly dark room cannot satisfy the percentile with nothing.
	const want = Math.max(1, Math.ceil((n * (100 - LEVEL_PERCENTILE)) / 100));
	let seen = 0;
	for (let v = 255; v > 0; v--) {
		seen += hist[v];
		if (seen >= want) return v / 255;
	}
	return 0;
}

const MEAN_TARGET = 0.36;
/** Lift dim tracks slowly enough to preserve section dynamics. Never reduce the house floor. */
const MEAN_MIN_GAIN = 1;
const MEAN_MAX_GAIN = 1.7;
const MEAN_TAU_DOWN = 12;
const MEAN_TAU_UP = 30;

/** Auto-exposure freezes when alive is false so silent passages remain silent. */
export class MeanLevel {
	gain = 1;
	private readonly target: number;
	private readonly minGain: number;
	private readonly maxGain: number;

	constructor(target = MEAN_TARGET, minGain = MEAN_MIN_GAIN, maxGain = MEAN_MAX_GAIN) {
		this.target = target;
		this.minGain = minGain;
		this.maxGain = maxGain;
	}

	apply(buf: Float32Array, dt: number, alive: boolean): number {
		let sum = 0;
		for (let i = 0; i < buf.length; i += 3) {
			sum += Math.max(buf[i], buf[i + 1], buf[i + 2]);
		}
		const mean = sum / (buf.length / 3);

		if (alive) {
			const wanted = mean > 1e-4 ? clamp(this.target / mean, this.minGain, this.maxGain) : 1;
			const tau = wanted < this.gain ? MEAN_TAU_DOWN : MEAN_TAU_UP;
			this.gain += (wanted - this.gain) * alphaFor(dt, tau);
		}

		if (this.gain !== 1) for (let i = 0; i < buf.length; i++) buf[i] *= this.gain;
		return mean;
	}

	reset(): void {
		this.gain = 1;
	}
}

/** Per-LED limit on how fast brightness may fall. Stops flicker reading as noise. */
export class BrightnessSlew {
	private prev: Float32Array;
	private readonly maxFallPerSecond: number;

	constructor(length: number, maxFallPerSecond = 25) {
		this.prev = new Float32Array(length);
		this.maxFallPerSecond = maxFallPerSecond;
	}

	apply(buf: Float32Array, dt: number): void {
		const maxFall = this.maxFallPerSecond * dt;
		for (let i = 0; i < buf.length; i++) {
			const floor = this.prev[i] - maxFall;
			if (buf[i] < floor) buf[i] = floor;
			this.prev[i] = buf[i];
		}
	}

	reset(): void {
		this.prev.fill(0);
	}
}

// Static bit-reversal dither avoids peripheral sparkle. Add in byte units after scaling
// to avoid float32 rounding that can turn full scale into 254.
const DITHER = [0, 4, 2, 6, 1, 5, 3, 7].map((v) => v / 8 - 0.5);

/** Exponent from authoring values to linear light. */
export const GAMMA = 2.45;

/**
 * Fixture dimmer, 0..1, applied after gamma to preserve authored contrast ratios.
 * Substantial cuts may require retuning the house floor.
 */
export const MASTER = 1;

/**
 * Encode 8-bit PWM once, using gamma (not its reciprocal) because LED duty is linear light.
 * 2.45 lowers mids for hit contrast while retaining more deep shades than 2.8.
 * WLED's realtime path disables its own gamma by default.
 */
export function quantize(
	buf: Float32Array,
	out: Uint8Array,
	gamma = GAMMA,
	master = MASTER
): void {
	// Round full scale so it cannot straddle dither codes.
	const full = Math.round(master * 255);
	for (let i = 0; i < buf.length; i++) {
		const v = buf[i] <= 0 ? 0 : buf[i] >= 1 ? 1 : buf[i];
		// Half-code bias keeps full-white pixels from alternating between 254 and 255.
		const byte = Math.floor(Math.pow(v, gamma) * full + DITHER[i & 7] + 0.5);
		out[i] = byte < 0 ? 0 : byte > 255 ? 255 : byte;
	}
}
