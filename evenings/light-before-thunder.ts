/**
 * Light Before Thunder. Light travels faster than sound: the night is one storm passing over
 * the room. A spark is born in the south-west corner above the Bounce Lamp at Go, returns as a
 * red reprise at eleven, and comes home to the same corner at the end.
 *
 * Ring pixels run 0-599 from the north-west corner (north 0-179 west to east, east 180-299,
 * south 300-479 east to west, west 480-599 south to north); the beam runs 600-719 from south to
 * north. Every effect is a function of time and the music, so the preview and the fixture draw
 * the same frames. Output gamma is 2.45: an effect level of 0.3 is a glow, 0.7 is bright.
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
 * the ring, two sparks fill the beam, and the storm strikes.
 */
const thunderhead = effect({
	id: 'thunderhead',
	name: 'Thunderhead',
	role: 'bed',
	blurb: 'Power cut, heartbeat, a storm counting down, two sparks charging the beam, three strokes.',
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
			for (let q = 0; q < tail + 3; q++) {
				const i = wrap(Math.round(at) - dir * q);
				if (q < 3) addSample(out, i, palette, SLOT.white, level);
				else {
					const k = (q - 3) / tail;
					addSample(out, i, palette, lerp(SLOT.glow, SLOT.deep, k), level * 0.9 * Math.pow(1 - k, 1.5));
				}
			}
		};

		// A spark is born: a white front races out of the corner along both walls.
		const burst = (out: Float32Array, palette: Float32Array, age: number, size: number) => {
			if (age < 0 || age > 0.6) return;
			const level = hit(age, 0.16) * size;
			const reach = Math.min(170, 20 + 2400 * age);
			for (let d = -Math.ceil(reach); d <= reach; d++) {
				const x = Math.abs(d);
				const front = reach < 170 && reach - x < 12 ? 1 - (reach - x) / 12 : 0;
				const white = Math.max(x < 14 ? 1 : 0, front, 0.35 * (1 - x / 171));
				addSample(out, wrap(home + d), palette, SLOT.white, level * white);
				addSample(out, wrap(home + d), palette, SLOT.glow, 0.7 * level * (1 - x / 171));
			}
		};

		const patch = (out: Float32Array, palette: Float32Array, at: number, width: number, level: number, rough: boolean) => {
			for (let d = -width; d <= width; d++) {
				const i = wrap(at + d);
				const shape = Math.pow(1 - Math.abs(d) / (width + 1), 1.4) * (rough ? grain[i] : 1);
				addSample(out, i, palette, SLOT.white, level * shape);
				addSample(out, i, palette, SLOT.glow, 0.35 * level * shape);
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

		return {
			render(out, { f, p, palette }) {
				const t = f.t;
				out.fill(0);

				// Go: the room's light drains along the frame into the south-west corner and dies there.
				if (t < p.heart) {
					const reach = (ring / 2) * Math.exp(-t / p.drain);
					const dim = 1 - smoothstep(0.8, p.heart - 0.4, t);
					const surge = t < 0.15 ? 1 - t / 0.15 : 0;
					for (let i = 0; i < g.count; i++) {
						const gap = reach - (i < ring ? apart(i, home) : home - south + (i - beamStart) + 1);
						if (gap < 0) continue;
						setSample(out, i, palette, lerp(SLOT.base, SLOT.glow, 0.4), (0.42 + 0.3 * surge) * dim);
						if (gap < 10) addSample(out, i, palette, SLOT.white, 0.85 * (1 - gap / 10) * dim);
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
					const beat = (0.85 + 0.15 * rise) * (hit(since, 0.2) + 0.6 * hit(dub, 0.15));
					const spread = 2 * Math.pow(12 + 10 * rise, 2);
					// The ember keeps a tenth of the frame lit, which the Bounce Lamp needs to take each lub's kick.
					for (let d = -60; d <= 60; d++) {
						const i = wrap(home + d);
						const glow = 0.28 * fadeIn * Math.exp(-(d * d) / 450) + beat * Math.exp(-(d * d) / spread);
						setSample(out, i, palette, SLOT.accent, glow * fade);
						if (d > -6 && d < 6 && beat > 0.4) {
							addSample(out, i, palette, SLOT.white, (beat - 0.4) * (1 - Math.abs(d) / 6) * fade);
						}
					}
					if (t >= p.race && t < p.ignite) {
						const speed = 420 + 300 * rise;
						const up = since * speed;
						if (up < 200) spark(out, palette, home + up, 1, (0.55 + 0.45 * rise) * (1 - up / 200), 30);
						const along = dub * speed;
						if (dub >= 0 && along < 150) {
							spark(out, palette, home - along, -1, (0.45 + 0.4 * rise) * (1 - along / 150), 24);
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

					if (t < p.gather) {
						if (t < twin) {
							for (let i = 0; i < ring; i++) {
								const from = wrap(i - home);
								const passes = run >= from ? Math.floor((run - from) / ring) + 1 : 0;
								if (passes > 0) setSample(out, i, palette, SLOT.base, Math.min(0.27, 0.035 * passes));
							}
						} else {
							const shimmer = clamp((t - p.full) / (p.gather - p.full));
							const level = lerp(0.27, 0.42, clamp((t - twin) / (p.full - twin))) + 0.12 * shimmer;
							for (let i = 0; i < ring; i++) {
								const n = shimmer > 0 ? noise3(i * 0.07, t * (3 + 4 * shimmer), 0.5) - 0.5 : 0;
								const tone = lerp(SLOT.base, SLOT.glow, shimmer * (0.5 + n));
								setSample(out, i, palette, tone, level * (1 + 1.4 * shimmer * n));
							}
						}
						for (let d = -6; d <= 6; d++) {
							addSample(out, wrap(home + d), palette, SLOT.accent, 0.3 * (1 - Math.abs(d) / 7));
						}
					}

					burst(out, palette, t - p.ignite, 1);
					burst(out, palette, t - twin, 0.7);
					const level = (t < p.full ? 1 : 1.1) * (1 - clamp((t - p.gather) / 0.15));
					const tail = t < p.full ? 40 : 64;
					spark(out, palette, home + run, 1, level, tail);
					if (t >= twin) spark(out, palette, home - (run - joined), -1, level, tail);

					if (t < twin) {
						// The beam crackles as the lone spark passes its ends: 210 px out, then every 300.
						const n = Math.floor((run - 210) / 300);
						const lapNow = p.lapFrom * Math.exp((210 + 300 * n) / scale / k);
						const age = t - (p.ignite + ((lapNow - p.lapFrom) * span) / (p.lap - p.lapFrom));
						for (let j = 0; n >= 0 && j < 5 && age < 0.1; j++) {
							const b = Math.floor(hash01(n * 7 + j * 13) * beamCount);
							setSample(out, beamStart + b, palette, SLOT.white, 0.85 * (1 - age / 0.1));
						}
					} else if (t >= p.collide && t < p.gather) {
						const interval = p.lap / 2;
						const m0 = Math.round((p.full - p.collide) / interval);
						const m =
							t < p.full ? Math.floor((t - p.collide) / interval) : m0 + Math.floor((t - p.full) / (interval / 2));
						const age = t - (t < p.full ? p.collide + m * interval : p.full + ((m - m0) * interval) / 2);
						const node = Math.exp(-age / 0.12);
						const end = m % 2 === 0 ? south : north;
						for (let d = -20; d <= 20; d++) {
							addSample(out, wrap(end + d), palette, SLOT.white, node * Math.pow(1 - Math.abs(d) / 21, 2));
						}

						// Each collision pumps a step of charge into the beam from its end.
						const steps = m0 / 2;
						const grow = clamp(age / 0.12);
						const southSteps = Math.floor(m / 2) + (m % 2 === 0 ? grow : 1);
						const northSteps = Math.floor((m + 1) / 2) - (m % 2 === 1 ? 1 - grow : 0);
						const fromSouth = (Math.min(steps, southSteps) / steps) * half;
						const fromNorth = (Math.min(steps, northSteps) / steps) * half;
						const burn = t < p.full ? 0 : 0.2 * clamp((t - p.full) / (p.gather - p.full));
						for (let b = 0; b < beamCount; b++) {
							const southDepth = fromSouth - b;
							const northDepth = fromNorth - (beamCount - 1 - b);
							if (southDepth <= 0 && northDepth <= 0) continue;
							const southGrowing = southDepth > 0 && southDepth < 1.5 && fromSouth < half;
							const northGrowing = northDepth > 0 && northDepth < 1.5 && fromNorth < half;
							setSample(out, beamStart + b, palette, SLOT.glow, southGrowing || northGrowing ? 0.95 : 0.62 + burn);
						}
						const rate = (t < p.full ? 4 : 8) / p.lap;
						const slot = Math.floor(t * rate);
						const glint = Math.exp(-(t - slot / rate) / 0.06);
						const count = 1 + Math.floor(hash01(slot * 3 + 1) * 3) + (t < p.full ? 0 : 1);
						for (let j = 0; j < count; j++) {
							const b = Math.floor(hash01(slot * 11 + j * 5 + 2) * beamCount);
							if (b < fromSouth || beamCount - 1 - b < fromNorth) {
								addSample(out, beamStart + b, palette, SLOT.white, 0.9 * glint);
							}
						}
					}
				}

				// The storm, from the far corner to overhead. Its thunder follows in the soundtrack.
				const flash1 = flicker(t - p.flash1, 0);
				if (flash1 > 0) patch(out, palette, far, 45, 0.5 * flash1, false);
				const flash2 = flicker(t - p.flash2, 1);
				if (flash2 > 0) patch(out, palette, Math.round((far + north) / 2), 65, 0.7 * flash2, true);
				const flash3 = flicker(t - p.flash3, 2);
				if (flash3 > 0) {
					patch(out, palette, north, 35, 0.9 * flash3, true);
					for (let b = Math.ceil(half); b < beamCount; b++) {
						const level = 0.9 * flash3 * grain[beamStart + b] * ((b - half) / half);
						addSample(out, beamStart + b, palette, SLOT.white, level);
					}
				}
				const flash4 = flicker(t - p.flash4, 3);
				if (flash4 > 0) {
					patch(out, palette, north, 45, flash4, true);
					patch(out, palette, south, 45, flash4, true);
					for (let b = 0; b < beamCount; b++) {
						addSample(out, beamStart + b, palette, SLOT.white, flash4 * grain[beamStart + b]);
					}
				}

				// The charge gathers into the beam, the beam into its centre, and the centre beats three times.
				if (t >= p.gather && t < p.strike) {
					if (t < p.contract) {
						const u = (t - p.gather) / (p.contract - p.gather);
						for (let i = 0; i < ring; i++) {
							const fromEnds = Math.min(apart(i, north), apart(i, south));
							if (fromEnds < (ring / 4) * (1 - u)) setSample(out, i, palette, SLOT.base, 0.42 + 0.2 * u);
						}
						const tone = lerp(SLOT.glow, SLOT.white, u);
						for (let b = 0; b < beamCount; b++) setSample(out, beamStart + b, palette, tone, 0.65 + 0.25 * u);
					} else if (t < p.point) {
						const reach = lerp(half, 3, smoothstep(p.contract, p.point, t));
						for (let b = 0; b < beamCount; b++) {
							if (Math.abs(b - centre) < reach) setSample(out, beamStart + b, palette, SLOT.white, 0.9);
						}
					} else if (t < p.point + 2 * p.pulse + 0.1) {
						const age = (t - p.point) % p.pulse;
						// A faint halo on the whole beam gives the lamp enough lit pixels to take each beat's kick.
						const halo = 0.12 * Math.exp(-age / 0.1);
						for (let b = 0; b < beamCount; b++) {
							const level = Math.abs(b - centre) < 3 ? (age < 0.07 ? 1 : 0.25) : halo;
							setSample(out, beamStart + b, palette, SLOT.white, level);
						}
					}
				}

				// Three strokes, the branches' golden afterimage, then storm cloud rolling with the thunder.
				if (t >= p.strike) {
					const u = t - p.strike;
					const last = 2 * p.stroke;
					if (u < 0.09) {
						for (let b = 0; b < beamCount; b++) setSample(out, beamStart + b, palette, SLOT.white, 1);
						for (let i = 0; i < ring; i++) if (branch[i] > 0) setSample(out, i, palette, SLOT.white, 1);
					} else if (u >= p.stroke && u < p.stroke + 0.07) {
						for (let i = 0; i < ring; i++) setSample(out, i, palette, SLOT.white, branch[i] > 0 ? 0.8 : 0.5);
					} else if (u >= last && u < last + 0.15) {
						for (let i = 0; i < g.count; i++) setSample(out, i, palette, SLOT.white, 1);
					} else if (u >= last + 0.15) {
						const after = u - last - 0.15;
						const roll = smoothstep(0.3, 0.9, f.level) * smoothstep(0, 0.95, after);
						for (let i = 0; i < ring; i++) {
							const cloud = smoothstep(0.35, 0.7, noise3(i * 0.025, t * 0.35, 7.3));
							if (cloud > 0) setSample(out, i, palette, SLOT.base, 0.5 * roll * cloud);
							if (branch[i] > 0 && after < 2.15) addSample(out, i, palette, SLOT.accent, Math.exp(-after / 0.45));
						}
						const ember = 0.6 * smoothstep(0.25, 1.55, after) * (0.7 + 0.3 * roll);
						for (let d = -14; d <= 14; d++) {
							addSample(out, wrap(home + d), palette, SLOT.accent, ember * (1 - Math.abs(d) / 15));
						}
					}
				}
			}
		};
	}
});

/** Thunder's intro: rolling lobes on the low end, kicks rolling out of the beam, a fill into the drop. */
const thunderRoll = effect({
	id: 'thunderRoll',
	name: 'Thunder roll',
	role: 'bed',
	blurb: 'Low-end lobes roll around the ring; kicks roll out from the beam; the beam fills into the drop.',
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
				const bed = 0.2 + 0.25 * clamp(low.update(f.bands[0], f.dt) * 1.4);
				for (let i = 0; i < ring; i++) {
					const u = i / ring;
					let lobe = 0;
					for (const offset of [0, 0.5]) {
						let d = u - (turn + offset);
						d -= Math.round(d);
						lobe = Math.max(lobe, Math.exp(-(d * d) / 0.0035));
					}
					setSample(out, i, palette, lerp(SLOT.base, SLOT.glow, lobe), bed + 0.45 * lobe);
				}
				const age = (t - kickAt) / f.beatPeriod;
				const fill = clamp(late / 4);
				for (let b = 0; b < beamCount; b++) {
					const fromCentre = Math.abs(b - (beamCount - 1) / 2) / (beamCount / 2);
					let level = 0;
					if (age < 1) level = Math.max(0, 1 - Math.abs(fromCentre - age) * 5) * (1 - age * 0.6);
					if (1 - fromCentre < fill) level = Math.max(level, 0.8);
					if (level > 0) setSample(out, beamStart + b, palette, level > 0.5 ? lerp(SLOT.glow, SLOT.white, (level - 0.5) * 2) : SLOT.base, level);
				}
				if (t - snareAt < 0.15) {
					const corner = Math.floor(hash01(snares * 7 + 3) * 4) * (ring / 4);
					const level = 1 - (t - snareAt) / 0.15;
					for (let d = -10; d < 10; d++) addSample(out, (corner + d + ring) % ring, palette, SLOT.accent, level);
				}
			}
		};
	}
});

// ---- The supercell ----------------------------------------------------------------------------

/** Three seconds of dark after "Turn The Lights Off", and two lime glints in the corner. */
const lightsOff = effect({
	id: 'lightsOff',
	name: 'Lights off',
	role: 'bed',
	blurb: 'Dark, then the storm’s first glints in the south-west corner.',
	create(g) {
		let ring = 0;
		for (const s of g.strips) if (s.inPerimeter) ring += s.count;
		const home = Math.round(ring * 0.8);
		return {
			render(out, { f, palette }) {
				out.fill(0);
				const t = f.t;
				let level = 0;
				let reach = 0;
				if (t >= 2.45 && t < 2.53) {
					level = 1;
					reach = 5;
				} else if (t >= 2.63 && t < 2.7) {
					level = 0.7;
					reach = 3;
				}
				for (let d = -reach; d <= reach && level > 0; d++) {
					setSample(out, (home + d + ring) % ring, palette, SLOT.accent, level);
					addSample(out, (home + d + ring) % ring, palette, SLOT.white, level * 0.4);
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
					const level = smoothstep(p.form, p.form + 0.6, t) * (1 + 0.45 * pulse);
					for (let i = 0; i < ring; i++) {
						const a = (i / ring - turn) * Math.PI * 2;
						const n = noise3(Math.cos(a) * 1.6, Math.sin(a) * 1.6, t * 0.35);
						setSample(out, i, palette, SLOT.base, level * (0.2 + 0.8 * n * n));
						const seam = clamp(1 - Math.abs(n - 0.64) / 0.05);
						if (seam > 0) addSample(out, i, palette, SLOT.accent, level * 0.9 * seam);
					}
					if (t >= p.funnel) {
						const half = Math.round(lerp(2, 30, smoothstep(p.funnel, p.eye, t)));
						for (let d = -half; d < half; d++) {
							setSample(out, beamStart + centre + d, palette, SLOT.accent, (0.55 + 0.35 * pulse) * (1 - Math.abs(d) / (half + 1)));
						}
					}
					return;
				}
				const age = t - p.crack;
				if (age < 0.12) {
					for (let i = 0; i < g.count; i++) {
						setSample(out, i, palette, SLOT.accent, 1);
						addSample(out, i, palette, SLOT.white, 0.6);
					}
					return;
				}
				// The flash's afterimage on the beam, and the cloud lit from inside while the thunder rolls.
				const flash = Math.exp(-(age - 0.12) / 0.25);
				const roll = Math.exp(-(age - 0.12) / 1.2);
				for (let b = 0; b < beamCount; b++) setSample(out, beamStart + b, palette, SLOT.accent, 0.8 * flash + 0.5 * roll);
				for (let i = 0; i < ring; i++) {
					const n = noise3(i * 0.04, t * 5, 9.1);
					setSample(out, i, palette, SLOT.base, roll * (0.3 + 0.6 * n * n));
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
					if (arm > 0) setSample(out, i, palette, arm > 0.6 ? SLOT.white : SLOT.glow, 0.95 * arm);
					if (tail > 0) addSample(out, i, palette, SLOT.base, 0.5 * tail * tail);
				}
				const age = (t - kickAt) / f.beatPeriod;
				for (let b = 0; b < beamCount; b++) {
					const fromCentre = Math.abs(b - (beamCount - 1) / 2) / (beamCount / 2);
					const shot = age < 1 ? Math.max(0, 1 - Math.abs(fromCentre - age) * 6) : 0;
					if (lastBar) setSample(out, beamStart + b, palette, SLOT.accent, Math.max(collapse, shot));
					else if (shot > 0) setSample(out, beamStart + b, palette, shot > 0.5 ? SLOT.white : SLOT.accent, shot);
				}
				for (let j = 0; j < 9; j++) {
					const hailAge = t - hailAt[j];
					if (hailAge < 0 || hailAge > 0.4) continue;
					const v = Math.exp(-hailAge / 0.12);
					addSample(out, hailPos[j], palette, SLOT.white, v);
					addSample(out, (hailPos[j] + 1) % ring, palette, SLOT.white, v);
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
			const v = 0.9 * Math.exp(-age / 0.12);
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
				const gain = listening ? 0.75 + 0.5 * clamp(heard.update(f.level, f.dt) * 1.3) : 1;
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
					setSample(out, i, palette, lerp(SLOT.base, SLOT.glow, cloud), (0.28 + 0.4 * cloud) * gain * (1 - 0.8 * pool));
					if (pool > 0) addSample(out, i, palette, SLOT.accent, 0.55 * gain * pool);
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
					const level = 0.8 * (Math.exp(-age / 0.07) + (age > 0.22 ? 0.7 * Math.exp(-(age - 0.22) / 0.07) : 0));
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
				const gain = 0.85 + 0.3 * clamp(heard.update(f.level, f.dt));
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
					setSample(out, i, palette, lerp(SLOT.base, SLOT.glow, cloud), (0.35 + 0.4 * cloud) * gain);
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
				const level = 0.9 * env;
				if (hash01(j * 29 + 4) < 0.3) {
					for (let b = 0; b < beamCount; b++) {
						addSample(out, beamStart + b, palette, SLOT.accent, level);
						addSample(out, beamStart + b, palette, SLOT.white, level * 0.35);
					}
				} else {
					const centre = Math.floor(hash01(j * 31 + 6) * ring);
					const half = 30 + Math.floor(hash01(j * 37 + 8) * 30);
					for (let d = -half; d <= half; d++) {
						const i = (centre + d + ring) % ring;
						const v = level * (1 - Math.abs(d) / (half + 1));
						addSample(out, i, palette, SLOT.accent, v);
						addSample(out, i, palette, SLOT.white, v * 0.35);
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
				const gain = 0.85 + 0.3 * clamp(heard.update(f.level, f.dt));
				const sun = (Math.round(ring * 0.15) + (t / 240) * ring) % ring;
				for (let i = 0; i < g.count; i++) {
					const u = i < ring ? i / ring : 0.15 + ((i - ring) / (g.count - ring)) * 0.5;
					const net = Math.abs(Math.sin(u * Math.PI * 14 + t * 0.25) * Math.sin(u * Math.PI * 9 - t * 0.18));
					setSample(out, i, palette, lerp(SLOT.glow, SLOT.base, net), (0.42 + 0.35 * net) * gain);
					if (i < ring) {
						let d = Math.abs(i - sun);
						if (d > ring / 2) d = ring - d;
						if (d < 90) addSample(out, i, palette, SLOT.accent, 0.7 * gain * Math.exp(-(d * d) / 1000));
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
				const gain = 0.9 + 0.2 * clamp(heard.update(f.level, f.dt));
				for (let i = 0; i < g.count; i++) {
					const u = i < ring ? i / ring : 0.15 + ((i - ring) / beamCount) * 0.5;
					const fringe = 0.5 + 0.5 * Math.sin((u - t / 120) * Math.PI * 10 + Math.sin(u * 7 + t * 0.05) * 2);
					setSample(out, i, palette, SLOT.base, (0.28 + 0.3 * fringe) * gain);
					addSample(out, i, palette, SLOT.third, 0.25 * fringe * fringe * gain);
				}
				const j = Math.floor(t / 7.5);
				const age = t - (j * 7.5 + hash01(j * 11 + 3) * 2.5);
				if (age >= 0 && age < 1.2) {
					const at = Math.floor(hash01(j * 17 + 5) * (beamCount - 24)) + Math.floor((age / 1.2) * 20);
					const v = 0.9 * (1 - age / 1.2);
					addSample(out, beamStart + at, palette, SLOT.accent, v);
					addSample(out, beamStart + at, palette, SLOT.white, v * 0.3);
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
					for (let q = -3; q < 3; q++) {
						if (at + q >= 0 && at + q < beamCount) setSample(out, beamStart + at + q, palette, SLOT.white, all ? 1 : 0.8);
					}
				}
				const flash = t - hitAt;
				if (flash >= 0 && flash < 0.25) {
					for (let d = -24; d <= 24; d++) setSample(out, (home + d + ring) % ring, palette, SLOT.base, (1 - flash / 0.25) * (1 - Math.abs(d) / 25));
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
				const mist = 0.32 * smoothstep(0, 0.8, t) * (1 - smoothstep(p.bloom, p.glitter, t));
				if (mist > 0.002) {
					for (let i = 0; i < g.count; i++) {
						const n = noise3(i * 0.02, t * 0.15, 3.3);
						setSample(out, i, palette, lerp(SLOT.accent, SLOT.white, 0.15 * n), mist * (0.45 + 0.55 * n));
					}
				}
				const rain = 1 - smoothstep(0.5, p.dry, t);
				if (rain > 0) {
					const now = Math.floor(t * 40);
					for (let s = now - 6; s <= now; s++) {
						const v = 0.45 * Math.exp(-(t - s / 40) / 0.045);
						for (let j = 0; j < 2; j++) {
							if (hash01(s * 29 + j * 11 + 5) > rain * 0.8) continue;
							addSample(out, Math.floor(hash01(s * 17 + j * 13 + 1) * g.count), palette, SLOT.white, v);
						}
					}
				}
				const flash = hit(t - p.flash, 0.08) + 0.6 * hit(t - p.flash - 0.2, 0.08);
				if (flash > 0.003) {
					for (let d = -40; d <= 40; d++) addSample(out, wrap(far + d), palette, SLOT.white, 0.4 * flash * (1 - Math.abs(d) / 41));
				}

				// Gold warms the beam's centre as the chord swells in, fills the beam from there, then
				// spills from the beam ends round the ring.
				const settle = 1 - 0.25 * smoothstep(p.settle, p.end, t);
				const dawn = smoothstep(p.dry - 0.5, p.bloom, t);
				if (dawn > 0 && t < p.spill) {
					for (let b = 0; b < beamCount; b++) {
						const x = Math.abs(b - (beamCount - 1) / 2) / half;
						addSample(out, beamStart + b, palette, SLOT.base, 0.35 * dawn * Math.exp(-(x * x) / 0.08));
					}
				}
				if (t >= p.bloom) {
					const reach = 4 + smoothstep(p.bloom, p.spill, t) * (half - 4);
					for (let b = 0; b < beamCount; b++) {
						const fromCentre = Math.abs(b - (beamCount - 1) / 2);
						if (fromCentre <= reach) setSample(out, beamStart + b, palette, SLOT.base, 0.85 * settle);
					}
				}
				if (t >= p.spill) {
					const reach = smoothstep(p.spill, p.glitter, t) * (ring / 4);
					for (let i = 0; i < ring; i++) {
						const d = Math.min(apart(i, north), apart(i, south));
						if (d > reach) continue;
						const front = t < p.glitter ? clamp(1 - (reach - d) / 30) : 0;
						setSample(out, i, palette, SLOT.base, (0.8 + 0.2 * front) * settle);
						if (front > 0) addSample(out, i, palette, SLOT.white, 0.6 * front);
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
							addSample(out, i, palette, SLOT.white, Math.exp(-age / 0.07));
						}
					}
				}
			}
		};
	}
});

/**
 * The end, scored by light-before-thunder/homecoming.m4a: rain on the frame easing off, the storm
 * rolling away, the heart slowing to rest and the spark's last lap home. The Goodnight hold plays
 * it from its end, where the ember rests.
 */
const homecoming = effect({
	id: 'homecoming',
	name: 'Homecoming',
	role: 'bed',
	blurb: 'Rain easing off, the storm rolling away, the heart slowing, the last spark lapping home to rest.',
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
				const shape = level * Math.pow(1 - Math.abs(d) / (width + 1), 1.4);
				addSample(out, wrap(at + d), palette, SLOT.accent, 0.6 * shape);
				addSample(out, wrap(at + d), palette, SLOT.white, 0.5 * shape);
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

				// The wet frame glows warm, fading as the rain stops; the spark takes the light round with it.
				const u = clamp((t - p.leave) / (p.home - p.leave));
				const run = ring * u * u * (3 - 2 * u);
				const warm = 0.36 * (1 - smoothstep(p.ease, p.home, t));
				if (warm > 0.002) {
					for (let i = 0; i < ring; i++) {
						if (t >= p.leave && wrap(i - home) < run) continue;
						const n = noise3(i * 0.03, t * 0.08, 1.7);
						setSample(out, i, palette, lerp(SLOT.base, SLOT.glow, n), warm * (0.55 + 0.45 * n));
					}
					const beam = warm * (1 - smoothstep(p.leave, p.leave + 10, t));
					for (let b = 0; b < beamCount; b++) {
						setSample(out, beamStart + b, palette, SLOT.base, beam * (0.55 + 0.45 * noise3(b * 0.05, t * 0.08, 5.3)));
					}
				}

				// Rain landing on the frame: specks that thin out as it eases.
				const rain = 1 - smoothstep(p.ease, p.dry, t);
				if (rain > 0) {
					const now = Math.floor(t * 40);
					for (let s = now - 6; s <= now; s++) {
						const v = 0.5 * Math.exp(-(t - s / 40) / 0.045);
						for (let j = 0; j < 2; j++) {
							if (hash01(s * 29 + j * 11 + 7) > rain * 0.9) continue;
							const i = Math.floor(hash01(s * 17 + j * 13 + 3) * g.count);
							addSample(out, i, palette, SLOT.accent, v);
							addSample(out, i, palette, SLOT.white, 0.4 * v);
						}
					}
				}

				// Drips once it eases, each with its sound: mirrors drips() in timing.ts.
				for (let s = Math.floor((t - 0.9) / 0.45); s <= Math.floor(t / 0.45); s++) {
					const at = s * 0.45 + 0.4 * hash01(s * 13 + 5);
					const age = t - at;
					if (s < Math.floor(p.ease / 0.45) || s * 0.45 >= p.end - 0.6 || age < 0 || age > 0.5) continue;
					const chance = 0.75 * smoothstep(p.ease, p.dry, at) * (1 - 0.7 * smoothstep(p.dry, p.end, at));
					if (hash01(s * 7 + 11) >= chance) continue;
					const i = Math.floor(hash01(s * 19 + 3) * g.count);
					const v = 0.8 * hit(age, 0.12);
					addSample(out, i, palette, SLOT.white, v);
					if (i + 1 < g.count) addSample(out, i + 1, palette, SLOT.accent, 0.5 * v);
				}

				// The storm rolling away: overhead first, then ever farther to the north-east.
				const flash1 = flicker(t - p.flash1, 0);
				if (flash1 > 0) {
					patch(out, palette, north, 30, 0.8 * flash1);
					for (let b = 0; b < beamCount; b++) addSample(out, beamStart + b, palette, SLOT.white, 0.7 * flash1 * (b / beamCount));
				}
				const flash2 = flicker(t - p.flash2, 1);
				if (flash2 > 0) patch(out, palette, Math.round((far + north) / 2), 55, 0.6 * flash2);
				const flash3 = flicker(t - p.flash3, 2);
				if (flash3 > 0) patch(out, palette, far, 45, 0.45 * flash3);
				const flash4 = flicker(t - p.flash4, 3);
				if (flash4 > 0) patch(out, palette, far, 30, 0.3 * flash4);

				// The last lap: a warm spark leaves home, and home is where it goes out.
				if (t >= p.leave && t < p.home + 0.8) {
					const level = 0.75 * smoothstep(p.leave, p.leave + 0.8, t) * (1 - smoothstep(p.home, p.home + 0.8, t));
					for (let q = 0; q < 33; q++) {
						const i = wrap(Math.round(home + run) - q);
						if (q < 3) addSample(out, i, palette, SLOT.white, level);
						else addSample(out, i, palette, lerp(SLOT.glow, SLOT.deep, (q - 3) / 30), level * Math.pow(1 - (q - 3) / 30, 1.5));
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
					for (let d = -64; d <= 64; d++) {
						const level = glow * (0.45 * Math.exp(-(d * d) / 100) + 0.05 * Math.exp(-(d * d) / 1500)) + 0.35 * pulse * Math.exp(-(d * d) / 200);
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
	timeline: [{ at: 0, section: 'void', look: look({ bed: lightsOff }) }]
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
			enter: { light: 'cut', hit: 'slam' },
			between: { crossfade: 4 },
			songs: [
				song('Thunder', {
					by: 'Gabry Ponte',
					id: 'b_bEigUA1kk',
					overlays: [{ from: 'start', to: 'first-drop', look: look({ bed: thunderRoll, intensity: 1, floor: 0 }) }]
				}),
				song('Desire', { by: 'Ian Asher', id: 'UARSiWU8eoo' }),
				song("I'm Good (Blue)", { by: 'David Guetta', id: 'pIb7QoXdP_k' }),
				song('Princezna', { by: 'EARTH', id: 'oMjF7HyD_K4' }),
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
			music: [
				song('Intro', { by: 'The xx', id: 'xMV6l2y67rk' }),
				song('After Dark', { by: 'Mr.Kitty', id: 'Cl5Vkd4N03Q' }),
				song('Sunset Lover', { by: 'Petit Biscuit', id: 'WrWcOLlmv7k' }),
				song('Resonance', { by: 'Home', id: 'exvt4dzmuaI' })
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
				song('Párno Nýdrle', { by: 'VOJIR', id: 'NDvtXeAVjOM' }),
				song('ASSETTO CLUB', { by: 'ASSETTO DRIFTER', id: 'DhM_tQAKqB0' }),
				song('Safír', { by: 'Calin', id: 'nTzU8TjvxyE' }),
				song('ČIMICE RIDER', { by: 'VOJIR', id: 'j7fLRm-w2cU' })
			]
		}),

		pause('Eye of the Storm', {
			look: look({ bed: eyeOfStorm, palette: 'deep sea', floor: 0.15 }),
			enter: { sting: blackout('2.5s') },
			music: [
				song('Pink + White', { by: 'Frank Ocean', id: '9cHbvRUALrc' }),
				song('Kerala', { by: 'Bonobo', id: 'sbygyYTKzVE' }),
				song('Say My Name', { by: 'ODESZA', id: 'JbLYOE5TEyo' })
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
			bpm: 60 / (RETURN_STROKE.lap / 2),
			enter: { light: 'cut' },
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
			enter: { light: 'cut' },
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
			music: [
				song('BIRDS OF A FEATHER', { by: 'Billie Eilish', id: 'WKZO-CWeOVA' }),
				song('Snooze', { by: 'SZA', id: 'ZqSlV5LmrTg' }),
				song('Apocalypse', { by: 'Cigarettes After Sex', id: 'DdI598gKkKw' }),
				song('Space Song', { by: 'Beach House', id: 'uSDWUx7S8dw' }),
				song('Xtal', { by: 'Aphex Twin', id: 'sWcLccMuCA8' })
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
