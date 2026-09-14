/**
 * The scored moments' timing tables, in seconds from each moment's start. `sound.mjs` scores
 * every moment from its table and the moment's effect receives the same table as parameters,
 * so light and sound cannot drift. Effects cannot import, so they repeat the formulas below;
 * change them together.
 */

/** First Strike, from Go: the storm's first pass. */
export const OPENING = {
	/** The frame's light drains into the south-west corner with this time constant. */
	drain: 0.55,
	/** First lub at `heartFrom` bpm; from `race` the rate climbs to `heartTo`, reached at `ignite`. */
	heart: 3,
	race: 11,
	ignite: 27,
	heartFrom: 60,
	heartTo: 120,
	/** A storm approaching from the north-east: each flash, then its thunder. */
	flash1: 6,
	thunder1: 9,
	flash2: 14,
	thunder2: 16,
	flash3: 21,
	thunder3: 22,
	flash4: 36,
	thunder4: 36.5,
	/** Spark lap seconds at ignition, and once the second spark has joined. */
	lapFrom: 4,
	lap: 1,
	/** The sparks first collide at the south beam end, then every half lap, every quarter from `full`. */
	collide: 44,
	full: 60,
	/** The charge drains into the beam, which contracts to its centre and beats three times. */
	gather: 64,
	contract: 65,
	point: 65.5,
	pulse: 0.5,
	/** Three strokes, then the thunder rolls until Thunder starts. */
	strike: 68,
	stroke: 0.25,
	end: 75
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
export const BPM = 120;

const RING = 600;
const HOME = 480;
const SOUTH = 390;

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
 * Its run is scaled so it is 420 px past home when the twin is born, which puts every collision
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

/** The first spark's run from home in pixels; the second spark's is `run - joined` backwards. */
export function run(o: Opening, t: number): number {
	const { twin, span, k, scale, joined } = loader(o);
	if (t <= o.ignite) return 0;
	if (t < twin) return scale * k * Math.log((o.lapFrom + ((o.lap - o.lapFrom) * (t - o.ignite)) / span) / o.lapFrom);
	if (t < o.full) return joined + (RING * (t - twin)) / o.lap;
	return joined + (RING * (o.full - twin)) / o.lap + (2 * RING * (t - o.full)) / o.lap;
}

export type End = 'north' | 'south';

/** The first spark alone reaches the north end 210 px out and a beam end every 300 px after. */
export function crossings(o: Opening): { t: number; end: End }[] {
	const { span, k, scale, joined } = loader(o);
	const out: { t: number; end: End }[] = [];
	for (let n = 0, d = 210; d < joined; n++, d += 300) {
		const lapNow = o.lapFrom * Math.exp(d / scale / k);
		const t = o.ignite + ((lapNow - o.lapFrom) * span) / (o.lap - o.lapFrom);
		out.push({ t, end: n % 2 === 0 ? 'north' : 'south' });
	}
	return out;
}

/** Kicks for the Bounce Lamp: every lub, the fourth flash, each collision, the point's beats, the strokes. */
export function stormKicks(o: Opening): { at: number; kick: number }[] {
	const kicks = lubTimes(o)
		.slice(0, -1)
		.map((at) => ({ at, kick: 0.85 }));
	for (const at of [o.ignite, o.flash4]) kicks.push({ at, kick: 1 });
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

/** Homecoming, before the Goodnight hold: rain easing off, the storm leaving, the heart slowing to rest. */
export const HOMECOMING = {
	/** The rain eases from `ease` and is over by `dry`. */
	ease: 16,
	dry: 30,
	/** Flashes ever farther away, each thunder later after its flash than the last. */
	flash1: 2,
	thunder1: 2.5,
	flash2: 8.5,
	thunder2: 9.5,
	flash3: 16,
	thunder3: 18,
	flash4: 24,
	thunder4: 27,
	/** The first lub, its beat in seconds, each beat `slow` times the one before; none from `rest`. */
	heart: 4,
	beat: 0.9,
	slow: 1.035,
	rest: 38,
	/** The spark leaves home for a last lap and is back. */
	leave: 10,
	home: 33,
	end: 44
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

/** The spark's distance round the ring from home, 0..600 px, easing in and out of its last lap. */
export function lastLap(o: Homecoming, t: number): number {
	const u = Math.max(0, Math.min(1, (t - o.leave) / (o.home - o.leave)));
	return RING * u * u * (3 - 2 * u);
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
	for (let s = Math.floor(o.ease / 0.45); s * 0.45 < o.end - 0.6; s++) {
		const t = s * 0.45 + 0.4 * hash01(s * 13 + 5);
		const chance = 0.75 * smoothUnit((t - o.ease) / (o.dry - o.ease)) * (1 - 0.7 * smoothUnit((t - o.dry) / (o.end - o.dry)));
		if (hash01(s * 7 + 11) < chance) out.push({ t, pixel: Math.floor(hash01(s * 19 + 3) * 720) });
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
	/** Pressure pulses in the funnel as it lights on the beam. */
	funnel: 6.6,
	pulse1: 7,
	pulse2: 7.6,
	pulse3: 8.1,
	/** Everything drops out, then the crack. */
	eye: 8.4,
	crack: 9,
	end: 10
} as const;

export type WallCloud = { readonly [K in keyof typeof WALL_CLOUD]: number };

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
	/** Gold lights the beam from its centre, spills round the ring from its ends, and glitters. */
	bloom: 5,
	spill: 5.5,
	glitter: 7,
	settle: 9,
	end: 10
} as const;

export type OpenSky = { readonly [K in keyof typeof OPEN_SKY]: number };

/** Glints of the glitter, a slot every 0.1 s: mirrors the Open Sky effect. */
export function glitter(o: OpenSky): { t: number; pixel: number; note: number }[] {
	const out: { t: number; pixel: number; note: number }[] = [];
	for (let s = Math.ceil(o.glitter * 10); s < o.settle * 10; s++) {
		for (let j = 0; j < 2; j++) {
			if (hash01(s * 23 + j * 7 + 1) > 0.55) continue;
			const pixel = Math.floor(hash01(s * 31 + j * 17 + 9) * RING);
			out.push({ t: s / 10 + 0.05 * j, pixel, note: Math.floor(hash01(s * 41 + j * 3 + 2) * 5) });
		}
	}
	return out;
}
