/**
 * The autumn's own voices, on Light Before Thunder's primitives and the studio's sends.
 * Deterministic like everything they render through.
 */
import {
	RATE,
	TAU,
	at,
	crackler,
	drift,
	ending,
	filter,
	panGains,
	random,
	saw,
	seedOf,
	smooth
} from '../light-before-thunder/instruments.mjs';
import { busesOf } from './studio.mjs';

/**
 * Bush crickets on a warm evening: each voice chirps three pulses on its own period, a little
 * slower than in summer. `level(t)` shapes the whole chorus.
 */
export function crickets(mix, from, until, level, seed) {
	const rnd = random(seed);
	const voices = Array.from({ length: 5 }, (_, v) => ({
		f: 4100 + 1100 * rnd(),
		period: 0.48 + 0.3 * rnd(),
		offset: rnd(),
		amp: 0.5 + 0.5 * rnd(),
		gains: panGains((v / 4) * 1.6 - 0.8)
	}));
	for (let n = at(from); n < Math.min(mix.length, at(until)); n++) {
		const t = n / RATE;
		const g = level(t);
		if (g <= 1e-5) continue;
		let l = 0;
		let r = 0;
		for (const v of voices) {
			const c = Math.floor((t - from) / v.period + v.offset);
			const tau = (t - from) / v.period + v.offset - c;
			const within = tau * v.period;
			const pulse = Math.floor(within / 0.03);
			const p = within - pulse * 0.03;
			if (pulse > 2 || p > 0.014) continue;
			const env = Math.sin((Math.PI * p) / 0.014) ** 2;
			const s = env * v.amp * Math.sin(TAU * v.f * t);
			l += s * v.gains[0];
			r += s * v.gains[1];
		}
		mix.put(n, g * l, g * r, 0.15, 0.25);
	}
}

/** Leaves rustling in a gust: dense dry ticks over a breath of air, `level(t)` and `pan(t)`. */
export function rustle(mix, from, until, { level, pan }, seed) {
	const tick = [crackler(seed + 1, 1800), crackler(seed + 2, 1800)];
	const rnd = random(seed);
	const top = [filter('lowpass', 7000, 0.7), filter('lowpass', 7000, 0.7)];
	const air = [filter('bandpass', 3200, 0.7), filter('bandpass', 3200, 0.7)];
	const flurry = drift(seed + 3, 0.12, until - from + 1);
	for (let n = at(from); n < Math.min(mix.length, at(until)); n++) {
		const t = n / RATE;
		const g = level(t);
		if (g <= 1e-5) continue;
		const busy = 0.4 + 0.6 * flurry(t - from);
		const density = (300 + 3200 * Math.min(1, g * 8)) * busy;
		const [gl, gr] = panGains(pan(t));
		const out = [0, 0];
		for (let c = 0; c < 2; c++) out[c] = g * (top[c].run(tick[c](density)) * 1.4 + air[c].run(rnd() * 2 - 1) * 0.5 * busy);
		mix.put(n, out[0] * gl, out[1] * gr, 0.12, 0.15);
	}
}

/** A branch creaking under load: stick-slip pulses ringing a wooden body. */
export function creak(mix, time, length, gain, pan, seed) {
	const rnd = random(seed);
	const rate = drift(seed + 1, 0.18, length + 1);
	const body = [filter('bandpass', 540, 9), filter('bandpass', 1260, 7), filter('bandpass', 190, 4)];
	const [gl, gr] = panGains(pan);
	const start = at(time);
	const total = at(length);
	let phase = 0;
	for (let n = 0; n < total; n++) {
		const t = n / RATE;
		phase += (45 + 50 * rate(t)) / RATE;
		let x = 0;
		if (phase >= 1) {
			phase -= 1;
			x = 0.6 + 0.4 * rnd();
		}
		const env = Math.sin((Math.PI * t) / length) ** 1.5;
		const v = gain * ending(n, total) * env * (body[0].run(x) * 6 + body[1].run(x) * 3 + body[2].run(x) * 4);
		mix.put(start + n, v * gl, v * gr, 0.2, 0.2);
	}
}

/** A kite's sail flapping, `rate(t)` flaps a second, placed by `pan(t)`. */
export function flutter(mix, from, until, { level, rate, pan }, seed) {
	const rnd = random(seed);
	const band = [filter('bandpass', 950, 0.9), filter('bandpass', 950, 0.9)];
	const low = [filter('lowpass', 240, 0.7), filter('lowpass', 240, 0.7)];
	let phase = 0;
	for (let n = at(from); n < Math.min(mix.length, at(until)); n++) {
		const t = n / RATE;
		phase = (phase + rate(t) / RATE) % 1;
		const flap = Math.abs(Math.sin(Math.PI * phase)) ** 6;
		const g = level(t);
		const [gl, gr] = panGains(pan(t));
		const out = [0, 0];
		for (let c = 0; c < 2; c++) {
			const w = rnd() * 2 - 1;
			out[c] = g * (band[c].run(w) * 2.4 * (0.25 + 0.75 * flap) + low[c].run(w) * 3 * flap);
		}
		mix.put(n, out[0] * gl, out[1] * gr, 0.1, 0.12);
	}
}

/** A kite line singing in the wind: a tone at `pitch(t)` with a slow waver. */
export function lineHum(mix, from, until, { level, pitch, pan }, seed) {
	const waver = drift(seed, 0.35, until - from + 1);
	let phase = 0;
	for (let n = at(from); n < Math.min(mix.length, at(until)); n++) {
		const t = n / RATE;
		phase += (pitch(t) * (0.985 + 0.03 * waver(t - from))) / RATE;
		const v = level(t) * (Math.sin(TAU * phase) + 0.25 * Math.sin(2 * TAU * phase));
		const [gl, gr] = panGains(pan(t));
		mix.put(n, v * gl, v * gr, 0.05, 0.3);
	}
}

/** A sail filling with a crack: a slap of cloth and the thump of the wind in it. */
export function sailSnap(mix, time, gain, pan, seed) {
	const rnd = random(seed);
	const cloth = filter('bandpass', 1300, 1.1);
	const air = [filter('lowpass', 160, 0.7), filter('lowpass', 160, 0.7)];
	const [gl, gr] = panGains(pan);
	const start = at(time);
	const length = at(0.6);
	let thump = 0;
	for (let n = 0; n < length; n++) {
		const t = n / RATE;
		const w = rnd() * 2 - 1;
		thump += (62 + 70 * Math.exp(-t / 0.04)) / RATE;
		const slap = cloth.run(w) * 5 * (1 - Math.exp(-t / 0.0015)) * Math.exp(-t / 0.035);
		const low = air[1].run(air[0].run(w)) * 6 * Math.exp(-t / 0.12) + Math.sin(TAU * thump) * Math.exp(-t / 0.16);
		const v = gain * ending(n, length) * (slap + 0.8 * low);
		mix.put(start + n, v * gl, v * gr, 0.15, 0.25);
	}
}

/** A loose cap giving: gas through the thread, with a faint whistle in it. */
export function capHiss(mix, time, length, gain, pan, seed) {
	const rnd = random(seed);
	const hp = [filter('highpass', 2400, 0.7), filter('highpass', 2400, 0.7)];
	const [gl, gr] = panGains(pan);
	const start = at(time);
	const total = at(length);
	let whistle = 0;
	for (let n = 0; n < total; n++) {
		const t = n / RATE;
		whistle += (3100 - 600 * (t / length)) / RATE;
		const env = (1 - Math.exp(-t / 0.008)) * Math.exp(-t / (length * 0.4));
		const tone = 0.08 * Math.sin(TAU * whistle);
		const v = gain * ending(n, total) * env;
		mix.put(start + n, v * (hp[0].run(rnd() * 2 - 1) * 1.6 + tone) * gl, v * (hp[1].run(rnd() * 2 - 1) * 1.6 + tone) * gr, 0.2, 0.1);
	}
}

/** A glug out of a bottle neck: a resonant gulp rising as the air goes in. */
export function glug(mix, time, gain, pan, seed) {
	const rnd = random(seed);
	const f0 = 150 + 70 * rnd();
	const gurgle = filter('bandpass', 420, 2.5);
	const [gl, gr] = panGains(pan);
	const start = at(time);
	const length = at(0.3);
	let phase = 0;
	for (let n = 0; n < length; n++) {
		const t = n / RATE;
		phase += (f0 * (1 + 1.4 * (1 - Math.exp(-t / 0.05)))) / RATE;
		const env = (1 - Math.exp(-t / 0.004)) * Math.exp(-t / 0.07);
		const v = gain * ending(n, length) * (env * Math.sin(TAU * phase) + 0.6 * gurgle.run(rnd() * 2 - 1) * Math.exp(-t / 0.05));
		mix.put(start + n, v * gl, v * gr, 0.25, 0.15);
	}
}

/** A bubble rising through the glass: a tiny blip climbing in pitch as it closes. */
export function blip(mix, time, gain, freq, pan) {
	const [gl, gr] = panGains(pan);
	const start = at(time);
	const length = at(0.06);
	let phase = 0;
	for (let n = 0; n < length; n++) {
		const t = n / RATE;
		phase += (freq * (1 + 0.6 * (t / 0.06))) / RATE;
		const v = gain * ending(n, length) * (1 - Math.exp(-t / 0.0006)) * Math.exp(-t / 0.014) * Math.sin(TAU * phase);
		mix.put(start + n, v * gl, v * gr, 0.2, 0.2);
	}
}

/** Fermentation fizzing in the glass: the finest crackle, `level(t)`. */
export function fizzle(mix, from, until, level, seed) {
	const tick = [crackler(seed + 1, 4800), crackler(seed + 2, 4800)];
	for (let n = at(from); n < Math.min(mix.length, at(until)); n++) {
		const t = n / RATE;
		const g = level(t);
		if (g <= 1e-5) continue;
		const density = 400 + 5200 * Math.min(1, g * 12);
		mix.put(n, g * tick[0](density), g * tick[1](density), 0.15, 0.2);
	}
}

/** Two glasses meeting: the inharmonic ring of each, a few cents apart, beating as they die. */
export function clink(mix, time, gain, pan) {
	const glass = [
		[1, 1, 1.5],
		[2.32, 0.45, 0.8],
		[4.25, 0.22, 0.35],
		[6.63, 0.1, 0.16]
	];
	const pitches = [1567.98, 1567.98 * 1.059];
	const [gl, gr] = panGains(pan);
	const start = at(time);
	const length = at(3);
	for (let n = 0; n < length; n++) {
		const t = n / RATE;
		let v = 0;
		for (const f of pitches) for (const [ratio, amp, decay] of glass) v += amp * Math.sin(TAU * f * ratio * t) * Math.exp(-t / decay);
		const click = t < 0.002 ? Math.sin((Math.PI * t) / 0.002) * 0.8 : 0;
		v = gain * ending(n, length) * ((1 - Math.exp(-t / 0.0005)) * 0.5 * v + click);
		mix.put(start + n, v * gl, v * gr, 0.15, 0.4);
	}
}

/**
 * A church bell across the village: hum, strike, minor third, fifth and nominal, each partial a
 * pair a hair apart so the bell beats, the high ones dying first, dulled by the distance.
 */
export function churchBell(mix, time, gain, strike, pan) {
	const partials = [
		[0.5, 0.55, 7],
		[1, 0.45, 4.5],
		[1.2, 0.5, 3.8],
		[1.5, 0.22, 2.6],
		[2, 0.6, 2.8],
		[2.5, 0.22, 1.4],
		[2.67, 0.18, 1.2],
		[4, 0.1, 0.8]
	];
	const far = [filter('lowpass', 2400, 0.7), filter('lowpass', 2400, 0.7)];
	const knock = filter('bandpass', 2600, 1.2);
	const rnd = random(seedOf('bell', Math.round(time * 1000)));
	const [gl, gr] = panGains(pan);
	const start = at(time);
	const length = Math.min(mix.length - start, at(7));
	for (let n = 0; n < length; n++) {
		const t = n / RATE;
		let l = 0;
		let r = 0;
		for (const [ratio, amp, decay] of partials) {
			const f = strike * ratio;
			const d = amp * Math.exp(-t / decay);
			l += d * Math.sin(TAU * f * t);
			r += d * Math.sin(TAU * f * 1.0012 * t + 1.3);
		}
		const strikeOn = 1 - Math.exp(-t / 0.002);
		const k = knock.run(rnd() * 2 - 1) * Math.exp(-t / 0.004) * 0.8;
		const last = gain * ending(n, length);
		mix.put(start + n, last * far[0].run(l * strikeOn + k) * gl, last * far[1].run(r * strikeOn + k) * gr, 0.05, 0.5, 0, 0.12);
	}
}

/** A match: the head dragged across the strip, then the flare taking the air with it. */
export function matchStrike(mix, time, gain, pan, seed) {
	const rnd = random(seed);
	const grit = crackler(seed + 1, 1500);
	const scrape = filter('bandpass', 2600, 1.2);
	const flare = [filter('lowpass', 600, 0.7), filter('lowpass', 600, 0.7)];
	const [gl, gr] = panGains(pan);
	const start = at(time);
	const length = at(0.9);
	for (let n = 0; n < length; n++) {
		const t = n / RATE;
		const drag = t < 0.12 ? Math.sin((Math.PI * t) / 0.12) : 0;
		const s = scrape.run(rnd() * 2 - 1) * drag * 1.6 + grit(2500) * drag * 1.2;
		const ft = t - 0.1;
		if (n % 64 === 0 && ft > 0) for (const f of flare) f.set('lowpass', 700 + 5200 * Math.exp(-ft / 0.12), 0.7);
		const whoosh = ft > 0 ? (1 - Math.exp(-ft / 0.012)) * Math.exp(-ft / 0.22) * 2.2 : 0;
		const l = s + flare[0].run(rnd() * 2 - 1) * whoosh;
		const r = s + flare[1].run(rnd() * 2 - 1) * whoosh;
		mix.put(start + n, gain * ending(n, length) * l * gl, gain * ending(n, length) * r * gr, 0.2, 0.2);
	}
}

/**
 * A fire: a low roar, tongues of air licking through the middle and the crackle of the pile.
 * `size(t)` 0..1 grows all three; `pan(t)` places a small fire, and a big one is centred.
 */
export function flame(mix, from, until, { level, size, pan }, seed) {
	const rnd = random(seed);
	const brown = [0, 0];
	const roar = [0, 1].map(() => [filter('lowpass', 300, 0.7), filter('lowpass', 300, 0.7)]);
	const lick = [filter('bandpass', 900, 0.8), filter('bandpass', 1100, 0.8)];
	const tick = [crackler(seed + 1, 700), crackler(seed + 2, 700)];
	const breath = [drift(seed + 3, 0.25, until - from + 2), drift(seed + 4, 0.31, until - from + 2)];
	for (let n = at(from); n < Math.min(mix.length, at(until)); n++) {
		const t = n / RATE;
		const s = size(t);
		if (n % 128 === 0) for (const pair of roar) for (const f of pair) f.set('lowpass', 220 + 1600 * s, 0.7);
		const g = level(t);
		const [pl, pr] = panGains(pan(t) * (1 - s));
		const out = [0, 0];
		for (let c = 0; c < 2; c++) {
			const w = rnd() * 2 - 1;
			brown[c] = 0.985 * brown[c] + 0.15 * w;
			const b = breath[c](t - from);
			const low = roar[c][1].run(roar[c][0].run(brown[c] * 2.4)) * (0.6 + 0.6 * b) * 2;
			const mid = lick[c].run(w) * (0.15 + 0.85 * b * b) * 0.8 * s;
			out[c] = g * (low + mid + tick[c](20 + 260 * s) * (0.5 + 0.5 * s));
		}
		mix.put(n, out[0] * pl, out[1] * pr, 0.08, 0.2);
	}
}

/** A pop in the pile: sap boiling out of a twig, a sharp click and a small knock. */
export function pop(mix, time, gain, pan, seed) {
	const rnd = random(seed);
	const snap = filter('bandpass', 1800 + 2200 * rnd(), 1.4);
	const knock = filter('bandpass', 260, 1.5);
	const [gl, gr] = panGains(pan);
	const start = at(time);
	const length = at(0.08);
	for (let n = 0; n < length; n++) {
		const t = n / RATE;
		const w = rnd() * 2 - 1;
		const v = gain * ending(n, length) * (snap.run(w) * 4 * Math.exp(-t / 0.004) + knock.run(w) * 3 * Math.exp(-t / 0.02));
		mix.put(start + n, v * gl, v * gr, 0.2, 0.2);
	}
}

/** Fuel catching: a low rush of air drawn into the fire and the thump of it going up. */
export function whump(mix, time, gain, pan, seed) {
	const rnd = random(seed);
	const lp = [filter('lowpass', 150, 0.8), filter('lowpass', 150, 0.8)];
	const [gl, gr] = panGains(pan);
	const start = at(time);
	const length = at(1.4);
	let thump = 0;
	for (let n = 0; n < length; n++) {
		const t = n / RATE;
		if (n % 64 === 0) for (const f of lp) f.set('lowpass', 150 + 1500 * smooth(0, 0.25, t) * Math.exp(-t / 0.6), 0.8);
		thump += (52 + 40 * Math.exp(-t / 0.08)) / RATE;
		const env = (1 - Math.exp(-t / 0.05)) * Math.exp(-t / 0.45);
		const low = Math.sin(TAU * thump) * (1 - Math.exp(-t / 0.01)) * Math.exp(-t / 0.3);
		const l = gain * ending(n, length) * (lp[0].run(rnd() * 2 - 1) * 3.2 * env + 0.7 * low);
		const r = gain * ending(n, length) * (lp[1].run(rnd() * 2 - 1) * 3.2 * env + 0.7 * low);
		mix.put(start + n, l * gl, r * gr, 0.1, 0.35);
	}
}

/**
 * A tawny owl across the dark: one long hoot, a pause, then the quavering answer. Pitch is the
 * first hoot's; the bird bends each note up into it and lets it fall away.
 */
export function owl(mix, time, gain, pitch, pan) {
	const rnd = random(seedOf('owl', Math.round(time * 1000)));
	const notes = [
		{ at: 0, length: 0.62, bend: 1, wobble: 0 },
		{ at: 2.1, length: 0.12, bend: 0.94, wobble: 0 },
		{ at: 2.5, length: 0.07, bend: 0.97, wobble: 0 },
		{ at: 2.6, length: 0.07, bend: 0.97, wobble: 0 },
		{ at: 2.7, length: 1.05, bend: 1.02, wobble: 1 }
	];
	const soft = [filter('lowpass', 1300, 0.7), filter('lowpass', 1300, 0.7)];
	const breath = filter('bandpass', 900, 1);
	const [gl, gr] = panGains(pan);
	for (const note of notes) {
		const start = at(time + note.at);
		const length = at(note.length + 0.08);
		let phase = 0;
		for (let n = 0; n < length; n++) {
			const t = n / RATE;
			const u = t / note.length;
			const bend = 1 + 0.06 * Math.min(1, t / 0.06) - 0.09 * Math.max(0, u - 0.6);
			const quaver = 1 + note.wobble * 0.025 * Math.sin(TAU * 11 * t) * smooth(0.1, 0.4, t);
			phase += (pitch * note.bend * bend * quaver) / RATE;
			const env = smooth(0, 0.035, t) * (1 - smooth(note.length * 0.75, note.length + 0.06, t));
			const tone = Math.sin(TAU * phase) + 0.12 * Math.sin(2 * TAU * phase);
			const air = breath.run(rnd() * 2 - 1) * 0.25 * Math.exp(-t / 0.05);
			const v = gain * env * (tone + air);
			mix.put(start + n, soft[0].run(v) * gl, soft[1].run(v) * gr, 0.05, 0.55);
		}
	}
}

/** A feather of hoarfrost forming: a breath of the finest air and a small, soft glass note. */
export function frostTuft(mix, time, gain, freq, pan, seed) {
	const rnd = random(seed);
	const hp = filter('highpass', 6500, 0.7);
	const [gl, gr] = panGains(pan);
	const start = at(time);
	const length = at(0.7);
	for (let n = 0; n < length; n++) {
		const t = n / RATE;
		const puff = hp.run(rnd() * 2 - 1) * Math.sin(Math.PI * Math.min(1, t / 0.08)) * (t < 0.08 ? 0.5 : 0);
		const note = (1 - Math.exp(-t / 0.006)) * Math.exp(-t / 0.22) * (Math.sin(TAU * freq * t) + 0.2 * Math.sin(TAU * freq * 2.1 * t));
		const v = gain * ending(n, length) * (puff + 0.6 * note);
		mix.put(start + n, v * gl, v * gr, 0.3, 0.5);
	}
}

/** A dry stem breaking: two ticks a hair apart and the knock of the twig. */
export function stemSnap(mix, time, gain, pan, seed) {
	const rnd = random(seed);
	const tick = filter('bandpass', 3200, 2);
	const wood = filter('bandpass', 880, 3);
	const [gl, gr] = panGains(pan);
	const start = at(time);
	const length = at(0.12);
	for (let n = 0; n < length; n++) {
		const t = n / RATE;
		const w = rnd() * 2 - 1;
		const ticks = Math.exp(-t / 0.002) + 0.7 * (t > 0.009 ? Math.exp(-(t - 0.009) / 0.002) : 0);
		const v = gain * ending(n, length) * (tick.run(w) * 4 * ticks + wood.run(w) * 3 * Math.exp(-t / 0.02));
		mix.put(start + n, v * gl, v * gr, 0.2, 0.3);
	}
}

/** The air a falling leaf moves through on one swing. */
export function swish(mix, time, length, gain, panFrom, panTo, seed) {
	const rnd = random(seed);
	const band = [filter('bandpass', 1700, 0.9), filter('bandpass', 1700, 0.9)];
	const start = at(time);
	const total = at(length);
	for (let n = 0; n < total; n++) {
		const t = n / RATE;
		const u = t / length;
		if (n % 64 === 0) for (const b of band) b.set('bandpass', 1900 - 700 * u, 0.9);
		const env = gain * Math.sin(Math.PI * u) ** 2;
		const [gl, gr] = panGains(panFrom + (panTo - panFrom) * u);
		mix.put(start + n, env * band[0].run(rnd() * 2 - 1) * gl, env * band[1].run(rnd() * 2 - 1) * gr, 0.15, 0.35);
	}
}

// ---- The musical voices --------------------------------------------------------------------------

const UNISON = [-1, -0.62, -0.28, 0, 0.28, 0.62, 1];
const UNISON_GAIN = [0.55, 0.72, 0.88, 1, 0.88, 0.72, 0.55];

/**
 * A wide supersaw chord: seven saws a note, detuned up to `detune` semitones and fanned across
 * the room, through a filter at `bright(t)` Hz, with a sine under each note for body. `pump`
 * plays it through the sidechain.
 */
export function lush(mix, from, until, notes, level, { bright = () => 2600, detune = 0.16, width = 0.9, room = 0, hall = 0.4, echo = 0, shimmer = 0.12, body = 0.35, pump = false, seed = 1 } = {}) {
	const rnd = random(seed);
	const voices = [];
	for (const f of notes) {
		UNISON.forEach((u, k) => {
			const [gl, gr] = panGains(u * width * (0.75 + 0.25 * rnd()));
			voices.push({ inc: (f * Math.pow(2, (u * detune) / 12)) / RATE, phase: rnd(), gl: gl * UNISON_GAIN[k], gr: gr * UNISON_GAIN[k] });
		});
	}
	const sines = notes.map((f) => ({ inc: f / RATE, phase: rnd() }));
	const norm = 1 / Math.sqrt(voices.length);
	const bodyNorm = body / Math.sqrt(sines.length);
	const lp = [0, 1].map(() => [filter('lowpass', 2000, 0.7), filter('lowpass', 2000, 0.9)]);
	for (let n = Math.max(0, at(from)); n < Math.min(mix.length, at(until)); n++) {
		const t = n / RATE;
		if (n % 64 === 0) {
			const c = Math.max(80, bright(t));
			for (const pair of lp) {
				pair[0].set('lowpass', c, 0.7);
				pair[1].set('lowpass', c, 0.9);
			}
		}
		const g = level(t);
		let l = 0;
		let r = 0;
		for (const v of voices) {
			v.phase += v.inc;
			if (v.phase >= 1) v.phase -= 1;
			const s = saw(v.phase, v.inc);
			l += s * v.gl;
			r += s * v.gr;
		}
		let b = 0;
		for (const s of sines) {
			s.phase += s.inc;
			if (s.phase >= 1) s.phase -= 1;
			b += Math.sin(TAU * s.phase);
		}
		if (g <= 1e-6) continue;
		const outL = g * (lp[0][1].run(lp[0][0].run(l * norm)) + b * bodyNorm);
		const outR = g * (lp[1][1].run(lp[1][0].run(r * norm)) + b * bodyNorm);
		if (pump) mix.pumped(n, outL, outR, hall, echo, shimmer);
		else mix.put(n, outL, outR, room, hall, echo, shimmer);
	}
}

/** An FM bell: its brightness dies with the note, and each side rings a hair apart from the other. */
export function bell(mix, time, gain, freq, pan, { decay = 2.4, index = 2, ratio = 3.5, room = 0.05, hall = 0.35, echo = 0.2, shimmer = 0.12 } = {}) {
	const [gl, gr] = panGains(pan);
	const start = at(time);
	const length = Math.min(mix.length - start, at(decay * 2.4));
	const f = [freq * 0.9986, freq * 1.0014];
	for (let n = 0; n < length; n++) {
		const t = n / RATE;
		const env = gain * (1 - Math.exp(-t / 0.0015)) * Math.exp(-t / decay) * ending(n, length);
		const idx = index * Math.exp(-t / (decay * 0.22));
		const hi = 0.22 * Math.exp(-t / (decay * 0.35));
		const v = [0, 0];
		for (let c = 0; c < 2; c++) v[c] = Math.sin(TAU * f[c] * t + idx * Math.sin(TAU * f[c] * ratio * t)) + hi * Math.sin(TAU * 2 * f[c] * t);
		mix.put(start + n, env * v[0] * gl, env * v[1] * gr, room, hall, echo, shimmer);
	}
}

/** A glass tink: a bright inharmonic strike gone in a breath, its echo carrying it across. */
export function glass(mix, time, gain, freq, pan, { decay = 0.32, room = 0.1, hall = 0.3, echo = 0.35, shimmer = 0.15 } = {}) {
	const [gl, gr] = panGains(pan);
	const start = at(time);
	const length = Math.min(mix.length - start, at(decay * 4));
	const f = [freq * 0.998, freq * 1.002];
	for (let n = 0; n < length; n++) {
		const t = n / RATE;
		const env = gain * (1 - Math.exp(-t / 0.0008)) * Math.exp(-t / decay) * ending(n, length);
		const idx = 1.4 * Math.exp(-t / 0.03);
		const v = [0, 0];
		for (let c = 0; c < 2; c++) v[c] = Math.sin(TAU * f[c] * t + idx * Math.sin(TAU * f[c] * 2.76 * t)) + 0.3 * Math.sin(TAU * f[c] * 4.07 * t) * Math.exp(-t / (decay * 0.3));
		mix.put(start + n, env * v[0] * gl, env * v[1] * gr, room, hall, echo, shimmer);
	}
}

/** A synth pluck: two saws a few cents apart, one each side, the filter snapping shut behind the note. */
export function synthPluck(mix, time, gain, freq, pan, { decay = 0.35, bright = 6500, room = 0.05, hall = 0.25, echo = 0.35, shimmer = 0.05, pump = false } = {}) {
	const [gl, gr] = panGains(pan);
	const start = at(time);
	const length = Math.min(mix.length - start, at(decay * 4));
	const inc = [(freq * 0.9954) / RATE, (freq * 1.0046) / RATE];
	const sub = freq / 2 / RATE;
	const phase = [0.1, 0.6];
	let low = 0;
	const lp = [filter('lowpass', bright, 1.1), filter('lowpass', bright, 1.1)];
	for (let n = 0; n < length; n++) {
		const t = n / RATE;
		if (n % 32 === 0) for (const f of lp) f.set('lowpass', 220 + bright * Math.exp(-t / (decay * 0.3)), 1.1);
		const env = gain * (1 - Math.exp(-t / 0.002)) * Math.exp(-t / decay) * ending(n, length);
		low = (low + sub) % 1;
		const v = [0, 0];
		for (let c = 0; c < 2; c++) {
			phase[c] = (phase[c] + inc[c]) % 1;
			v[c] = lp[c].run(saw(phase[c], inc[c]) + 0.5 * saw(low, sub)) * env;
		}
		if (pump) mix.pumped(start + n, v[0] * gl, v[1] * gr, hall, echo, shimmer);
		else mix.put(start + n, v[0] * gl, v[1] * gr, room, hall, echo, shimmer);
	}
}

/** A harp string: a soft burst ringing in a delay line its period long, the two sides tuned a hair apart. */
export function pluck(mix, time, gain, freq, pan, seed, { ring = 1.6, room = 0.1, hall = 0.3, echo = 0.1, shimmer = 0.05 } = {}) {
	const rnd = random(seed);
	const [gl, gr] = panGains(pan);
	const start = at(time);
	const length = Math.min(mix.length - start, at(ring + 0.4));
	const loss = Math.pow(0.001, 1 / (ring * freq));
	const strings = [freq * 0.999, freq * 1.001].map((f) => {
		const size = Math.max(2, Math.round(RATE / f));
		const line = new Float32Array(size);
		let soft = 0;
		for (let k = 0; k < size; k++) line[k] = soft += 0.5 * (rnd() * 2 - 1 - soft);
		return { line, i: 0 };
	});
	for (let n = 0; n < length; n++) {
		const v = [0, 0];
		for (let c = 0; c < 2; c++) {
			const s = strings[c];
			const size = s.line.length;
			const next = s.i + 1 < size ? s.i + 1 : 0;
			v[c] = s.line[s.i];
			s.line[s.i] = loss * 0.5 * (s.line[s.i] + s.line[next]);
			s.i = next;
		}
		const g = gain * 1.6 * ending(n, length);
		mix.put(start + n, g * v[0] * gl, g * v[1] * gr, room, hall, echo, shimmer);
	}
}

/** A harp glissando up through `notes` in `span` seconds, sweeping across the room. */
export function gliss(mix, time, span, notes, gain, panFrom, panTo, seed) {
	notes.forEach((f, k) => {
		const u = k / Math.max(1, notes.length - 1);
		pluck(mix, time + u * span, gain * (0.7 + 0.3 * u), f, panFrom + (panTo - panFrom) * u, seedOf('gliss', seed + k), { ring: 1.8, hall: 0.4, echo: 0.2, shimmer: 0.15 });
	});
}

/** Air: stereo noise through a band centred on `centre(t)` Hz, shaped by `level(t)`, its sides independent. */
export function air(mix, from, until, { level, centre, q = 0.9, width = 1, pan = () => 0, room = 0, hall = 0.2, echo = 0, shimmer = 0 }, seed) {
	const rnd = random(seed);
	const band = [filter('bandpass', 1000, q), filter('bandpass', 1000, q)];
	for (let n = Math.max(0, at(from)); n < Math.min(mix.length, at(until)); n++) {
		const t = n / RATE;
		if (n % 32 === 0) for (const b of band) b.set('bandpass', Math.max(40, centre(t)), q);
		const g = level(t);
		const a = band[0].run(rnd() * 2 - 1) * 2.4;
		const b = band[1].run(rnd() * 2 - 1) * 2.4;
		if (g <= 1e-6) continue;
		const m = (a + b) * 0.5;
		const s = (a - b) * 0.5 * width;
		const [gl, gr] = panGains(pan(t));
		mix.put(n, g * (m + s) * gl, g * (m - s) * gr, room, hall, echo, shimmer);
	}
}

/**
 * The rise into a moment: noise sweeping up and opening wide, and a chord of saws gliding up an
 * octave under it, cut dead at `until` so what follows lands in the hole it leaves.
 */
export function riser(mix, from, until, { gain, fromHz = 300, toHz = 7000, notes = null, seed }) {
	const span = until - from;
	if (span <= 0) return;
	const rise = (t) => Math.max(0, Math.min(1, (t - from) / span));
	const cut = (t) => 1 - smooth(until - 0.006, until, t);
	air(mix, from, until, { level: (t) => gain * Math.pow(rise(t), 2.2) * cut(t), centre: (t) => fromHz * Math.pow(toHz / fromHz, Math.pow(rise(t), 1.5)), q: 1.1, width: 0.7, hall: 0.25 }, seed);
	if (!notes) return;
	const rnd = random(seed + 7);
	const voices = notes.flatMap((f) => [-1, 0, 1].map((u) => ({ f: f * Math.pow(2, (u * 0.15) / 12), phase: rnd(), pan: u * 0.8 })));
	const lp = [filter('lowpass', 800, 0.8), filter('lowpass', 800, 0.8)];
	for (let n = Math.max(0, at(from)); n < Math.min(mix.length, at(until)); n++) {
		const t = n / RATE;
		const u = rise(t);
		if (n % 64 === 0) for (const f of lp) f.set('lowpass', 500 + 7000 * u * u, 0.8);
		const glide = Math.pow(2, u * u);
		let l = 0;
		let r = 0;
		for (const v of voices) {
			const inc = (v.f * glide) / RATE;
			v.phase = (v.phase + inc) % 1;
			const s = saw(v.phase, inc);
			const [gl, gr] = panGains(v.pan * u);
			l += s * gl;
			r += s * gr;
		}
		const g = gain * 0.5 * Math.pow(u, 2.5) * cut(t) / Math.sqrt(voices.length);
		mix.put(n, g * lp[0].run(l), g * lp[1].run(r), 0, 0.2, 0, 0.1);
	}
}

/**
 * A reverse swell: a chord and a breath of air drawn in out of nothing, the way a reverb runs
 * backwards, cut at `until` exactly where what it draws in arrives.
 */
export function swell(mix, until, length, notes, gain, seed) {
	const from = until - length;
	const u = (t) => Math.max(0, Math.min(1, (t - from) / length));
	const cut = (t) => 1 - smooth(until - 0.008, until, t);
	lush(mix, from, until, notes, (t) => gain * Math.pow(u(t), 3.2) * cut(t), { bright: (t) => 500 + 9000 * Math.pow(u(t), 2), width: 1, hall: 0.12, shimmer: 0.05, body: 0.15, seed });
	air(mix, from, until, { level: (t) => gain * 0.5 * Math.pow(u(t), 4) * cut(t), centre: (t) => 2500 + 6000 * u(t), q: 0.7, width: 0.6, hall: 0.1 }, seed + 3);
}

/** The air of something passing close: a band of noise falling as it goes by, from one side to the other. */
export function whoosh(mix, time, length, gain, panFrom, panTo, seed) {
	const u = (t) => Math.max(0, Math.min(1, (t - time) / length));
	air(
		mix,
		time,
		time + length,
		{
			level: (t) => gain * Math.pow(Math.sin(Math.PI * Math.pow(u(t), 0.7)), 2),
			centre: (t) => 3200 * Math.pow(0.18, u(t)),
			q: 0.8,
			width: 0.6,
			pan: (t) => panFrom + (panTo - panFrom) * u(t),
			hall: 0.25,
			echo: 0.1
		},
		seed
	);
}

/** A sub under an arrival, swelling in rather than struck, and settling into the room. */
export function bloomSub(mix, time, gain, freq, length = 6) {
	const start = at(time);
	const total = Math.min(mix.length - start, at(length));
	let phase = 0;
	for (let n = 0; n < total; n++) {
		const t = n / RATE;
		phase += freq / RATE;
		const env = gain * smooth(0, 0.35, t) * Math.exp(-Math.max(0, t - 0.35) / (length * 0.4)) * ending(n, total);
		const v = env * (Math.sin(TAU * phase) + 0.18 * Math.sin(2 * TAU * phase));
		mix.put(start + n, v, v, 0, 0, 0, 0);
	}
}

/** A reverse cymbal: bright air and a cluster of metal drawn in to `until`. */
export function cymbalSwell(mix, until, length, gain, seed) {
	const from = until - length;
	const u = (t) => Math.max(0, Math.min(1, (t - from) / length));
	const cut = (t) => 1 - smooth(until - 0.006, until, t);
	air(mix, from, until, { level: (t) => gain * Math.pow(u(t), 3.5) * cut(t), centre: () => 7000, q: 0.5, width: 0.6, hall: 0.15 }, seed);
}

/** A snare in a roll: a crack of stereo noise and a tuned body, tighter, brighter and wider as `u` rises. */
export function snare(mix, time, gain, u, pan, seed) {
	const rnd = random(seed);
	const hp = [filter('highpass', 1400 + 1800 * u, 0.7), filter('highpass', 1400 + 1800 * u, 0.7)];
	const [gl, gr] = panGains(pan);
	const start = at(time);
	const length = Math.min(mix.length - start, at(0.3));
	const decay = 0.13 - 0.07 * u;
	let phase = 0;
	for (let n = 0; n < length; n++) {
		const t = n / RATE;
		phase += (190 + 70 * u + 90 * Math.exp(-t / 0.01)) / RATE;
		const body = Math.sin(TAU * phase) * Math.exp(-t / 0.045) * 0.7;
		const attack = 1 - Math.exp(-t / 0.0006);
		const env = gain * attack * ending(n, length);
		const a = hp[0].run(rnd() * 2 - 1) * Math.exp(-t / decay) * 1.6;
		const b = hp[1].run(rnd() * 2 - 1) * Math.exp(-t / decay) * 1.6;
		const m = (a + b) * 0.5;
		const s = (a - b) * 0.5 * (0.3 + 0.7 * u);
		mix.put(start + n, env * (m + s + body) * gl, env * (m - s + body) * gr, 0.25, 0.15, 0, 0);
	}
}

/**
 * A string ostinato, bowed short: `pattern` frequencies in turn at `rate(t)` notes a second, each
 * note's filter snapping shut from `bright(t)` Hz. Two saws a side, a few cents apart, and one an
 * octave down in the middle. `speed(t)` below 1 slows the bow and the pitch together, the way a
 * tape stops.
 */
export function ostinato(mix, from, until, { pattern, rate, bright, level, speed = () => 1, pump = false, echo = 0.15 }, seed) {
	const rnd = random(seed);
	const lp = [filter('lowpass', 800, 1), filter('lowpass', 800, 1)];
	const detune = [
		[0.9935, 1.0021],
		[1.0065, 0.9979]
	];
	const phases = [
		[rnd(), rnd()],
		[rnd(), rnd()]
	];
	let low = 0;
	let notes = 0;
	for (let n = Math.max(0, at(from)); n < Math.min(mix.length, at(until)); n++) {
		const t = n / RATE;
		const s = speed(t);
		notes += (rate(t) * s) / RATE;
		const note = Math.floor(notes);
		const u = notes - note;
		const f = pattern[note % pattern.length] * s;
		if (n % 32 === 0) {
			const c = Math.max(120, bright(t) * (0.3 + 0.7 * Math.exp(-u / 0.3)));
			for (const filt of lp) filt.set('lowpass', c, 1);
		}
		const env = (1 - Math.exp(-u / 0.02)) * Math.exp(-u / 0.5);
		const g = level(t) * env;
		const lowInc = (f * 0.5) / RATE;
		low = (low + lowInc) % 1;
		const under = 0.45 * saw(low, lowInc);
		const out = [0, 0];
		for (let c = 0; c < 2; c++) {
			const ph = phases[c];
			let v = under;
			for (let k = 0; k < 2; k++) {
				const inc = (f * detune[c][k]) / RATE;
				ph[k] = (ph[k] + inc) % 1;
				v += saw(ph[k], inc);
			}
			out[c] = g * lp[c].run(v * 0.36);
		}
		if (pump) mix.pumped(n, out[0], out[1], 0.25, echo, 0.03);
		else mix.put(n, out[0], out[1], 0.12, 0.25, echo, 0.03);
	}
}

/** A taiko: the head's pitch falling into the floor in the middle, the slap of the skin and its room either side. */
export function taiko(mix, time, gain, pan, seed) {
	const rnd = random(seed);
	const thump = filter('lowpass', 240, 0.8);
	const slap = [filter('bandpass', 1100, 0.9), filter('bandpass', 1250, 0.9)];
	const [gl, gr] = panGains(pan);
	const start = at(time);
	const length = Math.min(mix.length - start, at(1.4));
	let phase = 0;
	for (let n = 0; n < length; n++) {
		const t = n / RATE;
		phase += (54 + 100 * Math.exp(-t / 0.045)) / RATE;
		const body = Math.sin(TAU * phase) * (1 - Math.exp(-t / 0.002)) * Math.exp(-t / 0.38);
		const low = thump.run(rnd() * 2 - 1) * Math.exp(-t / 0.1) * 3;
		const core = Math.tanh(1.5 * (body + 0.4 * low));
		const last = gain * ending(n, length);
		const a = slap[0].run(rnd() * 2 - 1) * Math.exp(-t / 0.02) * 1.3;
		const b = slap[1].run(rnd() * 2 - 1) * Math.exp(-t / 0.02) * 1.3;
		mix.put(start + n, last * (core + a * gl), last * (core + b * gr), 0.3, 0.25, 0, 0);
	}
}

/**
 * The trailer brass: every note three detuned saws, the filter blown open on the attack and
 * closing as it holds, driven until it growls.
 */
export function braam(mix, time, length, gain, notes, seed) {
	const rnd = random(seed);
	const voices = notes.flatMap((f) =>
		[0.996, 1, 1.004].map((d, k) => ({ f: f * d, phase: [rnd(), rnd()], spread: (k - 1) * 0.0025 }))
	);
	const lp = [filter('lowpass', 300, 1.4), filter('lowpass', 300, 1.4)];
	const start = at(time);
	const total = Math.min(mix.length - start, at(length));
	for (let n = 0; n < total; n++) {
		const t = n / RATE;
		if (n % 64 === 0) {
			const cutoff = 260 + 2600 * (1 - Math.exp(-t / 0.06)) * Math.exp(-t / (length * 0.3)) + 380;
			for (const f of lp) f.set('lowpass', cutoff, 1.4);
		}
		const env = (1 - Math.exp(-t / 0.035)) * (1 - smooth(length * 0.45, length, t));
		const out = [0, 0];
		for (let c = 0; c < 2; c++) {
			let v = 0;
			for (const voice of voices) {
				const inc = (voice.f * (1 + (c ? voice.spread : -voice.spread))) / RATE;
				voice.phase[c] = (voice.phase[c] + inc) % 1;
				v += saw(voice.phase[c], inc);
			}
			out[c] = Math.tanh(1.8 * lp[c].run(v / Math.sqrt(voices.length)));
		}
		const g = gain * env * ending(n, total);
		mix.put(start + n, g * out[0], g * out[1], 0.1, 0.4, 0, 0.05);
	}
}

/**
 * A choir on "ah": four voices a note, each with its own vibrato and place in the room, through
 * the vowel's formants with a little breath, `level(t)`.
 */
export function choir(mix, from, until, notes, level, seed, { hall = 0.55, shimmer = 0.18 } = {}) {
	const rnd = random(seed);
	const voices = notes.flatMap((f, i) =>
		[0, 1, 2, 3].map((j) => {
			const [gl, gr] = panGains(((((i + j) % 4) / 3) * 2 - 1) * 0.85);
			return { f: f * (1 + (j - 1.5) * 0.0035), phase: rnd(), vib: 4.6 + 1.4 * rnd(), vibPhase: rnd() * TAU, gl, gr };
		})
	);
	const formants = [0, 1].map(() => [filter('bandpass', 730, 5), filter('bandpass', 1090, 6), filter('bandpass', 2440, 8), filter('highpass', 4000, 0.7)]);
	for (let n = Math.max(0, at(from)); n < Math.min(mix.length, at(until)); n++) {
		const t = n / RATE;
		const g = level(t);
		if (g <= 1e-5) continue;
		let l = 0;
		let r = 0;
		for (const v of voices) {
			const inc = (v.f * (1 + 0.006 * Math.sin(TAU * v.vib * t + v.vibPhase))) / RATE;
			v.phase = (v.phase + inc) % 1;
			const s = saw(v.phase, inc);
			l += s * v.gl;
			r += s * v.gr;
		}
		const out = [0, 0];
		const src = [l, r];
		for (let c = 0; c < 2; c++) {
			const x = src[c] / voices.length;
			const [f1, f2, f3, breath] = formants[c];
			out[c] = g * (f1.run(x) * 2.2 + f2.run(x) * 1.4 + f3.run(x) * 0.8 + breath.run(rnd() * 2 - 1) * 0.025);
		}
		mix.put(n, out[0], out[1], 0.05, hall, 0, shimmer);
	}
}

/** A crash cymbal: bright noise and metal partials, each side its own, washing out over seconds. */
export function crash(mix, time, gain, pan, seed) {
	const rnd = random(seed);
	const hp = [filter('highpass', 4200, 0.7), filter('highpass', 4200, 0.7)];
	const partials = [0, 1].map(() => [3150, 4270, 5390, 6820, 8130].map((f) => ({ f: f * (0.98 + 0.04 * rnd()), phase: rnd() })));
	const [gl, gr] = panGains(pan);
	const start = at(time);
	const length = Math.min(mix.length - start, at(4));
	for (let n = 0; n < length; n++) {
		const t = n / RATE;
		const env = (1 - Math.exp(-t / 0.001)) * (0.55 * Math.exp(-t / 0.12) + 0.45 * Math.exp(-t / 1.4));
		const g = gain * env * ending(n, length);
		const out = [0, 0];
		for (let c = 0; c < 2; c++) {
			let metal = 0;
			for (const p of partials[c]) metal += Math.sin(TAU * (p.f * t + p.phase));
			out[c] = g * (hp[c].run(rnd() * 2 - 1) * 1.4 + 0.08 * metal);
		}
		mix.put(start + n, out[0] * gl, out[1] * gr, 0.1, 0.3, 0, 0.1);
	}
}

/** The floor dropping away: a sine falling from 110 Hz to the bottom of what the room can move. */
export function subDrop(mix, time, gain, length = 1.8) {
	const start = at(time);
	const total = Math.min(mix.length - start, at(length));
	let phase = 0;
	for (let n = 0; n < total; n++) {
		const t = n / RATE;
		phase += (28 + 82 * Math.exp(-t / (length * 0.25))) / RATE;
		const v = gain * ending(n, total) * (1 - Math.exp(-t / 0.004)) * Math.exp(-t / (length * 0.5)) * Math.sin(TAU * phase);
		mix.put(start + n, v, v);
	}
}

/**
 * A rise that never arrives: octave-spaced tones climbing for ever under a bell over pitch, each
 * a soft saw of three partials, the two sides a few cents apart.
 */
export function shepard(mix, from, until, level) {
	const span = until - from;
	const octaves = 6;
	const phase = new Float64Array(2 * octaves);
	for (let n = Math.max(0, at(from)); n < Math.min(mix.length, at(until)); n++) {
		const t = n / RATE;
		const climb = (t - from) / span;
		const out = [0, 0];
		for (let k = 0; k < octaves; k++) {
			const x = (k + climb * 1.5) % octaves;
			const weight = Math.sin((Math.PI * x) / octaves) ** 2;
			for (let c = 0; c < 2; c++) {
				const j = c * octaves + k;
				phase[j] = (phase[j] + (55 * Math.pow(2, x) * (c ? 1.0023 : 0.9977)) / RATE) % 1;
				const p = TAU * phase[j];
				out[c] += weight * (Math.sin(p) + 0.3 * Math.sin(2 * p) + 0.12 * Math.sin(3 * p));
			}
		}
		const g = level(t) * 0.22;
		mix.put(n, g * out[0], g * out[1], 0, 0.3, 0, 0.05);
	}
}

/** A dance kick: a click, a sine diving to the floor and driven round, and the sidechain dipping under it. */
export function kick(mix, time, gain, duck = 0.7) {
	const start = at(time);
	const length = Math.min(mix.length - start, at(0.5));
	const rnd = random(seedOf('kick', Math.round(time * 1000)));
	const click = filter('highpass', 3000, 0.7);
	let phase = 0;
	for (let n = 0; n < length; n++) {
		const t = n / RATE;
		phase += (46 + 140 * Math.exp(-t / 0.028) + 300 * Math.exp(-t / 0.004)) / RATE;
		const body = Math.tanh(2.4 * Math.sin(TAU * phase)) / Math.tanh(2.4);
		const tick = click.run(rnd() * 2 - 1) * Math.exp(-t / 0.0025) * 0.35;
		const v = gain * ending(n, length) * (body * Math.exp(-t / 0.3) + tick);
		mix.put(start + n, v, v, 0.02, 0, 0, 0);
	}
	if (duck > 0) mix.duck(time, duck);
}

/** A crown cap rattling on its bottle: a metal tick and its short ring. */
export function rattle(mix, time, gain, pan, seed) {
	const rnd = random(seed);
	const modes = [2350, 3710, 5120, 6890].map((f) => f * (0.97 + 0.06 * rnd()));
	const tick = filter('bandpass', 6000, 1.5);
	const [gl, gr] = panGains(pan);
	const start = at(time);
	const length = Math.min(mix.length - start, at(0.12));
	for (let n = 0; n < length; n++) {
		const t = n / RATE;
		let ring = 0;
		for (const [k, f] of modes.entries()) ring += Math.sin(TAU * f * t) * Math.exp(-t / (0.03 / (1 + k * 0.4)));
		const v = gain * ending(n, length) * (0.4 * ring + tick.run(rnd() * 2 - 1) * Math.exp(-t / 0.003) * 3);
		mix.put(start + n, v * gl, v * gr, 0.2, 0.2, 0.1, 0);
	}
}

/** The cap blowing off: a hard pop, the gas rushing out after it, and the bottle's ring. */
export function corkPop(mix, time, gain, seed) {
	const rnd = random(seed);
	const rush = [filter('bandpass', 6000, 0.9), filter('bandpass', 6000, 0.9)];
	const start = at(time);
	const length = Math.min(mix.length - start, at(1.2));
	let phase = 0;
	for (let n = 0; n < length; n++) {
		const t = n / RATE;
		phase += (110 + 520 * Math.exp(-t / 0.012)) / RATE;
		const pop = Math.sin(TAU * phase) * (1 - Math.exp(-t / 0.0005)) * Math.exp(-t / 0.05);
		if (n % 64 === 0) for (const f of rush) f.set('bandpass', 900 + 6000 * Math.exp(-t / 0.25), 0.9);
		const gas = (1 - Math.exp(-t / 0.01)) * Math.exp(-t / 0.35) * 2.2;
		const l = gain * ending(n, length) * (pop + rush[0].run(rnd() * 2 - 1) * gas);
		const r = gain * ending(n, length) * (pop + rush[1].run(rnd() * 2 - 1) * gas);
		mix.put(start + n, l, r, 0.2, 0.3, 0.15, 0);
	}
}

/** A line snapping under load: a crack and the twang of the free end whipping away. */
export function twang(mix, time, gain, pan, seed) {
	const rnd = random(seed);
	const crackBand = filter('bandpass', 2800, 0.9);
	const [gl, gr] = panGains(pan);
	const start = at(time);
	const length = Math.min(mix.length - start, at(0.8));
	let phase = 0;
	for (let n = 0; n < length; n++) {
		const t = n / RATE;
		phase += (180 + 1400 * Math.exp(-t / 0.08)) / RATE;
		const tone = Math.sin(TAU * phase) * (1 - Math.exp(-t / 0.002)) * Math.exp(-t / 0.22);
		const snap = crackBand.run(rnd() * 2 - 1) * Math.exp(-t / 0.012) * 4;
		const v = gain * ending(n, length) * (0.6 * tone + snap);
		mix.put(start + n, v * gl, v * gr, 0.15, 0.35, 0.2, 0);
	}
}

/**
 * A hole in everything scored so far, so a silence before an arrival is silence rather than the
 * last hit's ring. Only what is already in the mix is cut; what is scored afterwards plays through it.
 */
export function hole(mix, from, until) {
	const ramp = at(0.03);
	const buses = busesOf(mix);
	for (let n = Math.max(0, at(from) - ramp); n < Math.min(mix.length, at(until)); n++) {
		const g = n < at(from) ? (at(from) - n) / ramp : 0;
		for (const bus of buses) {
			bus[0][n] *= g;
			bus[1][n] *= g;
		}
	}
}

/** A horn playing a melody note: detuned saws, the filter opening on the breath, vibrato as it holds. */
export function brassLead(mix, time, length, gain, freq, seed) {
	const rnd = random(seed);
	const phases = [rnd(), rnd(), rnd(), rnd()];
	const lp = [filter('lowpass', 400, 1.2), filter('lowpass', 400, 1.2)];
	const start = at(time);
	const total = Math.min(mix.length - start, at(length + 0.25));
	for (let n = 0; n < total; n++) {
		const t = n / RATE;
		if (n % 64 === 0) {
			const open = 500 + 2600 * (1 - Math.exp(-t / 0.07)) * (0.75 + 0.25 * Math.exp(-t / 0.6));
			for (const f of lp) f.set('lowpass', open, 1.2);
		}
		const vibrato = 1 + 0.005 * Math.sin(TAU * 5.2 * t) * smooth(0.15, 0.5, t);
		const env = smooth(0, 0.05, t) * (1 - smooth(length, length + 0.22, t));
		const out = [0, 0];
		for (let c = 0; c < 2; c++) {
			const f = freq * vibrato * (c === 0 ? 0.996 : 1.004);
			const inc = f / RATE;
			phases[c] = (phases[c] + inc) % 1;
			phases[c + 2] = (phases[c + 2] + inc * 1.003) % 1;
			out[c] = Math.tanh(1.4 * lp[c].run(saw(phases[c], inc) + saw(phases[c + 2], inc * 1.003)));
		}
		const g = gain * env * ending(n, total);
		mix.put(start + n, g * out[0], g * out[1], 0.12, 0.35, 0.08, 0.04);
	}
}

/** A celesta, the music box of the orchestra: a soft hammered bell, the two sides a hair apart. */
export function celesta(mix, time, gain, freq, pan) {
	bell(mix, time, gain, freq, pan, { decay: 1.3, index: 0.9, ratio: 4, hall: 0.35, echo: 0.15, shimmer: 0.1 });
}

/** A clock's tick, or its lower tock: a wooden click with a faint ring of the escapement. */
export function tick(mix, time, gain, tock, seed) {
	const rnd = random(seed);
	const click = filter('bandpass', tock ? 1500 : 2300, 3);
	const start = at(time);
	const length = Math.min(mix.length - start, at(0.12));
	const [gl, gr] = panGains(tock ? 0.25 : -0.25);
	for (let n = 0; n < length; n++) {
		const t = n / RATE;
		const ring = 0.25 * Math.sin(TAU * (tock ? 2900 : 3600) * t) * Math.exp(-t / 0.02);
		const v = gain * ending(n, length) * (click.run(rnd() * 2 - 1) * 4 * Math.exp(-t / 0.008) + ring);
		mix.put(start + n, v * gl, v * gr, 0.3, 0.25, 0.2, 0);
	}
}

/** A firework going up: a whistle climbing and the hiss of its fuse. */
export function launch(mix, time, length, gain, pan, seed) {
	const rnd = random(seed);
	const hiss = filter('highpass', 3500, 0.7);
	const [gl, gr] = panGains(pan);
	const start = at(time);
	const total = Math.min(mix.length - start, at(length));
	let phase = 0;
	for (let n = 0; n < total; n++) {
		const t = n / RATE;
		const u = t / length;
		phase += (600 + 2200 * u * u) / RATE;
		const env = smooth(0, 0.05, t) * (1 - smooth(length - 0.04, length, t));
		const v = gain * env * (0.35 * Math.sin(TAU * phase) + 0.6 * hiss.run(rnd() * 2 - 1));
		mix.put(start + n, v * gl, v * gr, 0.1, 0.3, 0.15, 0);
	}
}

/**
 * A firework bursting high up: a soft far thump, then its stars crackling and glittering as they
 * fall, spread wide across the sky.
 */
export function burst(mix, time, gain, pan, seed) {
	const rnd = random(seed);
	const thump = [filter('lowpass', 160, 0.7), filter('lowpass', 160, 0.7)];
	const stars = [crackler(seed + 1, 2200), crackler(seed + 2, 2200)];
	const [gl, gr] = panGains(pan);
	const start = at(time);
	const length = Math.min(mix.length - start, at(2.6));
	let low = 0;
	for (let n = 0; n < length; n++) {
		const t = n / RATE;
		low += (52 + 40 * Math.exp(-t / 0.04)) / RATE;
		const boom = Math.sin(TAU * low) * (1 - Math.exp(-t / 0.006)) * Math.exp(-t / 0.22) * 0.6;
		const density = t < 0.2 ? 0 : 1600 * Math.exp(-(t - 0.2) / 0.7);
		const out = [0, 0];
		for (let c = 0; c < 2; c++) out[c] = boom + thump[c].run(rnd() * 2 - 1) * 2.4 * (1 - Math.exp(-t / 0.004)) * Math.exp(-t / 0.08) + 0.8 * stars[c](density);
		const g = gain * ending(n, length);
		mix.put(start + n, g * out[0] * gl, g * out[1] * gr, 0.1, 0.35, 0.15, 0.1);
	}
}

/** Starlings chattering: short falling whistles, `density(t)` a second, placed round `pan(t)`. */
export function chatter(mix, from, until, { density, pan }, seed) {
	const rnd = random(seed);
	const voices = Array.from({ length: 24 }, () => ({ age: 1, f: 0, length: 0, amp: 0, gains: [0, 0] }));
	let wait = 0;
	for (let n = Math.max(0, at(from)); n < Math.min(mix.length, at(until)); n++) {
		const t = n / RATE;
		if (--wait <= 0) {
			const v = voices.find((x) => x.age >= x.length) ?? voices[0];
			v.age = 0;
			v.f = 2600 + 3400 * rnd();
			v.length = 0.03 + 0.05 * rnd();
			v.amp = 0.3 + 0.7 * rnd();
			v.gains = panGains(Math.max(-1, Math.min(1, pan(t) + (rnd() - 0.5) * 0.9)));
			wait = Math.max(1, Math.round((-Math.log(1 - rnd() * 0.999) / Math.max(density(t), 1e-3)) * RATE));
		}
		let l = 0;
		let r = 0;
		for (const v of voices) {
			if (v.age >= v.length) continue;
			const u = v.age / v.length;
			const s = v.amp * Math.sin(Math.PI * u) * Math.sin(TAU * v.f * (1 - 0.35 * u) * v.age);
			l += s * v.gains[0];
			r += s * v.gains[1];
			v.age += 1 / RATE;
		}
		mix.put(n, l * 0.3, r * 0.3, 0.1, 0.25, 0.05, 0);
	}
}

/**
 * Wings: a flock taking off at once, thousands of beats of air rushing past and away, `level(t)`
 * and `pan(t)`, faster and brighter while `lift(t)` is high.
 */
export function wings(mix, from, until, { level, lift, pan }, seed) {
	const rnd = random(seed);
	const band = [filter('bandpass', 700, 0.8), filter('bandpass', 760, 0.8)];
	const low = [filter('lowpass', 300, 0.7), filter('lowpass', 300, 0.7)];
	const beats = [drift(seed + 1, 0.013, until - from + 1), drift(seed + 2, 0.011, until - from + 1)];
	for (let n = Math.max(0, at(from)); n < Math.min(mix.length, at(until)); n++) {
		const t = n / RATE;
		const g = level(t);
		const up = lift(t);
		if (n % 64 === 0) for (let c = 0; c < 2; c++) band[c].set('bandpass', (600 + 1400 * up) * (c ? 1.08 : 1), 0.8);
		const [gl, gr] = panGains(pan(t));
		const out = [0, 0];
		for (let c = 0; c < 2; c++) {
			const w = rnd() * 2 - 1;
			const flap = 0.35 + 0.65 * beats[c](t - from) ** 2;
			out[c] = g * flap * (band[c].run(w) * 2.6 + low[c].run(w) * 1.4 * up);
		}
		if (g <= 1e-6) continue;
		mix.put(n, out[0] * gl, out[1] * gr, 0.1, 0.3, 0.05, 0);
	}
}
