/**
 * Light Before Thunder. Light travels faster than sound: the night is one storm passing over
 * the room. A spark is born in the south-west corner above the Bounce Lamp at Go, returns as a
 * red reprise at eleven, and comes home to the same corner at the end.
 *
 * Ring pixels run 0-561 from the north-west corner (north 0-169 west to east, east 170-280,
 * south 281-450 east to west, west 451-561 south to north); the beam runs 562-670 from south to
 * north. Landmarks derive from the run lengths, so they hold wherever the frame was cut; a glow
 * or a travel stays written in pixels, which at 60 LED/m is the same metre of strip either way.
 * Every effect is a function of time and the music, so the preview and the fixture draw
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
	setSample,
	smoothstep,
	song,
	type ShowPalette
} from 'lightningstrike';
import {
	BLACK_ICE,
	BPM,
	CHARGE,
	HOMECOMING,
	LIGHTS_OUT,
	OPENING,
	OPEN_SKY,
	RETURN_STROKE,
	SUNDOWN,
	WALL_CLOUD,
	lapCorners,
	restingLubs,
	shootingStars,
	stormKicks,
	sundownRoll,
	twinTime
} from './light-before-thunder/timing.ts';

/**
 * Never chosen for the guests' hour: the rock and metal cuts, Mandrage, PÁRNO AMG, the other
 * Desire, two songs far quieter than the rest, and the songs dropped from the night, which the
 * fill would otherwise hand straight back. A guest who asks for one by name still gets it.
 */
const notTonight = [
	'NhsK5WExrnE', 'ikFFVfObwss', 'qfVLcUhqnGo', 'AxuTd9rwEHQ', 'VyV54YwPAkk', 'HAQQUDbuudY', 'Q_XJ-7jNqws',
	'MEb49Q9ZRGo', 'CHIWNDAwTqQ', 'ttNSr4Ecdzo', 'JxlnKVj2IWA', 'Lt8AfIeJOxw', '3triLkS0nq4', 'B2lmOei7qfk',
	'SaEnRRSKcs8', 'v2eZCfv56p4', 'tN6YYPs3g3c', 'VRDJJH6K5R8', 'jWsRtq61AqE',
	'DYf28lOb8KU', 'XAGXPAHwksA', '8VKD-IlvibI', 'nI6GP8wKJ6o', 'rjXMBZJo-VA', 'ryV2LN003YI', 'H4RELGc9su8',
	'xw2_W6UVj0s', 'hFG5ZPtnxsw', 'j8VRLPa1za4', 'mbWOIqlrqFU', 'xAgv1mAyxr8', 'UH0HlkPfd2U', 'tkFceKEWnqg',
	'sbygyYTKzVE', 'JbLYOE5TEyo', 'eqYbxfBqGqg', 'LakQ1OvhOQ4', 'TZCE6PfaUWA', 'gNBkFme2BPE', 'wr62oNJORAI',
	// Both uploads of High On Helium: their titles do not normalise to one song, so one id is not enough.
	'xynO0CdiE6Q', 'h3TBBH7GU9o', '6cCYZRGCb1o', 'w4M13JKPE2Y'
];

const firstStrike: ShowPalette = { name: 'first strike', base: 214, accent: 38, third: 200, sat: 0.93, shade: 0.12 };
const petrichor: ShowPalette = { name: 'petrichor', base: 18, accent: 196, third: 44, sat: 0.7, shade: 0.1 };
const returnStroke: ShowPalette = { name: 'return stroke', base: 350, accent: 200, third: 24, sat: 0.97, shade: 0.11 };
/**
 * The charge going red-hot once the spark has split, in the reprise's red with the corner's amber
 * kept. Palettes blend channel by channel, and on the rainbow ramp a blue keeps its light in blue
 * while a red keeps it in red, so a straight run between them crosses over at well under half the
 * delivered light and the climb to the strike sags in the middle. `whiteHot` is a desaturated
 * waypoint: it spreads the same light across all three channels, so the turn brightens the whole
 * way instead, which is also what an overloading charge should look like.
 */
const whiteHot: ShowPalette = { name: 'white hot', base: 300, accent: 38, third: 24, sat: 0.4, shade: 0.12 };
const overload: ShowPalette = { name: 'overload', base: 350, accent: 38, third: 24, sat: 0.95, shade: 0.12 };
/**
 * The reprise over its limit. The charge keeps the night's red on the base ramp; the two hues the
 * frame blinks between sit on `accent` and `third`, a green the rainbow ramp delivers at full
 * light and the violet a quarter turn from it.
 */
const overdrive: ShowPalette = { name: 'overdrive', base: 350, accent: 135, third: 280, sat: 0.98, shade: 0.12 };

/** The spark splits in two here; the charge is fully red by the time it drains into the beam. */
const split = twinTime(OPENING);
const halfRed = (split + OPENING.gather) / 2;
const beatsFrom = (from: number, to: number) => Math.round(((to - from) * BPM) / 60);
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
	// `ambient` scales only the washes the storm sits in, never a flash, the loader or a stroke.
	// `overdrive` blinks the frame between the palette's third and accent on the collision grid.
	params: { ...OPENING, ambient: 1, overdrive: 0 },
	create(g) {
		let ring = 0;
		for (const s of g.strips) if (s.inPerimeter) ring += s.count;
		const [alongRun, acrossRun] = [g.strips[0].count, g.strips[1].count];
		const beamStart = ring;
		const beamCount = g.count - ring;
		const half = beamCount / 2;
		const centre = (beamCount - 1) / 2;
		const home = 2 * alongRun + acrossRun;
		const north = Math.round(alongRun / 2);
		const south = alongRun + acrossRun + Math.round(alongRun / 2);
		const far = alongRun;
		const wrap = (i: number) => ((i % ring) + ring) % ring;
		const apart = (a: number, b: number) => {
			const d = wrap(a - b);
			return d > ring / 2 ? ring - d : d;
		};
		const hit = (age: number, tau: number) => (age < 0 ? 0 : age < 0.02 ? age / 0.02 : Math.exp(-(age - 0.02) / tau));

		/** From home round to the beam's north end; the ends then alternate every half ring. */
		const firstEnd = ring - home + north;

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
						// A six-pixel front, not sixteen: the front crawls, so a wide edge leaves a
						// standing band of pixels in the dither codes for seconds at a time.
						const edge = Math.sqrt(clamp((front - away) / 6)) * (i < ring ? 1 : beamSky);
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
						setSample(out, i, palette, lerp(SLOT.base, SLOT.glow, 0.45), (0.62 + 0.38 * surge) * dim * p.ambient);
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
					// The ember keeps a tenth of the frame lit, which the Bounce Lamp needs to take each
					// lub's kick. Its skirt sits on a pedestal and stops at 34 rather than trailing a
					// bare gaussian out to 72: same peak, same lit width, but the outer ring holds a
					// colour instead of sparkling in the dither codes for the whole passage.
					for (let d = -34; d <= 34; d++) {
						const i = wrap(home + d);
						const skirt = (0.46 + 0.14 * rise) * fadeIn * (0.66 + 0.34 * Math.exp(-(d * d) / 620));
						const glow = skirt + beat * Math.exp(-(d * d) / spread);
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
							// Under the overdrive the charge has to climb further than it otherwise would:
							// the blinks already sit at the ceiling, so the build has nowhere else to go.
							const from = p.overdrive > 0 ? 0.55 : 0.62;
							const to = p.overdrive > 0 ? 0.92 : 0.78;
							const level = lerp(from, to, clamp((t - twin) / (p.full - twin))) + 0.16 * shimmer;
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
						// The beam crackles as the lone spark passes its ends, then every half ring.
						const n = Math.floor((run - firstEnd) / (ring / 2));
						const lapNow = p.lapFrom * Math.exp((firstEnd + (ring / 2) * n) / scale / k);
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
				shudder(out, palette, far, t - p.thunder1, 5.5, 0.6 * p.ambient, beamSky);
				const flash2 = flicker(t - p.flash2, 1);
				if (flash2 > 0) patch(out, palette, Math.round((far + north) / 2), 70, 1.3 * flash2, true);
				shudder(out, palette, Math.round((far + north) / 2), t - p.thunder2, 5, 0.78 * p.ambient, beamSky);
				const flash3 = flicker(t - p.flash3, 2);
				if (flash3 > 0) {
					patch(out, palette, north, 40, 1.6 * flash3, true);
					for (let b = Math.ceil(half); b < beamCount; b++) {
						const level = 1.5 * flash3 * grain[beamStart + b] * ((b - half) / half);
						addSample(out, beamStart + b, palette, SLOT.white, level);
					}
				}
				shudder(out, palette, north, t - p.thunder3, 4.5, p.ambient, beamSky);
				const flash4 = flicker(t - p.flash4, 3);
				if (flash4 > 0) {
					patch(out, palette, north, 55, 1.85 * flash4, true);
					patch(out, palette, south, 55, 1.85 * flash4, true);
					for (let b = 0; b < beamCount; b++) {
						addSample(out, beamStart + b, palette, SLOT.white, 1.7 * flash4 * grain[beamStart + b]);
					}
				}
				shudder(out, palette, north, t - p.thunder4, 3.5, 1.25 * p.ambient, beamSky);

				// Overdrive: from the first collision the charge is more than the frame can hold, and
				// the room blinks between the palette's two answering hues on the half-lap grid the
				// score already hits. It escalates by what the eye can resolve rather than by rate:
				// every other collision, then every one, then the frame breaks into bands that swap
				// hue on each blink. The rate stops at 2.5 Hz because a full-field change this deep
				// is held to three flashes a second, and the blink is the whole frame every time.
				if (p.overdrive > 0 && t >= p.collide && t < p.gather) {
					const interval = p.lap / 2;
					const m = Math.floor((t - p.collide) / interval);
					const age = t - (p.collide + m * interval);
					const over = t >= p.full;
					// Half rate for the first eight collisions, so the room doubles once on the way up.
					// The hole belongs to the blink that follows it, never to a collision it skips.
					const blinkAt = (k: number) => k % 2 === 0 || k >= 8;
					// The violet half of the ramp carries less light than the green, so it is written
					// higher for the two blinks to land in the room as one brightness.
					const lit = p.overdrive * (over ? 1 : lerp(0.85, 1, clamp((t - p.collide) / (p.full - p.collide))));
					if (interval - age < 0.085 && blinkAt(m + 1)) {
						// The room drops out before each blink. The charge already fills the frame, so a
						// hue that only swaps reads as a wash; the hole makes it a flash. The output's
						// fall slew takes about 40 ms of this, which is why the gap is not shorter.
						out.fill(0);
					} else if (age < 0.075 && blinkAt(m)) {
						if (over) {
							for (let i = 0; i < ring; i++) {
								const violet = (Math.floor(i / 50) + m) % 2 === 1;
								setSample(out, i, palette, violet ? SLOT.third : SLOT.accent, lit * (violet ? 1.34 : 0.78));
							}
							for (let b = 0; b < beamCount; b++) {
								const violet = (Math.floor(b / 20) + m) % 2 === 0;
								setSample(out, beamStart + b, palette, violet ? SLOT.third : SLOT.accent, lit * (violet ? 1.34 : 0.78));
							}
						} else {
							const violet = m % 2 === 1;
							const level = lit * (violet ? 1.34 : 0.78);
							for (let i = 0; i < g.count; i++) setSample(out, i, palette, violet ? SLOT.third : SLOT.accent, level);
						}
					}
				}

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
						// The storm cloud the next overlay carries on from: same shape, same levels.
						const roll = 0.82 + 0.22 * smoothstep(0.25, 0.85, f.level);
						// The blast the strike throws: a white front leaving both beam ends for the far
						// walls with the sub the score drops under it, and the cloud lit where it passes.
						// A front rather than a fade, so no pixel lingers in the dither codes.
						const front = after * 265;
						const blast = 1 - smoothstep(0.5, 1, after);
						for (let i = 0; i < ring; i++) {
							const behind = front - Math.min(apart(i, north), apart(i, south));
							if (behind < 0) continue;
							const cloud = noise3(i * 0.022, t * 0.3, 7.3);
							setSample(out, i, palette, lerp(SLOT.base, SLOT.glow, 0.4 * cloud), roll * (0.5 + 0.45 * cloud * cloud));
							if (blast > 0 && behind < 28) addSample(out, i, palette, SLOT.white, 1.4 * blast * Math.pow(1 - behind / 28, 1.6));
							if (branch[i] > 0 && after < 2.4) addSample(out, i, palette, SLOT.accent, 1.1 * Math.exp(-after / 0.5));
						}
						for (let b = 0; b < beamCount; b++) {
							const cloud = noise3(b * 0.04, t * 0.22, 2.9);
							setSample(out, beamStart + b, palette, SLOT.base, roll * (0.4 + 0.3 * cloud));
							addSample(out, beamStart + b, palette, SLOT.white, 0.9 * (1 - smoothstep(0, 0.35, after)));
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
 * Over the first song's intro: the storm cloud First Strike left, turning into rolling lobes on
 * the low end, kicks rolling out of the beam and a fill into the drop.
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
		/** The two lobes, half a lap apart. Hoisted: a literal here would allocate per pixel per frame. */
		const lobes = [0, 0.5];
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
					for (const offset of lobes) {
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

/**
 * After "Turn The Lights Off", scored by light-before-thunder/lights-out.m4a: the breaker throws
 * and the room drains into the south-west corner, three glints gather there, the frame catches,
 * and the supercell's first hail comes through it.
 */
const lightsOff = effect({
	id: 'lightsOff',
	name: 'Lights out',
	role: 'bed',
	blurb: 'The power drains into the corner, three glints gather, the frame snaps and the hail starts.',
	params: LIGHTS_OUT,
	create(g) {
		let ring = 0;
		for (const s of g.strips) if (s.inPerimeter) ring += s.count;
		const [alongRun, acrossRun] = [g.strips[0].count, g.strips[1].count];
		const home = 2 * alongRun + acrossRun;
		const wrap = (i: number) => ((i % ring) + ring) % ring;
		const apart = (a: number, b: number) => {
			const d = wrap(a - b);
			return d > ring / 2 ? ring - d : d;
		};
		const glint = (out: Float32Array, palette: Float32Array, age: number, level: number, reach: number, life: number) => {
			if (age < 0 || age > life) return;
			const v = level * (1 - age / life);
			for (let d = -reach; d <= reach; d++) {
				addSample(out, wrap(home + d), palette, SLOT.accent, v);
				addSample(out, wrap(home + d), palette, SLOT.white, v * 0.5);
			}
		};
		return {
			render(out, { f, p, palette }) {
				const t = f.t;
				out.fill(0);

				// The breaker throws: what the room was holding drains into the corner and dies there.
				if (t < p.glint1) {
					// `reach` alone empties the frame. Dimming what is still inside it as well would drag
					// every one of those pixels down through the dither codes on the way out.
					const reach = (ring / 2 + 140) * Math.exp(-t / p.cut);
					for (let i = 0; i < g.count; i++) {
						const gap = reach - (i < ring ? apart(i, home) : 140 + (i - ring));
						if (gap < 0) continue;
						setSample(out, i, palette, lerp(SLOT.base, SLOT.glow, 0.45), 0.8);
						if (gap < 14) addSample(out, i, palette, SLOT.white, 1.1 * (1 - gap / 14));
					}
				}

				// Three glints closing up in the corner, each hotter and wider than the last.
				glint(out, palette, t - p.glint1, 1, 14, 0.16);
				glint(out, palette, t - p.glint2, 1.2, 26, 0.2);
				glint(out, palette, t - p.glint3, 1.45, 44, 0.26);

				// The frame catches: the whole room white, then the charge leaving the corner as a front.
				const snap = t - p.snap;
				if (snap >= 0 && snap < 0.07) {
					for (let i = 0; i < g.count; i++) setSample(out, i, palette, SLOT.white, 1.3);
				} else if (snap >= 0.07 && snap < 0.32) {
					const wave = (snap - 0.07) * 1500;
					for (let i = 0; i < ring; i++) {
						const off = Math.abs(apart(i, home) - wave);
						if (off > 38) continue;
						const v = 1 - off / 38;
						addSample(out, i, palette, SLOT.accent, 1.4 * v);
						addSample(out, i, palette, SLOT.white, 0.55 * v);
					}
				}

				// The first stones through it: mirrors hail() in timing.ts, thinning as the block lands.
				if (t >= p.snap) {
					for (let s = Math.max(0, Math.floor((t - p.snap - 0.35) / 0.035)); s * 0.035 < p.end - p.snap - 0.04; s++) {
						const at = p.snap + 0.04 + s * 0.035;
						const age = t - at;
						if (age < 0) break;
						if (age > 0.3 || hash01(s * 23 + 11) > 0.85 * (1 - (at - p.snap) / (p.end - p.snap))) continue;
						const i = Math.floor(hash01(s * 41 + 7) * g.count);
						const v = 1.3 * Math.exp(-age / 0.06);
						addSample(out, i, palette, SLOT.white, v);
						addSample(out, (i + 1) % g.count, palette, SLOT.white, 0.6 * v);
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
		const [alongRun, acrossRun] = [g.strips[0].count, g.strips[1].count];
		const beamStart = ring;
		const beamCount = g.count - ring;
		const centre = Math.floor(beamCount / 2);
		const north = Math.round(alongRun / 2);
		const south = alongRun + acrossRun + Math.round(alongRun / 2);
		const far = alongRun;
		const apart = (a: number, b: number) => {
			const d = ((a - b) % ring + ring) % ring;
			return d > ring / 2 ? ring - d : d;
		};
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
					const closing = clamp((t - p.form) / (p.eye - p.form));
					const pulse = hit(t - p.pulse1, 0.18) + hit(t - p.pulse2, 0.18) + hit(t - p.pulse3, 0.18);
					const level = 1 + 0.5 * pulse;
					// The cloud closes over the room from the storm's bearing. A front rather than a
					// fade, so no pixel lingers in the dither codes as it arrives.
					const arrive = ((t - p.form) / 0.45) * (ring / 2 + 30);
					for (let i = 0; i < ring; i++) {
						if (apart(i, far) > arrive) continue;
						const a = (i / ring - turn) * Math.PI * 2;
						const n = noise3(Math.cos(a) * 1.6, Math.sin(a) * 1.6, t * 0.14);
						// Violet splits its light between two channels, so the wall needs a higher level here
						// than the same cloud would on a blue palette. The term growing with `closing` is what
						// brightens it as it turns, instead of following wherever the noise field wandered.
						setSample(out, i, palette, SLOT.base, level * (0.42 + 0.3 * closing + 0.74 * n * n));
						const seam = clamp(1 - Math.abs(n - 0.64) / 0.05);
						if (seam > 0) addSample(out, i, palette, SLOT.accent, level * 1.2 * seam);
					}
					// Debris torn off the wall: each piece whips round the ring the way the cloud turns,
					// and there are more of them the faster it goes. Mirrors debris() in timing.ts.
					for (let s = Math.max(0, Math.floor((t - 1.2 - 0.6) / 0.14)); 1.2 + s * 0.14 < p.eye; s++) {
						const at = 1.2 + s * 0.14 + 0.09 * hash01(s * 17 + 5);
						const age = t - at;
						if (age < 0) break;
						if (age > 0.5 || hash01(s * 7 + 3) > 0.08 + 0.72 * ((at - 1.2) / (p.eye - 1.2))) continue;
						const from = Math.floor(hash01(s * 43 + 11) * ring);
						const flung = Math.round(from + age * 900);
						const v = 1.25 * (1 - age / 0.5);
						for (let q = 0; q < 7; q++) {
							addSample(out, ((flung - q) % ring + ring) % ring, palette, SLOT.accent, v * (1 - q / 7));
						}
					}

					// The funnel reaches down the beam out of the cloud and touches the floor at the
					// south corner, widening behind its tip as it comes.
					if (t >= p.funnel) {
						const down = clamp((t - p.funnel) / (p.touch - p.funnel));
						const tip = Math.round(lerp(beamCount - 1, 0, down * down));
						const half = Math.round(lerp(3, 26, down));
						for (let b = tip; b < beamCount; b++) {
							const wide = Math.min(1, (b - tip) / 6);
							const held = 1 - Math.abs(b - centre) / (half + beamCount);
							const tone = b - tip < 3 ? SLOT.white : SLOT.accent;
							setSample(out, beamStart + b, palette, tone, (0.82 + 0.35 * pulse) * lerp(1.2, held, wide));
						}
						// Touchdown: the corner under the beam's south end takes it.
						const struck = t - p.touch;
						if (struck >= 0) {
							const v = 1.4 * Math.exp(-struck / 0.18);
							for (let d = -60; d <= 60; d++) {
								addSample(out, ((south + d) % ring + ring) % ring, palette, SLOT.white, v * Math.exp(-(d * d) / 900));
							}
							// What it lifts leaves the corner both ways round the frame, so a touchdown is a
							// room event and not a corner one. The eye cuts it off, which is the point of the eye.
							const thrown = struck * 520;
							const blast = 1.25 * Math.exp(-struck / 0.3);
							for (let i = 0; i < ring; i++) {
								const off = Math.abs(apart(i, south) - thrown);
								if (off < 30) addSample(out, i, palette, SLOT.white, blast * (1 - off / 30));
							}
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
				// The flash's afterimage on the beam, and the cloud lit from inside for as long as the
				// thunder rolls.
				const flash = Math.exp(-(age - 0.12) / 0.25);
				const roll = Math.exp(-(age - 0.12) / 2.6);
				// The churn slows from a strobe to a drift as the thunder loses its top, integrated so
				// the noise field never jumps: its rate falls from 5 to 0.6.
				const churn = 0.6 * age + 5.28 * (1 - Math.exp(-age / 1.2));
				// The beam settles on the 0.34 Eyewall opens its own channel at, so poster boy's cut is
				// the arms starting rather than the room changing level.
				for (let b = 0; b < beamCount; b++) {
					setSample(out, beamStart + b, palette, SLOT.accent, 1.05 * flash + 0.34 + 0.4 * roll);
				}
				// The roll thins the glow into ever fewer pockets rather than dimming all of it, so the
				// cloud leaves by going out pixel by pixel instead of trailing through the dither codes.
				const gate = 0.78 * (1 - roll);
				for (let i = 0; i < ring; i++) {
					const n = noise3(i * 0.04, churn, 9.1);
					if (n <= gate) continue;
					setSample(out, i, palette, SLOT.base, (0.58 + 0.62 * n * n) * (0.62 + 0.38 * roll));
				}
				// The blast leaving both beam ends, with the sub the score drops under the crack.
				const blast = 1 - smoothstep(0.4, 0.62, age - 0.12);
				if (blast > 0) {
					const front = (age - 0.12) * 265;
					for (let i = 0; i < ring; i++) {
						const off = Math.abs(Math.min(apart(i, north), apart(i, south)) - front);
						if (off < 28) addSample(out, i, palette, SLOT.white, 1.35 * blast * Math.pow(1 - off / 28, 1.6));
					}
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
		const [alongRun, acrossRun] = [g.strips[0].count, g.strips[1].count];
		const beamStart = ring;
		const beamCount = g.count - ring;
		const north = Math.round(alongRun / 2);
		const south = alongRun + acrossRun + Math.round(alongRun / 2);
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
		const wrap = (i: number) => ((i % ring) + ring) % ring;
		const apart = (a: number, b: number) => {
			const d = wrap(a - b);
			return d > ring / 2 ? ring - d : d;
		};
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
					setSample(out, i, palette, lerp(SLOT.base, SLOT.glow, cloud), (0.32 + 0.24 * cloud) * gain * (1 - 0.6 * pool));
					if (pool > 0) addSample(out, i, palette, SLOT.accent, 0.65 * gain * pool);
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
				const wall = g.strips[Math.floor(hash01(j * 13 + 2) * 4)];
				if (age >= 0 && age < 0.8) {
					const level = 1.05 * (Math.exp(-age / 0.07) + (age > 0.22 ? 0.7 * Math.exp(-(age - 0.22) / 0.07) : 0));
					for (let q = 0; q < wall.count; q++) addSample(out, wall.offset + q, palette, SLOT.glow, level);
				}
				// The thunder that flash threw, arriving three to eight seconds behind it and rolling
				// over the frame from its wall. The night is named for this gap; the room states it
				// once a minute and a half at the doors, before anyone is watching for it.
				const gap = 3 + hash01(j * 41 + 6) * 5;
				const rolling = age - gap;
				if (rolling > 0 && rolling < 4.5) {
					const env = Math.max(0, 1.2 * (1 - Math.exp(-rolling / 0.45)) * (1 - smoothstep(1.6, 4.5, rolling)) - 0.16);
					if (env > 0) {
						const from = wrap(wall.offset + Math.round(wall.count / 2));
						const front = rolling * (ring / 2.2);
						for (let i = 0; i < ring; i++) {
							const behind = front - apart(i, from);
							if (behind < 0) continue;
							const n = noise3(i * 0.02, rolling * 0.4, 8.8);
							addSample(out, i, palette, SLOT.base, 0.5 * env * (0.4 + 0.75 * Math.exp(-behind / 170)) * (0.45 + 0.55 * n));
						}
					}
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
		const walls = g.strips.filter((s) => s.inPerimeter);
		return {
			reset() {
				heard.reset();
			},
			render(out, { f, palette }) {
				const t = f.t;
				const gain = 0.88 + 0.3 * clamp(heard.update(f.level, f.dt));
				// Five minutes is a long time to hold one level. The room breathes about six times across
				// the pause, which is slow enough to read as weather rather than as an effect.
				const breath = 0.8 + 0.3 * (0.5 + 0.5 * Math.sin(t / 24));
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
					setSample(out, i, palette, lerp(SLOT.base, SLOT.glow, cloud), (0.5 + 0.38 * cloud) * gain * breath);
				}
				const j = Math.floor(t / 8);
				const age = t - (j * 8 + hash01(j * 19 + 1) * 4);
				if (age < 0 || age > 1.2) return;
				const flickers = 2 + Math.floor(hash01(j * 23 + 9) * 2);
				let env = 0;
				for (let n = 0; n < flickers; n++) {
					const a = age - n * 0.19;
					if (a >= 0) env = Math.max(env, Math.exp(-a / 0.12));
				}
				const level = 1.15 * env;
				// Heat lightning is a storm too far off to be heard, so nothing follows it: the flash
				// is the whole event, and what changes from one to the next is where it lights from.
				const kind = hash01(j * 29 + 4);
				if (kind < 0.22) {
					// Sheet: the whole cloud lights from inside at once, the beam with it.
					for (let i = 0; i < ring; i++) addSample(out, i, palette, SLOT.accent, level * 0.7);
					for (let b = 0; b < beamCount; b++) {
						addSample(out, beamStart + b, palette, SLOT.accent, level);
						addSample(out, beamStart + b, palette, SLOT.white, level * 0.45);
					}
				} else if (kind < 0.52) {
					// Low on the horizon: one whole wall lights and the rest of the room does not.
					const wall = walls[Math.floor(hash01(j * 47 + 3) * walls.length)];
					for (let q = 0; q < wall.count; q++) {
						const shape = Math.pow(Math.sin((Math.PI * (q + 0.5)) / wall.count), 0.6);
						addSample(out, wall.offset + q, palette, SLOT.accent, level * shape);
						addSample(out, wall.offset + q, palette, SLOT.white, level * 0.4 * shape);
					}
				} else {
					// One cell out there, lighting the cloud around it.
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

/** The calm centre: a clear caustic net, a warm pool of sun, and the wall still turning out there. */
const eyeOfStorm = effect({
	id: 'eyeOfStorm',
	name: 'Eye of the storm',
	role: 'bed',
	blurb: 'Clear blue caustic net with a travelling pool of sun, and the storm wall turning on the horizon.',
	create(g) {
		let ring = 0;
		for (const s of g.strips) if (s.inPerimeter) ring += s.count;
		const [alongRun, acrossRun] = [g.strips[0].count, g.strips[1].count];
		const north = Math.round(alongRun / 2);
		const south = alongRun + acrossRun + Math.round(alongRun / 2);
		const heard = new Follower(0.3, 1.5);
		const wrap = (i: number) => ((i % ring) + ring) % ring;
		const apart = (a: number, b: number) => {
			const d = wrap(a - b);
			return d > ring / 2 ? ring - d : d;
		};
		return {
			reset() {
				heard.reset();
			},
			render(out, { f, palette }) {
				const t = f.t;
				const gain = 0.88 + 0.3 * clamp(heard.update(f.level, f.dt));
				const sun = (north + (t / 240) * ring) % ring;
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
				// The wall of the storm is still out there, turning a lap every five minutes. From the
				// middle it is far enough off that its lightning arrives without any thunder at all.
				const wallAt = wrap(Math.round(south - (t / 300) * ring));
				for (let i = 0; i < ring; i++) {
					const d = apart(i, wallAt);
					if (d > 170) continue;
					const n = noise3(i * 0.02, t * 0.05, 2.2);
					addSample(out, i, palette, SLOT.third, 0.6 * gain * Math.pow(1 - d / 170, 2.2) * (0.5 + 0.6 * n * n));
				}
				const j = Math.floor(t / 23);
				const age = t - (j * 23 + hash01(j * 13 + 7) * 12);
				if (age < 0 || age > 0.7) return;
				let env = 0;
				for (let n = 0; n < 2; n++) {
					const a = age - n * 0.16;
					if (a >= 0) env = Math.max(env, Math.exp(-a / 0.09));
				}
				const at = wrap(wallAt + Math.round((hash01(j * 53 + 2) - 0.5) * 220));
				for (let d = -50; d <= 50; d++) {
					addSample(out, wrap(at + d), palette, SLOT.white, 0.85 * env * Math.exp(-(d * d) / 900));
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
		const [alongRun, acrossRun] = [g.strips[0].count, g.strips[1].count];
		const beamStart = ring;
		const beamCount = g.count - ring;
		const home = 2 * alongRun + acrossRun;
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
		const [alongRun, acrossRun] = [g.strips[0].count, g.strips[1].count];
		const beamStart = ring;
		const beamCount = g.count - ring;
		const half = beamCount / 2;
		const north = Math.round(alongRun / 2);
		const south = alongRun + acrossRun + Math.round(alongRun / 2);
		const far = alongRun;
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

				// Sun on the last of the rain. The palette ramp laid straight out along the north wall
				// is the bow: the one place in the night where sweeping the hues is the whole point.
				const bow = smoothstep(p.bow, p.bow + 1.2, t) * (1 - smoothstep(p.spill, p.glitter, t));
				if (bow > 0.01) {
					const width = Math.round(ring * 0.16);
					for (let d = -width; d <= width; d++) {
						const u = (d + width) / (2 * width);
						const arc = Math.pow(Math.sin(Math.PI * u), 0.35);
						addSample(out, wrap(north + d), palette, lerp(SLOT.base, SLOT.accent, u), 0.95 * bow * arc);
					}
				}

				// Gold warms the beam's centre as the chord swells in, fills the beam from there, then
				// spills from the beam ends round the ring. It never dims: the block after it cuts in on
				// top of this and sets its own level.
				const dawn = smoothstep(p.dry - 0.5, p.bloom, t);
				if (dawn > 0 && t < p.spill) {
					for (let b = 0; b < beamCount; b++) {
						const x = Math.abs(b - (beamCount - 1) / 2) / half;
						addSample(out, beamStart + b, palette, SLOT.base, 0.55 * dawn * Math.exp(-(x * x) / 0.08));
					}
				}
				// The gold arrives at a level it can still climb from, and keeps climbing through the
				// glitter, so the cue marked as the drop is a step up rather than a held plateau.
				const risen = smoothstep(p.glitter, p.settle, t);
				if (t >= p.bloom) {
					const reach = 4 + smoothstep(p.bloom, p.spill, t) * (half - 4);
					for (let b = 0; b < beamCount; b++) {
						const fromCentre = Math.abs(b - (beamCount - 1) / 2);
						if (fromCentre <= reach) setSample(out, beamStart + b, palette, SLOT.base, 0.86 + 0.14 * risen);
					}
				}
				if (t >= p.spill) {
					const reach = smoothstep(p.spill, p.glitter, t) * (ring / 4);
					for (let i = 0; i < ring; i++) {
						const d = Math.min(apart(i, north), apart(i, south));
						if (d > reach) continue;
						const front = t < p.glitter ? clamp(1 - (reach - d) / 30) : 0;
						setSample(out, i, palette, SLOT.base, 0.8 + 0.18 * risen + 0.25 * front);
						if (front > 0) addSample(out, i, palette, SLOT.white, 0.8 * front);
					}
				}

				// Sunbeams turning slowly over the gold once it has the frame: eight of them, narrow
				// enough that the ring reads as light through cloud rather than an even wash.
				if (t >= p.spill) {
					// They speed up through the glitter rather than fading out of it, so the cue marked as
					// the drop is the one place the room visibly turns.
					const rays = smoothstep(p.spill, p.glitter, t);
					const turn = (t - p.spill) * lerp(0.055, 0.17, smoothstep(p.glitter, p.settle, t));
					for (let i = 0; i < ring; i++) {
						const spoke = Math.pow(Math.max(0, Math.cos((i / ring - turn) * Math.PI * 16)), 6);
						if (spoke < 0.02) continue;
						addSample(out, i, palette, SLOT.white, 0.8 * rays * spoke);
					}
				}

				// Glitter as the ring closes, each glint with its own chime.
				if (t >= p.glitter && t < p.settle + 0.3) {
					for (let s = Math.floor((t - 0.3) * 10); s <= Math.floor(t * 10); s++) {
						if (s < Math.ceil(p.glitter * 10) || s >= p.settle * 10) continue;
						for (let j = 0; j < 2; j++) {
							if (hash01(s * 23 + j * 7 + 1) > 0.3) continue;
							const age = t - (s / 10 + 0.05 * j);
							if (age < 0) continue;
							const i = Math.floor(hash01(s * 31 + j * 17 + 9) * ring);
							const v = 1.45 * Math.exp(-age / 0.07);
							addSample(out, i, palette, SLOT.white, v);
							for (let d = 1; d <= 2; d++) {
								addSample(out, wrap(i - d), palette, SLOT.third, v * (1 - d / 3));
								addSample(out, wrap(i + d), palette, SLOT.third, v * (1 - d / 3));
							}
						}
					}
				}
			}
		};
	}
});

/**
 * Before the night's last set, scored by light-before-thunder/sundown.m4a: the day's last light
 * comes up out of the dark, laps the room faster and faster with a roll doubling under it, breaks
 * white over the frame and leaves the hole the first song lands in.
 */
const sundown = effect({
	id: 'sundown',
	name: 'Sundown',
	role: 'bed',
	blurb: 'The last light laps the room faster and faster, breaks white over it, and leaves a hole.',
	// The soundtrack's timing table arrives as parameters; the formulas below mirror timing.ts.
	params: SUNDOWN,
	create(g) {
		let ring = 0;
		for (const s of g.strips) if (s.inPerimeter) ring += s.count;
		const [alongRun, acrossRun] = [g.strips[0].count, g.strips[1].count];
		const beamStart = ring;
		const beamCount = g.count - ring;
		const half = beamCount / 2;
		const home = 2 * alongRun + acrossRun;
		const wrap = (i: number) => ((i % ring) + ring) % ring;
		return {
			render(out, { f, p, palette }) {
				const t = f.t;
				out.fill(0);

				// The crest breaks white over the frame; what follows is the hole the song lands in.
				if (t >= p.crest) {
					if (t < p.crest + 0.1) for (let i = 0; i < g.count; i++) setSample(out, i, palette, SLOT.white, 1.35);
					return;
				}
				if (t < p.lift) return;

				const span = p.crest - p.lift;
				const u = (t - p.lift) / span;
				const rise = u * u;
				// The bed the light travels over, coming up out of the dark with it.
				// The bed stops short of the ceiling on purpose: the roll rides on top of it, and a room
				// already at full has nothing left to give the hits.
				const bed = 0.42 + 0.16 * u;
				for (let i = 0; i < g.count; i++) {
					const n = noise3(i * 0.024, t * 0.35, 6.4);
					setSample(out, i, palette, lerp(SLOT.base, SLOT.glow, 0.4 * n), bed * (0.66 + 0.34 * n));
				}

				// The light itself: mirrors sundownTurn in timing.ts, its lap easing `lapFrom` to `lapTo`.
				const k = span / (p.lapTo - p.lapFrom);
				const turn = k * Math.log((p.lapFrom + ((t - p.lift) * (p.lapTo - p.lapFrom)) / span) / p.lapFrom);
				const head = Math.round(home + turn * ring);
				const tail = Math.round(lerp(60, 230, rise));
				for (let q = 0; q < tail; q++) {
					const i = wrap(head - q);
					if (q < 5) addSample(out, i, palette, SLOT.white, 1.3);
					else addSample(out, i, palette, lerp(SLOT.glow, SLOT.third, q / tail), 1.05 * Math.pow(1 - q / tail, 1.5));
				}

				// The beam fills from both ends toward its centre and is solid by the crest.
				const fill = rise * half;
				for (let b = 0; b < beamCount; b++) {
					const depth = Math.min(b, beamCount - 1 - b);
					if (depth > fill) continue;
					const edge = fill - depth < 4;
					setSample(out, beamStart + b, palette, edge ? SLOT.white : SLOT.glow, edge ? 1.25 : 0.68 + 0.3 * u);
				}

				// The roll under it: mirrors sundownRoll in timing.ts, doubling `doubles` times on the
				// way up, so by the crest the hits are faster than the room can show them apart.
				let last = -1;
				for (let s = p.lift; s < t; ) {
					last = s;
					s += 1 / (p.rollFrom * Math.pow(2, (p.doubles * (s - p.lift)) / span));
				}
				const beat = last >= 0 ? Math.exp(-(t - last) / 0.055) : 0;
				if (beat > 0.02) {
					// Each hit lands on the light that is lapping the room, in a band that widens as they
					// speed up, so the roll gets more visible rather than less as it gets louder.
					const reach = Math.round(lerp(70, 260, rise));
					const lift = 0.95 * beat * (0.3 + 0.7 * rise);
					for (let d = -reach; d <= reach; d++) {
						addSample(out, wrap(head + d), palette, SLOT.glow, lift * (1 - Math.abs(d) / (reach + 1)));
					}
					for (let b = 0; b < beamCount; b++) addSample(out, beamStart + b, palette, SLOT.white, 0.85 * beat * rise);
				}
			}
		};
	}
});

/**
 * The end, scored by light-before-thunder/homecoming.m4a: the storm's parting stroke, rain on the
 * frame easing off, the sky clearing star by star, the heart slowing to rest, the spark's last lap
 * home, and the room switching off the way a tube set does. The Goodnight hold plays it from its
 * end, where the standby ember rests in the corner.
 */
const homecoming = effect({
	id: 'homecoming',
	name: 'Homecoming',
	role: 'bed',
	blurb: 'A parting stroke, rain easing, stars, the last spark lapping home, and the set switching off.',
	// The soundtrack's timing table arrives as parameters; `from` skips ahead into the standby ember.
	params: { ...HOMECOMING, from: 0 },
	create(g) {
		let ring = 0;
		for (const s of g.strips) if (s.inPerimeter) ring += s.count;
		const [alongRun, acrossRun] = [g.strips[0].count, g.strips[1].count];
		const beamStart = ring;
		const beamCount = g.count - ring;
		const centre = (beamCount - 1) / 2;
		const home = 2 * alongRun + acrossRun;
		const north = Math.round(alongRun / 2);
		const south = alongRun + acrossRun + Math.round(alongRun / 2);
		const far = alongRun;
		const wrap = (i: number) => ((i % ring) + ring) % ring;
		const apart = (a: number, b: number) => {
			const d = wrap(a - b);
			return d > ring / 2 ? ring - d : d;
		};
		const hit = (age: number, tau: number) => (age < 0 ? 0 : age < 0.02 ? age / 0.02 : Math.exp(-(age - 0.02) / tau));

		// The parting stroke takes the branches the night opened with: the same storm, one last time.
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
		// Corners the last lap tolls, and the stars that fall across the cleared sky: both mirror
		// lapCorners() and shootingStars() in timing.ts.
		const corners = [0.2, 0.5, 0.7];
		const falling = [
			{ at: 4.4, from: 0.16, span: 0.46 },
			{ at: 9.1, from: 0.92, span: -0.53 },
			{ at: 16.5, from: 0.43, span: 0.41 }
		];
		/** The smoothstep of the last lap, inverted: when the spark has run `x` of the ring. */
		const lapAt = (from: number, until: number, x: number) =>
			from + (until - from) * (0.5 - Math.sin(Math.asin(1 - 2 * clamp(x)) / 3));

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
		/**
		 * The thunder of the parting stroke: a front leaving its bearing, crossing the frame in
		 * under a second, with the roll following it in. Stops at a fifth of its peak rather than
		 * trailing off through the dither codes.
		 */
		const roll = (out: Float32Array, palette: Float32Array, at: number, age: number, length: number, size: number) => {
			if (age < 0 || age > length) return;
			const env = Math.max(0, 1.15 * (1 - Math.exp(-age / 0.25)) * (1 - smoothstep(length * 0.4, length, age)) - 0.2);
			if (env <= 0) return;
			const front = age * (ring / 1.7);
			for (let i = 0; i < ring; i++) {
				const behind = front - apart(i, at);
				if (behind < 0) continue;
				const n = noise3(i * 0.018, age * 0.5, 4.1);
				addSample(out, i, palette, SLOT.base, size * env * (0.35 + 0.85 * Math.exp(-behind / 150)) * (0.4 + 0.6 * n));
				if (behind < 30) addSample(out, i, palette, SLOT.glow, size * 1.1 * env * (1 - behind / 30));
			}
			for (let b = 0; b < beamCount; b++) {
				const n = noise3(b * 0.05, age * 0.4, 8.2);
				addSample(out, beamStart + b, palette, SLOT.base, 0.7 * size * env * (0.5 + 0.5 * n));
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

				// The set switches off. The picture squashes into the beam, the line pinches to one
				// dot, and the dot burns down to the standby ember: the whole room from here on, which
				// is also the room the Goodnight hold holds.
				if (t >= p.off) {
					if (t < p.line) {
						const u = (t - p.off) / (p.line - p.off);
						const reach = (ring / 4) * (1 - u) * (1 - u);
						for (let i = 0; i < ring; i++) {
							if (Math.min(apart(i, north), apart(i, south)) > reach) continue;
							setSample(out, i, palette, SLOT.white, 0.95 + 0.5 * u);
						}
						for (let b = 0; b < beamCount; b++) setSample(out, beamStart + b, palette, SLOT.white, 1.05 + 0.35 * u);
					} else if (t < p.dot) {
						const v = (t - p.line) / (p.dot - p.line);
						const reach = 1.2 + (beamCount / 2) * Math.pow(1 - v, 2.2);
						for (let b = 0; b < beamCount; b++) {
							if (Math.abs(b - centre) < reach) setSample(out, beamStart + b, palette, SLOT.white, 1.1 + 0.45 * v);
						}
					} else {
						const age = t - p.dot;
						// Two decays: the dot itself, and the phosphor still faintly alight under it.
						const dot = 1.35 * Math.exp(-age / 0.45) + 0.45 * Math.exp(-age / 1.9);
						const line = 0.95 * Math.exp(-age / 0.09);
						for (let b = 0; b < beamCount; b++) {
							const d = Math.abs(b - centre);
							if (d < 1.5) setSample(out, beamStart + b, palette, SLOT.white, dot);
							else if (d < 7 * clamp((dot - 0.55) / 0.5)) setSample(out, beamStart + b, palette, SLOT.glow, 0.42);
							if (line > 0.06) addSample(out, beamStart + b, palette, SLOT.white, line);
						}
						// The room lies dark for a breath, then the standby ember comes on: an eighth of
						// the frame, which is what the Bounce Lamp needs to stay lit over the corner.
						// It opens out of a point at full level rather than fading a hundred pixels up from
						// nothing, which would put the night's last gesture in the dither codes.
						const standby = smoothstep(p.standby - 0.25, p.standby, t);
						if (standby > 0) {
							const breath = 0.93 + 0.07 * noise3(0.4, t * 0.06, 9.7);
							const reach = Math.round(56 * standby);
							for (let d = -reach; d <= reach; d++) {
								addSample(out, wrap(home + d), palette, SLOT.glow, breath * (0.46 + 0.4 * Math.exp(-(d * d) / 700)));
							}
						}
					}
					return;
				}

				// The wet frame glows warm while it rains. Behind it a clear night comes up, and the
				// spark's last lap wipes the wet warmth off to reveal the sky it leaves behind.
				const u = clamp((t - p.leave) / (p.home - p.leave));
				const run = ring * u * u * (3 - 2 * u);
				// The wet warmth does not fade: the lap wipes it off, which is a front and leaves nothing
				// in the dither codes. Fading it as well used to cross the sky coming up underneath, and
				// the two mid-levels together sat in the codes across a fifth of the frame for four seconds.
				const warm = 0.58;
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

				// The parting stroke, still overhead: branches down both long walls and the whole beam
				// white, with the thunder it throws rolling over the frame a breath later.
				const flash1 = flicker(t - p.flash1, 0);
				if (flash1 > 0) {
					patch(out, palette, north, 62, 1.5 * flash1);
					patch(out, palette, south, 46, 1.1 * flash1);
					for (let i = 0; i < ring; i++) {
						if (branch[i] > 0) addSample(out, i, palette, SLOT.white, 1.45 * flash1);
					}
					for (let b = 0; b < beamCount; b++) addSample(out, beamStart + b, palette, SLOT.white, 1.4 * flash1);
				}
				roll(out, palette, north, t - p.thunder1, 5, 0.85);

				// Then the storm goes, ever farther to the north-east.
				const flash2 = flicker(t - p.flash2, 1);
				if (flash2 > 0) patch(out, palette, Math.round((far + north) / 2), 60, 0.9 * flash2);
				const flash3 = flicker(t - p.flash3, 2);
				if (flash3 > 0) patch(out, palette, far, 50, 0.7 * flash3);
				const flash4 = flicker(t - p.flash4, 3);
				if (flash4 > 0) patch(out, palette, far, 34, 0.5 * flash4);

				// The cleared sky: mirrors stars() in timing.ts, each star up for good and slowly alive.
				if (t >= p.stars) {
					for (let s = 0; p.stars + s * 1.15 < p.off - 0.5; s++) {
						const at = p.stars + s * 1.15 + 0.35 * hash01(s * 23 + 7);
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

				// Stars falling across it: mirrors shootingStars() in timing.ts, each burning out in SHOOT.
				for (let s = 0; s < falling.length; s++) {
					const age = t - (p.stars + falling[s].at);
					if (age < 0 || age > 0.8) continue;
					const burn = clamp(age / 0.8);
					const dir = falling[s].span < 0 ? -1 : 1;
					const head = Math.round((falling[s].from + falling[s].span * burn * (2 - burn)) * ring);
					// Each one nearer than the last, so the third crosses a sixth of the ring and is the
					// last thing the sky does before the set goes off.
					const level = (1.35 + 0.3 * s) * (1 - smoothstep(0.5, 1, burn));
					const tail = 52 + 26 * s;
					for (let q = 0; q < tail; q++) {
						const i = wrap(head - dir * q);
						if (q < 2) addSample(out, i, palette, SLOT.white, level);
						else {
							const tone = lerp(SLOT.white, SLOT.third, (q - 2) / tail);
							addSample(out, i, palette, tone, level * Math.pow(1 - (q - 2) / (tail - 2), 1.5));
						}
					}
				}

				// The last lap: the spark leaves home blazing, drags a warm wake over the frame it
				// wipes clear, and tolls each corner it passes.
				if (t >= p.leave && t < p.home + 0.8) {
					const level = 1.2 * smoothstep(p.leave, p.leave + 0.7, t) * (1 - smoothstep(p.home, p.home + 0.8, t));
					const head = Math.round(home + run);
					for (let q = 0; q < 70; q++) {
						const i = wrap(head - q);
						if (q < 4) addSample(out, i, palette, SLOT.white, level * (q < 2 ? 1.4 : 1.1));
						else addSample(out, i, palette, lerp(SLOT.glow, SLOT.deep, (q - 4) / 66), level * Math.pow(1 - (q - 4) / 66, 1.4));
					}
					for (let q = 70; q < 190; q++) {
						if (q > run) break;
						addSample(out, wrap(head - q), palette, SLOT.glow, level * 0.4 * Math.pow(1 - (q - 70) / 120, 1.8));
					}
					for (let c = 0; c < corners.length; c++) {
						const age = t - lapAt(p.leave, p.home, corners[c]);
						if (age < 0 || age > 1.8) continue;
						const toll = hit(age, 0.45);
						const at = wrap(home + Math.round(corners[c] * ring));
						for (let d = -46; d <= 46; d++) {
							addSample(out, wrap(at + d), palette, SLOT.accent, 1.45 * toll * Math.exp(-(d * d) / 640));
							if (d > -9 && d < 9) addSample(out, wrap(at + d), palette, SLOT.white, 1.05 * toll * (1 - Math.abs(d) / 9));
						}
						// The note rings out round the frame, so the whole room hears the corner.
						const ripple = age * 420;
						if (ripple < ring / 2 + 40) {
							for (let i = 0; i < ring; i++) {
								const off = Math.abs(apart(i, at) - ripple);
								if (off < 40) addSample(out, i, palette, SLOT.glow, 0.95 * toll * (1 - off / 40));
							}
						}
					}
				}
				// Home: the spark arrives, the charge it carried runs back out round the whole frame and
				// up the beam, and what is left blooms into the ember that stays.
				const arrive = t - p.home;
				if (arrive >= 0 && arrive < 3.2) {
					const bloom = hit(arrive, 0.5);
					const swell = hit(arrive, 1.1);
					const front = arrive * 215;
					for (let i = 0; i < ring; i++) {
						const off = Math.abs(apart(i, home) - front);
						if (off < 52) addSample(out, i, palette, SLOT.glow, 1.35 * swell * (1 - off / 52));
					}
					for (let b = 0; b < beamCount; b++) {
						const n = noise3(b * 0.05, arrive * 0.4, 3.3);
						addSample(out, beamStart + b, palette, SLOT.glow, 0.85 * swell * (0.55 + 0.45 * n));
					}
					for (let d = -50; d <= 50; d++) {
						addSample(out, wrap(home + d), palette, SLOT.accent, 1.3 * bloom * Math.exp(-(d * d) / 420));
						if (Math.abs(d) < 10) addSample(out, wrap(home + d), palette, SLOT.white, 0.9 * bloom * (1 - Math.abs(d) / 10));
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

/**
 * Into Neon Rain, scored by light-before-thunder/charge.m4a: the new colour races out of the
 * corner both ways round the frame, the beam takes it from the south end, and the air on the lit
 * frame crackles harder the closer the block gets.
 */
const chargeSweep = effect({
	id: 'chargeSweep',
	name: 'Static charge',
	role: 'bed',
	blurb: 'A hot front leaves the corner both ways round the frame, and the air crackles behind it.',
	params: CHARGE,
	create(g) {
		let ring = 0;
		for (const s of g.strips) if (s.inPerimeter) ring += s.count;
		const [alongRun, acrossRun] = [g.strips[0].count, g.strips[1].count];
		const south = alongRun + acrossRun + Math.round(alongRun / 2);
		const beamStart = ring;
		const beamCount = g.count - ring;
		const home = 2 * alongRun + acrossRun;
		const apart = (a: number, b: number) => {
			const d = (((a - b) % ring) + ring) % ring;
			return d > ring / 2 ? ring - d : d;
		};
		// How far the front has run when it reaches the south beam end.
		const toBeam = apart(south, home);
		return {
			render(out, { f, p, palette }) {
				out.fill(0);
				const t = f.t;
				// The front meets itself on the far wall exactly at `round`, so the sweep is the moment.
				const front = (t / p.round) * (ring / 2);
				for (let i = 0; i < ring; i++) {
					const behind = front - apart(i, home);
					if (behind < 0) continue;
					const n = noise3(i * 0.03, t * 0.6, 4.4);
					setSample(out, i, palette, lerp(SLOT.base, SLOT.glow, 0.35 * n), 0.72 + 0.22 * n);
					if (behind < 26) addSample(out, i, palette, SLOT.white, 1.35 * Math.pow(1 - behind / 26, 1.6));
				}
				// The beam takes the charge from its south end as the front goes past that corner.
				const reach = ((front - toBeam) / 130) * beamCount;
				for (let b = 0; b < beamCount && b <= reach; b++) {
					setSample(out, beamStart + b, palette, SLOT.glow, 0.82);
					if (reach - b < 5) addSample(out, beamStart + b, palette, SLOT.white, 1.25 * (1 - (reach - b) / 5));
				}
				// Static gathering on the lit frame, denser as the block arrives.
				const slot = Math.floor(t * 12);
				const age = t - slot / 12;
				for (let j = 0, n = 2 + Math.floor(clamp(t / p.end) * 9); j < n; j++) {
					const i = Math.floor(hash01(slot * 19 + j * 31 + 5) * g.count);
					addSample(out, i, palette, SLOT.white, 1.45 * Math.exp(-age / 0.05) * (0.5 + 0.5 * hash01(slot * 7 + j * 13)));
				}
				// The charge closes over the whole frame on the last beat, which the block cuts into.
				const land = smoothstep(p.end - 0.3, p.end, t);
				if (land > 0) {
					for (let i = 0; i < g.count; i++) addSample(out, i, palette, SLOT.white, 0.9 * land * land);
				}
			}
		};
	}
});

/**
 * Before Black Ice, scored by light-before-thunder/black-ice.m4a: frost grows in from the four
 * corners crystal by crystal, the sheet holds under its own stress, then the ice lets go and the
 * shards come down.
 */
const blackIce = effect({
	id: 'blackIce',
	name: 'Black ice',
	role: 'bed',
	blurb: 'Frost takes the frame crystal by crystal, holds under its own stress, and shatters.',
	params: BLACK_ICE,
	create(g) {
		let ring = 0;
		for (const s of g.strips) if (s.inPerimeter) ring += s.count;
		const beamStart = ring;
		const beamCount = g.count - ring;
		const corners: number[] = [];
		for (const s of g.strips) if (s.inPerimeter) corners.push(s.offset);
		// How far each pixel's needle has to reach from the nearest corner, so the frost is ragged.
		const reach = new Float32Array(ring);
		let full = 1;
		for (let i = 0; i < ring; i++) {
			let near = ring;
			for (const c of corners) {
				const ahead = ((i - c) % ring + ring) % ring;
				near = Math.min(near, ahead, ring - ahead);
			}
			reach[i] = near * (0.75 + 0.5 * hash01(i * 7 + 3));
			if (reach[i] > full) full = reach[i];
		}
		// The fracture the crack opens: one broken line right round the frame.
		const fracture = new Float32Array(ring);
		for (let k = 0, at = 40; k < 7; k++) {
			const length = 20 + Math.floor(hash01(k * 13 + 5) * 45);
			for (let q = 0; q < length; q++) fracture[(at + q) % ring] = 1;
			at += length + 10 + Math.floor(hash01(k * 17 + 2) * 30);
		}
		return {
			render(out, { f, p, palette }) {
				const t = f.t;
				out.fill(0);
				const age = t - p.crack;

				// The ice lets go: the fracture takes the light, the whole sheet goes white, and what
				// is left comes down as shards.
				if (age >= 0) {
					if (age < 0.07) {
						for (let i = 0; i < ring; i++) if (fracture[i] > 0) setSample(out, i, palette, SLOT.white, 1.3);
					} else if (age < 0.19) {
						for (let i = 0; i < g.count; i++) setSample(out, i, palette, SLOT.white, 1.3 * (1 - (age - 0.07) / 0.12));
					} else {
						// What the crack left: the fracture still lit while the pieces come down, so the room
						// is a broken sheet of ice rather than an empty frame under a shower of sound.
						// It goes out where it can still hold a colour, rather than trailing off through the
						// dither codes, and it lasts just past the final shard.
						const residue = 0.75 * Math.exp(-(age - 0.19) / 0.9);
						if (residue > 0.3) {
							for (let i = 0; i < ring; i++) if (fracture[i] > 0) setSample(out, i, palette, SLOT.third, residue);
						}
					}
					// Mirrors shards() in timing.ts: each one rings where it lands and goes out.
					for (let k = 0; k < 14; k++) {
						const fell = t - (p.crack + 0.06 + 0.9 * Math.pow(hash01(k * 19 + 2), 1.6));
						if (fell < 0 || fell > 0.3) continue;
						const i = Math.floor(hash01(k * 31 + 9) * g.count);
						const v = 1.35 * Math.exp(-fell / 0.16);
						for (let d = 0; d < 14; d++) {
							addSample(out, (i + d) % g.count, palette, d < 2 ? SLOT.white : SLOT.third, v * (1 - d / 14));
						}
					}
					return;
				}

				// Frost needles growing in from the four corners; the beam frosts over from its centre.
				const grown = full * Math.pow(clamp(t / p.frozen), 1.35);
				// Once the frame is closed the sheet is under its own stress, and a fine tremor runs
				// over it until it cannot hold.
				const stress = smoothstep(p.frozen - 0.5, p.crack, t);
				for (let i = 0; i < ring; i++) {
					const past = grown - reach[i];
					if (past <= 0) continue;
					const shiver = stress > 0 ? stress * 0.3 * (noise3(i * 0.17, t * 22, 5.9) - 0.5) : 0;
					setSample(out, i, palette, SLOT.third, 0.66 + 0.26 * clamp(past / 10) + shiver);
					if (past < 16) addSample(out, i, palette, SLOT.white, 1.2 * (1 - past / 16));
					else addSample(out, i, palette, SLOT.base, 0.34 * Math.exp(-(past - 16) / 40));
				}
				// The beam frosts from its centre out, the front deciding whether a pixel is ice at all.
				for (let b = 0; b < beamCount; b++) {
					const fromCentre = Math.abs(b - (beamCount - 1) / 2) / (beamCount / 2);
					if (grown / full <= fromCentre) continue;
					setSample(out, beamStart + b, palette, SLOT.third, 0.64 + 0.2 * stress);
				}
				// Every crystal that forms strikes once: mirrors crystals() in timing.ts.
				for (let s = Math.max(0, Math.floor((t - 0.5) / 0.08)); s * 0.08 < p.frozen; s++) {
					const at = s * 0.08 + 0.05 * hash01(s * 29 + 3);
					const struck = t - at;
					if (struck < 0) break;
					if (struck > 0.45 || hash01(s * 11 + 7) > 0.18 + 0.72 * (at / p.frozen)) continue;
					const i = Math.floor(hash01(s * 37 + 13) * g.count);
					const v = 1.25 * Math.exp(-struck / 0.09);
					addSample(out, i, palette, SLOT.white, v);
					addSample(out, (i + 1) % g.count, palette, SLOT.white, 0.5 * v);
				}
			}
		};
	}
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
				// Half the light in the washes the storm arrives under; the strokes and the loader stay whole.
				{ at: 0, section: 'breakdown', look: look({ bed: { effect: thunderhead, params: { ambient: 0.6 } }, floor: 0 }) },
				{ at: OPENING.ignite, section: 'build' },
				// A cue's fade runs backwards from its own start, so these two turn the charge red-hot
				// from the moment the spark splits until it drains into the beam.
				{ at: halfRed, palette: whiteHot, fade: beatsFrom(split, halfRed) },
				{ at: OPENING.gather, section: 'void', palette: overload, fade: beatsFrom(halfRed, OPENING.gather) },
				{ at: OPENING.strike, section: 'drop' },
				{ at: OPENING.strike + 2 * OPENING.stroke + 0.15, section: 'outro' },
				...stormKicks(OPENING)
			]
		}),

		block('First Strike', {
			id: 'first-strike-songs',
			palette: firstStrike,
			// The opening's rolling cloud dissolves into the first song's, so the room never restates itself.
			enter: { light: 3 },
			between: { crossfade: 4 },
			songs: [
				// The cloud rolls over Blinding Lights' arpeggio and build to its first chorus at 0:17.
				song('Blinding Lights', {
					by: 'The Weeknd',
					id: 'J7p4bzqLvCw',
					overlays: [{ from: 'start', to: 'first-drop', look: look({ bed: thunderRoll, intensity: 1, floor: 0 }) }]
				}),
				song('Desire', { by: 'Ian Asher', id: 'UARSiWU8eoo' }),
				song('Thunder', { by: 'Gabry Ponte', id: 'b_bEigUA1kk' }),
				song("I'm Good (Blue)", { by: 'David Guetta', id: 'pIb7QoXdP_k' }),
				song('Surrender', { by: 'Alesso', id: 'Tdo1KPY7Mig' }),
				song('Like a Prayer', { by: 'Josh Fawaz', id: 'wy7_PFy-ztQ' }),
				song('I Love Hollywood!', { by: 'Slayyyter', id: 'IqW8xx53ADQ' }),
				song('Turn The Lights Off', { by: 'KATO', id: 'q_Siih2P9tA' })
			]
		}),

		narration('Lights Out', {
			audio: './light-before-thunder/lights-out.m4a',
			palette: 'ultraviolet',
			enter: { light: 'cut' },
			// The hail is handed to the block at its own level, not eased out from under it.
			end: 'hold',
			timeline: [
				{ at: 0, section: 'void', look: look({ bed: lightsOff, floor: 0 }) },
				{ at: LIGHTS_OUT.glint1, kick: 0.5 },
				{ at: LIGHTS_OUT.glint2, kick: 0.65 },
				{ at: LIGHTS_OUT.glint3, kick: 0.8 },
				{ at: LIGHTS_OUT.snap, section: 'drop', kick: true }
			]
		}),

		block('Supercell: Hail', {
			palette: 'ultraviolet',
			enter: { light: 'cut', hit: 'strobe' },
			between: { crossfade: 3 },
			songs: [
				song('Babydoll', { by: 'Ely Oaks', id: 'wK7jF7I9dIA' }),
				song('Summertime Sadness (Hardstyle)', { id: 'AHaIdOXzzuE' }),
				song('Borderline', { by: 'Ely Oaks', id: 'oXin8uZTQIk' }),
				song('Rumble', { by: 'Skrillex', id: 'fFU3VEimqe0' }),
				song('La Noche', { by: 'Chris Lake', id: 'Y2AkWTF-NVU' }),
				song('FE!N', { by: 'Travis Scott', id: '2nR1zrNzgcY' })
			]
		}),

		narration('Wall Cloud', {
			audio: './light-before-thunder/wall-cloud.m4a',
			palette: 'ultraviolet',
			enter: { light: 'cut' },
			// The crack's cloud is handed to Eyewall at its own level, not eased out from under it.
			end: 'hold',
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
			length: '5m'
		}),

		narration('Static Charge', {
			audio: './light-before-thunder/charge.m4a',
			palette: 'magenta bloom',
			enter: { light: 'cut' },
			// The charged frame is handed straight to the block rather than eased out from under it.
			end: 'hold',
			timeline: [
				{ at: 0, section: 'build', look: look({ bed: chargeSweep, floor: 0 }) },
				{ at: CHARGE.end - 0.02, section: 'drop', kick: true }
			]
		}),

		block('Neon Rain', {
			palette: 'magenta bloom',
			enter: { light: 'cut', hit: 'bump' },
			songs: [
				song('Physical', { by: 'Dua Lipa', id: 'Yegn0dZ-BfY' }),
				song('September', { by: 'Earth, Wind & Fire', id: 'B2mmDEv0OEk' }),
				song('Hypnotized', { by: 'Purple Disco Machine', id: '91jpOlo3M3Y' }),
				song('Von dutch', { by: 'Charli xcx', id: 'oZ-lTp1ZaZQ' }),
				song('Erotic Electronic', { by: 'Slayyyter', id: 'LghHErPmles' })
			]
		}),

		narration('Hard Freeze', {
			audio: './light-before-thunder/black-ice.m4a',
			palette: 'ice',
			enter: { light: 'cut' },
			// The shards are handed to the block as they fall, not eased out from under them.
			end: 'hold',
			timeline: [
				{ at: 0, section: 'build', look: look({ bed: blackIce, floor: 0 }) },
				{ at: BLACK_ICE.frozen, kick: 0.6 },
				{ at: BLACK_ICE.crack, section: 'drop', kick: true }
			]
		}),

		block('Black Ice', {
			palette: 'ice',
			enter: { light: 'cut', hit: 'slam' },
			songs: [
				song('NOKIA', { by: 'Drake', id: 'RDH71p3LgWM' }),
				song('The Box', { by: 'Roddy Ricch', id: 'IxJjY5T9yag' }),
				song('For The Night', { by: 'Pop Smoke', id: 'rm6ypCrKFQ8' }),
				song('Not Like Us', { by: 'Kendrick Lamar', id: 'phLb_SoPBlA' }),
				song('CARNIVAL', { by: '¥$', id: '2VPAdf9dkmQ' })
			]
		}),

		block('Bouřka', {
			id: 'bourka',
			palette: 'indigo',
			songs: [
				song('Melanž', { by: 'Yzomandias', id: 'jojRxf2qvqs' }),
				song('Vítej mezi náma', { by: 'Calin', id: 'ZiJWFrSJ7Gk' }),
				song('Až na měsíc', { by: 'Viktor Sheen', id: 'I-HWMiOM8uE' }),
				song('Jedna Dva', { by: 'Yzomandias', id: 'IyqcKddpDKA' }),
				song('Habibi', { by: 'STEIN27', id: 'tWEaUKCQ8Fg' }),
				song('Vandr', { by: 'Skippy McDippy', id: 'cOpRvLUSMiQ' }),
				song('Cígo a káva', { by: 'Viktor Sheen', id: 'rgN9j5WQVdc' }),
				song('Hannah Montana', { by: 'Calin', id: 'rtRf-iukdvc' }),
				song('cool', { by: 'Grey256', id: 'ghfhZ9_lK24' }),
				song('Princezna', { by: 'EARTH', id: 'oMjF7HyD_K4' }),
				song('Párno Nýdrle', { by: 'VOJIR', id: 'NDvtXeAVjOM' }),
				song('ASSETTO CLUB', { by: 'ASSETTO DRIFTER', id: 'DhM_tQAKqB0' }),
				song('Safír', { by: 'Calin', id: 'nTzU8TjvxyE' }),
				song('ČIMICE RIDER', { by: 'VOJIR', id: 'j7fLRm-w2cU' }),
				// The come-down the Eye of the Storm opens out of.
				song('Napořád', { by: 'EARTH', id: 'RSBflEHEz-Y' })
			]
		}),

		pause('Eye of the Storm', {
			look: look({ bed: eyeOfStorm, palette: 'deep sea', floor: 0.15 }),
			enter: { sting: blackout('2.5s') },
			length: '5m'
		}),

		// The warm air rising back into the storm: Nightcall carries the room out of the silence,
		// then the edits lift it to the rave that answers Return Stroke.
		block('Updraft', {
			palette: 'orchid',
			enter: { light: 3 },
			between: { crossfade: 4 },
			songs: [
				song('Nightcall', { by: 'Kavinsky', id: 'LfgNorryffc' }),
				song('I Follow Rivers', { by: 'Tiësto', id: 'lEy7d460_y4' }),
				song('Boston', { by: 'Ian Asher', id: '4HKiZY0wp5Y' }),
				song('Stateside', { by: 'PinkPantheress', id: 'hEQwWKj8Sns' }),
				song('No Broke Boys', { by: 'Disco Lines', id: 'nS-fOh1CfhQ' }),
				song('Dreamin', { by: 'Dom Dolla', id: 'C3uhKNDCbZA' }),
				song('Bulletproof (This Time Baby)', { by: 'Ian Asher', id: 'Y91m7qbTj-k' }),
				song('Waterfalls', { by: 'James Hype', id: 'G-VVVGALi1A' }),
				song("Movin' To The Sun", { by: 'HUGEL', id: 'n7QlUH0zrPg' }),
				song('Just The Way You Are', { by: 'Milky', id: '1iDrQta26zo' })
			]
		}),

		narration('Return Stroke', {
			audio: './light-before-thunder/return-stroke.m4a',
			palette: returnStroke,
			bpm: BPM,
			enter: { light: 'cut' },
			end: 'hold',
			timeline: [
				{
					at: 0,
					section: 'breakdown',
					look: look({ bed: { effect: thunderhead, params: { ...RETURN_STROKE, overdrive: 1 } }, floor: 0 })
				},
				{ at: RETURN_STROKE.ignite, section: 'build' },
				// The charge goes over-voltage between the first collision and the gather, so the room
				// blinks green and violet only while it is over its limit and is red-hot for the strike.
				// Both fades start clear of the racing heart, which is the last thing to use the accent.
				{ at: RETURN_STROKE.collide, palette: overdrive, fade: 8 },
				{ at: RETURN_STROKE.gather, section: 'void' },
				{ at: RETURN_STROKE.strike, section: 'drop', palette: returnStroke, fade: 8 },
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
				song('Kernkraft 400', { by: 'Zombie Nation', id: '48apI4bpnSo' }),
				song('Windows98', { by: 'frutiger dillon', id: 'QjwdsQBhWCo' }),
				song('What A Life', { by: 'FISHER', id: 'CsRTKXYEhOM' }),
				song("I Don't Even Like You", { by: 'LUM!X', id: 'FuoNzefYXUQ' }),
				song('Vois sur ton chemin (Techno Mix)', { by: 'BENNETT', id: 'i9Jr50r8L7o' }),
				song('Brace For Impact', { by: 'Hardwell', id: 'sJ-feZJ60VE' }),
				song('Bangarang', { by: 'Skrillex', id: 'V7hbIzqxhaE' })
			]
		}),

		pause('Low Pressure', {
			look: look({ bed: staticAir, palette: 'sodium night', floor: 0.12 }),
			enter: { light: 3 },
			length: '5m'
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

		narration('Sundown', {
			audio: './light-before-thunder/sundown.m4a',
			palette: 'rosewood',
			enter: { light: 2 },
			timeline: [
				{ at: 0, section: 'build', look: look({ bed: sundown, floor: 0 }) },
				...sundownRoll(SUNDOWN).map((at, k, all) => ({ at, kick: 0.45 + 0.55 * (k / Math.max(1, all.length - 1)) })),
				{ at: SUNDOWN.crest, section: 'drop', kick: true }
			]
		}),

		block('Last Light', {
			palette: 'rosewood',
			enter: { light: 'cut', hit: 'bump' },
			between: { crossfade: 5 },
			songs: [
				song('One More Time', { by: 'Daft Punk', id: 'wU26xVT_vBU' }),
				song("Don't You Worry Child", { by: 'Swedish House Mafia', id: 'vRqbSgp8w38' }),
				song('Gone Gone Gone', { by: 'David Guetta', id: '_kwiNpRZlDI' }),
				song('Take Me (To The Moon)', { by: 'Ian Asher', id: 'u0fhiNS_nZc' }),
				song('Miracle', { by: 'Calvin Harris', id: '5zC9gkugb0o' })
			]
		}),

		narration('Homecoming', {
			audio: './light-before-thunder/homecoming.m4a',
			palette: petrichor,
			bpm: 60,
			enter: { light: 4 },
			// The standby ember carries straight on into Goodnight.
			end: 'hold',
			timeline: [
				{ at: 0, section: 'outro', look: look({ bed: homecoming, floor: 0 }) },
				{ at: HOMECOMING.flash1, kick: 1 },
				{ at: HOMECOMING.thunder1, kick: 0.9 },
				...lapCorners(HOMECOMING).map((at) => ({ at, kick: 0.6 })),
				...shootingStars(HOMECOMING).map((s) => ({ at: s.t, kick: 0.45 })),
				// The Bounce Lamp turns from rain to ember as the spark comes home.
				{ at: HOMECOMING.home, palette: embers, fade: 6, kick: 1 },
				{ at: HOMECOMING.off, kick: 1 },
				...restingLubs(HOMECOMING).map((at, k) => ({ at, kick: 0.9 * Math.pow(0.97, k) }))
			]
		}),

		hold('Goodnight', {
			look: look({ bed: { effect: homecoming, params: { from: HOMECOMING.end } }, palette: embers, intensity: 1, floor: 0 }),
			enter: { light: 3 },
			note: 'The set is off and the standby ember is lit. End the evening when the room is empty.'
		})
	]
});
