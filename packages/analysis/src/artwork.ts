import { spawn } from 'node:child_process';

/** Read the cover hue through ffmpeg, already required for audio, without adding image decoders. */

/** Enough to average a sleeve, few enough that the histogram is not a list of unique pixels. */
const SIZE = 48;
/** Below this a pixel is grey and has no hue to contribute. */
const MIN_SAT = 0.22;
/** Reject dark pixels, but keep full-value saturated colour; saturation already excludes white highlights. */
const MIN_VAL = 0.12;
const BINS = 36;
/** Minimum colour agreement for a dominant hue; weak agreement should retain the tempo palette. */
const MIN_SHARE = 0.18;

function rgb2hsv(r: number, g: number, b: number): [number, number, number] {
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	const d = max - min;
	let h = 0;
	if (d > 1e-9) {
		if (max === r) h = ((g - b) / d) % 6;
		else if (max === g) h = (b - r) / d + 2;
		else h = (r - g) / d + 4;
		h *= 60;
	}
	return [((h % 360) + 360) % 360, max > 1e-9 ? d / max : 0, max];
}

function decode(bytes: Uint8Array): Promise<Uint8Array> {
	return new Promise((resolve, reject) => {
		const child = spawn(
			'ffmpeg',
			[
				'-hide_banner', '-loglevel', 'error',
				'-i', 'pipe:0',
				'-vf', `scale=${SIZE}:${SIZE}:force_original_aspect_ratio=decrease`,
				'-frames:v', '1',
				'-f', 'rawvideo', '-pix_fmt', 'rgb24', 'pipe:1'
			],
			{ stdio: ['pipe', 'pipe', 'pipe'] }
		);
		const chunks: Buffer[] = [];
		let err = '';
		child.stdout.on('data', (c: Buffer) => chunks.push(c));
		child.stderr.on('data', (c: Buffer) => (err += c.toString()));
		child.on('error', reject);
		child.on('close', (code) =>
			code === 0 && chunks.length > 0
				? resolve(new Uint8Array(Buffer.concat(chunks)))
				: reject(new Error(`ffmpeg failed on the artwork: ${err.slice(0, 200)}`))
		);
		child.stdin.on('error', () => {});
		child.stdin.end(Buffer.from(bytes));
	});
}

export interface Artwork {
	/** Dominant hue in degrees, or null when the image has no colour worth taking. */
	hue: number | null;
	/** 0..1, the share of the image's coloured pixels that agree with it. */
	share: number;
}

export function dominantHue(rgb: Uint8Array): Artwork {
	const weight = new Float64Array(BINS);
	const sinAcc = new Float64Array(BINS);
	const cosAcc = new Float64Array(BINS);
	let total = 0;

	for (let i = 0; i + 2 < rgb.length; i += 3) {
		const [h, s, v] = rgb2hsv(rgb[i] / 255, rgb[i + 1] / 255, rgb[i + 2] / 255);
		if (s < MIN_SAT || v < MIN_VAL) continue;
		// Weighted by how strongly the pixel asserts its hue, so a large flat wash of colour
		// outvotes a handful of vivid specks and a washed-out background contributes little.
		const w = s * v;
		const bin = Math.min(BINS - 1, Math.floor((h / 360) * BINS));
		weight[bin] += w;
		const rad = (h * Math.PI) / 180;
		sinAcc[bin] += Math.sin(rad) * w;
		cosAcc[bin] += Math.cos(rad) * w;
		total += w;
	}
	if (total <= 0) return { hue: null, share: 0 };

	// Neighbouring bins are the same colour to the eye, so a hue straddling a bin edge should
	// not lose to one that happens to sit in the middle of its own.
	let best = 0;
	let bestScore = -1;
	for (let b = 0; b < BINS; b++) {
		const score = weight[(b - 1 + BINS) % BINS] + weight[b] + weight[(b + 1) % BINS];
		if (score > bestScore) {
			bestScore = score;
			best = b;
		}
	}

	let sin = 0;
	let cos = 0;
	for (const b of [(best - 1 + BINS) % BINS, best, (best + 1) % BINS]) {
		sin += sinAcc[b];
		cos += cosAcc[b];
	}
	const share = bestScore / total;
	if (share < MIN_SHARE) return { hue: null, share };

	const hue = ((Math.atan2(sin, cos) * 180) / Math.PI + 360) % 360;
	return { hue: Math.round(hue * 10) / 10, share: Math.round(share * 100) / 100 };
}

/** Fetch a cover image and report the colour it is. Never throws; a failure is just no colour. */
export async function artworkHue(url: string): Promise<Artwork> {
	if (!/^https?:\/\//.test(url)) return { hue: null, share: 0 };
	try {
		const res = await fetch(url, { signal: AbortSignal.timeout(8000) });
		if (!res.ok) return { hue: null, share: 0 };
		return dominantHue(await decode(new Uint8Array(await res.arrayBuffer())));
	} catch {
		return { hue: null, share: 0 };
	}
}
