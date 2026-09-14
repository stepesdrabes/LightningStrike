/**
 * The night's instruments: seeded DSP, the storm's voices, the mix bus and the master that
 * limits under -1 dBTP and encodes AAC. Every moment's score renders through these, so the
 * evening keeps one sound. Deterministic: the same score always writes the same bytes.
 */
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

export const RATE = 48000;
export const TAU = Math.PI * 2;
/** First true-peak ceiling tried for a mix; the AAC encoder overshoots it by up to a dB. */
const CEILING = -2.2;
const TP_GOAL = -1.5;
const LIMIT_TP = -1;

// ---- Primitives ----------------------------------------------------------------------------------

export const db = (x) => 10 ** (x / 20);
export const at = (seconds) => Math.round(seconds * RATE);
export const smooth = (a, b, x) => {
	const t = Math.max(0, Math.min(1, (x - a) / (b - a)));
	return t * t * (3 - 2 * t);
};
/** 1 until the last 40 ms of a voice `length` samples long, then down to 0, so no voice ends in a step. */
export const ending = (n, length) => smooth(length, length - at(0.04), n);

export function random(seed) {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) >>> 0;
		let t = a;
		t = Math.imul(t ^ (t >>> 15), t | 1);
		t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

export function seedOf(name, n = 0) {
	let h = 2166136261;
	for (const c of `${name}:${n}`) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
	return h >>> 0;
}

class Biquad {
	b0 = 1;
	b1 = 0;
	b2 = 0;
	a1 = 0;
	a2 = 0;
	z1 = 0;
	z2 = 0;

	set(type, freq, q = Math.SQRT1_2) {
		const w = (TAU * Math.min(freq, RATE * 0.45)) / RATE;
		const cos = Math.cos(w);
		const alpha = Math.sin(w) / (2 * q);
		const a0 = 1 + alpha;
		if (type === 'lowpass') {
			this.b0 = (1 - cos) / 2 / a0;
			this.b1 = (1 - cos) / a0;
			this.b2 = this.b0;
		} else if (type === 'highpass') {
			this.b0 = (1 + cos) / 2 / a0;
			this.b1 = -(1 + cos) / a0;
			this.b2 = this.b0;
		} else {
			this.b0 = alpha / a0;
			this.b1 = 0;
			this.b2 = -alpha / a0;
		}
		this.a1 = (-2 * cos) / a0;
		this.a2 = (1 - alpha) / a0;
		return this;
	}

	run(x) {
		const y = this.b0 * x + this.z1;
		this.z1 = this.b1 * x - this.a1 * y + this.z2;
		this.z2 = this.b2 * x - this.a2 * y;
		return y;
	}
}

export const filter = (type, freq, q) => new Biquad().set(type, freq, q);

/** Band-limited sawtooth, -1..1, at `phase` (0..1) advancing by `inc` per sample. */
export function saw(phase, inc) {
	let v = 2 * phase - 1;
	if (phase < inc) {
		const t = phase / inc;
		v -= t + t - t * t - 1;
	} else if (phase > 1 - inc) {
		const t = (phase - 1) / inc;
		v -= t * t + t + t + 1;
	}
	return v;
}

/** A smooth random curve, 0..1, through a new value every `period` seconds. */
export function drift(seed, period, seconds) {
	const rnd = random(seed);
	const points = Array.from({ length: Math.ceil(seconds / period) + 2 }, () => rnd());
	return (t) => {
		const x = Math.min(points.length - 1.000001, Math.max(0, t / period));
		const i = Math.floor(x);
		const u = (1 - Math.cos((x - i) * Math.PI)) / 2;
		return points[i] + (points[i + 1] - points[i]) * u;
	};
}

export function panGains(pan) {
	const a = ((Math.max(-1, Math.min(1, pan)) + 1) * Math.PI) / 4;
	return [Math.cos(a) * Math.SQRT2, Math.sin(a) * Math.SQRT2];
}

/** Ring pixel 0..599 to metres east of the frame's centre, which places a spark in stereo. */
export function ringX(i) {
	const p = ((Math.round(i) % 600) + 600) % 600;
	if (p < 180) return -1.5 + (3 * (p + 0.5)) / 180;
	if (p < 300) return 1.5;
	if (p < 480) return 1.5 - (3 * (p - 300 + 0.5)) / 180;
	return -1.5;
}

/** Sparse clicks of noise, the grain of electricity: call once per sample with clicks per second. */
export function crackler(seed, highpass) {
	const rnd = random(seed);
	const hp = filter('highpass', highpass, 0.7);
	let wait = 0;
	let burst = 0;
	let amp = 0;
	return (density) => {
		if (--wait <= 0) {
			burst = Math.round((0.0004 + 0.0016 * rnd()) * RATE);
			amp = (0.3 + 0.7 * rnd()) * (rnd() < 0.5 ? -1 : 1);
			wait = Math.max(1, Math.round((-Math.log(1 - rnd() * 0.999) / Math.max(density, 1e-3)) * RATE));
		}
		let v = 0;
		if (burst > 0) {
			v = amp * (rnd() * 2 - 1);
			burst--;
		}
		return hp.run(v);
	};
}

// ---- The mix -------------------------------------------------------------------------------------

/** A stereo bus `seconds` long with a short room and a long hall send. */
export function createMix(seconds) {
	const length = Math.round(seconds * RATE);
	const dry = [new Float32Array(length), new Float32Array(length)];
	const room = [new Float32Array(length), new Float32Array(length)];
	const hall = [new Float32Array(length), new Float32Array(length)];
	return {
		length,
		dry,
		room,
		hall,
		put(i, l, r, roomSend = 0, hallSend = 0) {
			if (i < 0 || i >= length) return;
			dry[0][i] += l;
			dry[1][i] += r;
			room[0][i] += l * roomSend;
			room[1][i] += r * roomSend;
			hall[0][i] += l * hallSend;
			hall[1][i] += r * hallSend;
		}
	};
}

// ---- Voices ---------------------------------------------------------------------------------------

/** Rolling thunder: low noise swelling in overlapping rolls that wander across the stereo field. */
export function rumble(mix, time, { duration, rise, cutoff, gain, pan, spread, decay, seed, hallSend = 0.3 }) {
	const rnd = random(seed);
	const rolls = [];
	for (let k = 0; k < Math.round(duration * 4); k++) {
		const u = Math.pow(rnd(), 1.4);
		rolls.push({
			centre: rise + u * duration * 0.8,
			width: 0.1 + 0.5 * rnd(),
			amp: (0.35 + 0.65 * rnd()) * Math.exp(-u * decay),
			pan: pan + (rnd() * 2 - 1) * spread
		});
	}
	const lows = [0, 1].map(() => [filter('lowpass', cutoff, 0.6), filter('lowpass', cutoff, 0.6)]);
	const brown = [0, 0];
	const start = at(time);
	const end = Math.min(mix.length - start, at(duration + 0.4));
	for (let n = 0; n < end; n++) {
		const t = n / RATE;
		let env = 0;
		let panSum = 0;
		for (const r of rolls) {
			const d = (t - r.centre) / r.width;
			if (d < -3 || d > 3) continue;
			const g = r.amp * Math.exp(-0.5 * d * d);
			env += g;
			panSum += g * r.pan;
		}
		if (n % 128 === 0) {
			// Thunder darkens as it rolls: its high end comes from the nearest part of the bolt.
			const c = cutoff * (0.45 + 0.55 * Math.exp(-t / 0.9));
			for (const pair of lows) for (const f of pair) f.set('lowpass', c, 0.6);
		}
		const [gl, gr] = panGains(env > 1e-6 ? panSum / env : pan);
		const shape = gain * (1 - Math.exp(-t / rise)) * (1 - smooth(duration * 0.75, duration + 0.4, t)) * Math.min(1.6, env);
		const out = [0, 0];
		for (let c = 0; c < 2; c++) {
			const w = rnd() * 2 - 1;
			brown[c] = 0.985 * brown[c] + 0.15 * w;
			out[c] = shape * lows[c][1].run(lows[c][0].run(brown[c] * 2.2 + w * 0.55)) * 2.2;
		}
		mix.put(start + n, out[0] * gl, out[1] * gr, 0, hallSend);
	}
}

/** One heart sound: the lub is lower and longer than the dub. */
export function heartSound(mix, time, gain, lub, pan) {
	const rnd = random(seedOf(lub ? 'lub' : 'dub', Math.round(time * 1000)));
	const f0 = lub ? 41 : 54;
	const sweep = lub ? 52 : 62;
	const decay = lub ? 0.12 : 0.08;
	const lp = [filter('lowpass', 150, 0.7), filter('lowpass', 150, 0.7)];
	const click = filter('highpass', 700, 0.7);
	const [gl, gr] = panGains(pan);
	let phase = 0;
	const start = at(time);
	for (let n = 0; n < at(0.8); n++) {
		const t = n / RATE;
		phase += (f0 + sweep * Math.exp(-t / (lub ? 0.035 : 0.025))) / RATE;
		const env = (1 - Math.exp(-t / 0.003)) * Math.exp(-t / decay);
		const body = Math.tanh(2.2 * Math.sin(TAU * phase)) / Math.tanh(2.2);
		const thump = lp[1].run(lp[0].run(rnd() * 2 - 1)) * Math.exp(-t / 0.035) * 4;
		const skin = click.run(rnd() * 2 - 1) * Math.exp(-t / 0.004) * 0.06;
		const v = gain * ending(n, at(0.8)) * (env * body + 0.3 * thump + skin);
		mix.put(start + n, v * gl, v * gr, 0.18, 0.04);
	}
}

/** A spark leaving the corner: a fizz of clicks and a falling whistle. */
export function spark(mix, time, gain, length, panFrom, panTo) {
	const id = Math.round(time * 1000);
	const tick = [crackler(seedOf('sparkL', id), 2400), crackler(seedOf('sparkR', id), 2400)];
	let phase = 0;
	const start = at(time);
	for (let n = 0; n < at(length); n++) {
		const t = n / RATE;
		const u = t / length;
		phase += (1100 + 2600 * Math.exp(-t / 0.05)) / RATE;
		const whistle = 0.25 * Math.sin(TAU * phase) * Math.exp(-t / 0.06);
		const env = gain * (1 - Math.exp(-t / 0.002)) * (1 - u);
		const density = 1400 * Math.exp(-t / (length * 0.35));
		const [gl, gr] = panGains(panFrom + (panTo - panFrom) * u);
		mix.put(start + n, env * (tick[0](density) + whistle) * gl, env * (tick[1](density) + whistle) * gr, 0.15, 0.1);
	}
}

/** A close crack: a shock, a tearing burst of clicks darkening fast, a ripping mid band and the boom. */
export function crack(mix, time, size, seed, pan = 0) {
	const rnd = random(seed);
	const tear = [0, 1].map((c) => ({
		tick: crackler(seed * 3 + c, 150),
		lp: filter('lowpass', 12000, 0.7),
		rip: filter('bandpass', 1400, 0.45),
		flutter: drift(seed * 5 + c, 0.011, 4)
	}));
	const boomLp = [filter('lowpass', 110, 0.7), filter('lowpass', 110, 0.7)];
	const thud = filter('bandpass', 160, 0.8);
	const shockLp = filter('lowpass', 5000, 0.7);
	const [gl, gr] = panGains(pan);
	let phase = 0;
	const start = at(time);
	const length = at(4);
	for (let n = 0; n < Math.min(mix.length - start, length); n++) {
		const t = n / RATE;
		const last = ending(n, length);
		if (n % 96 === 0) {
			for (const side of tear) {
				side.lp.set('lowpass', 1400 + 11000 * Math.exp(-t / 0.08), 0.7);
				side.rip.set('bandpass', 700 + 1800 * Math.exp(-t / 0.25), 0.45);
			}
		}
		const density = 4000 * Math.exp(-t / 0.05) + 400 * Math.exp(-t / 0.35);
		const push = t < 0.0015 ? Math.sin((Math.PI * t) / 0.0015) : 0;
		const pull = t >= 0.0015 && t < 0.0035 ? -0.6 * Math.sin((Math.PI * (t - 0.0015)) / 0.002) : 0;
		const shock = shockLp.run(t < 0.0015 ? push : pull);
		phase += (29 + 48 * Math.exp(-t / 0.1)) / RATE;
		const sub = Math.sin(TAU * phase) * (1 - Math.exp(-t / 0.006)) * Math.exp(-t / 0.85);
		const noise = rnd() * 2 - 1;
		const boom = boomLp[1].run(boomLp[0].run(noise)) * (1 - Math.exp(-t / 0.004)) * Math.exp(-t / 0.45) * 5;
		const body = thud.run(noise) * (1 - Math.exp(-t / 0.003)) * Math.exp(-t / 0.22) * 2.5;
		const low = last * size * (0.5 * sub + 0.45 * boom + 0.35 * body);
		const ripEnv = (1 - Math.exp(-t / 0.002)) * (Math.exp(-t / 0.13) + 0.3 * Math.exp(-t / 0.55));
		const out = [0, 0];
		for (let c = 0; c < 2; c++) {
			const side = tear[c];
			const tearing = side.lp.run(side.tick(density)) * (Math.exp(-t / 0.18) + 0.2 * Math.exp(-t / 0.6)) * 1.3;
			const ripping = side.rip.run(rnd() * 2 - 1) * ripEnv * (0.3 + 0.7 * side.flutter(t)) * 2.4;
			// Driven into a soft clip, as a hit is on a trailer: loud without a needle of a peak.
			out[c] = last * 0.8 * Math.tanh(2.5 * size * (1.1 * shock + tearing + ripping));
		}
		mix.put(start + n, out[0] * gl + low, out[1] * gr + low, 0, 0.45);
	}
}

/** A spark is born: a falling zap, a buzzing arc, a burst of crackle and a sub boom. */
export function ignition(mix, time, size, pan) {
	const id = Math.round(time * 1000);
	const rnd = random(seedOf('ignite', id));
	const tick = [crackler(seedOf('igniteL', id), 1800), crackler(seedOf('igniteR', id), 1800)];
	const arcBand = [filter('bandpass', 900, 0.6), filter('bandpass', 2400, 0.8)];
	const jitter = drift(seedOf('jitter', id), 0.02, 3);
	const [gl, gr] = panGains(pan);
	let zap = 0;
	let arc = 0;
	let boom = 0;
	const start = at(time);
	for (let n = 0; n < at(3); n++) {
		const t = n / RATE;
		const last = ending(n, at(3));
		zap += (170 + 4200 * Math.exp(-t / 0.035)) / RATE;
		const zapV = Math.sin(TAU * zap + 2 * (rnd() - 0.5) * Math.exp(-t / 0.05)) * Math.exp(-t / 0.09);
		const f = 96 * (0.92 + 0.16 * jitter(t));
		arc = (arc + f / RATE) % 1;
		const raw = Math.max(-0.6, Math.min(0.6, saw(arc, f / RATE) * 1.6));
		const arcV = arcBand[1].run(arcBand[0].run(raw)) * 3 * (1 - Math.exp(-t / 0.004)) * Math.exp(-t / 0.35);
		boom += (31 + 55 * Math.exp(-t / 0.08)) / RATE;
		const boomV = Math.sin(TAU * boom) * (1 - Math.exp(-t / 0.004)) * Math.exp(-t / 0.6);
		const density = 2500 * Math.exp(-t / 0.2);
		const mono = last * size * (0.3 * zapV + 0.28 * arcV);
		const low = last * size * 0.75 * boomV;
		const l = mono * gl + low + last * size * 0.3 * tick[0](density);
		const r = mono * gr + low + last * size * 0.3 * tick[1](density);
		mix.put(start + n, l, r, 0.1, 0.35);
	}
}

/** Rain on the roof: bright pings and dull taps over a hiss, `intensity(t)` 0..1 thinning it out. */
export function rainfall(mix, from, until, intensity, seed) {
	const rnd = random(seed);
	const pink = [new Float32Array(3), new Float32Array(3)];
	const hiss = [0, 1].map(() => [filter('bandpass', 2600, 0.6), filter('highpass', 900, 0.7)]);
	const roof = [0, 1].map(() => [filter('lowpass', 260, 0.7), filter('lowpass', 260, 0.7)]);
	const gust = [drift(seed + 1, 1.3, until - from + 2), drift(seed + 2, 1.7, until - from + 2)];
	const pools = [0, 1].map(() => Array.from({ length: 32 }, () => ({ age: 1, f: 0, tau: 0, amp: 0 })));
	const wait = [0, 0];
	for (let n = at(from); n < Math.min(mix.length, at(until)); n++) {
		const t = n / RATE;
		const level = intensity(t);
		const out = [0, 0];
		for (let c = 0; c < 2; c++) {
			if (--wait[c] <= 0) {
				const pool = pools[c];
				let voice = pool[0];
				for (const v of pool) if (v.age >= 5 * v.tau) voice = v;
				const bright = rnd() < 0.7;
				voice.age = 0;
				voice.f = bright ? 1800 + 5200 * Math.pow(rnd(), 1.5) : 160 + 340 * rnd();
				voice.tau = bright ? 0.002 + 0.005 * rnd() : 0.006 + 0.01 * rnd();
				voice.amp = (bright ? 0.6 : 1.4) * (0.15 + 0.85 * rnd() * rnd());
				wait[c] = Math.max(1, Math.round((-Math.log(1 - rnd() * 0.999) / (340 * level + 1e-3)) * RATE));
			}
			let drops = 0;
			for (const v of pools[c]) {
				if (v.age >= 5 * v.tau) continue;
				drops += v.amp * Math.sin(TAU * v.f * v.age) * Math.exp(-v.age / v.tau);
				v.age += 1 / RATE;
			}
			const w = rnd() * 2 - 1;
			const p = pink[c];
			p[0] = 0.99765 * p[0] + w * 0.099046;
			p[1] = 0.963 * p[1] + w * 0.2965164;
			p[2] = 0.57 * p[2] + w * 1.0526913;
			const hissV = hiss[c][1].run(hiss[c][0].run((p[0] + p[1] + p[2] + w * 0.1848) * 0.2)) * (0.6 + 0.4 * gust[c](t - from));
			const roofV = roof[c][1].run(roof[c][0].run(w)) * 2;
			out[c] = level * (0.22 * drops + 0.5 * hissV + 0.16 * roofV);
		}
		mix.put(n, out[0], out[1], 0.1, 0.15);
	}
}

/** A water drop: a click and a bubble ringing up in pitch as it closes. */
export function drip(mix, time, gain, pan) {
	const id = Math.round(time * 1000);
	const rnd = random(seedOf('drip', id));
	const f0 = 900 + 900 * rnd();
	const [gl, gr] = panGains(pan);
	let phase = 0;
	const start = at(time);
	const length = at(0.25);
	for (let n = 0; n < length; n++) {
		const t = n / RATE;
		phase += (f0 * (1 + 0.8 * (1 - Math.exp(-t / 0.012)))) / RATE;
		const env = (1 - Math.exp(-t / 0.0008)) * Math.exp(-t / 0.03);
		const click = t < 0.002 ? (rnd() * 2 - 1) * (1 - t / 0.002) * 0.3 : 0;
		const v = gain * ending(n, length) * (env * Math.sin(TAU * phase) + click);
		mix.put(start + n, v * gl, v * gr, 0.25, 0.3);
	}
}

/** A warm chord: three gently detuned voices per note, spread across the room, `level(t)` shaping it. */
export function pad(mix, from, until, notes, level) {
	const voices = notes.flatMap((f, i) =>
		[0.997, 1, 1.003].map((d, j) => ({ f: f * d, phase: (i * 0.37 + j * 0.21) % 1, gains: panGains((((i + j) % 3) - 1) * 0.5) }))
	);
	const lp = [filter('lowpass', 1800, 0.7), filter('lowpass', 1800, 0.7)];
	for (let n = at(from); n < Math.min(mix.length, at(until)); n++) {
		const t = n / RATE;
		const wobble = 1 + 0.002 * Math.sin(TAU * 0.23 * t);
		let l = 0;
		let r = 0;
		for (const v of voices) {
			v.phase = (v.phase + (v.f * wobble) / RATE) % 1;
			const s = Math.sin(TAU * v.phase) + 0.18 * Math.sin(2 * TAU * v.phase) + 0.06 * Math.sin(3 * TAU * v.phase);
			l += s * v.gains[0];
			r += s * v.gains[1];
		}
		const g = level(t) / voices.length;
		mix.put(n, lp[0].run(l) * g, lp[1].run(r) * g, 0, 0.35);
	}
}

/** A soft bell: inharmonic partials, the high ones dying first. */
export function chime(mix, time, gain, freq, pan) {
	const partials = [[1, 1, 3.2], [2.76, 0.45, 1.4], [5.4, 0.22, 0.7], [8.93, 0.1, 0.35]];
	const [gl, gr] = panGains(pan);
	const start = at(time);
	const length = at(4);
	for (let n = 0; n < length; n++) {
		const t = n / RATE;
		let v = 0;
		for (const [ratio, amp, decay] of partials) v += amp * Math.sin(TAU * freq * ratio * t) * Math.exp(-t / decay);
		v *= gain * (1 - Math.exp(-t / 0.004)) * ending(n, length);
		mix.put(start + n, v * gl, v * gr, 0.1, 0.4);
	}
}

/** A spark's soft electric fizz, placed by `pan(t)` and shaped by `level(t)`. */
export function fizz(mix, from, until, pan, level, seed) {
	const rnd = random(seed);
	const band = [filter('bandpass', 2600, 1.4), filter('bandpass', 2600, 1.4)];
	const tick = [crackler(seed + 1, 2200), crackler(seed + 2, 2200)];
	let hum = 0;
	for (let n = at(from); n < Math.min(mix.length, at(until)); n++) {
		const t = n / RATE;
		hum = (hum + 100 / RATE) % 1;
		const buzz = 0.6 + 0.4 * Math.sin(TAU * hum);
		const [gl, gr] = panGains(pan(t));
		const g = level(t);
		const l = g * (band[0].run(rnd() * 2 - 1) * buzz * 2.5 + 0.6 * tick[0](60));
		const r = g * (band[1].run(rnd() * 2 - 1) * buzz * 2.5 + 0.6 * tick[1](60));
		mix.put(n, l * gl, r * gr, 0.1, 0.1);
	}
}

/** Wind howling through a narrowing band, placed by `pan(t)`, pitched by `pitch(t)`, dulled by `muffle(t)` Hz. */
export function howl(mix, from, until, { pan, level, pitch, muffle }, seed) {
	const rnd = random(seed);
	const pink = [new Float32Array(3), new Float32Array(3)];
	const band = [0, 1].map(() => [filter('bandpass', 400, 2.5), filter('bandpass', 600, 3)]);
	const close = [filter('lowpass', 9000, 0.7), filter('lowpass', 9000, 0.7)];
	const gust = drift(seed + 3, 0.7, until - from + 2);
	let whistle = 0;
	let fifth = 0;
	for (let n = at(from); n < Math.min(mix.length, at(until)); n++) {
		const t = n / RATE;
		const f = pitch(t) * (0.9 + 0.2 * gust(t - from));
		if (n % 32 === 0) {
			for (const pair of band) {
				pair[0].set('bandpass', f, 2.5);
				pair[1].set('bandpass', f * 1.5, 3);
			}
			for (const lp of close) lp.set('lowpass', muffle(t), 0.7);
		}
		whistle += f / RATE;
		fifth += (f * 1.498) / RATE;
		const tone = 0.08 * Math.sin(TAU * whistle) + 0.04 * Math.sin(TAU * fifth);
		const g = level(t) * (0.7 + 0.3 * gust(t - from));
		const [gl, gr] = panGains(pan(t));
		const out = [0, 0];
		for (let c = 0; c < 2; c++) {
			const w = rnd() * 2 - 1;
			const p = pink[c];
			p[0] = 0.99765 * p[0] + w * 0.099046;
			p[1] = 0.963 * p[1] + w * 0.2965164;
			p[2] = 0.57 * p[2] + w * 1.0526913;
			const noise = (p[0] + p[1] + p[2] + w * 0.1848) * 0.2;
			out[c] = g * close[c].run((band[c][0].run(noise) + 0.5 * band[c][1].run(noise)) * 3 + tone);
		}
		mix.put(n, out[0] * gl, out[1] * gr, 0, 0.2);
	}
}

/** The pressure dropping: a sub note and a low rumble under everything, `level(t)` and `freq(t)` Hz. */
export function pressure(mix, from, until, level, freq, seed) {
	const rnd = random(seed);
	const lp = [filter('lowpass', 60, 0.7), filter('lowpass', 60, 0.7)];
	let phase = 0;
	for (let n = at(from); n < Math.min(mix.length, at(until)); n++) {
		const t = n / RATE;
		phase += freq(t) / RATE;
		const v = level(t) * (0.7 * Math.sin(TAU * phase) + 1.8 * lp[1].run(lp[0].run(rnd() * 2 - 1)));
		mix.put(n, v, v, 0, 0.05);
	}
}

/** A sparkle: a bright sine and a quieter inharmonic partial, gone in a tenth of a second. */
export function ping(mix, time, gain, freq, pan) {
	const [gl, gr] = panGains(pan);
	const start = at(time);
	const length = at(0.5);
	for (let n = 0; n < length; n++) {
		const t = n / RATE;
		const env = (1 - Math.exp(-t / 0.002)) * Math.exp(-t / 0.09);
		const v = gain * ending(n, length) * env * (Math.sin(TAU * freq * t) + 0.3 * Math.sin(TAU * freq * 2.76 * t) * Math.exp(-t / 0.03));
		mix.put(start + n, v * gl, v * gr, 0.1, 0.35);
	}
}

// ---- Master ---------------------------------------------------------------------------------------

/** Freeverb: eight damped combs and four allpasses per side, fed in mono. */
function reverb(mix, input, output, { size, damp, wet, predelay }) {
	const scale = RATE / 44100;
	const feedback = size * 0.28 + 0.7;
	const damping = damp * 0.4;
	const delay = at(predelay);
	for (let c = 0; c < 2; c++) {
		const spread = c === 0 ? 0 : 23;
		const delayLine = (len) => ({ buf: new Float32Array(Math.round((len + spread) * scale)), i: 0, store: 0 });
		const comb = [1116, 1188, 1277, 1356, 1422, 1491, 1557, 1617].map(delayLine);
		const pass = [556, 441, 341, 225].map(delayLine);
		for (let n = 0; n < mix.length; n++) {
			const k = n - delay;
			const x = k >= 0 ? (input[0][k] + input[1][k]) * 0.015 : 0;
			let y = 0;
			for (const f of comb) {
				const v = f.buf[f.i];
				f.store = v * (1 - damping) + f.store * damping;
				f.buf[f.i] = x + f.store * feedback;
				if (++f.i >= f.buf.length) f.i = 0;
				y += v;
			}
			for (const a of pass) {
				const v = a.buf[a.i];
				a.buf[a.i] = y + v * 0.5;
				y = v - y;
				if (++a.i >= a.buf.length) a.i = 0;
			}
			output[c][n] += y * wet * 3;
		}
	}
}

/** Windowed-sinc taps that estimate the signal a quarter, half and three quarters between samples. */
const INTERPOLATE = [0.25, 0.5, 0.75].map((phase) =>
	Array.from({ length: 16 }, (_, j) => {
		const x = j - 7 - phase;
		const window = 0.5 + 0.5 * Math.cos((Math.PI * x) / 8.5);
		return (x === 0 ? 1 : Math.sin(Math.PI * x) / (Math.PI * x)) * window;
	})
);

/** The highest level between samples n and n+1 in either channel, 4x oversampled. */
function truePeaks(channels, length) {
	const peaks = new Float32Array(length);
	for (let c = 0; c < 2; c++) {
		const x = channels[c];
		for (let n = 7; n < length - 9; n++) {
			let peak = Math.abs(x[n]);
			for (const taps of INTERPOLATE) {
				let v = 0;
				for (let j = 0; j < 16; j++) v += x[n - 7 + j] * taps[j];
				peak = Math.max(peak, Math.abs(v));
			}
			peaks[n] = Math.max(peaks[n], peak);
		}
	}
	return peaks;
}

/** Look-ahead limiter on true peaks: the gain ramps down before a peak and recovers over `release`. */
function limit(channels, length, ceilingDb, lookahead = 0.005, release = 0.12) {
	const ceiling = db(ceilingDb);
	const ahead = at(lookahead);
	const peaks = truePeaks(channels, length);
	const want = new Float32Array(length);
	for (let n = length - 1; n >= 0; n--) {
		const need = Math.min(1, ceiling / Math.max(peaks[n], peaks[Math.min(length - 1, n + 1)], 1e-9));
		// No faster than a linear ramp across the look-ahead, so the gain never steps.
		want[n] = n + 1 < length ? Math.min(need, want[n + 1] + 1 / ahead) : need;
	}
	const recover = 1 - Math.exp(-1 / (release * RATE));
	let gain = 1;
	for (let n = 0; n < length; n++) {
		gain = Math.min(want[n], gain + (1 - gain) * recover);
		channels[0][n] *= gain;
		channels[1][n] *= gain;
	}
}

function writeWav(path, channels, length) {
	const bytes = Buffer.alloc(44 + length * 8);
	bytes.write('RIFF', 0);
	bytes.writeUInt32LE(36 + length * 8, 4);
	bytes.write('WAVEfmt ', 8);
	bytes.writeUInt32LE(16, 16);
	bytes.writeUInt16LE(3, 20);
	bytes.writeUInt16LE(2, 22);
	bytes.writeUInt32LE(RATE, 24);
	bytes.writeUInt32LE(RATE * 8, 28);
	bytes.writeUInt16LE(8, 32);
	bytes.writeUInt16LE(32, 34);
	bytes.write('data', 36);
	bytes.writeUInt32LE(length * 8, 40);
	for (let n = 0; n < length; n++) {
		bytes.writeFloatLE(channels[0][n], 44 + n * 8);
		bytes.writeFloatLE(channels[1][n], 48 + n * 8);
	}
	writeFileSync(path, bytes);
}

function ffmpeg(args) {
	const options = { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 };
	const result = spawnSync('ffmpeg', ['-hide_banner', '-nostdin', ...args], options);
	if (result.error) throw new Error(`ffmpeg failed to start: ${result.error.message}`);
	if (result.status !== 0) throw new Error(`ffmpeg exited ${result.status}: ${result.stderr.slice(-1500)}`);
	return result.stderr;
}

function loudness(file) {
	const report = ffmpeg(['-i', file, '-filter_complex', 'ebur128=peak=true', '-f', 'null', '-']);
	const summary = report.slice(report.lastIndexOf('Summary:'));
	return {
		integrated: Number(/I:\s+(-?[\d.]+) LUFS/.exec(summary)?.[1]),
		truePeak: Number(/True peak:\s+Peak:\s+(-?[\d.]+) dBFS/.exec(summary)?.[1])
	};
}

/**
 * Reverbs, band limits, an end fade `fade` seconds long, then AAC at the given path with the true
 * peak under -1 dBTP. With `lufs`, the mix is first levelled to that integrated loudness.
 */
export function master(mix, target, { lufs = null, wav = null, fade = 0.3 } = {}) {
	const { length, dry, room, hall } = mix;
	reverb(mix, room, dry, { size: 0.45, damp: 0.55, wet: 0.5, predelay: 0.008 });
	reverb(mix, hall, dry, { size: 0.9, damp: 0.35, wet: 0.55, predelay: 0.03 });

	// Rumble below 22 Hz only costs headroom, and the encoder's own band limit rings on transients
	// unless the mix already stops short of it.
	for (let c = 0; c < 2; c++) {
		const band = [filter('highpass', 22, 0.7), filter('highpass', 22, 0.7)];
		band.push(filter('lowpass', 15500, 0.54), filter('lowpass', 15500, 1.31));
		for (let n = 0; n < length; n++) {
			let v = dry[c][n];
			for (const f of band) v = f.run(v);
			dry[c][n] = v;
		}
	}
	for (let n = length - at(fade); n < length; n++) {
		const k = smooth(length, length - at(fade), n);
		dry[0][n] *= k;
		dry[1][n] *= k;
	}

	const scratch = mkdtempSync(join(tmpdir(), 'light-before-thunder-'));
	const file = join(scratch, 'mix.wav');
	let gain = 0;
	if (lufs !== null) {
		writeWav(file, dry, length);
		gain = lufs - loudness(file).integrated;
	}
	let ceiling = CEILING;
	let measured = { integrated: 0, truePeak: 0 };
	for (let attempt = 0; ; attempt++) {
		const channels = [Float32Array.from(dry[0]), Float32Array.from(dry[1])];
		if (gain !== 0) for (const channel of channels) for (let n = 0; n < length; n++) channel[n] *= db(gain);
		limit(channels, length, ceiling);
		if (!channels.every((channel) => channel.every(Number.isFinite))) {
			throw new Error('The mix has a sample that is not a finite number.');
		}
		writeWav(file, channels, length);
		const encode = ['-c:a', 'aac', '-b:a', '192k', '-map_metadata', '-1', '-fflags', '+bitexact', '-flags:a', '+bitexact'];
		ffmpeg(['-y', '-i', file, ...encode, target]);
		measured = loudness(target);
		const peakOver = measured.truePeak - TP_GOAL;
		const loudnessOff = lufs === null ? 0 : lufs - measured.integrated;
		if ((peakOver <= 0 && Math.abs(loudnessOff) <= 0.3) || attempt === 7) break;
		// The encoder's overshoot barely depends on the ceiling, so step the ceiling by the excess.
		if (peakOver > 0) ceiling -= peakOver + 0.05;
		gain += loudnessOff;
	}
	if (wav) writeFileSync(wav, readFileSync(file));
	rmSync(scratch, { recursive: true, force: true });
	if (!(measured.truePeak < LIMIT_TP)) throw new Error(`True peak ${measured.truePeak} dBTP is not under ${LIMIT_TP} dBTP.`);
	return { ...measured, ceiling };
}
