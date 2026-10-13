/**
 * The autumn's own voices. They play through Light Before Thunder's mix bus and master, so the
 * room keeps one sound from night to night. Deterministic like everything they render through.
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

const pinkStep = (p, w) => {
	p[0] = 0.99765 * p[0] + w * 0.099046;
	p[1] = 0.963 * p[1] + w * 0.2965164;
	p[2] = 0.57 * p[2] + w * 1.0526913;
	return (p[0] + p[1] + p[2] + w * 0.1848) * 0.2;
};

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
		let v = 0;
		for (const [ratio, amp, decay] of partials) {
			const f = strike * ratio;
			v += amp * 0.5 * (Math.sin(TAU * f * t) + Math.sin(TAU * f * 1.0012 * t + 1.3)) * Math.exp(-t / decay);
		}
		v = v * (1 - Math.exp(-t / 0.002)) + knock.run(rnd() * 2 - 1) * Math.exp(-t / 0.004) * 0.8;
		const last = ending(n, length);
		mix.put(start + n, gain * last * far[0].run(v) * gl, gain * last * far[1].run(v) * gr, 0.05, 0.6);
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

/** A sub swelling under an arrival and settling into the room. */
export function warmth(mix, time, gain, freq) {
	const lp = [filter('lowpass', 320, 0.7), filter('lowpass', 320, 0.7)];
	const rnd = random(seedOf('warmth', Math.round(time * 1000)));
	let phase = 0;
	const start = at(time);
	const length = Math.min(mix.length - start, at(3.5));
	for (let n = 0; n < length; n++) {
		const t = n / RATE;
		phase += (freq * (1 + 0.25 * Math.exp(-t / 0.35))) / RATE;
		const env = (1 - Math.exp(-t / 0.05)) * Math.exp(-t / 1.1);
		const air = lp[1].run(lp[0].run(rnd() * 2 - 1)) * Math.exp(-t / 0.45) * 2.5;
		const v = gain * ending(n, length) * (env * (Math.sin(TAU * phase) + 0.3 * Math.sin(2 * TAU * phase)) + 0.25 * env * air);
		mix.put(start + n, v, v, 0.15, 0.4);
	}
}

// ---- The epic voices ---------------------------------------------------------------------------

/**
 * A string ostinato, bowed short: `pattern` frequencies in turn at `rate(t)` notes a second, its
 * filter opening with `bright(t)` Hz. `speed(t)` below 1 slows the bow and the pitch together,
 * the way a tape stops.
 */
export function ostinato(mix, from, until, { pattern, rate, bright, level, speed = () => 1 }, seed) {
	const lp = [filter('lowpass', 800, 1.1), filter('lowpass', 800, 1.1)];
	const detune = [0.996, 1.004];
	const phases = [
		[0, 0.3, 0.6],
		[0.15, 0.45, 0.8]
	];
	let notes = 0;
	for (let n = at(from); n < Math.min(mix.length, at(until)); n++) {
		const t = n / RATE;
		const s = speed(t);
		notes += (rate(t) * s) / RATE;
		const note = Math.floor(notes);
		const u = notes - note;
		const f = pattern[note % pattern.length] * s;
		if (n % 64 === 0) for (const filt of lp) filt.set('lowpass', Math.max(120, bright(t)), 1.1);
		const env = (1 - Math.exp(-u / 0.03)) * Math.exp(-u / 0.45);
		const g = level(t) * env;
		const out = [0, 0];
		for (let c = 0; c < 2; c++) {
			const ph = phases[c];
			const inc = (f * detune[c]) / RATE;
			ph[0] = (ph[0] + inc) % 1;
			ph[1] = (ph[1] + inc * 1.0035) % 1;
			ph[2] = (ph[2] + inc * 0.5) % 1;
			const v = saw(ph[0], inc) + saw(ph[1], inc * 1.0035) + 0.6 * saw(ph[2], inc * 0.5);
			out[c] = g * lp[c].run(v * 0.4);
		}
		mix.put(n, out[0], out[1], 0.12, 0.3);
	}
}

/** A taiko: the head's pitch falling into the floor, the slap of the skin, and the room after it. */
export function taiko(mix, time, gain, pan, seed) {
	const rnd = random(seed);
	const thump = [filter('lowpass', 260, 0.8), filter('lowpass', 260, 0.8)];
	const slap = filter('bandpass', 1100, 1);
	const [gl, gr] = panGains(pan);
	const start = at(time);
	const length = Math.min(mix.length - start, at(1.6));
	let phase = 0;
	for (let n = 0; n < length; n++) {
		const t = n / RATE;
		phase += (52 + 95 * Math.exp(-t / 0.05)) / RATE;
		const body = Math.sin(TAU * phase) * (1 - Math.exp(-t / 0.002)) * Math.exp(-t / 0.42);
		const w = rnd() * 2 - 1;
		const low = thump[1].run(thump[0].run(w)) * Math.exp(-t / 0.12) * 4;
		const skin = slap.run(w) * Math.exp(-t / 0.018) * 1.2;
		const v = gain * ending(n, length) * Math.tanh(1.6 * (body + 0.5 * low + skin));
		mix.put(start + n, v * gl, v * gr, 0.3, 0.4);
	}
}

/**
 * The trailer brass: every note three detuned saws, the filter blown open on the attack and
 * closing as it holds, driven until it growls.
 */
export function braam(mix, time, length, gain, notes, seed) {
	const rnd = random(seed);
	const voices = notes.flatMap((f) =>
		[0.996, 1, 1.004].map((d) => ({ f: f * d, phase: [rnd(), rnd()], spread: (rnd() - 0.5) * 0.004 }))
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
		mix.put(start + n, g * out[0], g * out[1], 0.1, 0.5);
	}
}

/** A choir on "ah": detuned voices with vibrato through the vowel's formants, `level(t)`. */
export function choir(mix, from, until, notes, level, seed) {
	const rnd = random(seed);
	const voices = notes.flatMap((f, i) =>
		[0, 1, 2].map((j) => ({
			f: f * (1 + (j - 1) * 0.004),
			phase: rnd(),
			vib: 4.8 + 1.2 * rnd(),
			vibPhase: rnd() * TAU,
			pan: (((i + j) % 3) - 1) * 0.6
		}))
	);
	const formants = [0, 1].map(() => [filter('bandpass', 730, 5), filter('bandpass', 1090, 6), filter('bandpass', 2440, 8)]);
	for (let n = at(from); n < Math.min(mix.length, at(until)); n++) {
		const t = n / RATE;
		const g = level(t);
		if (g <= 1e-5) continue;
		const src = [0, 0];
		for (const v of voices) {
			const f = v.f * (1 + 0.006 * Math.sin(TAU * v.vib * t + v.vibPhase));
			const inc = f / RATE;
			v.phase = (v.phase + inc) % 1;
			const s = saw(v.phase, inc);
			const [gl, gr] = panGains(v.pan);
			src[0] += s * gl;
			src[1] += s * gr;
		}
		const out = [0, 0];
		for (let c = 0; c < 2; c++) {
			const x = src[c] / voices.length + (rnd() * 2 - 1) * 0.04;
			const [f1, f2, f3] = formants[c];
			out[c] = g * (f1.run(x) * 2.2 + f2.run(x) * 1.3 + f3.run(x) * 0.7);
		}
		mix.put(n, out[0], out[1], 0.05, 0.6);
	}
}

/** A crash cymbal: bright noise and a cluster of metal partials washing out over seconds. */
export function crash(mix, time, gain, pan, seed) {
	const rnd = random(seed);
	const hp = [filter('highpass', 4200, 0.7), filter('highpass', 4200, 0.7)];
	const partials = [3150, 4270, 5390, 6820, 8130].map((f) => ({ f: f * (0.98 + 0.04 * rnd()), phase: rnd() }));
	const [gl, gr] = panGains(pan);
	const start = at(time);
	const length = Math.min(mix.length - start, at(4));
	for (let n = 0; n < length; n++) {
		const t = n / RATE;
		let metal = 0;
		for (const p of partials) metal += Math.sin(TAU * (p.f * t + p.phase));
		const env = (1 - Math.exp(-t / 0.001)) * (0.55 * Math.exp(-t / 0.12) + 0.45 * Math.exp(-t / 1.4));
		const g = gain * env * ending(n, length);
		const l = g * (hp[0].run(rnd() * 2 - 1) * 1.4 + 0.08 * metal);
		const r = g * (hp[1].run(rnd() * 2 - 1) * 1.4 + 0.08 * metal);
		mix.put(start + n, l * gl, r * gr, 0.1, 0.35);
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
		mix.put(start + n, v, v, 0, 0.05);
	}
}

/** A rise that never arrives: octave-spaced tones climbing for ever under a bell over pitch. */
export function shepard(mix, from, until, level) {
	const span = until - from;
	const octaves = 6;
	for (let n = at(from); n < Math.min(mix.length, at(until)); n++) {
		const t = n / RATE;
		const climb = (t - from) / span;
		let v = 0;
		for (let k = 0; k < octaves; k++) {
			const x = (k + climb * 1.5) % octaves;
			const f = 55 * Math.pow(2, x);
			const weight = Math.sin((Math.PI * x) / octaves) ** 2;
			v += weight * Math.sin(TAU * f * t + k);
		}
		const g = level(t) * v * 0.25;
		mix.put(n, g, g, 0, 0.3);
	}
}

/** A dance kick: a click and a sine diving to the floor. */
export function kick(mix, time, gain) {
	const start = at(time);
	const length = Math.min(mix.length - start, at(0.45));
	let phase = 0;
	for (let n = 0; n < length; n++) {
		const t = n / RATE;
		phase += (48 + 120 * Math.exp(-t / 0.035)) / RATE;
		const click = t < 0.003 ? (1 - t / 0.003) * 0.5 : 0;
		const v = gain * ending(n, length) * (Math.tanh(1.8 * Math.sin(TAU * phase)) * Math.exp(-t / 0.28) + click);
		mix.put(start + n, v, v, 0.02, 0.04);
	}
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
		mix.put(start + n, v * gl, v * gr, 0.2, 0.2);
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
		mix.put(start + n, l, r, 0.2, 0.3);
	}
}

/** A plucked string: a burst of noise ringing in a delay line the length of its period. */
export function pluck(mix, time, gain, freq, pan, seed) {
	const rnd = random(seed);
	const size = Math.max(2, Math.round(RATE / freq));
	const line = new Float32Array(size);
	for (let k = 0; k < size; k++) line[k] = rnd() * 2 - 1;
	const [gl, gr] = panGains(pan);
	const start = at(time);
	const length = Math.min(mix.length - start, at(1.2));
	let i = 0;
	for (let n = 0; n < length; n++) {
		const next = (i + 1) % size;
		const v = line[i];
		line[i] = 0.497 * (line[i] + line[next]);
		i = next;
		const g = gain * ending(n, length) * v;
		mix.put(start + n, g * gl, g * gr, 0.15, 0.3);
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
		mix.put(start + n, v * gl, v * gr, 0.15, 0.35);
	}
}

/**
 * A hole in everything scored so far, so a silence before a drop is silence rather than the last
 * hit's ring. Only what is already in the mix is cut; what is scored afterwards plays through it.
 */
export function hole(mix, from, until) {
	const ramp = at(0.03);
	for (let n = Math.max(0, at(from) - ramp); n < Math.min(mix.length, at(until)); n++) {
		const g = n < at(from) ? (at(from) - n) / ramp : 0;
		for (const bus of [mix.dry, mix.room, mix.hall]) {
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
			const f = freq * vibrato * (c === 0 ? 0.997 : 1.003);
			const inc = f / RATE;
			phases[c] = (phases[c] + inc) % 1;
			phases[c + 2] = (phases[c + 2] + inc * 1.002) % 1;
			out[c] = Math.tanh(1.4 * lp[c].run(saw(phases[c], inc) + saw(phases[c + 2], inc * 1.002)));
		}
		const g = gain * env * ending(n, total);
		mix.put(start + n, g * out[0], g * out[1], 0.12, 0.4);
	}
}

/** A celesta, the music box of the orchestra: harmonic partials, the high ones gone first. */
export function celesta(mix, time, gain, freq, pan) {
	const partials = [
		[1, 1, 1.4],
		[2, 0.35, 0.6],
		[3, 0.12, 0.3],
		[4.2, 0.08, 0.15]
	];
	const [gl, gr] = panGains(pan);
	const start = at(time);
	const length = Math.min(mix.length - start, at(2.5));
	for (let n = 0; n < length; n++) {
		const t = n / RATE;
		let v = 0;
		for (const [ratio, amp, decay] of partials) v += amp * Math.sin(TAU * freq * ratio * t) * Math.exp(-t / decay);
		v *= gain * (1 - Math.exp(-t / 0.002)) * ending(n, length);
		mix.put(start + n, v * gl, v * gr, 0.15, 0.4);
	}
}

/** A clock's tick, or its lower tock: a wooden click with a faint ring of the escapement. */
export function tick(mix, time, gain, tock, seed) {
	const rnd = random(seed);
	const click = filter('bandpass', tock ? 1500 : 2300, 3);
	const start = at(time);
	const length = Math.min(mix.length - start, at(0.12));
	for (let n = 0; n < length; n++) {
		const t = n / RATE;
		const ring = 0.25 * Math.sin(TAU * (tock ? 2900 : 3600) * t) * Math.exp(-t / 0.02);
		const v = gain * ending(n, length) * (click.run(rnd() * 2 - 1) * 4 * Math.exp(-t / 0.008) + ring);
		mix.put(start + n, v, v, 0.3, 0.3);
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
		mix.put(start + n, v * gl, v * gr, 0.1, 0.3);
	}
}

/** A firework bursting: the thump of the shell and its stars crackling as they fall. */
export function burst(mix, time, gain, pan, seed) {
	const rnd = random(seed);
	const thump = [filter('lowpass', 180, 0.8), filter('lowpass', 180, 0.8)];
	const stars = [crackler(seed + 1, 1400), crackler(seed + 2, 1400)];
	const [gl, gr] = panGains(pan);
	const start = at(time);
	const length = Math.min(mix.length - start, at(2.2));
	let low = 0;
	for (let n = 0; n < length; n++) {
		const t = n / RATE;
		low += (48 + 70 * Math.exp(-t / 0.05)) / RATE;
		const boom = Math.sin(TAU * low) * (1 - Math.exp(-t / 0.002)) * Math.exp(-t / 0.3);
		const density = t < 0.25 ? 0 : 900 * Math.exp(-(t - 0.25) / 0.5);
		const out = [0, 0];
		for (let c = 0; c < 2; c++) {
			const w = rnd() * 2 - 1;
			out[c] = 0.9 * boom + thump[c].run(w) * 4 * Math.exp(-t / 0.08) + 0.7 * stars[c](density);
		}
		const g = gain * ending(n, length);
		mix.put(start + n, g * out[0] * gl, g * out[1] * gr, 0.1, 0.45);
	}
}

/** Starlings chattering: short falling whistles, `density(t)` a second, placed round `pan(t)`. */
export function chatter(mix, from, until, { density, pan }, seed) {
	const rnd = random(seed);
	const voices = Array.from({ length: 24 }, () => ({ age: 1, f: 0, length: 0, amp: 0, gains: [0, 0] }));
	let wait = 0;
	for (let n = at(from); n < Math.min(mix.length, at(until)); n++) {
		const t = n / RATE;
		if (--wait <= 0) {
			const v = voices.find((x) => x.age >= x.length) ?? voices[0];
			v.age = 0;
			v.f = 2600 + 3400 * rnd();
			v.length = 0.03 + 0.05 * rnd();
			v.amp = 0.3 + 0.7 * rnd();
			v.gains = panGains(Math.max(-1, Math.min(1, pan(t) + (rnd() - 0.5) * 0.6)));
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
		mix.put(n, l * 0.3, r * 0.3, 0.1, 0.25);
	}
}
