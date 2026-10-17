/**
 * Podzimní listí's studio: a mix bus with true-stereo reverbs, a shimmer, a tempo echo and a
 * sidechained group, and the bus processing that gives the moments a mono low end, width above it
 * and a modern density before Light Before Thunder's master levels, limits and encodes them.
 * Deterministic like everything that renders through it.
 */
import { RATE, TAU, at, db, master, smooth } from '../light-before-thunder/instruments.mjs';

/** RBJ biquad with shelves and peaks, transposed direct form II. */
export class Eq {
	z1 = 0;
	z2 = 0;

	constructor(type, freq, q = Math.SQRT1_2, gain = 0) {
		this.set(type, freq, q, gain);
	}

	set(type, freq, q = Math.SQRT1_2, gain = 0) {
		const w = (TAU * Math.min(freq, RATE * 0.45)) / RATE;
		const cos = Math.cos(w);
		const alpha = Math.sin(w) / (2 * q);
		const A = 10 ** (gain / 40);
		const s = 2 * Math.sqrt(A) * alpha;
		let b;
		let a;
		if (type === 'lowpass') {
			b = [(1 - cos) / 2, 1 - cos, (1 - cos) / 2];
			a = [1 + alpha, -2 * cos, 1 - alpha];
		} else if (type === 'highpass') {
			b = [(1 + cos) / 2, -(1 + cos), (1 + cos) / 2];
			a = [1 + alpha, -2 * cos, 1 - alpha];
		} else if (type === 'bandpass') {
			b = [alpha, 0, -alpha];
			a = [1 + alpha, -2 * cos, 1 - alpha];
		} else if (type === 'peak') {
			b = [1 + alpha * A, -2 * cos, 1 - alpha * A];
			a = [1 + alpha / A, -2 * cos, 1 - alpha / A];
		} else if (type === 'lowshelf') {
			b = [A * (A + 1 - (A - 1) * cos + s), 2 * A * (A - 1 - (A + 1) * cos), A * (A + 1 - (A - 1) * cos - s)];
			a = [A + 1 + (A - 1) * cos + s, -2 * (A - 1 + (A + 1) * cos), A + 1 + (A - 1) * cos - s];
		} else {
			b = [A * (A + 1 + (A - 1) * cos + s), -2 * A * (A - 1 + (A + 1) * cos), A * (A + 1 + (A - 1) * cos - s)];
			a = [A + 1 - (A - 1) * cos + s, 2 * (A - 1 - (A + 1) * cos), A + 1 - (A - 1) * cos - s];
		}
		this.b0 = b[0] / a[0];
		this.b1 = b[1] / a[0];
		this.b2 = b[2] / a[0];
		this.a1 = a[1] / a[0];
		this.a2 = a[2] / a[0];
		return this;
	}

	run(x) {
		const y = this.b0 * x + this.z1;
		this.z1 = this.b1 * x - this.a1 * y + this.z2;
		this.z2 = this.b2 * x - this.a2 * y;
		return y;
	}
}

// ---- The bus -------------------------------------------------------------------------------------

/**
 * A stereo bus `seconds` long at `bpm`. Besides the dry signal every voice can send to a short
 * room, a long hall, a shimmer that climbs an octave as it rings, and an echo on the dotted
 * eighth. `pumped` writes into a group the sidechain ducks wherever `duck` was called.
 */
export function createStudio(seconds, { bpm = 120 } = {}) {
	const length = Math.round(seconds * RATE);
	const pair = () => [new Float32Array(length), new Float32Array(length)];
	const dry = pair();
	const room = pair();
	const hall = pair();
	const shimmer = pair();
	const echo = pair();
	const group = { dry: pair(), hall: pair(), shimmer: pair(), echo: pair() };
	const ducks = [];
	const rides = [];
	return {
		length,
		bpm,
		dry,
		room,
		hall,
		shimmer,
		echo,
		group,
		ducks,
		rides,
		put(i, l, r, roomSend = 0, hallSend = 0, echoSend = 0, shimmerSend = 0) {
			if (i < 0 || i >= length) return;
			dry[0][i] += l;
			dry[1][i] += r;
			room[0][i] += l * roomSend;
			room[1][i] += r * roomSend;
			hall[0][i] += l * hallSend;
			hall[1][i] += r * hallSend;
			echo[0][i] += l * echoSend;
			echo[1][i] += r * echoSend;
			shimmer[0][i] += l * shimmerSend;
			shimmer[1][i] += r * shimmerSend;
		},
		pumped(i, l, r, hallSend = 0, echoSend = 0, shimmerSend = 0) {
			if (i < 0 || i >= length) return;
			group.dry[0][i] += l;
			group.dry[1][i] += r;
			group.hall[0][i] += l * hallSend;
			group.hall[1][i] += r * hallSend;
			group.echo[0][i] += l * echoSend;
			group.echo[1][i] += r * echoSend;
			group.shimmer[0][i] += l * shimmerSend;
			group.shimmer[1][i] += r * shimmerSend;
		},
		/** The sidechain: the group dips by `depth` at `time` and swells back over `release` s. */
		duck(time, depth = 0.7, release = (60 / bpm) * 0.8) {
			ducks.push({ time, depth, release });
		},
		/** The whole moment's fader, `[seconds, dB]` points joined in straight lines, reverbs and all. */
		ride(points) {
			rides.push(...points);
		}
	};
}

/** Every bus of the studio, for cutting holes in all of them at once. */
export function busesOf(mix) {
	return [mix.dry, mix.room, mix.hall, mix.shimmer, mix.echo, mix.group.dry, mix.group.hall, mix.group.shimmer, mix.group.echo];
}

// ---- Effects --------------------------------------------------------------------------------------

/** An octave up by two crossfaded taps sweeping a delay line, for the shimmer's feedback. */
class Octave {
	buf = new Float32Array(8192);
	w = 0;
	phase = 0;
	size = 1920;

	run(x) {
		const buf = this.buf;
		buf[this.w & 8191] = x;
		this.phase += 1 / this.size;
		if (this.phase >= 1) this.phase -= 1;
		const y = this.tap(this.phase) + this.tap((this.phase + 0.5) % 1);
		this.w++;
		return y;
	}

	tap(p) {
		const pos = this.w - this.size * (1 - p) - 2;
		const i = Math.floor(pos);
		const f = pos - i;
		const g = Math.sin(Math.PI * p);
		return (this.buf[i & 8191] * (1 - f) + this.buf[(i + 1) & 8191] * f) * g * g;
	}
}

const LINES = [29.71, 37.13, 41.11, 43.73, 53.93, 59.27, 67.07, 73.31];

/**
 * An eight-line feedback delay network fed in true stereo: left into the even lines, right into
 * the odd, mixed by a Hadamard matrix, each line's length breathing a little so the tail never
 * rings metallic. `octave` feeds the tail an octave up back into itself: the shimmer.
 */
function network(input, output, length, { size, decay, damp, lowcut, highcut, predelay, gain, octave = 0, modulation = 1, width = 1 }) {
	const lens = LINES.map((ms) => Math.round((ms / 1000) * size * RATE));
	const lines = lens.map((len) => new Float32Array(len + 64));
	const pos = new Int32Array(8);
	const lp = new Float64Array(8);
	const g = lens.map((len) => db((-60 * len) / (decay * RATE)));
	const dampC = 1 - Math.exp((-TAU * damp) / RATE);
	const rates = LINES.map((_, k) => 0.31 + 0.17 * k);
	const depth = 6 * modulation;
	const inFilters = [0, 1].map(() => [new Eq('highpass', lowcut, 0.7), new Eq('lowpass', highcut, 0.7)]);
	const shift = octave > 0 ? [new Octave(), new Eq('highpass', 400, 0.7), new Eq('lowpass', 7000, 0.7)] : null;
	const delay = at(predelay);
	const y = new Float64Array(8);
	const near = (1 + width) / 2;
	const far = (1 - width) / 2;
	let fed = 0;
	for (let n = 0; n < length; n++) {
		const k = n - delay;
		let l = k >= 0 ? input[0][k] : 0;
		let r = k >= 0 ? input[1][k] : 0;
		l = inFilters[0][1].run(inFilters[0][0].run(l));
		r = inFilters[1][1].run(inFilters[1][0].run(r));
		if (shift) {
			const up = shift[2].run(shift[1].run(shift[0].run(fed))) * octave;
			l += up;
			r += up;
		}
		for (let i = 0; i < 8; i++) {
			const buf = lines[i];
			const size = buf.length;
			const d = lens[i] - depth - 2 + depth * Math.sin((TAU * rates[i] * n) / RATE + i);
			let p = pos[i] - d;
			if (p < 0) p += size;
			const j = Math.floor(p);
			const f = p - j;
			const v = buf[j] * (1 - f) + buf[j + 1 < size ? j + 1 : 0] * f;
			lp[i] += dampC * (v - lp[i]);
			y[i] = lp[i] * g[i];
		}
		const outL = y[0] - y[2] + y[4] - y[6];
		const outR = y[1] - y[3] + y[5] - y[7];
		fed = (outL + outR) * 0.5;
		// Hadamard, in place.
		for (let h = 1; h < 8; h <<= 1) {
			for (let i = 0; i < 8; i += h << 1) {
				for (let j = i; j < i + h; j++) {
					const a = y[j];
					const b = y[j + h];
					y[j] = a + b;
					y[j + h] = a - b;
				}
			}
		}
		for (let i = 0; i < 8; i++) {
			const buf = lines[i];
			buf[pos[i]] = y[i] * 0.35355339 + (i % 2 === 0 ? l : r) * (i % 4 < 2 ? 1 : -1);
			if (++pos[i] >= buf.length) pos[i] = 0;
		}
		output[0][n] += (outL * near + outR * far) * gain;
		output[1][n] += (outR * near + outL * far) * gain;
	}
}

/** A ping-pong echo of `time` s, its repeats losing their top and bottom as they cross the room. */
function pingPong(input, output, length, { time, feedback, lowcut, highcut, gain, hall }) {
	const size = at(time);
	const left = new Float32Array(size);
	const right = new Float32Array(size);
	const tone = [0, 1].map(() => [new Eq('highpass', lowcut, 0.7), new Eq('lowpass', highcut, 0.7)]);
	let w = 0;
	for (let n = 0; n < length; n++) {
		const l = left[w];
		const r = right[w];
		const x = (input[0][n] + input[1][n]) * 0.5;
		left[w] = tone[0][1].run(tone[0][0].run(x + r * feedback));
		right[w] = tone[1][1].run(tone[1][0].run(l * feedback));
		if (++w >= size) w = 0;
		output[0][n] += l * gain;
		output[1][n] += r * gain;
		if (hall) {
			hall[0][n] += l * 0.3;
			hall[1][n] += r * 0.3;
		}
	}
}

/** The sidechain's gain over the whole bus: 1, dipping at each duck and swelling back. */
function duckCurve(mix) {
	const env = new Float32Array(mix.length).fill(1);
	for (const { time, depth, release } of mix.ducks) {
		const from = at(time);
		const span = at(release);
		for (let n = Math.max(0, from); n < Math.min(mix.length, from + span); n++) {
			const age = (n - from) / RATE;
			const dip = age < 0.004 ? age / 0.004 : 1 - smooth(0.004, release, age);
			env[n] = Math.min(env[n], 1 - depth * dip);
		}
	}
	return env;
}

/** Short-term RMS in dB over 400 ms windows, ignoring silence. */
function loudPercentile(channels, length, q) {
	const win = at(0.4);
	const levels = [];
	for (let s = 0; s + win <= length; s += win) {
		let e = 0;
		for (let n = s; n < s + win; n++) e += channels[0][n] * channels[0][n] + channels[1][n] * channels[1][n];
		if (e > 0) levels.push(10 * Math.log10(e / (2 * win)));
	}
	levels.sort((a, b) => a - b);
	return levels.length ? levels[Math.floor(q * (levels.length - 1))] : -60;
}

/** A stereo-linked compressor with a soft knee, gain riding in dB. */
function glue(channels, length, { threshold, ratio, attack, release, knee }) {
	const det = 1 - Math.exp(-1 / (0.005 * RATE));
	const att = 1 - Math.exp(-1 / (attack * RATE));
	const rel = 1 - Math.exp(-1 / (release * RATE));
	let power = 0;
	let reduction = 0;
	for (let n = 0; n < length; n++) {
		const l = channels[0][n];
		const r = channels[1][n];
		power += det * (0.5 * (l * l + r * r) - power);
		const level = 10 * Math.log10(power + 1e-12);
		const over = level - threshold;
		let want = 0;
		if (over > knee / 2) want = over * (1 - 1 / ratio);
		else if (over > -knee / 2) want = ((over + knee / 2) ** 2 / (2 * knee)) * (1 - 1 / ratio);
		reduction += (want > reduction ? att : rel) * (want - reduction);
		const g = db(-reduction);
		channels[0][n] = l * g;
		channels[1][n] = r * g;
	}
}

/** Linear to `knee`, then rounding smoothly into 1: peaks lose their needles, not their weight. */
function soften(x, knee) {
	const a = Math.abs(x);
	if (a <= knee) return x;
	return Math.sign(x) * (knee + (1 - knee) * Math.tanh((a - knee) / (1 - knee)));
}

// ---- The finish -----------------------------------------------------------------------------------

/**
 * Renders the sends, folds in the sidechained group and rides the moment's fader, then the bus:
 * the side channel cut below 120 Hz so the low end is one centred voice, a lift of air and width
 * above 5 kHz, a dip in the mud, glue on the loudest passages, and a soft clip that takes the
 * needles off the peaks. Then Light Before Thunder's master.
 */
export function finish(mix, target, { lufs, fade, wav = null }) {
	const { length } = mix;
	const out = [Float32Array.from(mix.dry[0]), Float32Array.from(mix.dry[1])];

	const env = duckCurve(mix);
	for (const [from, to] of [
		[mix.group.dry, out],
		[mix.group.hall, mix.hall],
		[mix.group.shimmer, mix.shimmer],
		[mix.group.echo, mix.echo]
	]) {
		for (let c = 0; c < 2; c++) for (let n = 0; n < length; n++) to[c][n] += from[c][n] * env[n];
	}

	const beat = 60 / mix.bpm;
	pingPong(mix.echo, out, length, { time: 0.75 * beat, feedback: 0.42, lowcut: 350, highcut: 5200, gain: 0.9, hall: mix.hall });
	network(mix.room, out, length, { size: 0.35, decay: 0.7, damp: 7000, lowcut: 180, highcut: 10000, predelay: 0.006, gain: 0.55 });
	network(mix.hall, out, length, { size: 1.15, decay: 3.6, damp: 5200, lowcut: 220, highcut: 9000, predelay: 0.028, gain: 0.45, width: 0.75 });
	network(mix.shimmer, out, length, { size: 1.4, decay: 6.5, damp: 6500, lowcut: 500, highcut: 8000, predelay: 0.045, gain: 0.3, octave: 0.42, modulation: 2, width: 0.65 });

	if (mix.rides.length) {
		const points = [...mix.rides].sort((a, b) => a[0] - b[0]);
		const follow = 1 - Math.exp(-1 / (0.05 * RATE));
		let gain = db(points[0][1]);
		for (let n = 0, j = 0; n < length; n++) {
			const t = n / RATE;
			while (j < points.length - 1 && points[j + 1][0] <= t) j++;
			const [t0, d0] = points[j];
			const [t1, d1] = points[Math.min(j + 1, points.length - 1)];
			const want = db(t1 > t0 && t >= t0 ? d0 + ((d1 - d0) * Math.min(1, (t - t0) / (t1 - t0))) : t < t0 ? d0 : d1);
			gain += follow * (want - gain);
			out[0][n] *= gain;
			out[1][n] *= gain;
		}
	}

	const side = [new Eq('highpass', 120, 0.6), new Eq('highpass', 120, 0.9), new Eq('highshelf', 5000, 0.7, 2.5)];
	const tone = [0, 1].map(() => [
		new Eq('highpass', 24, 0.7),
		new Eq('lowshelf', 45, 0.7, -2),
		new Eq('peak', 300, 0.9, -2),
		new Eq('peak', 3200, 0.8, 1),
		new Eq('highshelf', 7500, 0.7, 3.5)
	]);
	for (let n = 0; n < length; n++) {
		let l = out[0][n];
		let r = out[1][n];
		for (const f of tone[0]) l = f.run(l);
		for (const f of tone[1]) r = f.run(r);
		const m = (l + r) * 0.5;
		let s = (l - r) * 0.5;
		for (const f of side) s = f.run(s);
		out[0][n] = m + s;
		out[1][n] = m - s;
	}

	// Glue only on the loudest passages, so a build still grows into its arrival.
	glue(out, length, { threshold: loudPercentile(out, length, 0.9) - 2, ratio: 2, attack: 0.025, release: 0.25, knee: 6 });

	// The rarest needles, the top half per mille of samples, are rounded off before the limiter.
	const magnitudes = new Float32Array(2 * length);
	for (let n = 0; n < length; n++) {
		magnitudes[2 * n] = Math.abs(out[0][n]);
		magnitudes[2 * n + 1] = Math.abs(out[1][n]);
	}
	magnitudes.sort();
	const scale = 1 / Math.max(magnitudes[Math.floor(0.9995 * (magnitudes.length - 1))], 1e-9);
	for (let c = 0; c < 2; c++) for (let n = 0; n < length; n++) out[c][n] = soften(out[c][n] * scale * 0.8, 0.7) * 0.8;

	const empty = [new Float32Array(length), new Float32Array(length)];
	return master({ length, dry: out, room: empty, hall: empty }, target, { lufs, fade, wav });
}
