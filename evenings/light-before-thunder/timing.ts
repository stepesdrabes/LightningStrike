/**
 * The scored moments' timing tables, in seconds from each moment's start. `sound.mjs` scores
 * every moment from its table and the moment's effect receives the same table as parameters,
 * so light and sound cannot drift. Effects cannot import, so they repeat the formulas below;
 * change them together.
 */

/** First Strike, from Go: the storm's first pass. */
export const OPENING = {
	/** The frame's light drains into the south-west corner with this time constant. */
	drain: 0.45,
	/** First lub at `heartFrom` bpm; from `race` the rate climbs to `heartTo`, reached at `ignite`. */
	heart: 2.5,
	race: 8.5,
	ignite: 21,
	heartFrom: 60,
	heartTo: 132,
	/** A storm approaching from the north-east: each flash, then its thunder, sooner every time. */
	flash1: 4.6,
	thunder1: 7.6,
	flash2: 11,
	thunder2: 12.9,
	flash3: 16.2,
	thunder3: 17.2,
	flash4: 28,
	thunder4: 28.35,
	/** Spark lap seconds at ignition, and once the second spark has joined. */
	lapFrom: 3.2,
	lap: 0.8,
	/** The sparks first collide at the south beam end, then every half lap, every quarter from `full`. */
	collide: 35,
	full: 47,
	/** The charge drains into the beam, which contracts to its centre and beats three times. */
	gather: 50.5,
	contract: 51.1,
	point: 51.5,
	pulse: 0.42,
	/** Three strokes, then the thunder rolls until Thunder starts. */
	strike: 53.4,
	stroke: 0.22,
	end: 62
} as const;

export type Opening = { readonly [K in keyof typeof OPENING]: number };

/** Return Stroke: the storm again, faster, with only its two nearest flashes. */
export const RETURN_STROKE: Opening = {
	drain: 0.4,
	heart: 1.6,
	race: 4,
	ignite: 8.8,
	heartFrom: 100,
	heartTo: 150,
	flash1: -10,
	thunder1: -10,
	flash2: -10,
	thunder2: -10,
	flash3: 5.2,
	thunder3: 5.5,
	flash4: 11.2,
	thunder4: 11.35,
	lapFrom: 2.4,
	lap: 0.8,
	collide: 13,
	full: 19.4,
	gather: 21,
	contract: 21.6,
	point: 22,
	pulse: 0.4,
	strike: 24,
	stroke: 0.2,
	end: 28
};

/** The narration's grid: the tempo of the drone's throb and the collisions. */
export const BPM = 60 / (OPENING.lap / 2);

/** The built frame's runs: north and south are `LONG`, east and west `SHORT`. */
export const LONG = 170;
export const SHORT = 111;
export const BEAM = 109;
export const RING = 2 * (LONG + SHORT);
/** Every pixel in the room, the ring then the beam. */
export const ROOM = RING + BEAM;
/** The south-west corner above the Bounce Lamp, where the spark is born and comes home. */
export const HOME = 2 * LONG + SHORT;
/** The beam's south end, at the middle of the south run. */
const SOUTH = LONG + SHORT + LONG / 2;
/** From home round to the beam's north end; the ends then alternate every half ring. */
const FIRST_END = RING - HOME + LONG / 2;
/** The other three corners as distances from home: north-west, north-east, south-east. */
export const LAP_CORNERS = [SHORT, SHORT + LONG, 2 * SHORT + LONG];

/** Lub times: steady, then a linear climb in rate whose last beat is `ignite`. */
export function lubTimes(o: Opening): number[] {
	const f0 = o.heartFrom / 60;
	const f1 = o.heartTo / 60;
	const steady = Math.round((o.race - o.heart) * f0);
	const span = o.ignite - o.race;
	const climb = Math.round(((f0 + f1) / 2) * span);
	const a = (f1 - f0) / (2 * span);
	const out: number[] = [];
	for (let k = 0; k <= steady; k++) out.push(o.heart + k / f0);
	for (let k = 1; k <= climb; k++) out.push(o.race + (-f0 + Math.sqrt(f0 * f0 + 4 * a * k)) / (2 * a));
	return out;
}

/** The dub follows its lub by less as the heart races. */
export function dubDelay(period: number): number {
	return 0.18 + 0.1 * period;
}

/** The second spark is born at home so that the two first meet at the south beam end on `collide`. */
export function twinTime(o: Opening): number {
	return o.collide - ((HOME - SOUTH) * o.lap) / RING;
}

/**
 * The first spark's lap time eases linearly from `lapFrom` to `lap` between ignition and the twin.
 * Its run is scaled so it is 392 px past home when the twin is born, which puts every collision
 * on a beam end.
 */
function loader(o: Opening) {
	const twin = twinTime(o);
	const span = twin - o.ignite;
	const k = (RING * span) / (o.lap - o.lapFrom);
	const end = k * Math.log(o.lap / o.lapFrom);
	const offset = (((2 * (SOUTH - HOME)) % RING) + RING) % RING;
	const scale = (offset + Math.round((end - offset) / RING) * RING) / end;
	return { twin, span, k, scale, joined: scale * end };
}

/** When the lone spark has run `d` pixels from home. */
function reach(o: Opening, d: number): number {
	const { span, k, scale } = loader(o);
	const lapNow = o.lapFrom * Math.exp(d / scale / k);
	return o.ignite + ((lapNow - o.lapFrom) * span) / (o.lap - o.lapFrom);
}

/** The first spark's run from home in pixels; the second spark's is `run - joined` backwards. */
export function run(o: Opening, t: number): number {
	const { twin, span, k, scale, joined } = loader(o);
	if (t <= o.ignite) return 0;
	if (t < twin) return scale * k * Math.log((o.lapFrom + ((o.lap - o.lapFrom) * (t - o.ignite)) / span) / o.lapFrom);
	if (t < o.full) return joined + (RING * (t - twin)) / o.lap;
	return joined + (RING * (o.full - twin)) / o.lap + (2 * RING * (t - o.full)) / o.lap;
}

export type End = 'north' | 'south';

/** The first spark alone reaches the north end `FIRST_END` out, then an end every half ring. */
export function crossings(o: Opening): { t: number; end: End }[] {
	const { joined } = loader(o);
	const out: { t: number; end: End }[] = [];
	for (let n = 0, d = FIRST_END; d < joined; n++, d += RING / 2) out.push({ t: reach(o, d), end: n % 2 === 0 ? 'north' : 'south' });
	return out;
}

/** Every lap the lone spark closes past home: another step of charge lands on the ring. */
export function laps(o: Opening): number[] {
	const { joined } = loader(o);
	const out: number[] = [];
	for (let d = RING; d < joined; d += RING) out.push(reach(o, d));
	return out;
}

/** Kicks for the Bounce Lamp: every lub, each flash, each lap and collision, the beats and strokes. */
export function stormKicks(o: Opening): { at: number; kick: number }[] {
	const kicks = lubTimes(o)
		.slice(0, -1)
		.map((at) => ({ at, kick: 0.85 }));
	for (const [n, at] of [o.flash1, o.flash2, o.flash3, o.flash4].entries()) {
		if (at >= 0) kicks.push({ at, kick: 0.7 + 0.1 * n });
	}
	kicks.push({ at: o.ignite, kick: 1 });
	for (const at of laps(o)) kicks.push({ at, kick: 0.8 });
	for (const c of collisions(o)) kicks.push({ at: c.t, kick: 1 });
	for (let k = 0; k < 3; k++) kicks.push({ at: o.point + k * o.pulse, kick: 1 }, { at: o.strike + k * o.stroke, kick: 1 });
	return kicks.sort((a, b) => a.at - b.at);
}

/** Collisions of the two sparks, alternating beam ends, until the charge gathers. */
export function collisions(o: Opening): { t: number; end: End }[] {
	const out: { t: number; end: End }[] = [];
	let n = 0;
	for (let t = o.collide; t < o.full - 1e-6; t += o.lap / 2) out.push({ t, end: n++ % 2 === 0 ? 'south' : 'north' });
	for (let t = o.full; t < o.gather - 1e-6; t += o.lap / 4) out.push({ t, end: n++ % 2 === 0 ? 'south' : 'north' });
	return out;
}

/** Homecoming, before the Goodnight hold: the rain easing, the storm leaving, the heart at rest. */
export const HOMECOMING = {
	/** The rain eases from `ease` and is over by `dry`. */
	ease: 14,
	dry: 28,
	/** The parting stroke overhead, then flashes ever farther away, each thunder later than the last. */
	flash1: 2,
	thunder1: 2.5,
	flash2: 8.5,
	thunder2: 9.5,
	flash3: 16,
	thunder3: 18,
	flash4: 24,
	thunder4: 27,
	/** The first lub, its beat in seconds, each beat `slow` times the one before; none from `rest`.
	 *  The heart is the moment's spine, so it runs to the switch rather than leaving the last ten
	 *  seconds of the night with nothing in them. */
	heart: 4,
	beat: 0.9,
	slow: 1.035,
	rest: 49.5,
	/** The spark leaves home for a last lap and is back. */
	leave: 10,
	home: 33,
	/** The cleared sky comes out star by star from here until the set is switched off. */
	stars: 32,
	/**
	 * The set goes off the way a tube set does: the picture squashes into the beam by `line`, the
	 * line pinches to one dot by `dot`, and the dot burns down to the standby ember at `standby`,
	 * which is the room the Goodnight hold keeps.
	 */
	off: 50,
	line: 50.14,
	dot: 50.42,
	standby: 53.4,
	end: 58
} as const;

export type Homecoming = { readonly [K in keyof typeof HOMECOMING]: number };

/** Lub times of a heart slowing to rest. */
export function restingLubs(o: Homecoming): number[] {
	const out: number[] = [];
	for (let k = 0; ; k++) {
		const t = o.heart + (o.beat * (Math.pow(o.slow, k) - 1)) / (o.slow - 1);
		if (t >= o.rest) return out;
		out.push(t);
	}
}

/** The spark's distance round the ring from home, 0..`RING`, easing in and out of its last lap. */
export function lastLap(o: Homecoming, t: number): number {
	const u = Math.max(0, Math.min(1, (t - o.leave) / (o.home - o.leave)));
	return RING * u * u * (3 - 2 * u);
}

/** When the last lap's spark passes the other three corners, so each one can toll a note. */
export function lapCorners(o: Homecoming): number[] {
	return LAP_CORNERS.map((d) => o.leave + (o.home - o.leave) * lapPhase(d / RING));
}

/** The smoothstep in `lastLap`, inverted: the phase of the lap at which it has run `x` of the ring. */
function lapPhase(x: number): number {
	return 0.5 - Math.sin(Math.asin(1 - 2 * Math.max(0, Math.min(1, x))) / 3);
}

/** How long a falling star takes to cross its span and burn out. */
export const SHOOT = 0.8;

/** Stars falling across the cleared sky, each `span` pixels round the ring from `from`. */
export function shootingStars(o: Homecoming): { t: number; from: number; span: number }[] {
	return [
		{ t: o.stars + 4.4, from: 90, span: 259 },
		{ t: o.stars + 9.1, from: 517, span: -298 },
		{ t: o.stars + 16.5, from: 242, span: 230 }
	];
}

/** The DSL's hash01, repeated so the score and the effect place the same drips. */
function hash01(k: number): number {
	let h = (k | 0) >>> 0;
	h = (h ^ 61 ^ (h >>> 16)) >>> 0;
	h = (h + (h << 3)) >>> 0;
	h = (h ^ (h >>> 4)) >>> 0;
	h = Math.imul(h, 0x27d4eb2d) >>> 0;
	h = (h ^ (h >>> 15)) >>> 0;
	return h / 4294967296;
}

/** Drips once the rain eases: a slot every 0.45 s, jittered, more likely as the rain stops. */
export function drips(o: Homecoming): { t: number; pixel: number }[] {
	const out: { t: number; pixel: number }[] = [];
	for (let s = Math.floor(o.ease / 0.45); s * 0.45 < o.stars; s++) {
		const t = s * 0.45 + 0.4 * hash01(s * 13 + 5);
		const chance = 0.75 * smoothUnit((t - o.ease) / (o.dry - o.ease)) * (1 - 0.7 * smoothUnit((t - o.dry) / (o.stars - o.dry)));
		if (hash01(s * 7 + 11) < chance) out.push({ t, pixel: Math.floor(hash01(s * 19 + 3) * ROOM) });
	}
	return out;
}

/** Stars coming out of the cleared sky, a slot every 0.55 s, each with its own small chime. */
export function stars(o: Homecoming): { t: number; pixel: number; note: number }[] {
	const out: { t: number; pixel: number; note: number }[] = [];
	for (let s = 0; o.stars + s * 1.15 < o.off - 0.5; s++) {
		const t = o.stars + s * 1.15 + 0.35 * hash01(s * 23 + 7);
		out.push({ t, pixel: Math.floor(hash01(s * 37 + 13) * RING), note: Math.floor(hash01(s * 53 + 3) * 5) });
	}
	return out;
}

function smoothUnit(u: number): number {
	const x = Math.max(0, Math.min(1, u));
	return x * x * (3 - 2 * x);
}

/** Wall Cloud, before poster boy: the cloud turns ever faster, the pressure drops, the eye, a crack. */
export const WALL_CLOUD = {
	/** The cloud forms, turning a lap every `lapFrom` seconds, down to `lapTo` at the eye. */
	form: 0.2,
	lapFrom: 6,
	lapTo: 0.6,
	/** The funnel reaches down the beam from `funnel`, touching the floor at `touch`. */
	funnel: 6.6,
	touch: 7.85,
	/** Pressure pulses in the funnel while it comes down. */
	pulse1: 7,
	pulse2: 7.6,
	pulse3: 8.1,
	/** Everything drops out, then the crack, whose roll takes the rest of the moment. */
	eye: 8.4,
	crack: 9,
	end: 13
} as const;

export type WallCloud = { readonly [K in keyof typeof WALL_CLOUD]: number };

/** Debris the cloud tears off as it spins up, each piece whipped round the ring from where it went. */
export function debris(o: WallCloud): { t: number; pixel: number }[] {
	const out: { t: number; pixel: number }[] = [];
	const from = 1.2;
	for (let s = 0; from + s * 0.14 < o.eye; s++) {
		const t = from + s * 0.14 + 0.09 * hash01(s * 17 + 5);
		if (hash01(s * 7 + 3) > 0.08 + 0.72 * ((t - from) / (o.eye - from))) continue;
		out.push({ t, pixel: Math.floor(hash01(s * 43 + 11) * RING) });
	}
	return out;
}

/** Laps the wall cloud has turned: its lap time eases linearly from `lapFrom` to `lapTo`. */
export function cloudTurn(o: WallCloud, t: number): number {
	const span = o.eye - o.form;
	const u = Math.max(0, Math.min(t, o.eye) - o.form);
	const k = span / (o.lapTo - o.lapFrom);
	return k * Math.log((o.lapFrom + (u * (o.lapTo - o.lapFrom)) / span) / o.lapFrom);
}

/** Open Sky, before the requests: the last rain, the storm gone, gold spreading from the beam. */
export const OPEN_SKY = {
	/** Rain eases to nothing by `dry`; one last far flash and its thunder. */
	dry: 3.6,
	flash: 2,
	thunder: 3.6,
	/** Sun on the last of the rain: an arc of every colour the room has, across the north wall. */
	bow: 3.3,
	/** Gold lights the beam from its centre, spills round the ring from its ends, and glitters. */
	bloom: 5,
	spill: 5.5,
	glitter: 7,
	settle: 9.6,
	end: 11
} as const;

export type OpenSky = { readonly [K in keyof typeof OPEN_SKY]: number };

/** Sundown, before the night's last set: the day's last light laps the room and lifts it. */
export const SUNDOWN = {
	/** The light comes up out of the dark, then runs: a lap every `lapFrom` s easing to `lapTo`. */
	lift: 0.25,
	lapFrom: 2.6,
	lapTo: 0.42,
	/** The roll under it starts at `rollFrom` hits a second and doubles `doubles` times by the crest. */
	rollFrom: 2,
	doubles: 4,
	/** The light breaks over the room, then drops into the hole the first song lands in. */
	crest: 5.6,
	end: 6.2
} as const;

export type Sundown = { readonly [K in keyof typeof SUNDOWN]: number };

/** Laps the light has run by `t`: its lap time eases linearly from `lapFrom` to `lapTo`. */
export function sundownTurn(o: Sundown, t: number): number {
	const span = o.crest - o.lift;
	const u = Math.max(0, Math.min(t, o.crest) - o.lift);
	const k = span / (o.lapTo - o.lapFrom);
	return k * Math.log((o.lapFrom + (u * (o.lapTo - o.lapFrom)) / span) / o.lapFrom);
}

/** Hits of the roll: the rate doubles `doubles` times between the lift and the crest. */
export function sundownRoll(o: Sundown): number[] {
	const out: number[] = [];
	const span = o.crest - o.lift;
	for (let t = o.lift; t < o.crest - 1e-6; ) {
		out.push(t);
		t += 1 / (o.rollFrom * Math.pow(2, (o.doubles * (t - o.lift)) / span));
	}
	return out;
}

/** Black Ice, before the cold block: frost takes the frame, holds, and the ice lets go. */
export const BLACK_ICE = {
	/** Frost grows in from the four corners and has the whole frame by `frozen`. */
	frozen: 2.6,
	/** It holds under its own stress, creaking, until it lets go. */
	crack: 3.1,
	end: 4.6
} as const;

export type BlackIce = { readonly [K in keyof typeof BLACK_ICE]: number };

/** Crystals forming as the frost grows, denser the colder it gets: light and sound share the slots. */
export function crystals(o: BlackIce): { t: number; pixel: number; note: number }[] {
	const out: { t: number; pixel: number; note: number }[] = [];
	for (let s = 0; s * 0.08 < o.frozen; s++) {
		const t = s * 0.08 + 0.05 * hash01(s * 29 + 3);
		if (hash01(s * 11 + 7) > 0.18 + 0.72 * (t / o.frozen)) continue;
		out.push({ t, pixel: Math.floor(hash01(s * 37 + 13) * ROOM), note: Math.floor(hash01(s * 53 + 5) * 6) });
	}
	return out;
}

/** Shards thrown by the crack, each landing somewhere on the frame and ringing out. */
export function shards(o: BlackIce): { t: number; pixel: number; note: number }[] {
	const out: { t: number; pixel: number; note: number }[] = [];
	for (let k = 0; k < 14; k++) {
		const t = o.crack + 0.06 + 0.9 * Math.pow(hash01(k * 19 + 2), 1.6);
		out.push({ t, pixel: Math.floor(hash01(k * 31 + 9) * ROOM), note: Math.floor(hash01(k * 47 + 6) * 6) });
	}
	return out.sort((a, b) => a.t - b.t);
}

/** Lights Out, after Turn The Lights Off: the power goes, then the hail starts. */
export const LIGHTS_OUT = {
	/** The breaker throws and the room drains dead. */
	cut: 0.35,
	/** Three glints gather in the corner, each closer than the last. */
	glint1: 2.1,
	glint2: 2.42,
	glint3: 2.62,
	/** The frame catches, and the first hail comes through. */
	snap: 2.78,
	end: 3.6
} as const;

export type LightsOut = { readonly [K in keyof typeof LIGHTS_OUT]: number };

/** The first hail after the snap: stones landing on the frame, thinning as the block takes over. */
export function hail(o: LightsOut): { t: number; pixel: number }[] {
	const out: { t: number; pixel: number }[] = [];
	for (let s = 0; s * 0.035 < o.end - o.snap - 0.04; s++) {
		const t = o.snap + 0.04 + s * 0.035;
		if (hash01(s * 23 + 11) > 0.85 * (1 - (t - o.snap) / (o.end - o.snap))) continue;
		out.push({ t, pixel: Math.floor(hash01(s * 41 + 7) * ROOM) });
	}
	return out;
}

/** Static Charge, before Neon Rain: the new colour races out of the corner and the air crackles. */
export const CHARGE = {
	/** The front leaves home and has the frame by `round`; the beam takes it from the south end. */
	round: 1.25,
	end: 1.9
} as const;

export type Charge = { readonly [K in keyof typeof CHARGE]: number };

/** Glints of the glitter, a slot every 0.1 s: mirrors the Open Sky effect. */
export function glitter(o: OpenSky): { t: number; pixel: number; note: number }[] {
	const out: { t: number; pixel: number; note: number }[] = [];
	for (let s = Math.ceil(o.glitter * 10); s < o.settle * 10; s++) {
		for (let j = 0; j < 2; j++) {
			if (hash01(s * 23 + j * 7 + 1) > 0.3) continue;
			const pixel = Math.floor(hash01(s * 31 + j * 17 + 9) * RING);
			out.push({ t: s / 10 + 0.05 * j, pixel, note: Math.floor(hash01(s * 41 + j * 3 + 2) * 5) });
		}
	}
	return out;
}
