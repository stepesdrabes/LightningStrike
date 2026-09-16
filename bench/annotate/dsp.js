// Spectrogram and per-source attack envelopes, built in the page from the clip's WAVs.

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
