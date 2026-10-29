// Spectrogram, per-lane attack envelopes and the bands of the mix, built in the page from the WAVs.

/** 64 samples at 22050 Hz gives the envelope 2.9 ms of resolution, which is what snapping needs. */
const HOP = 64;

function fft(re, im) {
	const n = re.length;
	for (let i = 1, j = 0; i < n; i++) {
		let bit = n >> 1;
		for (; j & bit; bit >>= 1) j ^= bit;
		j ^= bit;
		if (i < j) {
			[re[i], re[j]] = [re[j], re[i]];
			[im[i], im[j]] = [im[j], im[i]];
		}
	}
	for (let len = 2; len <= n; len <<= 1) {
		const ang = (-2 * Math.PI) / len;
		const wr = Math.cos(ang), wi = Math.sin(ang);
		for (let i = 0; i < n; i += len) {
			let cr = 1, ci = 0;
			for (let k = 0; k < len / 2; k++) {
				const ur = re[i + k], ui = im[i + k];
				const vr = re[i + k + len / 2] * cr - im[i + k + len / 2] * ci;
				const vi = re[i + k + len / 2] * ci + im[i + k + len / 2] * cr;
				re[i + k] = ur + vr;
				im[i + k] = ui + vi;
				re[i + k + len / 2] = ur - vr;
				im[i + k + len / 2] = ui - vi;
				const nr = cr * wr - ci * wi;
				ci = cr * wi + ci * wr;
				cr = nr;
			}
		}
	}
}

export function buildSpectrogram(buffer) {
	const N = 1024, STEP = 128;
	const x = buffer.getChannelData(0);
	const rate = buffer.sampleRate;
	const frames = Math.max(1, Math.floor((x.length - N) / STEP));
	const rows = 220, fmin = 30, fmax = Math.min(11025, rate / 2);
	const bins = new Int32Array(rows);
	for (let r = 0; r < rows; r++) {
		const hz = fmin * Math.pow(fmax / fmin, 1 - r / (rows - 1));
		bins[r] = Math.min(N / 2 - 1, Math.max(1, Math.round((hz * N) / rate)));
	}
	const win = new Float32Array(N);
	for (let i = 0; i < N; i++) win[i] = 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (N - 1));
	const off = new OffscreenCanvas(frames, rows);
	const g = off.getContext('2d');
	const img = g.createImageData(frames, rows);
	const re = new Float64Array(N), im = new Float64Array(N);
	const db = new Float32Array(frames * rows);
	for (let f = 0; f < frames; f++) {
		const at = f * STEP;
		for (let i = 0; i < N; i++) {
			re[i] = (x[at + i] ?? 0) * win[i];
			im[i] = 0;
		}
		fft(re, im);
		for (let r = 0; r < rows; r++) {
			const b = bins[r];
			db[r * frames + f] = 20 * Math.log10(Math.hypot(re[b], im[b]) / (N / 4) + 1e-7);
		}
	}
	// Each band against its own median, so a hi-hat reads as clearly as a kick instead of the low
	// end filling the picture.
	const row = new Float32Array(frames);
	for (let r = 0; r < rows; r++) {
		row.set(db.subarray(r * frames, (r + 1) * frames));
		const sorted = Float32Array.from(row).sort();
		const floor = sorted[Math.floor(frames * 0.7)];
		const loud = sorted[Math.floor(frames * 0.995)];
		const span = Math.max(12, loud - floor);
		for (let f = 0; f < frames; f++) {
			const v = Math.pow(Math.max(0, Math.min(1, (row[f] - floor) / span)), 1.35);
			const p = (r * frames + f) * 4;
			img.data[p] = 10 + 196 * v;
			img.data[p + 1] = 10 + 200 * v;
			img.data[p + 2] = 13 + 208 * v;
			img.data[p + 3] = 255;
		}
	}
	g.putImageData(img, 0, 0);
	return { canvas: off, seconds: (frames * STEP) / rate };
}

export function envelope(buffer) {
	const x = buffer.getChannelData(0);
	const n = Math.floor(x.length / HOP);
	const env = new Float32Array(n);
	for (let i = 0; i < n; i++) {
		let sum = 0;
		for (let k = i * HOP; k < (i + 1) * HOP; k++) sum += x[k] * x[k];
		env[i] = Math.sqrt(sum / HOP);
	}
	const fps = buffer.sampleRate / HOP;
	const rise = new Float32Array(n);
	const back = Math.max(1, Math.round(0.012 * fps));
	for (let i = 0; i < n; i++) {
		const before = env[Math.max(0, i - back)];
		rise[i] = Math.max(0, Math.log10(env[i] + 1e-6) - Math.log10(before + 1e-6));
	}
	return { env, rise, fps };
}

const SNAP_S = 0.035;

/** The nearest proposal to `t` within the snap window, or null. */
export function nearestProposal(proposals, t) {
	let best = null, distance = SNAP_S;
	for (const p of proposals) {
		if (Math.abs(p.t - t) <= distance) {
			distance = Math.abs(p.t - t);
			best = p.t;
		}
	}
	return best;
}

/** The strongest attack in that source's envelope near `t`, or `t` itself when there is none. */
export function snapTime(attack, t) {
	const { rise, fps } = attack;
	const from = Math.max(0, Math.round((t - SNAP_S) * fps));
	const to = Math.min(rise.length - 1, Math.round((t + SNAP_S) * fps));
	let best = -1, strongest = 0.04;
	for (let i = from; i <= to; i++) {
		if (rise[i] > strongest) {
			strongest = rise[i];
			best = i;
		}
	}
	return best < 0 ? t : best / fps;
}

/**
 * A Striker 2.0 clip has no separated sources, so each lane is a band of the mix in Hz, [high-pass,
 * low-pass], 0 for none: something to hear and snap to, not a source.
 */
export const BANDS = {
	kick: [0, 150], snare: [1000, 5000], hat: [7000, 0], cymbal: [3000, 0], tom: [60, 400]
};

/** RBJ cookbook Butterworth section, normalised by a0. */
function section(kind, hz, rate) {
	const w = (2 * Math.PI * hz) / rate;
	const alpha = Math.sin(w) / (2 * Math.SQRT1_2);
	const cos = Math.cos(w);
	const a0 = 1 + alpha;
	const b = kind === 'low'
		? [(1 - cos) / 2, 1 - cos, (1 - cos) / 2]
		: [(1 + cos) / 2, -(1 + cos), (1 + cos) / 2];
	return { b0: b[0] / a0, b1: b[1] / a0, b2: b[2] / a0, a1: (-2 * cos) / a0, a2: (1 - alpha) / a0 };
}

function run(y, { b0, b1, b2, a1, a2 }) {
	let x1 = 0, x2 = 0, y1 = 0, y2 = 0;
	for (let i = 0; i < y.length; i++) {
		const x = y[i];
		const out = b0 * x + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
		x2 = x1;
		x1 = x;
		y2 = y1;
		y1 = out;
		y[i] = out;
	}
}

/** `x` through the band, each section run forward then backward so no attack moves in time. */
export function bandOf(x, rate, [low, high]) {
	const y = Float32Array.from(x);
	const sections = [];
	if (low > 0) sections.push(section('high', low, rate));
	if (high > 0) sections.push(section('low', high, rate));
	for (const s of sections) {
		run(y, s);
		y.reverse();
		run(y, s);
		y.reverse();
	}
	return y;
}
