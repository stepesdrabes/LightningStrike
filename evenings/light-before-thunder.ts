/**
 * Light Before Thunder. Light travels faster than sound: the night is one storm passing over
 * the room. A spark is born in the south-west corner above the Bounce Lamp at Go, returns as a
 * red reprise at eleven, and comes home to the same corner at the end.
 *
 * Ring pixels run 0-599 from the north-west corner (north 0-179 west to east, east 180-299,
 * south 300-479 east to west, west 480-599 south to north); the beam runs 600-719 from south to
 * north. Every effect is a function of time and the music, so the preview and the fixture draw
 * the same frames. Output gamma is 2.45, so an effect level of 0.3 barely leaves the dither
 * codes: 0.45 is the dimmest colour that reads cleanly, 0.6 is a lit room and 0.85 is bright.
 */
import {
	SLOT,
	Follower,
	addSample,
	block,
	blackout,
	clamp,
	colourSweep,
	effect,
	evening,
	fill,
	hash01,
	hold,
	lerp,
	look,
	narration,
	noise3,
	pause,
	riser,
	setSample,
	smoothstep,
	song,
	sting,
	type ShowPalette
} from 'lightningstrike';
import {
	BPM,
	HOMECOMING,
	OPENING,
	OPEN_SKY,
	RETURN_STROKE,
	WALL_CLOUD,
	restingLubs,
	stormKicks
} from './light-before-thunder/timing.ts';

/** Never chosen for the guests' hour: the rock and metal cuts, Mandrage, PÁRNO AMG, the other Desire, and two songs far quieter than the rest. */
const notTonight = [
	'NhsK5WExrnE', 'ikFFVfObwss', 'qfVLcUhqnGo', 'AxuTd9rwEHQ', 'VyV54YwPAkk', 'HAQQUDbuudY', 'Q_XJ-7jNqws',
	'MEb49Q9ZRGo', 'CHIWNDAwTqQ', 'ttNSr4Ecdzo', 'JxlnKVj2IWA', 'Lt8AfIeJOxw', '3triLkS0nq4', 'B2lmOei7qfk',
	'SaEnRRSKcs8', 'v2eZCfv56p4', 'tN6YYPs3g3c', 'VRDJJH6K5R8', 'jWsRtq61AqE'
];

const firstStrike: ShowPalette = { name: 'first strike', base: 214, accent: 38, third: 200, sat: 0.93, shade: 0.12 };
const petrichor: ShowPalette = { name: 'petrichor', base: 18, accent: 196, third: 44, sat: 0.7, shade: 0.1 };
const returnStroke: ShowPalette = { name: 'return stroke', base: 350, accent: 200, third: 24, sat: 0.97, shade: 0.11 };
const embers: ShowPalette = { name: 'embers', base: 18, accent: 38, third: 44, sat: 0.7, shade: 0.1 };

// ---- The spark --------------------------------------------------------------------------------

/**
 * The opening, scored by light-before-thunder/first-strike.m4a: the power drains into the corner,
 * a heartbeat wakes under a storm whose thunder comes sooner after every flash, a spark charges
 * the ring lap by lap, two sparks fill the beam, and the storm strikes.
 */
const thunderhead = effect({
	id: 'thunderhead',
	name: 'Thunderhead',
	role: 'bed',
	blurb: 'Power cut, a heart under a nearing storm, sparks charging the beam, three strokes.',
	// The soundtrack's timing table arrives as parameters; the formulas below mirror timing.ts.
	params: OPENING,
	create(g) {
		let ring = 0;
		for (const s of g.strips) if (s.inPerimeter) ring += s.count;
		const beamStart = ring;
		const beamCount = g.count - ring;
		const half = beamCount / 2;
		const centre = (beamCount - 1) / 2;
		const home = Math.round(ring * 0.8);
		const north = Math.round(ring * 0.15);
		const south = Math.round(ring * 0.65);
		const far = Math.round(ring * 0.3);
		const wrap = (i: number) => ((i % ring) + ring) % ring;
		const apart = (a: number, b: number) => {
			const d = wrap(a - b);
			return d > ring / 2 ? ring - d : d;
		};
		const hit = (age: number, tau: number) => (age < 0 ? 0 : age < 0.02 ? age / 0.02 : Math.exp(-(age - 0.02) / tau));

		// Lightning branches from both beam ends along the long sides, each broken in three.
		const branch = new Float32Array(ring);
		for (const end of [north, south]) {
			for (const dir of [1, -1]) {
				const length = 50 + Math.floor(hash01(end * 3 + dir * 7 + 11) * 40);
				const gapA = 6 + Math.floor(hash01(end * 5 + dir * 3 + 2) * 7);
				const gapB = 6 + Math.floor(hash01(end * 7 + dir * 11 + 5) * 7);
				const segment = Math.max(4, Math.floor((length - gapA - gapB) / 3));
				let at = 0;
				for (let s = 0; s < 3; s++) {
					for (let q = 0; q < segment; q++) branch[wrap(end + dir * (at + q))] = 1;
					at += segment + (s === 0 ? gapA : gapB);
				}
			}
		}
		// Runs of 3-10 px, lit and dim in turn, give a flash the grain of a bolt inside cloud.
		const grain = new Float32Array(g.count);
		for (let i = 0, lit = true; i < g.count; lit = !lit) {
			const length = 3 + Math.floor(hash01(i * 13 + 5) * 8);
			for (let q = 0; q < length && i < g.count; q++, i++) grain[i] = lit ? 1 : 0.2;
		}
		// The ring laid on a circle and the beam across it, so one noise field is the whole sky.
		const skyX = new Float32Array(g.count);
		const skyY = new Float32Array(g.count);
		for (let i = 0; i < g.count; i++) {
			if (i < ring) {
				const a = (i / ring) * Math.PI * 2;
				skyX[i] = Math.cos(a) * 1.45;
				skyY[i] = Math.sin(a) * 1.45;
			} else {
				skyX[i] = 0;
				skyY[i] = ((i - beamStart) / beamCount - 0.5) * 2.9;
			}
		}

		type Heart = { heart: number; race: number; ignite: number; heartFrom: number; heartTo: number };
		/** Lub `k`: steady, then a linear climb in rate whose last beat is the ignition. */
		const lubAt = (p: Heart, k: number) => {
			const f0 = p.heartFrom / 60;
			const f1 = p.heartTo / 60;
			const span = p.ignite - p.race;
			const steady = Math.round((p.race - p.heart) * f0);
			const climb = Math.round(((f0 + f1) / 2) * span);
			const accel = (f1 - f0) / (2 * span);
			if (k <= steady) return p.heart + k / f0;
			if (k <= steady + climb) return p.race + (Math.sqrt(f0 * f0 + 4 * accel * (k - steady)) - f0) / (2 * accel);
			return p.ignite + (k - steady - climb) / f1;
		};

		const spark = (out: Float32Array, palette: Float32Array, at: number, dir: number, level: number, tail: number) => {
			for (let q = 0; q < tail + 4; q++) {
				const i = wrap(Math.round(at) - dir * q);
				if (q < 4) addSample(out, i, palette, SLOT.white, level * (q < 2 ? 1.7 : 1.2));
				else {
					const k = (q - 4) / tail;
					addSample(out, i, palette, lerp(SLOT.white, SLOT.glow, Math.min(1, k * 4)), level * Math.pow(1 - k, 1.4));
					addSample(out, i, palette, lerp(SLOT.glow, SLOT.deep, k), level * 0.5 * Math.pow(1 - k, 1.4));
				}
			}
		};

		// A spark is born: a white front races out of the corner along both walls.
		const burst = (out: Float32Array, palette: Float32Array, age: number, size: number) => {
			if (age < 0 || age > 0.7) return;
			const level = hit(age, 0.18) * size;
			const reach = Math.min(190, 20 + 2600 * age);
			for (let d = -Math.ceil(reach); d <= reach; d++) {
				const x = Math.abs(d);
				const front = reach < 190 && reach - x < 14 ? 1 - (reach - x) / 14 : 0;
				const white = Math.max(x < 16 ? 1 : 0, front, 0.45 * (1 - x / 191));
				addSample(out, wrap(home + d), palette, SLOT.white, level * white);
				addSample(out, wrap(home + d), palette, SLOT.glow, level * (1 - x / 191));
			}
		};

		const patch = (out: Float32Array, palette: Float32Array, at: number, width: number, level: number, rough: boolean) => {
			for (let d = -width; d <= width; d++) {
				const i = wrap(at + d);
				const shape = Math.pow(1 - Math.abs(d) / (width + 1), 1.3) * (rough ? grain[i] : 1);
				addSample(out, i, palette, SLOT.white, level * shape);
				addSample(out, i, palette, SLOT.glow, 0.5 * level * shape);
			}
		};

		// A flash flickers two to four times, at least 170 ms apart.
		const flicker = (age: number, n: number) => {
			if (age < 0 || age > 1.2) return 0;
			let env = 0;
			let offset = 0;
			for (let j = 0; j < 2 + Math.min(n, 2); j++) {
				const strength = j === 0 ? 1 : 0.55 + 0.45 * hash01(n * 31 + j * 7);
				env = Math.max(env, strength * hit(age - offset, 0.07));
				offset += 0.17 + 0.09 * hash01(n * 13 + j * 5);
			}
			return env;
		};

		/**
		 * The thunder of a flash, arriving seconds later: a low swell that rolls out of the
		 * flash's bearing and washes over the frame while the rumble sounds.
		 */
		const shudder = (
			out: Float32Array,
			palette: Float32Array,
			at: number,
			age: number,
			length: number,
			size: number,
			beam: number
		) => {
			if (age < 0 || age > length) return;
			// Below a fifth of its peak the roll cannot hold a colour, so it stops there rather than
			// trailing off through the dither codes.
			const env = Math.max(0, 1.2 * (1 - Math.exp(-age / 0.22)) * (1 - smoothstep(length * 0.4, length, age)) - 0.2);
			if (env <= 0) return;
			// The sound is a front: it leaves the flash's bearing, crosses the frame both ways in
			// under a second, and the roll follows it in.
			const front = age * (ring / 1.6);
			for (let i = 0; i < ring; i++) {
				const d = apart(i, at);
				const behind = front - d;
				if (behind < 0) continue;
				const roll = 0.35 + 0.85 * Math.exp(-behind / 150);
				const n = noise3(i * 0.018, age * 0.5, 4.1);
				addSample(out, i, palette, SLOT.base, size * env * roll * (0.4 + 0.6 * n));
				if (behind < 30) addSample(out, i, palette, SLOT.glow, size * 1.1 * env * (1 - behind / 30));
			}
			if (beam <= 0) return;
			const reached = front - apart(at, north);
			if (reached < 0) return;
			for (let b = 0; b < beamCount; b++) {
				const n = noise3(b * 0.05, age * 0.4, 8.2);
				addSample(out, beamStart + b, palette, SLOT.base, 0.8 * beam * size * env * (0.5 + 0.5 * n));
			}
		};

		return {
			render(out, { f, p, palette }) {
				const t = f.t;
				out.fill(0);

				// The sky the storm arrives under, spreading from the north-east and then giving way to
				// the charge. A moving front rather than a fade: no pixel lingers in the dither codes.
				const sky = (1 - 0.65 * smoothstep(p.ignite, p.collide, t)) * (1 - smoothstep(p.gather - 2, p.gather, t));
				// The beam empties as the spark is born: from there it is the channel waiting to fill.
				const beamSky = 1 - smoothstep(p.ignite - 0.35, p.ignite, t);
				if (sky > 0.004 && t >= p.heart) {
					const front = smoothstep(p.heart + 0.2, p.race - 1.5, t) * (ring / 2 + 120);
					for (let i = 0; i < g.count; i++) {
						const away = i < ring ? apart(i, far) : 90 + (beamCount - 1 - (i - beamStart));
						const edge = Math.sqrt(clamp((front - away) / 16)) * (i < ring ? 1 : beamSky);
						if (edge < 0.02) continue;
						const n = noise3(skyX[i] + t * 0.035, skyY[i], t * 0.06);
						setSample(out, i, palette, lerp(SLOT.base, SLOT.glow, 0.45 * n), sky * edge * (0.29 + 0.23 * n * n));
					}
				}

				// Go: the room's light drains along the frame into the south-west corner and dies there.
				if (t < p.heart) {
					const reach = (ring / 2) * Math.exp(-t / p.drain);
					const dim = 1 - smoothstep(0.7, p.heart - 0.25, t);
					const surge = t < 0.18 ? 1 - t / 0.18 : 0;
					for (let i = 0; i < g.count; i++) {
						const gap = reach - (i < ring ? apart(i, home) : home - south + (i - beamStart) + 1);
						if (gap < 0) continue;
						setSample(out, i, palette, lerp(SLOT.base, SLOT.glow, 0.45), (0.62 + 0.38 * surge) * dim);
						if (gap < 12) addSample(out, i, palette, SLOT.white, 1.05 * (1 - gap / 12) * dim);
					}
				}

				// The heart in the corner: steady, then racing, each beat throwing sparks along the walls.
				if (t >= p.heart && t < p.ignite + 0.3) {
					const f0 = p.heartFrom / 60;
					const f1 = p.heartTo / 60;
					const span = p.ignite - p.race;
					const u = Math.min(t, p.ignite) - p.race;
					const steady = Math.round((p.race - p.heart) * f0);
					const counted =
						t < p.race
							? (t - p.heart) * f0
							: steady + f0 * u + ((f1 - f0) * u * u) / (2 * span) + Math.max(0, t - p.ignite) * f1;
					let k = Math.floor(counted + 1e-6);
					if (lubAt(p, k) > t) k--;
					const lub = lubAt(p, k);
					const since = t - lub;
					const dub = since - (0.18 + 0.1 * (lubAt(p, k + 1) - lub));
					const rise = clamp((t - p.race) / span);
					const fadeIn = smoothstep(p.heart - 0.05, p.heart + 0.6, t);
					const fade = 1 - smoothstep(p.ignite, p.ignite + 0.3, t);
					const beat = (0.85 + 0.25 * rise) * (hit(since, 0.2) + 0.6 * hit(dub, 0.15));
					const spread = 2 * Math.pow(14 + 12 * rise, 2);
					// The ember keeps a tenth of the frame lit, which the Bounce Lamp needs to take each lub's kick.
					for (let d = -72; d <= 72; d++) {
						const i = wrap(home + d);
						const glow = (0.46 + 0.14 * rise) * fadeIn * Math.exp(-(d * d) / 620) + beat * Math.exp(-(d * d) / spread);
						addSample(out, i, palette, SLOT.accent, glow * fade);
						if (d > -8 && d < 8 && beat > 0.35) {
							addSample(out, i, palette, SLOT.white, (beat - 0.35) * 1.2 * (1 - Math.abs(d) / 8) * fade);
						}
					}
					if (t >= p.race && t < p.ignite) {
						const speed = 460 + 340 * rise;
						const up = since * speed;
						if (up < 220) spark(out, palette, home + up, 1, (0.7 + 0.45 * rise) * (1 - up / 220), 32);
						const along = dub * speed;
						if (dub >= 0 && along < 170) {
							spark(out, palette, home - along, -1, (0.6 + 0.4 * rise) * (1 - along / 170), 26);
						}
					}
				}

				// The loader: one spark laps ever faster, then two collide on every beat at the beam ends.
				if (t >= p.ignite && t < p.gather + 0.15) {
					const twin = p.collide - ((home - south) * p.lap) / ring;
					const span = twin - p.ignite;
					const k = (ring * span) / (p.lap - p.lapFrom);
					const whole = k * Math.log(p.lap / p.lapFrom);
					const offset = wrap(2 * (south - home));
					const scale = (offset + Math.round((whole - offset) / ring) * ring) / whole;
					const joined = scale * whole;
					const run =
						t < twin
							? scale * k * Math.log((p.lapFrom + ((p.lap - p.lapFrom) * (t - p.ignite)) / span) / p.lapFrom)
							: joined + (ring * (Math.min(t, p.full) - twin)) / p.lap + (2 * ring * Math.max(0, t - p.full)) / p.lap;

					// Every lap the spark closes past home lands another step of charge on the ring.
					const closed = Math.floor(run / ring);
					let lapAge = -1;
					let lapPulse = 0;
					if (t < twin && closed >= 1) {
						const lapNow = p.lapFrom * Math.exp((closed * ring) / scale / k);
						lapAge = t - (p.ignite + ((lapNow - p.lapFrom) * span) / (p.lap - p.lapFrom));
						if (lapAge >= 0 && lapAge < 0.7) lapPulse = hit(lapAge, 0.17);
					}

					if (t < p.gather) {
						if (t < twin) {
							// The first pass already lays down light; every further lap deepens it toward full.
							const steps = Math.max(1, joined / ring - 1);
							for (let i = 0; i < ring; i++) {
								const from = wrap(i - home);
								const passes = run >= from ? Math.floor((run - from) / ring) + 1 : 0;
								if (passes === 0) continue;
								addSample(out, i, palette, SLOT.base, 0.3 + 0.36 * Math.min(1, (passes - 1) / steps) + 0.35 * lapPulse);
							}
						} else {
							const shimmer = clamp((t - p.full) / (p.gather - p.full));
							const level = lerp(0.62, 0.78, clamp((t - twin) / (p.full - twin))) + 0.16 * shimmer;
							for (let i = 0; i < ring; i++) {
								const n = shimmer > 0 ? noise3(i * 0.07, t * (3 + 4 * shimmer), 0.5) - 0.5 : 0;
								const tone = lerp(SLOT.base, SLOT.glow, shimmer * (0.5 + n));
								addSample(out, i, palette, tone, level * (1 + 1.3 * shimmer * n));
							}
						}
						for (let d = -8; d <= 8; d++) {
							addSample(out, wrap(home + d), palette, SLOT.accent, 0.45 * (1 - Math.abs(d) / 9));
						}
						// Each closed lap slams a white front out of the corner both ways round the frame.
						if (lapPulse > 0.01) {
							const wave = lapAge * 2400;
							for (let i = 0; i < ring; i++) {
								const off = Math.abs(apart(i, home) - wave);
								if (off < 34) addSample(out, i, palette, SLOT.white, 1.5 * lapPulse * (1 - off / 34));
							}
						}
						// Charge sparkling on the eighth notes, denser as the ring fills: the crackle
						// in the score is the same grid.
						const rate = (t < p.full ? 4 : 8) / p.lap;
						const slot = Math.floor(t * rate);
						const sparkle = Math.exp(-(t - slot / rate) / 0.055);
						const charged = clamp((t - p.ignite) / (p.gather - p.ignite));
						for (let j = 0, n = 3 + Math.floor(charged * 10); j < n; j++) {
							const i = Math.floor(hash01(slot * 17 + j * 31 + 7) * ring);
							addSample(out, i, palette, SLOT.white, 1.5 * sparkle * (0.45 + 0.55 * hash01(slot * 5 + j * 13)));
							addSample(out, wrap(i + 1), palette, SLOT.glow, 0.6 * sparkle);
						}
					}

					burst(out, palette, t - p.ignite, 1);
					burst(out, palette, t - twin, 0.75);
					const level = (t < p.full ? 1.1 : 1.25) * (1 - clamp((t - p.gather) / 0.15));
					const tail = t < p.full ? 44 : 70;
					spark(out, palette, home + run, 1, level, tail);
					if (t >= twin) spark(out, palette, home - (run - joined), -1, level, tail);

					if (t < twin) {
						// The beam crackles as the lone spark passes its ends: 210 px out, then every 300.
						const n = Math.floor((run - 210) / 300);
						const lapNow = p.lapFrom * Math.exp((210 + 300 * n) / scale / k);
						const age = t - (p.ignite + ((lapNow - p.lapFrom) * span) / (p.lap - p.lapFrom));
						for (let j = 0; n >= 0 && j < 9 && age < 0.12; j++) {
							const b = Math.floor(hash01(n * 7 + j * 13) * beamCount);
							setSample(out, beamStart + b, palette, SLOT.white, 1.5 * (1 - age / 0.12));
						}
					} else if (t >= p.collide && t < p.gather) {
						const interval = p.lap / 2;
						const m0 = Math.round((p.full - p.collide) / interval);
						const m =
							t < p.full ? Math.floor((t - p.collide) / interval) : m0 + Math.floor((t - p.full) / (interval / 2));
						const age = t - (t < p.full ? p.collide + m * interval : p.full + ((m - m0) * interval) / 2);
						const node = Math.exp(-age / 0.12);
						const end = m % 2 === 0 ? south : north;
						for (let d = -30; d <= 30; d++) {
							addSample(out, wrap(end + d), palette, SLOT.white, 1.6 * node * Math.pow(1 - Math.abs(d) / 31, 2));
						}
						// In the overload the whole ring takes each collision, not only its end.
						if (t >= p.full) {
							for (let i = 0; i < ring; i++) addSample(out, i, palette, SLOT.glow, 0.35 * node);
						}

						// Each collision pumps a step of charge into the beam from its end.
						const steps = m0 / 2;
						const grow = clamp(age / 0.12);
						const southSteps = Math.floor(m / 2) + (m % 2 === 0 ? grow : 1);
						const northSteps = Math.floor((m + 1) / 2) - (m % 2 === 1 ? 1 - grow : 0);
						const fromSouth = (Math.min(steps, southSteps) / steps) * half;
						const fromNorth = (Math.min(steps, northSteps) / steps) * half;
						const burn = t < p.full ? 0 : 0.25 * clamp((t - p.full) / (p.gather - p.full));
						for (let b = 0; b < beamCount; b++) {
							const southDepth = fromSouth - b;
							const northDepth = fromNorth - (beamCount - 1 - b);
							if (southDepth <= 0 && northDepth <= 0) continue;
							const southGrowing = southDepth > 0 && southDepth < 1.5 && fromSouth < half;
							const northGrowing = northDepth > 0 && northDepth < 1.5 && fromNorth < half;
							setSample(out, beamStart + b, palette, SLOT.glow, southGrowing || northGrowing ? 1.05 : 0.82 + burn);
						}
						const rate = (t < p.full ? 4 : 8) / p.lap;
						const slot = Math.floor(t * rate);
						const glint = Math.exp(-(t - slot / rate) / 0.06);
						const count = 2 + Math.floor(hash01(slot * 3 + 1) * 3) + (t < p.full ? 0 : 2);
						for (let j = 0; j < count; j++) {
							const b = Math.floor(hash01(slot * 11 + j * 5 + 2) * beamCount);
							if (b < fromSouth || beamCount - 1 - b < fromNorth) {
								addSample(out, beamStart + b, palette, SLOT.white, 1.6 * glint);
							}
						}
					}
				}

				// The storm, from the far corner to overhead. Its thunder follows in the soundtrack,
				// and the room answers each roll seconds after the flash that threw it.
				const flash1 = flicker(t - p.flash1, 0);
				if (flash1 > 0) patch(out, palette, far, 50, 1.05 * flash1, false);
				shudder(out, palette, far, t - p.thunder1, 5.5, 0.6, beamSky);
				const flash2 = flicker(t - p.flash2, 1);
				if (flash2 > 0) patch(out, palette, Math.round((far + north) / 2), 70, 1.3 * flash2, true);
				shudder(out, palette, Math.round((far + north) / 2), t - p.thunder2, 5, 0.78, beamSky);
				const flash3 = flicker(t - p.flash3, 2);
				if (flash3 > 0) {
					patch(out, palette, north, 40, 1.6 * flash3, true);
					for (let b = Math.ceil(half); b < beamCount; b++) {
						const level = 1.5 * flash3 * grain[beamStart + b] * ((b - half) / half);
						addSample(out, beamStart + b, palette, SLOT.white, level);
					}
				}
				shudder(out, palette, north, t - p.thunder3, 4.5, 1, beamSky);
				const flash4 = flicker(t - p.flash4, 3);
				if (flash4 > 0) {
					patch(out, palette, north, 55, 1.85 * flash4, true);
					patch(out, palette, south, 55, 1.85 * flash4, true);
					for (let b = 0; b < beamCount; b++) {
						addSample(out, beamStart + b, palette, SLOT.white, 1.7 * flash4 * grain[beamStart + b]);
					}
				}
				shudder(out, palette, north, t - p.thunder4, 3.5, 1.25, beamSky);

				// The charge gathers into the beam, the beam into its centre, and the centre beats three times.
				if (t >= p.gather && t < p.strike) {
					if (t < p.contract) {
						const u = (t - p.gather) / (p.contract - p.gather);
						for (let i = 0; i < ring; i++) {
							const fromEnds = Math.min(apart(i, north), apart(i, south));
							if (fromEnds < (ring / 4) * (1 - u)) setSample(out, i, palette, SLOT.base, 0.72 + 0.24 * u);
						}
						const tone = lerp(SLOT.glow, SLOT.white, u);
						for (let b = 0; b < beamCount; b++) setSample(out, beamStart + b, palette, tone, 0.88 + 0.2 * u);
					} else if (t < p.point) {
						const reach = lerp(half, 3, smoothstep(p.contract, p.point, t));
						for (let b = 0; b < beamCount; b++) {
							if (Math.abs(b - centre) < reach) setSample(out, beamStart + b, palette, SLOT.white, 1.05);
						}
					} else if (t < p.point + 2 * p.pulse + 0.1) {
						const age = (t - p.point) % p.pulse;
						// The channel still glows around the point, which also keeps the Bounce Lamp lit
						// for each beat's kick: a tenth of the frame has to carry light for it to see one.
						const halo = 0.3 + 0.32 * Math.exp(-age / 0.1);
						for (let b = 0; b < beamCount; b++) {
							const level = Math.abs(b - centre) < 4 ? (age < 0.07 ? 1.2 : 0.45) : halo;
							setSample(out, beamStart + b, palette, SLOT.white, level);
						}
					}
				}

				// Three strokes, the branches' golden afterimage, then storm cloud rolling with the thunder.
				if (t >= p.strike) {
					const u = t - p.strike;
					const last = 2 * p.stroke;
					if (u < 0.09) {
						for (let b = 0; b < beamCount; b++) setSample(out, beamStart + b, palette, SLOT.white, 1.2);
						for (let i = 0; i < ring; i++) if (branch[i] > 0) setSample(out, i, palette, SLOT.white, 1.2);
					} else if (u >= p.stroke && u < p.stroke + 0.07) {
						for (let i = 0; i < ring; i++) setSample(out, i, palette, SLOT.white, branch[i] > 0 ? 1 : 0.62);
					} else if (u >= last && u < last + 0.15) {
						for (let i = 0; i < g.count; i++) setSample(out, i, palette, SLOT.white, 1.25);
					} else if (u >= last + 0.15) {
						const after = u - last - 0.15;
						// The storm cloud Thunder's own overlay carries on from: same shape, same levels.
						const roll = 0.82 + 0.22 * smoothstep(0.25, 0.85, f.level);
						const open = smoothstep(0, 0.4, after);
						for (let i = 0; i < ring; i++) {
							const cloud = noise3(i * 0.022, t * 0.3, 7.3);
							setSample(out, i, palette, lerp(SLOT.base, SLOT.glow, 0.4 * cloud), open * roll * (0.5 + 0.45 * cloud * cloud));
							if (branch[i] > 0 && after < 2.4) addSample(out, i, palette, SLOT.accent, 1.1 * Math.exp(-after / 0.5));
						}
						for (let b = 0; b < beamCount; b++) {
							const cloud = noise3(b * 0.04, t * 0.22, 2.9);
							setSample(out, beamStart + b, palette, SLOT.base, open * roll * (0.4 + 0.3 * cloud));
						}
						const ember = 0.85 * smoothstep(0.25, 1.6, after) * (0.75 + 0.25 * roll);
						for (let d = -18; d <= 18; d++) {
							addSample(out, wrap(home + d), palette, SLOT.accent, ember * (1 - Math.abs(d) / 19));
						}
					}
				}
			}
		};
	}
});

/**
 * Thunder's intro: the storm cloud First Strike left, turning into rolling lobes on the low end,
 * kicks rolling out of the beam and a fill into the drop.
 */
const thunderRoll = effect({
	id: 'thunderRoll',
	name: 'Thunder roll',
	role: 'bed',
	blurb: 'The storm cloud becomes low-end lobes round the ring; kicks roll out from the beam into the drop.',
	create(g) {
		let ring = 0;
		for (const s of g.strips) if (s.inPerimeter) ring += s.count;
		const beamStart = ring;
		const beamCount = g.count - ring;
		const low = new Follower(0.05, 0.4);
		let kickAt = -10;
		let snareAt = -10;
		let snares = 0;
		return {
			reset() {
				low.reset();
				kickAt = -10;
				snareAt = -10;
				snares = 0;
			},
			render(out, { f, palette }) {
				const t = f.t;
				if (f.kick) kickAt = t;
				if (f.snare) {
					snareAt = t;
					snares++;
				}
				const bars = f.barIndex + f.barPhase;
				const barLength = f.beatPeriod * 4;
				const toDrop = Number.isFinite(f.timeToDrop) ? f.timeToDrop / barLength : Infinity;
				out.fill(0);
				// The last beat before the drop is dark.
				if (toDrop < 0.25) return;
				const late = Math.max(0, 4 - toDrop);
				// A lap every two bars, speeding to a lap a bar over the last four.
				const turn = bars / 2 + (late * late) / 16;
				// Two bars to take the cloud over from the opening and gather it into the lobes.
				const gathered = smoothstep(0, 2, bars);
				const bed = 0.82 + 0.28 * clamp(low.update(f.bands[0], f.dt) * 1.4);
				for (let i = 0; i < ring; i++) {
					const u = i / ring;
					let lobe = 0;
					for (const offset of [0, 0.5]) {
						let d = u - (turn + offset);
						d -= Math.round(d);
						lobe = Math.max(lobe, Math.exp(-(d * d) / 0.0035));
					}
					const cloud = noise3(i * 0.022, t * 0.3, 7.3);
					const body = lerp(0.5 + 0.45 * cloud * cloud, 0.55, gathered);
					setSample(out, i, palette, lerp(SLOT.base, SLOT.glow, lerp(0.4 * cloud, lobe, gathered)), bed * body + 0.55 * gathered * lobe);
				}
				const age = (t - kickAt) / f.beatPeriod;
				const fill = clamp(late / 4);
				for (let b = 0; b < beamCount; b++) {
					const fromCentre = Math.abs(b - (beamCount - 1) / 2) / (beamCount / 2);
					const cloud = noise3(b * 0.04, t * 0.22, 2.9);
					// The beam keeps the opening's cloud under the rolls rather than emptying into the
					// dither codes; the kick and the fill ride over it.
					let level = bed * (0.5 + 0.25 * cloud) * (1 - 0.3 * gathered);
					if (age < 1) level = Math.max(level, Math.max(0, 1.05 - Math.abs(fromCentre - age) * 5) * (1 - age * 0.6));
					if (1 - fromCentre < fill) level = Math.max(level, 0.95);
					if (level > 0) {
						setSample(out, beamStart + b, palette, level > 0.5 ? lerp(SLOT.glow, SLOT.white, (level - 0.5) * 2) : SLOT.base, level);
					}
				}
				if (t - snareAt < 0.15) {
					const corner = Math.floor(hash01(snares * 7 + 3) * 4) * (ring / 4);
					const level = 1.15 * (1 - (t - snareAt) / 0.15);
					for (let d = -14; d < 14; d++) addSample(out, (corner + d + ring) % ring, palette, SLOT.accent, level);
				}
			}
		};
	}
});

// ---- The supercell ----------------------------------------------------------------------------

/** After "Turn The Lights Off": dark, then three glints in the corner and a snap of the whole frame. */
const lightsOff = effect({
	id: 'lightsOff',
	name: 'Lights off',
	role: 'bed',
	blurb: 'Dark, then the storm’s first glints in the south-west corner and a snap across the frame.',
	create(g) {
		let ring = 0;
		for (const s of g.strips) if (s.inPerimeter) ring += s.count;
		const home = Math.round(ring * 0.8);
		return {
			render(out, { f, palette }) {
				out.fill(0);
				const t = f.t;
				// Three glints closing up, then the frame catches for a frame and a half.
				for (const [at, level, reach] of [
					[2.1, 0.8, 4],
					[2.42, 1, 7],
					[2.62, 1.2, 11]
				] as const) {
					const age = t - at;
					if (age < 0 || age > 0.09) continue;
					const v = level * (1 - age / 0.09);
					for (let d = -reach; d <= reach; d++) {
						addSample(out, (home + d + ring) % ring, palette, SLOT.accent, v);
						addSample(out, (home + d + ring) % ring, palette, SLOT.white, v * 0.5);
					}
				}
				const snap = t - 2.78;
				if (snap >= 0 && snap < 0.12) {
					const v = 1.2 * (1 - snap / 0.12);
					for (let i = 0; i < g.count; i++) {
						const reach = Math.abs(((i - home + ring * 1.5) % ring) - ring / 2) / (ring / 2);
						addSample(out, i, palette, SLOT.accent, v * (1 - 0.6 * reach));
					}
				}
			}
		};
	}
});

/**
 * Before poster boy, scored by light-before-thunder/wall-cloud.m4a: a violet wall cloud turns ever
 * faster while the pressure drops, the funnel lights the beam, the eye goes dark, then a crack.
 */
const wallCloud = effect({
	id: 'wallCloud',
	name: 'Wall cloud',
	role: 'bed',
	blurb: 'Violet cloud with lime seams turning ever faster, pressure pulses, the eye, a crack.',
	// The soundtrack's timing table arrives as parameters; the turn mirrors cloudTurn in timing.ts.
	params: WALL_CLOUD,
	create(g) {
		let ring = 0;
		for (const s of g.strips) if (s.inPerimeter) ring += s.count;
		const beamStart = ring;
		const beamCount = g.count - ring;
		const centre = Math.floor(beamCount / 2);
		const hit = (age: number, tau: number) => (age < 0 ? 0 : age < 0.02 ? age / 0.02 : Math.exp(-(age - 0.02) / tau));
		return {
			render(out, { f, p, palette }) {
				const t = f.t;
				out.fill(0);
				if (t < p.form || (t >= p.eye && t < p.crack)) return;
				if (t < p.eye) {
					const span = p.eye - p.form;
					const k = span / (p.lapTo - p.lapFrom);
					const turn = k * Math.log((p.lapFrom + ((t - p.form) * (p.lapTo - p.lapFrom)) / span) / p.lapFrom);
					const pulse = hit(t - p.pulse1, 0.18) + hit(t - p.pulse2, 0.18) + hit(t - p.pulse3, 0.18);
					const level = smoothstep(p.form, p.form + 0.25, t) * (1 + 0.5 * pulse);
					for (let i = 0; i < ring; i++) {
						const a = (i / ring - turn) * Math.PI * 2;
						const n = noise3(Math.cos(a) * 1.6, Math.sin(a) * 1.6, t * 0.35);
						setSample(out, i, palette, SLOT.base, level * (0.36 + 0.68 * n * n));
						const seam = clamp(1 - Math.abs(n - 0.64) / 0.05);
						if (seam > 0) addSample(out, i, palette, SLOT.accent, level * 1.2 * seam);
					}
					if (t >= p.funnel) {
						const half = Math.round(lerp(2, 34, smoothstep(p.funnel, p.eye, t)));
						for (let d = -half; d < half; d++) {
							setSample(out, beamStart + centre + d, palette, SLOT.accent, (0.8 + 0.35 * pulse) * (1 - Math.abs(d) / (half + 1)));
						}
					}
					return;
				}
				const age = t - p.crack;
				if (age < 0.12) {
					for (let i = 0; i < g.count; i++) {
						setSample(out, i, palette, SLOT.accent, 1.2);
						addSample(out, i, palette, SLOT.white, 0.8);
					}
					return;
				}
				// The flash's afterimage on the beam, and the cloud lit from inside while the thunder rolls.
				const flash = Math.exp(-(age - 0.12) / 0.25);
				const roll = Math.exp(-(age - 0.12) / 1.2);
				for (let b = 0; b < beamCount; b++) setSample(out, beamStart + b, palette, SLOT.accent, 1.05 * flash + 0.7 * roll);
				for (let i = 0; i < ring; i++) {
					const n = noise3(i * 0.04, t * 5, 9.1);
					setSample(out, i, palette, SLOT.base, roll * (0.58 + 0.62 * n * n));
				}
			}
		};
	}
});

/** poster boy's intro: three arms spin faster every two bars, into the drop. */
const eyewall = effect({
	id: 'eyewall',
	name: 'Eyewall',
	role: 'bed',
	blurb: 'Three arms spin faster each two bars; kicks fire the beam; hats hail; the last bar collapses.',
	create(g) {
		let ring = 0;
		for (const s of g.strips) if (s.inPerimeter) ring += s.count;
		const beamStart = ring;
		const beamCount = g.count - ring;
		const north = Math.round(ring * 0.15);
		const south = Math.round(ring * 0.65);
		const hailAt = new Float32Array(9);
		const hailPos = new Int32Array(9);
		let hails = 0;
		let kickAt = -10;
		return {
			reset() {
				hailAt.fill(-10);
				hailPos.fill(0);
				hails = 0;
				kickAt = -10;
			},
			render(out, { f, palette }) {
				const t = f.t;
				const bars = f.barIndex + f.barPhase;
				if (f.kick) kickAt = t;
				if (f.hat && bars >= 4) {
					for (let j = 0; j < 3; j++) {
						const slot = hails % 9;
						hailAt[slot] = t;
						hailPos[slot] = Math.floor(hash01(hails * 13 + 5) * ring);
						hails++;
					}
				}
				out.fill(0);
				const lastBar = bars >= 7;
				const beat = lastBar ? (bars - 7) * 4 : 0;
				if (lastBar && beat >= 3) return;
				// Laps: half a lap a bar, then one, then one and a half, then two.
				const spin = bars < 2 ? bars / 2 : bars < 4 ? 1 + (bars - 2) : bars < 6 ? 3 + 1.5 * (bars - 4) : 6 + 2 * (bars - 6);
				const collapse = lastBar ? clamp(beat / 3) : 0;
				const wall = 0.38 + 0.22 * clamp(bars / 7);
				for (let i = 0; i < ring; i++) {
					const u = i / ring;
					let arm = 0;
					let tail = 0;
					for (let a = 0; a < 3; a++) {
						let d = u - (spin + a / 3);
						d -= Math.floor(d);
						const ahead = 1 - d;
						if (d < 20 / ring || ahead < 20 / ring) arm = Math.max(arm, 1 - Math.min(d, ahead) / (20 / ring));
						if (d > 0.5 && ahead < 120 / ring) tail = Math.max(tail, 1 - ahead / (120 / ring));
					}
					const reach = Math.min(Math.abs(((i - north + ring * 1.5) % ring) - ring / 2), Math.abs(((i - south + ring * 1.5) % ring) - ring / 2));
					if (collapse > 0 && reach > (ring / 4) * (1 - collapse)) continue;
					const n = noise3(i * 0.03, t * 0.5, 3.7);
					setSample(out, i, palette, SLOT.base, wall * (0.72 + 0.28 * n));
					if (tail > 0) addSample(out, i, palette, SLOT.base, 0.7 * tail * tail);
					if (arm > 0) addSample(out, i, palette, arm > 0.6 ? SLOT.white : SLOT.glow, 1.1 * arm);
				}
				const age = (t - kickAt) / f.beatPeriod;
				for (let b = 0; b < beamCount; b++) {
					const fromCentre = Math.abs(b - (beamCount - 1) / 2) / (beamCount / 2);
					const shot = age < 1 ? Math.max(0, 1.1 - Math.abs(fromCentre - age) * 6) : 0;
					if (lastBar) setSample(out, beamStart + b, palette, SLOT.accent, Math.max(collapse * 1.1, shot));
					else setSample(out, beamStart + b, palette, shot > 0.5 ? SLOT.white : SLOT.accent, Math.max(0.34, shot));
				}
				for (let j = 0; j < 9; j++) {
					const hailAge = t - hailAt[j];
					if (hailAge < 0 || hailAge > 0.4) continue;
					const v = 1.15 * Math.exp(-hailAge / 0.12);
					addSample(out, hailPos[j], palette, SLOT.white, v);
					addSample(out, (hailPos[j] + 1) % ring, palette, SLOT.white, v * 0.6);
				}
			}
		};
	}
});

// ---- Weather looks ----------------------------------------------------------------------------

/** The doors: blue evening air, one amber streetlight, static and far-off flashes. Runs for hours. */
const staticAir = effect({
	id: 'staticAir',
	name: 'Static air',
	role: 'bed',
	blurb: 'Blue clouds and an amber streetlight with static sparks; listens to the beat when there is music.',
	params: { listen: { default: 0, min: 0, max: 1, step: 1, label: 'Follow the music' } },
	create(g) {
		let ring = 0;
		for (const s of g.strips) if (s.inPerimeter) ring += s.count;
		const beamStart = ring;
		const beamCount = g.count - ring;
		const heard = new Follower(0.4, 1.2);
		const spark = (out: Float32Array, palette: Float32Array, at: number, age: number) => {
			if (age < 0 || age > 0.6) return;
			const v = 1.1 * Math.exp(-age / 0.12);
			addSample(out, at % g.count, palette, SLOT.white, v);
			addSample(out, (at + 1) % g.count, palette, SLOT.white, v * 0.6);
		};
		return {
			reset() {
				heard.reset();
			},
			render(out, { f, p, palette }) {
				const t = f.t;
				const listening = p.listen > 0.5;
				const gain = listening ? 0.8 + 0.45 * clamp(heard.update(f.level, f.dt) * 1.3) : 1;
				const light = Math.floor((t / 420) * ring) % ring;
				for (let i = 0; i < g.count; i++) {
					// The ring on a circle of noise; the beam across its middle.
					let x: number;
					let y: number;
					if (i < ring) {
						const a = (i / ring) * Math.PI * 2;
						x = Math.cos(a) * 1.3;
						y = Math.sin(a) * 1.3;
					} else {
						x = 0;
						y = ((i - beamStart) / beamCount - 0.5) * 2.6;
					}
					const cloud = noise3(x + t / 70, y, t * 0.02);
					let pool = 0;
					if (i < ring) {
						let d = Math.abs(i - light);
						if (d > ring / 2) d = ring - d;
						pool = d < 90 ? Math.exp(-(d * d) / 1800) : 0;
					}
					setSample(out, i, palette, lerp(SLOT.base, SLOT.glow, cloud), (0.44 + 0.34 * cloud) * gain * (1 - 0.6 * pool));
					if (pool > 0) addSample(out, i, palette, SLOT.accent, 0.9 * gain * pool);
				}
				if (listening) {
					if (f.beatIndex % 2 === 0 && hash01(f.beatIndex * 7 + 1) < f.energy * 0.6) {
						spark(out, palette, Math.floor(hash01(f.beatIndex * 13 + 3) * g.count), f.beatPhase * f.beatPeriod);
					}
					return;
				}
				for (let k = Math.floor(t / 2) - 1; k <= Math.floor(t / 2); k++) {
					if (k < 0) continue;
					const onset = k * 2 + hash01(k * 17 + 3) * 1.8;
					const at = Math.floor(hash01(k * 31 + 7) * g.count);
					spark(out, palette, at, t - onset);
					if (hash01(k * 53 + 11) < 0.2) {
						spark(out, palette, at + 4, t - onset - 0.13);
						spark(out, palette, at + 9, t - onset - 0.27);
					}
				}
				const j = Math.floor(t / 90);
				const age = t - (j * 90 + 20 + hash01(j * 7 + 5) * 50);
				if (age >= 0 && age < 0.8) {
					const wall = g.strips[Math.floor(hash01(j * 13 + 2) * 4)];
					const level = 1.05 * (Math.exp(-age / 0.07) + (age > 0.22 ? 0.7 * Math.exp(-(age - 0.22) / 0.07) : 0));
					for (let q = 0; q < wall.count; q++) addSample(out, wall.offset + q, palette, SLOT.glow, level);
				}
			}
		};
	}
});

/** The first pause: copper cloud breathing with the music, heat lightning far away. */
const heatLightning = effect({
	id: 'heatLightning',
	name: 'Heat lightning',
	role: 'bed',
	blurb: 'Copper cloud following the music, with distant sky-blue flickers every so often.',
	create(g) {
		let ring = 0;
		for (const s of g.strips) if (s.inPerimeter) ring += s.count;
		const beamStart = ring;
		const beamCount = g.count - ring;
		const heard = new Follower(0.3, 1.5);
		return {
			reset() {
				heard.reset();
			},
			render(out, { f, palette }) {
				const t = f.t;
				const gain = 0.88 + 0.3 * clamp(heard.update(f.level, f.dt));
				for (let i = 0; i < g.count; i++) {
					let x: number;
					let y: number;
					if (i < ring) {
						const a = (i / ring) * Math.PI * 2;
						x = Math.cos(a) * 1.5;
						y = Math.sin(a) * 1.5;
					} else {
						x = 0;
						y = ((i - beamStart) / beamCount - 0.5) * 3;
					}
					const cloud = noise3(x + t / 90, y, t * 0.03);
					setSample(out, i, palette, lerp(SLOT.base, SLOT.glow, cloud), (0.5 + 0.38 * cloud) * gain);
				}
				const j = Math.floor(t / 12);
				const age = t - (j * 12 + hash01(j * 19 + 1) * 6);
				if (age < 0 || age > 1.2) return;
				const flickers = 2 + Math.floor(hash01(j * 23 + 9) * 2);
				let env = 0;
				for (let n = 0; n < flickers; n++) {
					const a = age - n * 0.19;
					if (a >= 0) env = Math.max(env, Math.exp(-a / 0.12));
				}
				const level = 1.15 * env;
				if (hash01(j * 29 + 4) < 0.3) {
					for (let b = 0; b < beamCount; b++) {
						addSample(out, beamStart + b, palette, SLOT.accent, level);
						addSample(out, beamStart + b, palette, SLOT.white, level * 0.4);
					}
				} else {
					const centre = Math.floor(hash01(j * 31 + 6) * ring);
					const half = 34 + Math.floor(hash01(j * 37 + 8) * 34);
					for (let d = -half; d <= half; d++) {
						const i = (centre + d + ring) % ring;
						const v = level * (1 - Math.abs(d) / (half + 1));
						addSample(out, i, palette, SLOT.accent, v);
						addSample(out, i, palette, SLOT.white, v * 0.4);
					}
				}
			}
		};
	}
});

/** The calm centre: a clear caustic net and one warm pool of sun travelling the ring. */
const eyeOfStorm = effect({
	id: 'eyeOfStorm',
	name: 'Eye of the storm',
	role: 'bed',
	blurb: 'Clear blue caustic net with a slow travelling pool of sun.',
	create(g) {
		let ring = 0;
		for (const s of g.strips) if (s.inPerimeter) ring += s.count;
		const heard = new Follower(0.3, 1.5);
		return {
			reset() {
				heard.reset();
			},
			render(out, { f, palette }) {
				const t = f.t;
				const gain = 0.88 + 0.3 * clamp(heard.update(f.level, f.dt));
				const sun = (Math.round(ring * 0.15) + (t / 240) * ring) % ring;
				for (let i = 0; i < g.count; i++) {
					const u = i < ring ? i / ring : 0.15 + ((i - ring) / (g.count - ring)) * 0.5;
					const net = Math.abs(Math.sin(u * Math.PI * 14 + t * 0.25) * Math.sin(u * Math.PI * 9 - t * 0.18));
					setSample(out, i, palette, lerp(SLOT.glow, SLOT.base, net), (0.52 + 0.38 * net) * gain);
					if (i < ring) {
						let d = Math.abs(i - sun);
						if (d > ring / 2) d = ring - d;
						if (d < 90) addSample(out, i, palette, SLOT.accent, 0.95 * gain * Math.exp(-(d * d) / 1000));
					}
				}
			}
		};
	}
});

/** The afterglow: wet street colours and a raindrop sliding down the beam now and then. */
const wetStreet = effect({
	id: 'wetStreet',
	name: 'Wet street',
	role: 'bed',
	blurb: 'Slow ember fringes like oil on a wet street, with the odd raindrop on the beam.',
	create(g) {
		let ring = 0;
		for (const s of g.strips) if (s.inPerimeter) ring += s.count;
		const beamStart = ring;
		const beamCount = g.count - ring;
		const heard = new Follower(1.5, 3);
		return {
			reset() {
				heard.reset();
			},
			render(out, { f, palette }) {
				const t = f.t;
				const gain = 0.92 + 0.2 * clamp(heard.update(f.level, f.dt));
				for (let i = 0; i < g.count; i++) {
					const u = i < ring ? i / ring : 0.15 + ((i - ring) / beamCount) * 0.5;
					const fringe = 0.5 + 0.5 * Math.sin((u - t / 120) * Math.PI * 10 + Math.sin(u * 7 + t * 0.05) * 2);
					setSample(out, i, palette, SLOT.base, (0.46 + 0.34 * fringe) * gain);
					addSample(out, i, palette, SLOT.third, 0.4 * fringe * fringe * gain);
				}
				const j = Math.floor(t / 7.5);
				const age = t - (j * 7.5 + hash01(j * 11 + 3) * 2.5);
				if (age >= 0 && age < 1.2) {
					const at = Math.floor(hash01(j * 17 + 5) * (beamCount - 24)) + Math.floor((age / 1.2) * 20);
					const v = 1.1 * (1 - age / 1.2);
					addSample(out, beamStart + at, palette, SLOT.accent, v);
					addSample(out, beamStart + at, palette, SLOT.white, v * 0.4);
				}
			}
		};
	}
});

/** Back In Black's count-in: each hat is a tick marching up the beam, the corner answers the kit. */
const countIn = effect({
	id: 'countIn',
	name: 'Count-in',
	role: 'bed',
	blurb: 'Ticks march up the beam on the hi-hat count; the corner flashes on kick and snare.',
	create(g) {
		let ring = 0;
		for (const s of g.strips) if (s.inPerimeter) ring += s.count;
		const beamStart = ring;
		const beamCount = g.count - ring;
		const home = Math.round(ring * 0.8);
		let ticks = 0;
		let hitAt = -10;
		return {
			reset() {
				ticks = 0;
				hitAt = -10;
			},
			render(out, { f, palette }) {
				const t = f.t;
				if (f.hat) ticks++;
				if (f.kick || f.snare) hitAt = t;
				out.fill(0);
				const bars = f.barIndex + f.barPhase;
				// Eighth notes stand in for a count the drums did not give.
				const count = Math.max(ticks, Math.floor(bars * 8) + 1);
				const all = bars >= 1.75;
				for (let n = 0; n < Math.min(count, 10); n++) {
					const at = 6 + 12 * n;
					for (let q = -4; q < 4; q++) {
						if (at + q >= 0 && at + q < beamCount) setSample(out, beamStart + at + q, palette, SLOT.white, all ? 1.2 : 0.95);
					}
				}
				const flash = t - hitAt;
				if (flash >= 0 && flash < 0.25) {
					for (let d = -30; d <= 30; d++) {
						setSample(out, (home + d + ring) % ring, palette, SLOT.base, 1.15 * (1 - flash / 0.25) * (1 - Math.abs(d) / 31));
					}
				}
			}
		};
	}
});

/**
 * Before the guests' hour, scored by light-before-thunder/open-sky.m4a: the last rain in azure mist,
 * then gold fills the beam, spills round the ring from its ends and glitters.
 */
const openSky = effect({
	id: 'openSky',
	name: 'Open sky',
	role: 'bed',
	blurb: 'The last rain in azure mist, then gold fills the beam, spills round the ring and glitters.',
	// The soundtrack's timing table arrives as parameters; the glitter mirrors glitter() in timing.ts.
	params: OPEN_SKY,
	create(g) {
		let ring = 0;
		for (const s of g.strips) if (s.inPerimeter) ring += s.count;
		const beamStart = ring;
		const beamCount = g.count - ring;
		const half = beamCount / 2;
		const north = Math.round(ring * 0.15);
		const south = Math.round(ring * 0.65);
		const far = Math.round(ring * 0.3);
		const wrap = (i: number) => ((i % ring) + ring) % ring;
		const apart = (a: number, b: number) => {
			const d = wrap(a - b);
			return d > ring / 2 ? ring - d : d;
		};
		const hit = (age: number, tau: number) => (age < 0 ? 0 : age < 0.02 ? age / 0.02 : Math.exp(-(age - 0.02) / tau));
		return {
			render(out, { f, p, palette }) {
				const t = f.t;
				out.fill(0);

				// Azure mist and the last of the rain, clearing as the gold comes.
				// The mist holds its level until the gold has covered the frame, then goes out under it.
				const mist = 0.56 * smoothstep(0, 0.35, t) * (1 - smoothstep(p.glitter, p.settle, t));
				if (mist > 0.002) {
					for (let i = 0; i < g.count; i++) {
						const n = noise3(i * 0.02, t * 0.15, 3.3);
						setSample(out, i, palette, lerp(SLOT.accent, SLOT.white, 0.15 * n), mist * (0.62 + 0.5 * n));
					}
				}
				const rain = 1 - smoothstep(0.5, p.dry, t);
				if (rain > 0) {
					const now = Math.floor(t * 40);
					for (let s = now - 6; s <= now; s++) {
						const v = 0.7 * Math.exp(-(t - s / 40) / 0.045);
						for (let j = 0; j < 2; j++) {
							if (hash01(s * 29 + j * 11 + 5) > rain * 0.8) continue;
							addSample(out, Math.floor(hash01(s * 17 + j * 13 + 1) * g.count), palette, SLOT.white, v);
						}
					}
				}
				const flash = hit(t - p.flash, 0.08) + 0.6 * hit(t - p.flash - 0.2, 0.08);
				if (flash > 0.003) {
					for (let d = -50; d <= 50; d++) addSample(out, wrap(far + d), palette, SLOT.white, 0.65 * flash * (1 - Math.abs(d) / 51));
				}
				// That flash's thunder, a second and a half behind it: the storm's last word on the room.
				const away = clamp((t - p.thunder) / 0.25) * (1 - smoothstep(p.thunder + 0.6, p.thunder + 2.6, t));
				if (away > 0.01) {
					for (let i = 0; i < ring; i++) {
						const n = noise3(i * 0.03, t * 0.5, 6.7);
						addSample(out, i, palette, SLOT.accent, 0.24 * away * (0.4 + 0.6 * n));
					}
				}

				// Gold warms the beam's centre as the chord swells in, fills the beam from there, then
				// spills from the beam ends round the ring.
				const settle = 1 - 0.18 * smoothstep(p.settle, p.end, t);
				const dawn = smoothstep(p.dry - 0.5, p.bloom, t);
				if (dawn > 0 && t < p.spill) {
					for (let b = 0; b < beamCount; b++) {
						const x = Math.abs(b - (beamCount - 1) / 2) / half;
						addSample(out, beamStart + b, palette, SLOT.base, 0.55 * dawn * Math.exp(-(x * x) / 0.08));
					}
				}
				if (t >= p.bloom) {
					const reach = 4 + smoothstep(p.bloom, p.spill, t) * (half - 4);
					for (let b = 0; b < beamCount; b++) {
						const fromCentre = Math.abs(b - (beamCount - 1) / 2);
						if (fromCentre <= reach) setSample(out, beamStart + b, palette, SLOT.base, 0.95 * settle);
					}
				}
				if (t >= p.spill) {
					const reach = smoothstep(p.spill, p.glitter, t) * (ring / 4);
					for (let i = 0; i < ring; i++) {
						const d = Math.min(apart(i, north), apart(i, south));
						if (d > reach) continue;
						const front = t < p.glitter ? clamp(1 - (reach - d) / 30) : 0;
						setSample(out, i, palette, SLOT.base, (0.9 + 0.25 * front) * settle);
						if (front > 0) addSample(out, i, palette, SLOT.white, 0.8 * front);
					}
				}

				// Glitter as the ring closes, each glint with its own chime.
				if (t >= p.glitter && t < p.settle + 0.3) {
					for (let s = Math.floor((t - 0.3) * 10); s <= Math.floor(t * 10); s++) {
						if (s < Math.ceil(p.glitter * 10) || s >= p.settle * 10) continue;
						for (let j = 0; j < 2; j++) {
							if (hash01(s * 23 + j * 7 + 1) > 0.55) continue;
							const age = t - (s / 10 + 0.05 * j);
							if (age < 0) continue;
							const i = Math.floor(hash01(s * 31 + j * 17 + 9) * ring);
							addSample(out, i, palette, SLOT.white, 1.2 * Math.exp(-age / 0.07));
						}
					}
				}
			}
		};
	}
});

/**
 * The end, scored by light-before-thunder/homecoming.m4a: rain on the frame easing off, the storm
 * rolling away, the sky clearing star by star, the heart slowing to rest and the spark's last lap
 * home. The Goodnight hold plays it from its end, where the ember rests under the stars.
 */
const homecoming = effect({
	id: 'homecoming',
	name: 'Homecoming',
	role: 'bed',
	blurb: 'Rain easing off, the storm rolling away, stars coming out, the last spark lapping home to rest.',
	// The soundtrack's timing table arrives as parameters; `from` skips ahead into the resting ember.
	params: { ...HOMECOMING, from: 0 },
	create(g) {
		let ring = 0;
		for (const s of g.strips) if (s.inPerimeter) ring += s.count;
		const beamStart = ring;
		const beamCount = g.count - ring;
		const home = Math.round(ring * 0.8);
		const north = Math.round(ring * 0.15);
		const far = Math.round(ring * 0.3);
		const wrap = (i: number) => ((i % ring) + ring) % ring;
		const hit = (age: number, tau: number) => (age < 0 ? 0 : age < 0.02 ? age / 0.02 : Math.exp(-(age - 0.02) / tau));

		const flicker = (age: number, n: number) => {
			if (age < 0 || age > 1.2) return 0;
			let env = 0;
			let offset = 0;
			for (let j = 0; j < 3; j++) {
				const strength = j === 0 ? 1 : 0.5 + 0.4 * hash01(n * 37 + j * 11);
				env = Math.max(env, strength * hit(age - offset, 0.08));
				offset += 0.18 + 0.1 * hash01(n * 17 + j * 3);
			}
			return env;
		};
		const patch = (out: Float32Array, palette: Float32Array, at: number, width: number, level: number) => {
			for (let d = -width; d <= width; d++) {
				const shape = level * Math.pow(1 - Math.abs(d) / (width + 1), 1.3);
				addSample(out, wrap(at + d), palette, SLOT.accent, 0.75 * shape);
				addSample(out, wrap(at + d), palette, SLOT.white, 0.6 * shape);
			}
		};

		type Rest = { heart: number; beat: number; slow: number; rest: number };
		// Mirrors restingLubs in timing.ts: each beat `slow` times longer than the one before.
		const lubAt = (p: Rest, k: number) => p.heart + (p.beat * (Math.pow(p.slow, k) - 1)) / (p.slow - 1);
		const lubBefore = (p: Rest, t: number) => Math.floor(Math.log(1 + ((t - p.heart) * (p.slow - 1)) / p.beat) / Math.log(p.slow) + 1e-9);

		return {
			render(out, { f, p, palette }) {
				const t = f.t + p.from;
				out.fill(0);

				// The wet frame glows warm while it rains. Behind it a clear night comes up, and the
				// spark's last lap wipes the wet warmth off to reveal the sky it leaves behind.
				const u = clamp((t - p.leave) / (p.home - p.leave));
				const run = ring * u * u * (3 - 2 * u);
				const warm = 0.58 * (1 - smoothstep(p.ease, p.home, t));
				const sky = smoothstep(p.dry - 8, p.stars - 2, t);
				for (let i = 0; i < ring; i++) {
					const n = noise3(i * 0.03, t * 0.08, 1.7);
					const swept = t >= p.leave && wrap(i - home) < run ? 1 : 0;
					setSample(out, i, palette, SLOT.base, 0.5 * Math.max(sky, swept) * (0.66 + 0.34 * n));
					const wet = warm * (1 - swept);
					if (wet > 0.002) addSample(out, i, palette, lerp(SLOT.base, SLOT.glow, n), wet * (0.6 + 0.4 * n));
				}
				for (let b = 0; b < beamCount; b++) {
					const n = noise3(b * 0.05, t * 0.08, 5.3);
					setSample(out, beamStart + b, palette, SLOT.base, (0.48 * sky + warm) * (0.62 + 0.38 * n));
				}

				// Rain landing on the frame: specks that thin out as it eases.
				const rain = 1 - smoothstep(p.ease, p.dry, t);
				if (rain > 0) {
					const now = Math.floor(t * 40);
					for (let s = now - 6; s <= now; s++) {
						const v = 0.75 * Math.exp(-(t - s / 40) / 0.045);
						for (let j = 0; j < 2; j++) {
							if (hash01(s * 29 + j * 11 + 7) > rain * 0.9) continue;
							const i = Math.floor(hash01(s * 17 + j * 13 + 3) * g.count);
							addSample(out, i, palette, SLOT.accent, v);
							addSample(out, i, palette, SLOT.white, 0.5 * v);
						}
					}
				}

				// Drips once it eases, each with its sound: mirrors drips() in timing.ts.
				for (let s = Math.floor((t - 0.9) / 0.45); s <= Math.floor(t / 0.45); s++) {
					const at = s * 0.45 + 0.4 * hash01(s * 13 + 5);
					const age = t - at;
					if (s < Math.floor(p.ease / 0.45) || s * 0.45 >= p.stars || age < 0 || age > 0.5) continue;
					const chance = 0.75 * smoothstep(p.ease, p.dry, at) * (1 - 0.7 * smoothstep(p.dry, p.stars, at));
					if (hash01(s * 7 + 11) >= chance) continue;
					const i = Math.floor(hash01(s * 19 + 3) * g.count);
					const v = 1.1 * hit(age, 0.12);
					addSample(out, i, palette, SLOT.white, v);
					if (i + 1 < g.count) addSample(out, i + 1, palette, SLOT.accent, 0.6 * v);
				}

				// The storm rolling away: overhead first, then ever farther to the north-east.
				const flash1 = flicker(t - p.flash1, 0);
				if (flash1 > 0) {
					patch(out, palette, north, 34, 1.15 * flash1);
					for (let b = 0; b < beamCount; b++) addSample(out, beamStart + b, palette, SLOT.white, 0.9 * flash1 * (b / beamCount));
				}
				const flash2 = flicker(t - p.flash2, 1);
				if (flash2 > 0) patch(out, palette, Math.round((far + north) / 2), 60, 0.9 * flash2);
				const flash3 = flicker(t - p.flash3, 2);
				if (flash3 > 0) patch(out, palette, far, 50, 0.7 * flash3);
				const flash4 = flicker(t - p.flash4, 3);
				if (flash4 > 0) patch(out, palette, far, 34, 0.5 * flash4);

				// The cleared sky: mirrors stars() in timing.ts, each star up for good and slowly alive.
				if (t >= p.stars) {
					for (let s = 0; p.stars + s * 0.7 < p.end - 0.4; s++) {
						const at = p.stars + s * 0.7 + 0.35 * hash01(s * 23 + 7);
						if (t < at) break;
						const i = Math.floor(hash01(s * 37 + 13) * ring);
						const born = smoothstep(at, at + 0.35, t);
						const alive = 0.7 + 0.3 * noise3(s * 0.7, t * 0.25, 6.1);
						// Each star strikes with its bell, then settles to the light it keeps.
						const v = 0.9 * born * alive + 0.55 * hit(t - at, 0.3);
						addSample(out, i, palette, SLOT.white, v);
						addSample(out, wrap(i - 1), palette, SLOT.third, 0.35 * v);
						addSample(out, wrap(i + 1), palette, SLOT.third, 0.35 * v);
					}
				}

				// The last lap: a warm spark leaves home, and home is where it goes out.
				if (t >= p.leave && t < p.home + 0.8) {
					const level = 1.05 * smoothstep(p.leave, p.leave + 0.8, t) * (1 - smoothstep(p.home, p.home + 0.8, t));
					for (let q = 0; q < 40; q++) {
						const i = wrap(Math.round(home + run) - q);
						if (q < 3) addSample(out, i, palette, SLOT.white, level);
						else addSample(out, i, palette, lerp(SLOT.glow, SLOT.deep, (q - 3) / 37), level * Math.pow(1 - (q - 3) / 37, 1.4));
					}
				}
				// Home: the spark arrives and blooms into the ember that stays.
				const arrive = t - p.home;
				if (arrive >= 0 && arrive < 2.2) {
					const bloom = hit(arrive, 0.5);
					for (let d = -50; d <= 50; d++) {
						addSample(out, wrap(home + d), palette, SLOT.accent, 1.2 * bloom * Math.exp(-(d * d) / 420));
						if (Math.abs(d) < 10) addSample(out, wrap(home + d), palette, SLOT.white, 0.8 * bloom * (1 - Math.abs(d) / 10));
					}
				}

				// The ember in the corner beats ever slower until it rests. Its faint wide halo keeps a
				// tenth of the frame lit, which the Bounce Lamp needs to stay on as the spark's home.
				if (t >= p.heart - 0.5) {
					let pulse = 0;
					if (t >= p.heart) {
						const last = lubBefore(p, p.rest - 1e-6);
						let k = Math.min(lubBefore(p, t), last);
						if (lubAt(p, k) > t) k--;
						const lub = lubAt(p, k);
						const since = t - lub;
						const strength = Math.pow(0.97, k);
						const dub = since - (0.18 + 0.1 * (lubAt(p, k + 1) - lub));
						pulse = strength * (hit(since, 0.3) + 0.5 * (1 - k / last) * hit(dub, 0.22));
					}
					const glow = smoothstep(p.heart - 0.5, p.heart + 3, t);
					for (let d = -72; d <= 72; d++) {
						const level = glow * (0.62 * Math.exp(-(d * d) / 130) + 0.1 * Math.exp(-(d * d) / 1900)) + 0.5 * pulse * Math.exp(-(d * d) / 260);
						addSample(out, wrap(home + d), palette, SLOT.glow, level);
					}
				}
			}
		};
	}
});

// ---- Stings -----------------------------------------------------------------------------------

const lightsOffSting = sting('Lights off', {
	length: 3,
	palette: 'ultraviolet',
	timeline: [
		{ at: 0, section: 'void', look: look({ bed: lightsOff }) },
		{ at: 2.78, kick: 1 }
	]
});


// ---- The night --------------------------------------------------------------------------------

export default evening('Light Before Thunder', {
	palette: 'sodium night',
	segments: [
		hold('Doors', {
			look: look({ bed: staticAir, palette: 'sodium night', floor: 0.15 }),
			expectEnd: '20:00',
			note: 'Stop Spotify, then press Go.'
		}),

		narration('First Strike', {
			audio: './light-before-thunder/first-strike.m4a',
			palette: firstStrike,
			bpm: BPM,
			enter: { light: 'cut' },
			// The storm cloud after the strike is handed to Thunder's own overlay, not eased out.
			end: 'hold',
			timeline: [
				{ at: 0, section: 'breakdown', look: look({ bed: thunderhead, floor: 0 }) },
				{ at: OPENING.ignite, section: 'build' },
				{ at: OPENING.gather, section: 'void' },
				{ at: OPENING.strike, section: 'drop' },
				{ at: OPENING.strike + 2 * OPENING.stroke + 0.15, section: 'outro' },
				...stormKicks(OPENING)
			]
		}),

		block('First Strike', {
			id: 'first-strike-songs',
			palette: firstStrike,
			// The opening's rolling cloud dissolves into Thunder's, so the room never restates itself.
			enter: { light: 3 },
			between: { crossfade: 4 },
			songs: [
				song('Thunder', {
					by: 'Gabry Ponte',
					id: 'b_bEigUA1kk',
					overlays: [{ from: 'start', to: 'first-drop', look: look({ bed: thunderRoll, intensity: 1, floor: 0 }) }]
				}),
				song('Desire', { by: 'Ian Asher', id: 'UARSiWU8eoo' }),
				song("I'm Good (Blue)", { by: 'David Guetta', id: 'pIb7QoXdP_k' }),
				song('Animals', { by: 'Martin Garrix', id: 'DYf28lOb8KU' }),
				song('La La Land', { by: 'Green Velvet', id: 'rjXMBZJo-VA' }),
				song('Like a Prayer', { by: 'Josh Fawaz', id: 'wy7_PFy-ztQ' }),
				song('I Love Hollywood!', { by: 'Slayyyter', id: 'IqW8xx53ADQ' }),
				song('Turn The Lights Off', { by: 'KATO', id: 'q_Siih2P9tA' })
			]
		}),

		block('Supercell: Hail', {
			palette: 'ultraviolet',
			enter: { sting: lightsOffSting, hit: 'strobe' },
			between: { crossfade: 3 },
			songs: [
				song('Babydoll', { by: 'Ely Oaks', id: 'wK7jF7I9dIA' }),
				song('Summertime Sadness (Hardstyle)', { id: 'AHaIdOXzzuE' }),
				song('Borderline', { by: 'Ely Oaks', id: 'oXin8uZTQIk' }),
				song('big chemistry', { by: 'frutiger dillon', id: 'XAGXPAHwksA' }),
				song('Rumble', { by: 'Skrillex', id: 'fFU3VEimqe0' }),
				song('FE!N', { by: 'Travis Scott', id: '2nR1zrNzgcY' }),
				song('Jedna Dva', { by: 'Yzomandias', id: 'IyqcKddpDKA' }),
				song('Ponyboy', { by: 'SOPHIE', id: 'ryV2LN003YI' })
			]
		}),

		narration('Wall Cloud', {
			audio: './light-before-thunder/wall-cloud.m4a',
			palette: 'ultraviolet',
			enter: { light: 'cut' },
			timeline: [
				{ at: 0, section: 'build', look: look({ bed: wallCloud, floor: 0 }) },
				{ at: WALL_CLOUD.eye, section: 'void' },
				{ at: WALL_CLOUD.crack, section: 'drop' },
				...[WALL_CLOUD.pulse1, WALL_CLOUD.pulse2, WALL_CLOUD.pulse3].map((at) => ({ at, kick: 0.8 })),
				{ at: WALL_CLOUD.crack, kick: true }
			]
		}),

		block('Supercell: Eyewall', {
			palette: 'ultraviolet',
			enter: { light: 'cut' },
			songs: [
				song('poster boy', {
					by: '2hollis',
					id: 'jOLT6ukrQSg',
					overlays: [{ from: 'start', to: 'first-drop', look: look({ bed: eyewall, intensity: 1, floor: 0 }), end: 'slam' }]
				})
			]
		}),

		block('Supercell: Downburst', {
			palette: 'ultraviolet',
			enter: { light: 'cut', hit: 'strobe' },
			songs: [
				song("I Like The Way You Kiss Me (Culture Shock's D&B Flip)", { id: 'SkU6xAwtF-s' }),
				song('Baddadan', { by: 'Chase & Status', id: '8GEObTEFEeo' }),
				song('SICKO MODE', { by: 'Travis Scott', id: 'NQbkGDoD7B0' })
			]
		}),

		pause('Heat Lightning', {
			look: look({ bed: heatLightning, palette: 'copper', floor: 0.15 }),
			enter: { light: 4 },
			length: '3m',
			music: [
				song('Intro', { by: 'The xx', id: 'xMV6l2y67rk' }),
				song('Sunset Lover', { by: 'Petit Biscuit', id: 'WrWcOLlmv7k' })
			]
		}),

		block('Neon Rain', {
			palette: 'magenta bloom',
			enter: { sting: colourSweep('2s', 'magenta bloom'), hit: 'bump' },
			songs: [
				song('Blinding Lights', { by: 'The Weeknd', id: 'J7p4bzqLvCw' }),
				song('Physical', { by: 'Dua Lipa', id: 'Yegn0dZ-BfY' }),
				song('September', { by: 'Earth, Wind & Fire', id: 'B2mmDEv0OEk' }),
				song('Hypnotized', { by: 'Purple Disco Machine', id: '91jpOlo3M3Y' }),
				song('360', { by: 'Charli xcx', id: 'nI6GP8wKJ6o' }),
				song('Von dutch', { by: 'Charli xcx', id: 'oZ-lTp1ZaZQ' }),
				song('Erotic Electronic', { by: 'Slayyyter', id: 'LghHErPmles' }),
				song('Unholy', { by: 'Sam Smith', id: '8VKD-IlvibI' })
			]
		}),

		block('Black Ice', {
			palette: 'ice',
			enter: { light: 'cut', hit: 'slam' },
			songs: [
				song('HUMBLE.', { by: 'Kendrick Lamar', id: 'H4RELGc9su8' }),
				song('The Box', { by: 'Roddy Ricch', id: 'IxJjY5T9yag' }),
				song('For The Night', { by: 'Pop Smoke', id: 'rm6ypCrKFQ8' }),
				song('Not Like Us', { by: 'Kendrick Lamar', id: 'phLb_SoPBlA' }),
				song('CARNIVAL', { by: '¥$', id: '2VPAdf9dkmQ' }),
				song('Just Wanna Rock', { by: 'Lil Uzi Vert', id: 'LakQ1OvhOQ4' })
			]
		}),

		block('Bouřka', {
			id: 'bourka',
			palette: 'indigo',
			songs: [
				song('Bbejbb', { by: 'Separ', id: 'eqYbxfBqGqg' }),
				song('WTF', { by: 'Yzomandias', id: 'UH0HlkPfd2U' }),
				song('Až na měsíc', { by: 'Viktor Sheen', id: 'I-HWMiOM8uE' }),
				song('Habibi', { by: 'STEIN27', id: 'tWEaUKCQ8Fg' }),
				song('Cígo a káva', { by: 'Viktor Sheen', id: 'rgN9j5WQVdc' }),
				song('Hannah Montana', { by: 'Calin', id: 'rtRf-iukdvc' }),
				song('Princezna', { by: 'EARTH', id: 'oMjF7HyD_K4' }),
				song('Párno Nýdrle', { by: 'VOJIR', id: 'NDvtXeAVjOM' }),
				song('ASSETTO CLUB', { by: 'ASSETTO DRIFTER', id: 'DhM_tQAKqB0' }),
				song('Safír', { by: 'Calin', id: 'nTzU8TjvxyE' }),
				song('ČIMICE RIDER', { by: 'VOJIR', id: 'j7fLRm-w2cU' })
			]
		}),

		pause('Eye of the Storm', {
			look: look({ bed: eyeOfStorm, palette: 'deep sea', floor: 0.15 }),
			enter: { sting: blackout('2.5s') },
			length: '3m',
			music: [
				song('Pink + White', { by: 'Frank Ocean', id: '9cHbvRUALrc' }),
				song('Kerala', { by: 'Bonobo', id: 'sbygyYTKzVE' })
			]
		}),

		block('Tropical Front', {
			palette: 'jade',
			between: { crossfade: 4 },
			songs: [
				song('Raindance', { by: 'Dave', id: 'SOJpE1KMUbo' }),
				song('Water', { by: 'Tyla', id: 'xynO0CdiE6Q' }),
				song('Tití Me Preguntó', { by: 'Bad Bunny', id: 'juRFjpB5Ppg' }),
				song('Mwaki', { by: 'Zerb', id: 'wr62oNJORAI' }),
				song('Nostalgia', { by: 'Sammy Virji', id: 'tkFceKEWnqg' }),
				song('B.O.T.A. (Baddest Of Them All)', { by: 'Eliza Rose', id: 'a0nPjZkxCzQ' }),
				song('Pepas', { by: 'Farruko', id: 'gNBkFme2BPE' })
			]
		}),

		narration('Return Stroke', {
			audio: './light-before-thunder/return-stroke.m4a',
			palette: returnStroke,
			bpm: BPM,
			enter: { light: 'cut' },
			end: 'hold',
			timeline: [
				{ at: 0, section: 'breakdown', look: look({ bed: { effect: thunderhead, params: RETURN_STROKE }, floor: 0 }) },
				{ at: RETURN_STROKE.ignite, section: 'build' },
				{ at: RETURN_STROKE.gather, section: 'void' },
				{ at: RETURN_STROKE.strike, section: 'drop' },
				{ at: RETURN_STROKE.strike + 2 * RETURN_STROKE.stroke + 0.15, section: 'outro' },
				...stormKicks(RETURN_STROKE)
			]
		}),

		block('Squall Line', {
			palette: 'siren',
			enter: { light: 2 },
			between: { crossfade: 3 },
			songs: [
				song('Back In Black', {
					by: 'AC/DC',
					id: '9vWNauaZAgg',
					overlays: [{ from: 'start', to: { bar: 2 }, look: look({ bed: countIn, intensity: 1, floor: 0 }), end: 'slam' }]
				}),
				song('Vandr', { by: 'Skippy McDippy', id: 'cOpRvLUSMiQ' }),
				song('Kernkraft 400', { by: 'Zombie Nation', id: '48apI4bpnSo' }),
				song('Windows98', { by: 'frutiger dillon', id: 'QjwdsQBhWCo' }),
				song("I Don't Even Like You", { by: 'LUM!X', id: 'FuoNzefYXUQ' }),
				song('Vois sur ton chemin (Techno Mix)', { by: 'BENNETT', id: 'i9Jr50r8L7o' }),
				song('Hands Up', { by: 'Sara Landry', id: 'j8VRLPa1za4' }),
				song('MHITR (Semi Automatic)', { by: 'Hedex', id: 'mbWOIqlrqFU' }),
				song('Bangarang', { by: 'Skrillex', id: 'V7hbIzqxhaE' })
			]
		}),

		pause('Low Pressure', {
			look: look({ bed: { effect: staticAir, params: { listen: 1 } }, palette: 'sodium night', floor: 0.12 }),
			enter: { light: 3 },
			length: '3m',
			music: [
				song('Nightcall', { by: 'Kavinsky', id: 'LfgNorryffc' }),
				song('Awake', { by: 'Tycho', id: 'dm4tkSNKfFI' })
			]
		}),

		narration('Clearing', {
			audio: './light-before-thunder/open-sky.m4a',
			palette: 'gold room',
			enter: { light: 2 },
			timeline: [
				{ at: 0, section: 'breakdown', look: look({ bed: openSky, floor: 0 }) },
				{ at: OPEN_SKY.bloom, section: 'build', kick: true },
				{ at: OPEN_SKY.glitter, section: 'drop', kick: true }
			]
		}),

		block('Open Sky', {
			palette: 'gold room',
			enter: { light: 'cut', hit: 'bump' },
			songs: [
				fill({
					length: '25m',
					from: 'requests-then-library',
					order: 'steady',
					where: {
						families: ['house', 'edm', 'disco', 'pop', 'hiphop', 'latin', 'trance'],
						heat: [3, 4.4],
						minutes: [1.5, 5.5],
						exclude: notTonight
					}
				})
			]
		}),

		block('Last Light', {
			palette: 'rosewood',
			enter: { sting: riser('4s', 'rosewood'), hit: 'bump' },
			between: { crossfade: 5 },
			songs: [
				song('One More Time', { by: 'Daft Punk', id: 'wU26xVT_vBU' }),
				song('Levels', { by: 'Avicii', id: 'xAgv1mAyxr8' }),
				song("Don't You Worry Child", { by: 'Swedish House Mafia', id: 'vRqbSgp8w38' }),
				song('Miracle', { by: 'Calvin Harris', id: '5zC9gkugb0o' }),
				song('Take Me (To The Moon)', { by: 'Ian Asher', id: 'u0fhiNS_nZc' }),
				song('Napořád', { by: 'EARTH', id: 'RSBflEHEz-Y' }),
				song('dřív bylo líp', { by: 'Yzomandias', id: 'w4M13JKPE2Y' })
			]
		}),

		pause('Petrichor', {
			look: look({ bed: wetStreet, palette: petrichor, floor: 0.12 }),
			enter: { light: 5 },
			length: '3m',
			music: [
				song('BIRDS OF A FEATHER', { by: 'Billie Eilish', id: 'WKZO-CWeOVA' }),
				song('Space Song', { by: 'Beach House', id: 'uSDWUx7S8dw' })
			]
		}),

		narration('Homecoming', {
			audio: './light-before-thunder/homecoming.m4a',
			palette: petrichor,
			bpm: 60,
			enter: { light: 4 },
			// The ember carries straight on into Goodnight.
			end: 'hold',
			timeline: [
				{ at: 0, section: 'outro', look: look({ bed: homecoming, floor: 0 }) },
				// The Bounce Lamp turns from rain to ember as the spark comes home.
				{ at: HOMECOMING.home, palette: embers, fade: 6 },
				...restingLubs(HOMECOMING).map((at, k) => ({ at, kick: 0.9 * Math.pow(0.97, k) }))
			]
		}),

		hold('Goodnight', {
			look: look({ bed: { effect: homecoming, params: { from: HOMECOMING.end } }, palette: embers, intensity: 1, floor: 0 }),
			enter: { light: 3 },
			note: 'The spark is home. End the evening when the room is empty.'
		})
	]
});
