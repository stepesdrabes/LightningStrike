/**
 * The storm's score, shared by First Strike and Return Stroke: a power cut, the heart under an
 * approaching storm, a charging spark, two sparks colliding, the gathering breath and the strike.
 * Everything lands on the times the Thunderhead effect reads from the same timing table.
 */
import {
	RATE,
	TAU,
	at,
	crack,
	crackler,
	db,
	drift,
	ending,
	filter,
	heartSound,
	ignition,
	panGains,
	random,
	ringX,
	rumble,
	saw,
	seedOf,
	smooth,
	spark
} from './instruments.mjs';
import { collisions, crossings, dubDelay, lubTimes, run, twinTime } from './timing.ts';

/** Go: a breaker slams, the light drains into the corner as a motor winds down, the mains hum dies. */
function powerCut(mix, o) {
	const rnd = random(seedOf('breaker'));
	const modes = [1150, 1730, 2420, 3310, 4680].map((f, k) => ({
		f,
		decay: 0.09 / (1 + k * 0.45),
		amp: 0.5 / (1 + k),
		phase: rnd()
	}));
	const clackBand = filter('bandpass', 2600, 1.4);
	const bodyNoise = [filter('lowpass', 200, 0.7), filter('lowpass', 200, 0.7)];
	const sizzle = [crackler(seedOf('drain', 0), 1800), crackler(seedOf('drain', 1), 1800)];
	const length = at(o.heart + 0.2);
	let body = 0;
	let whomp = 0;
	let whine = 0;
	let hum = 0;
	for (let n = 0; n < length; n++) {
		const t = n / RATE;
		const last = ending(n, length);
		let clack = 0;
		for (const m of modes) clack += m.amp * Math.sin(TAU * (m.f * t + m.phase)) * Math.exp(-t / m.decay);
		clack += clackBand.run(rnd() * 2 - 1) * Math.exp(-t / 0.004) * 3;
		body += (34 + 80 * Math.exp(-t / 0.05)) / RATE;
		const thump = Math.sin(TAU * body) * (1 - Math.exp(-t / 0.002)) * Math.exp(-t / 0.3);
		const noise = bodyNoise[1].run(bodyNoise[0].run(rnd() * 2 - 1)) * Math.exp(-t / 0.07) * 3;
		whomp += (26 + 26 * Math.exp(-t / 0.35)) / RATE;
		const sub = Math.sin(TAU * whomp) * Math.exp(-t / 0.7) * (1 - Math.exp(-t / 0.01));
		// The motor's pitch follows the light's reach, which falls with the drain time constant.
		const reach = Math.exp(-t / o.drain);
		whine += (32 + 380 * reach) / RATE;
		const wheel = (1 - Math.exp(-t / 0.02)) * Math.exp(-t / 1.3) * (0.8 + 0.2 * Math.sin((TAU * whine) / 9));
		let tone = 0;
		for (let h = 1; h <= 7; h++) tone += Math.sin(TAU * whine * h + h) / h;
		tone += 0.3 * Math.sin(TAU * whine * 2.71);
		hum += (50 - 7 * (1 - Math.exp(-t / 0.8))) / RATE;
		const mains = Math.tanh(3 * Math.sin(TAU * hum)) * Math.exp(-t / 0.9) * (1 - Math.exp(-t / 0.01));
		const drain = Math.max(0, 1 - t / (o.heart - 0.6));
		const density = 30 + 400 * reach;
		const hit = 0.3 * clack + 0.55 * thump + 0.25 * noise + 0.45 * sub;
		const [gl, gr] = panGains(-0.55 * (1 - reach));
		const trail = 0.06 * tone * wheel + 0.04 * mains;
		const l = hit + trail * gl + 0.05 * sizzle[0](density) * drain * gl;
		const r = hit + trail * gr + 0.05 * sizzle[1](density) * drain * gr;
		mix.put(n, last * l, last * r, 0.1, t < 0.6 ? 0.45 : 0.2);
	}
}

/** Wind and far weather under the heart, from the power cut until the charge gathers. */
function air(mix, o) {
	const from = 1.2;
	const until = o.gather;
	const gust = [drift(seedOf('gust', 0), 1.7, until), drift(seedOf('gust', 1), 1.9, until)];
	const tone = [drift(seedOf('tone', 0), 2.3, until), drift(seedOf('tone', 1), 2.9, until)];
	const band = [filter('bandpass', 400, 0.8), filter('bandpass', 400, 0.8)];
	const low = [filter('lowpass', 70, 0.7), filter('lowpass', 70, 0.7)];
	const rnd = random(seedOf('air'));
	const pink = [new Float32Array(3), new Float32Array(3)];
	for (let n = at(from); n < at(until); n++) {
		const t = n / RATE;
		const level =
			smooth(from, from + 3, t) *
			(0.6 + 0.4 * smooth(o.race, o.ignite, t)) *
			(1 - 0.7 * smooth(o.ignite, o.collide, t)) *
			(1 - smooth(until - 0.01, until, t));
		const out = [0, 0];
		for (let c = 0; c < 2; c++) {
			const w = rnd() * 2 - 1;
			const p = pink[c];
			p[0] = 0.99765 * p[0] + w * 0.099046;
			p[1] = 0.963 * p[1] + w * 0.2965164;
			p[2] = 0.57 * p[2] + w * 1.0526913;
			if (n % 64 === 0) band[c].set('bandpass', 180 + 520 * tone[c](t), 0.7);
			const wind = band[c].run((p[0] + p[1] + p[2] + w * 0.1848) * 0.2) * (0.3 + 0.7 * gust[c](t));
			const far = low[c].run(rnd() * 2 - 1) * (0.4 + 0.6 * gust[1 - c](t * 0.7));
			out[c] = level * (0.07 * wind + 0.1 * far);
		}
		mix.put(n, out[0], out[1]);
	}
}

function heart(mix, o) {
	const lubs = lubTimes(o);
	for (let k = 0; k < lubs.length - 1; k++) {
		const lub = lubs[k];
		const dub = lub + dubDelay(lubs[k + 1] - lub);
		const rise = smooth(o.race, o.ignite, lub);
		const gain = db(-9 + 4 * rise);
		heartSound(mix, lub, gain, true, -0.35);
		heartSound(mix, dub, gain * 0.62, false, -0.35);
		if (lub >= o.race) {
			// The lub throws a spark up the west wall, the dub one along the south wall.
			spark(mix, lub, db(-22 + 8 * rise), 0.28, -0.8, -0.8);
			spark(mix, dub, db(-25 + 8 * rise), 0.22, -0.8, -0.3);
		}
	}
}

/** The loader: a detuned drone rising a fourth, throbbing on the beat and opening as it charges. */
function drone(mix, o, root0) {
	const from = o.ignite;
	const until = o.gather;
	const twin = twinTime(o);
	const beat = o.lap / 2;
	const lp = [0, 1].map(() => [filter('lowpass', 100, 0.9), filter('lowpass', 100, 0.9)]);
	const phases = [new Float64Array(5), new Float64Array(5)];
	const detune = [[1, 1.004, 0.9965, 2.003, 1.5], [1, 0.996, 1.0035, 1.997, 1.5]];
	const weights = [0.6, 0.6, 0.6, 0.5, 0.35];
	let sub = 0;
	for (let n = at(from); n < at(until); n++) {
		const t = n / RATE;
		const charge = smooth(from, o.full, t);
		const over = smooth(o.full, until, t);
		const root = root0 * Math.pow(2, (5 / 12) * charge) * (1 + 0.06 * over);
		const beatPhase = ((t - from) / beat) % 1;
		const depth = t < twin ? 0.35 : 0.6;
		const throb = 1 - depth * (1 - Math.exp(-beatPhase * 4));
		const level =
			db(-11 + 5 * charge + 2 * over) * smooth(from - 0.2, from + 1.5, t) * (1 - smooth(until - 0.008, until, t));
		if (n % 64 === 0) {
			const cutoff = 160 * Math.pow(12, smooth(from, until, t)) * (0.7 + 0.6 * throb);
			for (const pair of lp) for (const f of pair) f.set('lowpass', cutoff, 0.9);
		}
		sub += root / RATE;
		const subV = 0.8 * Math.sin(TAU * sub);
		const drive = 1.2 + 2 * charge;
		const out = [0, 0];
		for (let c = 0; c < 2; c++) {
			let v = 0;
			for (let k = 0; k < 5; k++) {
				const inc = (root * detune[c][k]) / RATE;
				phases[c][k] = (phases[c][k] + inc) % 1;
				v += saw(phases[c][k], inc) * weights[k];
			}
			const filtered = lp[c][1].run(lp[c][0].run(v));
			out[c] = level * throb * (Math.tanh(drive * filtered) / Math.tanh(drive) + subV);
		}
		mix.put(n, out[0], out[1], 0, 0.08);
	}
}

/** Each spark buzzes where it is on the frame, brighter and busier as it speeds up. */
function sparkTrails(mix, o) {
	const twin = twinTime(o);
	const joined = run(o, twin);
	const voices = [0, 1].map((s) => ({
		band: [filter('bandpass', 2000, 2), filter('bandpass', 2000, 2)],
		tick: [crackler(seedOf('trailL', s), 2000), crackler(seedOf('trailR', s), 2000)],
		hum: 0,
		noise: random(seedOf('trail', s))
	}));
	for (let n = at(o.ignite); n < at(o.gather + 0.15); n++) {
		const t = n / RATE;
		const d = run(o, t);
		const speed = (run(o, t + 0.01) - d) / 0.01;
		const gone = 1 - smooth(o.gather, o.gather + 0.15, t);
		for (let s = 0; s < 2; s++) {
			const born = s === 0 ? o.ignite : twin;
			if (t < born) continue;
			const v = voices[s];
			const head = s === 0 ? 480 + d : 480 - (d - joined);
			const [gl, gr] = panGains((ringX(head) / 1.5) * 0.65);
			if (n % 64 === 0) for (const b of v.band) b.set('bandpass', 1400 + speed * 1.8, 1.6);
			v.hum = (v.hum + 100 / RATE) % 1;
			const buzz = 0.6 + 0.4 * Math.sin(TAU * v.hum);
			const level = db(-24 + 9 * Math.min(1, speed / 1200)) * gone * smooth(born, born + 0.4, t);
			const density = 40 + speed * 0.25;
			const l = level * (v.band[0].run(v.noise() * 2 - 1) * buzz * 2.5 + 0.8 * v.tick[0](density));
			const r = level * (v.band[1].run(v.noise() * 2 - 1) * buzz * 2.5 + 0.8 * v.tick[1](density));
			mix.put(n, l * gl, r * gr, 0.1, 0.05);
		}
	}
}

/** The lone spark crosses a beam end: the beam crackles. */
function crossingZap(mix, time, gain) {
	const id = Math.round(time * 1000);
	const tick = [crackler(seedOf('crossL', id), 2500), crackler(seedOf('crossR', id), 2500)];
	let ping = 0;
	let thump = 0;
	const start = at(time);
	for (let n = 0; n < at(0.25); n++) {
		const t = n / RATE;
		ping += 2900 / RATE;
		thump += (70 + 60 * Math.exp(-t / 0.02)) / RATE;
		const mono = 0.25 * Math.sin(TAU * ping) * Math.exp(-t / 0.03) + 0.6 * Math.sin(TAU * thump) * Math.exp(-t / 0.05);
		const density = 1800 * Math.exp(-t / 0.05);
		const g = gain * ending(n, at(0.25));
		mix.put(start + n, g * (mono + tick[0](density)), g * (mono + tick[1](density)), 0.15, 0.1);
	}
}

/** Two sparks collide at a beam end: a kick and an electric pop pitched by the end. */
function collision(mix, o, notes, time, end, index, charge) {
	const rnd = random(seedOf('collision', index));
	const accent = Math.round(time / (o.lap / 2)) % 4 === 0 ? 1 : 0.85;
	const note = (end === 'south' ? notes[0] : notes[1]) * Math.pow(2, (5 / 12) * charge);
	const snap = filter('bandpass', 3600, 1.2);
	const tick = crackler(seedOf('pop', index), 2200);
	const [gl, gr] = panGains(end === 'south' ? -0.15 : 0.15);
	let kick = 0;
	let ping = 0;
	const start = at(time);
	for (let n = 0; n < at(0.7); n++) {
		const t = n / RATE;
		const last = ending(n, at(0.7));
		kick += (45 + 95 * Math.exp(-t / 0.028)) / RATE;
		const kickV = Math.tanh(1.8 * Math.sin(TAU * kick)) * (1 - Math.exp(-t / 0.0015)) * Math.exp(-t / 0.15);
		ping += note / RATE;
		const pop =
			snap.run(rnd() * 2 - 1) * Math.exp(-t / 0.012) * 2 +
			0.35 * Math.sin(TAU * ping) * Math.exp(-t / 0.06) +
			0.5 * tick(900 * Math.exp(-t / 0.04));
		const k = last * db(-8 + 5 * charge) * accent * kickV;
		const p = last * db(-19 + 6 * charge) * pop;
		mix.put(start + n, k + p * gl, k + p * gr, 0.12, 0.08);
	}
}

/** Charge crackling in the filling beam on the eighth notes; in the overload a rolling snare of arcs. */
function glints(mix, o) {
	const twin = twinTime(o);
	const step = o.lap / 4;
	for (let slot = Math.ceil(twin / step) * step; slot < o.gather - 1e-6; slot += slot >= o.full ? step / 2 : step) {
		const id = Math.round(slot * 1000);
		const charge = smooth(o.collide, o.gather, slot);
		const over = smooth(o.full, o.gather, slot);
		const rnd = random(seedOf('glint', id));
		const tick = crackler(seedOf('glintTick', id), 4500);
		const snare = filter('bandpass', 1700 + 900 * over, 0.9);
		const [gl, gr] = panGains((rnd() * 2 - 1) * 0.35);
		const start = at(slot);
		for (let n = 0; n < at(0.16); n++) {
			const t = n / RATE;
			const crackle = db(-30 + 8 * charge) * tick(3000 * Math.exp(-t / 0.01));
			const roll = slot >= o.full ? db(-22 + 9 * over) * snare.run(rnd() * 2 - 1) * Math.exp(-t / 0.035) * 2 : 0;
			const v = (crackle + roll) * ending(n, at(0.16));
			mix.put(start + n, v * gl, v * gr, 0.1, 0.06);
		}
	}
}

/** Noise sweeping up and saws gliding two octaves as the beam fills; tremolo racing in the overload. */
function riser(mix, o) {
	const from = twinTime(o);
	const until = o.gather;
	const rnd = random(seedOf('riser'));
	const band = [filter('bandpass', 300, 1.2), filter('bandpass', 300, 1.2)];
	const lp = [filter('lowpass', 400, 0.8), filter('lowpass', 400, 0.8)];
	const phases = [new Float64Array(4), new Float64Array(4)];
	const spread = [[1, 1.006, 0.994, 2.001], [1, 0.995, 1.005, 1.999]];
	const faster = o.full + (o.gather - o.full) / 2;
	for (let n = at(from); n < at(until); n++) {
		const t = n / RATE;
		const u = (t - from) / (until - from);
		const f = 110 * Math.pow(4, Math.pow(u, 1.4));
		const swell = db(-32 + 27 * Math.pow(u, 1.2));
		const rate = t < o.full ? 0 : t < faster ? 8 / o.lap : 16 / o.lap;
		const tremolo = rate ? 0.6 + 0.4 * Math.cos(TAU * rate * (t - o.full)) : 1;
		const fade = 1 - smooth(until - 0.008, until, t);
		if (n % 64 === 0) {
			for (const b of band) b.set('bandpass', 250 * Math.pow(34, Math.pow(u, 1.3)), 1.1);
			for (const l of lp) l.set('lowpass', f * 3, 0.8);
		}
		const out = [0, 0];
		for (let c = 0; c < 2; c++) {
			let v = 0;
			for (let k = 0; k < 4; k++) {
				const inc = (f * spread[c][k]) / RATE;
				phases[c][k] = (phases[c][k] + inc) % 1;
				v += saw(phases[c][k], inc) * 0.25;
			}
			out[c] = fade * tremolo * swell * (band[c].run(rnd() * 2 - 1) * 1.6 + 0.5 * lp[c].run(v));
		}
		mix.put(n, out[0], out[1], 0, 0.12);
	}
}

/** The charge is sucked into the beam: a reversed swell that cuts dead as the beam becomes a point. */
function inhale(mix, o) {
	const from = o.gather;
	const until = o.point;
	const rnd = random(seedOf('inhale'));
	const band = [filter('bandpass', 400, 1), filter('bandpass', 400, 1)];
	let sub = 0;
	for (let n = at(from); n < at(until); n++) {
		const t = n / RATE;
		const u = (t - from) / (until - from);
		const env = db(-17) * Math.exp((t - until) / 0.55) * (1 - smooth(until - 0.012, until, t));
		if (n % 64 === 0) for (const b of band) b.set('bandpass', 300 * Math.pow(22, u * u), 1.2);
		sub += (28 + 40 * u * u) / RATE;
		const s = 0.3 * Math.sin(TAU * sub);
		mix.put(n, env * (band[0].run(rnd() * 2 - 1) * 3 + s), env * (band[1].run(rnd() * 2 - 1) * 3 + s));
	}
}

/**
 * The whole storm on `o`'s times. `style.root` is the drone's starting note, `style.notes` the
 * collision pops at the south and north beam ends, `style.thunders` the four flashes' thunder
 * (null, or a flash with a negative time, has none) and `style.tail` the rumble after the strike.
 */
export function scoreStorm(mix, o, style) {
	powerCut(mix, o);
	air(mix, o);
	heart(mix, o);
	const times = [o.thunder1, o.thunder2, o.thunder3, o.thunder4];
	style.thunders.forEach((thunder, index) => {
		if (!thunder || times[index] < 0) return;
		const { crack: crackGain, crackPan, ...roll } = thunder;
		rumble(mix, times[index], { ...roll, gain: db(roll.gain), seed: seedOf('thunder', index + 1) });
		if (crackGain !== undefined) crack(mix, times[index], db(crackGain), seedOf('near', index + 1), crackPan);
	});
	ignition(mix, o.ignite, 1, -0.5);
	ignition(mix, twinTime(o), db(-3), -0.5);
	drone(mix, o, style.root);
	sparkTrails(mix, o);
	for (const c of crossings(o)) crossingZap(mix, c.t, db(-20 + 6 * smooth(o.ignite, o.collide, c.t)));
	collisions(o).forEach((c, index) => collision(mix, o, style.notes, c.t, c.end, index, smooth(o.collide, o.gather, c.t)));
	glints(mix, o);
	riser(mix, o);
	inhale(mix, o);
	for (let k = 0; k < 3; k++) heartSound(mix, o.point + k * o.pulse, db(-6), true, 0);
	crack(mix, o.strike, db(-2.5), seedOf('crack', 1), -0.1);
	crack(mix, o.strike + o.stroke, db(-1.2), seedOf('crack', 2), 0.1);
	crack(mix, o.strike + 2 * o.stroke, 1, seedOf('crack', 3), 0);
	const rolling = o.strike + 2 * o.stroke;
	rumble(mix, rolling, {
		duration: o.end - rolling,
		...style.tail,
		gain: db(style.tail.gain),
		pan: 0,
		seed: seedOf('tail'),
		hallSend: 0.35
	});
}
