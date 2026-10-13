/**
 * The scored moments' timing tables, in seconds from each moment's start. `sound.mjs` scores
 * every moment from its table and the moment's effect receives the same table as parameters,
 * so light and sound cannot drift. Effects cannot import, so they repeat the formulas below;
 * change them together. Every moment rings out for `end - drop` seconds after its drop, which
 * the light holds, so the next song never lands on a sound cut short.
 */

/** The built frame's runs: north and south are `LONG`, east and west `SHORT`. */
export const LONG = 170;
export const SHORT = 111;
export const BEAM = 109;
export const RING = 2 * (LONG + SHORT);
export const ROOM = RING + BEAM;
/** The south-west corner above the Bounce Lamp, where the leaf comes to rest. */
export const HOME = 2 * LONG + SHORT;
/** The beam's ends on the ring, at the middle of the north and south runs. */
export const NORTH = LONG / 2;
export const SOUTH = LONG + SHORT + LONG / 2;
/** The middle of the west wall, where the wind comes in. */
export const WEST = HOME + Math.round(SHORT / 2);
/** The north-east corner, half a ring from home either way. */
export const FAR = LONG;
/** The leaf hangs at the beam's centre, beam pixel `LEAF`. */
export const LEAF = Math.floor(BEAM / 2);

/** The DSL's hash01, repeated so the score and the effect place the same events. */
export function hash01(k: number): number {
	let h = (k | 0) >>> 0;
	h = (h ^ 61 ^ (h >>> 16)) >>> 0;
	h = (h + (h << 3)) >>> 0;
	h = (h ^ (h >>> 4)) >>> 0;
	h = Math.imul(h, 0x27d4eb2d) >>> 0;
	h = (h ^ (h >>> 15)) >>> 0;
	return h / 4294967296;
}

function smoothUnit(u: number): number {
	const x = Math.max(0, Math.min(1, u));
	return x * x * (3 - 2 * x);
}

/** Ring distance between two ring pixels, 0..RING/2. */
export function apart(a: number, b: number): number {
	const d = (((a - b) % RING) + RING) % RING;
	return d > RING / 2 ? RING - d : d;
}

/** Laps run by something whose lap time eases linearly from `from` to `to` s over `span` s. */
function easedLaps(from: number, to: number, span: number, u: number): number {
	const k = span / (to - from);
	return k * Math.log((from + (to - from) * Math.max(0, Math.min(1, u))) / from);
}

// ---- Vítr ---------------------------------------------------------------------------------------

/**
 * Vítr, from Go: a still green evening, two gusts, then a storm whose vortex of torn leaves
 * laps the room ever faster until the great gust takes everything but one leaf. Silence, then
 * the gold. On a 100 bpm grid: a bar is 2.4 s.
 */
export const VITR = {
	bpm: 100,
	/** Go: every thread of gossamer catches the sun at once. */
	glint: 0.1,
	/** Two gusts out of the west wall; each front crosses half the ring in `crossN` s. */
	gust1: 7.2,
	cross1: 3.2,
	strip1: 0.12,
	gust2: 12,
	cross2: 2.4,
	strip2: 0.3,
	/** The storm: drums, and the leaves torn off lap the ring, `lapFrom` s easing to `lapTo`. */
	storm: 16.8,
	lapFrom: 4.8,
	lapTo: 0.45,
	/** The drums double and the roll starts under it. */
	rush: 26.4,
	/** The great gust tears off everything but the leaf, crossing in `crossPeak` s. */
	peak: 36,
	crossPeak: 0.9,
	/** The vortex flies apart and everything stops: the leaf alone, then the gold. */
	hush: 38.4,
	gold: 40.8,
	end: 48
} as const;

export type Vitr = { readonly [K in keyof typeof VITR]: number };

/** How much of the green is gone by `t` while the storm strips it, before the great gust. */
export function stormStrip(o: Vitr, t: number): number {
	return o.strip2 + (0.8 - o.strip2) * Math.pow(Math.max(0, Math.min(1, (t - o.storm) / (o.peak - o.storm))), 1.3);
}

/** Laps the vortex has turned: easing from `lapFrom` to `lapTo` by the peak, flat out after. */
export function vortexTurn(o: Vitr, t: number): number {
	if (t <= o.storm) return 0;
	const span = o.peak - o.storm;
	return easedLaps(o.lapFrom, o.lapTo, span, (t - o.storm) / span) + Math.max(0, t - o.peak) / o.lapTo;
}

/** The storm's drums: downbeats and the third beat, then every beat, then eighths into the peak. */
export function stormDrums(o: Vitr): { t: number; size: number }[] {
	const beat = 60 / o.bpm;
	const out: { t: number; size: number }[] = [];
	for (let t = o.storm; t < o.peak - 1e-6; t += beat / 2) {
		const n = Math.round((t - o.storm) / (beat / 2));
		const inBar = n % 8;
		if (t < o.rush - 1e-6) {
			if (inBar === 0) out.push({ t, size: 1 });
			else if (inBar === 4 || inBar === 5) out.push({ t, size: 0.6 });
		} else if (t < o.peak - 4 * beat - 1e-6) {
			if (n % 2 === 0) out.push({ t, size: inBar === 0 ? 1 : 0.75 });
		} else out.push({ t, size: n % 2 === 0 ? 0.9 : 0.6 });
	}
	return out;
}

/** The roll under the rush: from two bars in, accelerating from 4 to 24 hits a second. */
export function stormRoll(o: Vitr): number[] {
	const from = o.rush + 2 * (240 / o.bpm);
	const out: number[] = [];
	for (let t = from; t < o.peak - 1e-6; ) {
		out.push(t);
		t += 1 / (4 + 20 * Math.pow((t - from) / (o.peak - from), 1.6));
	}
	return out;
}

/** Two beats of the leaf holding on in the silence. */
export function hushBeats(o: Vitr): number[] {
	const beat = 60 / o.bpm;
	return [o.hush + beat, o.hush + 2 * beat];
}

// ---- Drakiáda -----------------------------------------------------------------------------------

/**
 * Drakiáda: the kite climbs the beam pull by pull, a gale catches it at the top until the line
 * snaps, and it spirals free round the room, faster each lap, into the drop. 120 bpm.
 */
export const DRAKIADA = {
	bpm: 120,
	/** A pull every other beat from `launch`, each a step up the beam. */
	launch: 2,
	tugs: 8,
	/** At the top a gale takes it; it thrashes, the line straining, until it snaps. */
	top: 10,
	snap: 14,
	/** Free, it spirals `laps` times round the ring in `spiral` s, each lap `lapShrink` of the last. */
	laps: 4,
	spiral: 4,
	lapShrink: 0.7,
	end: 24
} as const;

export type Drakiada = { readonly [K in keyof typeof DRAKIADA]: number };

/** Times of the pulls that walk the kite up the beam. */
export function tugs(o: Drakiada): number[] {
	return Array.from({ length: o.tugs }, (_, k) => o.launch + (k * 120) / o.bpm);
}

/** The kite completes its spiral back at the north end: the drop. */
export function dropTime(o: Drakiada): number {
	return o.snap + o.spiral;
}

/** Pixels up the beam from its south end: a step with each pull, thrashing in the gale. */
export function kiteHeight(o: Drakiada, t: number): number {
	let steps = 0;
	for (const at of tugs(o)) steps += smoothUnit((t - at) / 0.25);
	const gale = smoothUnit((t - o.top) / (o.snap - o.top));
	const thrash = 3.5 * gale * Math.sin(2 * Math.PI * (2 + 3 * gale) * (t - o.top));
	return Math.min(BEAM - 1, ((BEAM - 6) * steps) / o.tugs + thrash);
}

/** Pixels the free kite has run round the ring from the north end. */
export function spiralRun(o: Drakiada, t: number): number {
	const first = (o.spiral * (1 - o.lapShrink)) / (1 - Math.pow(o.lapShrink, o.laps));
	let at = o.snap;
	for (let k = 0; k < o.laps; k++) {
		const lap = first * Math.pow(o.lapShrink, k);
		if (t < at + lap) return RING * (k + Math.max(0, t - at) / lap);
		at += lap;
	}
	return RING * o.laps;
}

/** When the free kite passes the north end again, closing each lap. */
export function lapEnds(o: Drakiada): number[] {
	const first = (o.spiral * (1 - o.lapShrink)) / (1 - Math.pow(o.lapShrink, o.laps));
	const out: number[] = [];
	for (let k = 0, at = o.snap; k < o.laps; k++) out.push((at += first * Math.pow(o.lapShrink, k)));
	return out;
}

// ---- Burčák -------------------------------------------------------------------------------------

/**
 * Burčák: a bottle working under the beam, bubbles racing, the cap rattling ever faster on a
 * 128 bpm grid, then the cap blows, the foam floods the ring and every glass meets.
 */
export const BURCAK = {
	bpm: 128,
	/** The cap rattles every beat from `rattle`, every eighth from `surge`, every sixteenth from `hiss`. */
	rattle: 3.75,
	surge: 7.5,
	hiss: 11.25,
	/** It blows: the cap shoots up the beam and the foam runs both ways round the ring in `round` s. */
	pop: 13.125,
	round: 0.9,
	/** Na zdraví: the drop. */
	clink: 15,
	/** Bubbles off the bottom, `rateFrom` a second climbing to `rateTo`, rising `riseFrom` to `riseTo` px/s. */
	rateFrom: 3,
	rateTo: 45,
	riseFrom: 50,
	riseTo: 320,
	end: 21
} as const;

export type Burcak = { readonly [K in keyof typeof BURCAK]: number };

/** The cap's rattles: beats, then eighths, then sixteenths, until it blows. */
export function rattles(o: Burcak): number[] {
	const beat = 60 / o.bpm;
	const out: number[] = [];
	for (let t = o.rattle; t < o.pop - 1e-6; ) {
		out.push(t);
		t += t < o.surge - 1e-6 ? beat : t < o.hiss - 1e-6 ? beat / 2 : beat / 4;
	}
	return out;
}

/** The kick under the surge, four to the floor until the cap goes. */
export function kicks(o: Burcak): number[] {
	const beat = 60 / o.bpm;
	const out: number[] = [];
	for (let t = o.surge; t < o.pop - 1e-6; t += beat) out.push(t);
	return out;
}

/** Bubbles leaving the bottom of the bottle: emission time and rise, px/s. */
export function bubbles(o: Burcak): { t: number; speed: number }[] {
	const out: { t: number; speed: number }[] = [];
	for (let s = 0, t = 0.2; t < o.pop; s++) {
		const u = t / o.pop;
		out.push({ t, speed: (o.riseFrom + (o.riseTo - o.riseFrom) * u * u) * (0.8 + 0.4 * hash01(s * 17 + 3)) });
		t += (0.6 + 0.8 * hash01(s * 29 + 7)) / (o.rateFrom * Math.pow(o.rateTo / o.rateFrom, u));
	}
	return out;
}

// ---- Špačci -------------------------------------------------------------------------------------

/**
 * Špačci, at sundown over the vineyard: a murmuration of starlings, black against the sunset,
 * swirling on the drums and tightening into a racing ball, until the vineyard's carbide cannon
 * blows it apart. 110 bpm: a bar is 240/110 s.
 */
export const SPACCI = {
	bpm: 110,
	/** The flock comes in over the west wall. */
	arrive: 2.182,
	/** The drums: the flock turns back on itself every bar. */
	swirl: 6.545,
	/** Sixteenths and the roll: the flock tightens into a ball and races round. */
	rush: 15.273,
	/** Everything stops and the flock hangs. */
	hush: 19.636,
	/** The carbide cannon: the drop. */
	bang: 20.182,
	end: 28
} as const;

export type Spacci = { readonly [K in keyof typeof SPACCI]: number };

/** The middle of the flock, in ring pixels from the west wall's centre, unwrapped. */
export function flockAt(o: Spacci, t: number): number {
	const bar = 240 / o.bpm;
	let x = 60 * Math.max(0, Math.min(t, o.swirl) - o.arrive);
	for (let k = 0; k < 4; k++) {
		const from = o.swirl + k * bar;
		if (t <= from) break;
		const tau = Math.min(t, from + bar) - from;
		x += (k % 2 === 0 ? 1 : -1) * 150 * (1 + 0.3 * k) * (bar / Math.PI) * (1 - Math.cos((Math.PI * tau) / bar));
	}
	const rushed = Math.max(0, Math.min(t, o.hush) - o.rush);
	return WEST + x + 200 * rushed + 80 * rushed * rushed;
}

/** How far the flock spreads either side of its middle: breathing on the bar, then tightening. */
export function flockSpread(o: Spacci, t: number): number {
	const bar = 240 / o.bpm;
	if (t < o.swirl) return 42;
	if (t < o.rush) return 34 + 16 * Math.sin((2 * Math.PI * (t - o.swirl)) / bar);
	return 34 - 24 * smoothUnit((t - o.rush) / (o.hush - o.rush));
}

/** Birds in the flock: it thickens as it arrives and swirls. */
export function flockSize(o: Spacci, t: number): number {
	return Math.round(40 + 120 * smoothUnit((t - o.arrive) / (o.rush - o.arrive)));
}

/** The drums under the swirl and the rush: downbeats, then every beat, then eighths. */
export function spacciDrums(o: Spacci): { t: number; size: number }[] {
	const beat = 60 / o.bpm;
	const out: { t: number; size: number }[] = [];
	for (let t = o.swirl, n = 0; t < o.hush - 1e-6; t += beat / 2, n++) {
		if (t < o.rush - 1e-6) {
			if (n % 8 === 0) out.push({ t, size: 1 });
			else if (n % 8 === 4 || n % 8 === 6) out.push({ t, size: 0.6 });
		} else out.push({ t, size: n % 2 === 0 ? 0.9 : 0.6 });
	}
	return out;
}

// ---- Polární záře -------------------------------------------------------------------------------

/**
 * Polární záře: an aurora glowing low over the north wall, its curtains rising and spreading round
 * the sky, the substorm, and the corona breaking overhead along the beam. 70 bpm.
 */
export const ZARE = {
	bpm: 70,
	/** A green glow low in the north. */
	glow: 1,
	/** Curtains rise and spread round the sky from the north wall. */
	curtain: 6.857,
	/** The substorm: brighter, faster, violet edges, and the aurora climbing the beam. */
	surge: 17.143,
	/** The corona overhead: the drop. */
	corona: 27.429,
	end: 36
} as const;

export type Zare = { readonly [K in keyof typeof ZARE]: number };

/** How far round the ring the aurora reaches from the north wall either way. */
export function auroraReach(o: Zare, t: number): number {
	if (t < o.glow) return 0;
	if (t < o.curtain) return 30 + 30 * smoothUnit((t - o.glow) / (o.curtain - o.glow));
	return 60 + (RING / 2 - 60) * smoothUnit((t - o.curtain) / (o.corona - o.curtain));
}

// ---- Hodně štěstí -------------------------------------------------------------------------------

/**
 * The birthday: the room goes dark, eighteen candles light one by one round the ring, and the
 * tune plays twice, softly in F for everyone to sing and then in G with everything. 96 bpm in 3/4.
 */
export const NAROZENINY = {
	bpm: 96,
	/** The lights go down, then the candles light from home round the ring, `spacing` s apart. */
	dark: 0.3,
	candles: 18,
	light: 1.5,
	spacing: 0.5,
	/** The first verse's pickup, and the second's after a two-bar build. */
	verse1: 12.5,
	verse2: 31.875,
	/** The second verse holds its last note this many beats. */
	hold: 6,
	end: 56
} as const;

export type Narozeniny = { readonly [K in keyof typeof NAROZENINY]: number };

/** The tune, in beats from the pickup and semitones from the tonic: 25 beats of 3/4. */
export const MELODY: { beat: number; length: number; semis: number }[] = (() => {
	const lines = [
		{ semis: [-5, -5, -3, -5, 0, -1], lengths: [0.75, 0.25, 1, 1, 1, 2] },
		{ semis: [-5, -5, -3, -5, 2, 0], lengths: [0.75, 0.25, 1, 1, 1, 2] },
		{ semis: [-5, -5, 7, 4, 0, -1, -3], lengths: [0.75, 0.25, 1, 1, 1, 1, 1] },
		{ semis: [5, 5, 4, 0, 2, 0], lengths: [0.75, 0.25, 1, 1, 1, 3] }
	];
	const out: { beat: number; length: number; semis: number }[] = [];
	let beat = 0;
	for (const line of lines) {
		line.semis.forEach((semis, k) => {
			out.push({ beat, length: line.lengths[k], semis });
			beat += line.lengths[k];
		});
	}
	return out;
})();

/** The chords under the tune: root in semitones from the tonic, from each bar's beat on. */
export const CHORDS: { beat: number; root: number; seventh?: boolean }[] = [
	{ beat: 0, root: 0 },
	{ beat: 1, root: 0 },
	{ beat: 4, root: 7 },
	{ beat: 7, root: 7 },
	{ beat: 10, root: 0 },
	{ beat: 13, root: 0, seventh: true },
	{ beat: 16, root: 5 },
	{ beat: 19, root: 0 },
	{ beat: 21, root: 7 },
	{ beat: 22, root: 0 }
];

/** Where each candle stands on the ring, from home round, and when it is lit. */
export function candles(o: Narozeniny): { t: number; pixel: number }[] {
	return Array.from({ length: o.candles }, (_, k) => ({
		t: o.light + k * o.spacing,
		pixel: (HOME + Math.round(((k + 0.5) * RING) / o.candles)) % RING
	}));
}

/** Every note of both verses: time, length in seconds, frequency and which verse. */
export function tune(o: Narozeniny): { t: number; length: number; freq: number; verse: number }[] {
	const beat = 60 / o.bpm;
	const out: { t: number; length: number; freq: number; verse: number }[] = [];
	for (const [verse, from, tonic] of [
		[1, o.verse1, 349.23],
		[2, o.verse2, 392]
	] as const) {
		MELODY.forEach((n, k) => {
			const last = k === MELODY.length - 1;
			const length = (last && verse === 2 ? n.length + o.hold - 3 : n.length) * beat;
			out.push({ t: from + n.beat * beat, length, freq: tonic * Math.pow(2, n.semis / 12), verse });
		});
	}
	return out;
}

// ---- Sfouknuto ----------------------------------------------------------------------------------

/**
 * Sfouknuto, when he blows: the candles go out round the ring, a beat of dark, then fireworks while
 * the frame spells HAPPY, then bdAY, then his age, one 7-segment letter at a time. 128 bpm.
 */
export const SFOUKNUTO = {
	bpm: 128,
	/** The candles go out in a rush round the ring. */
	out: 0.1,
	/** A beat of dark, then everything goes up. */
	boom: 1.875,
	/** The first letter, and the beats each letter holds. */
	happy: 3.75,
	letter: 2,
	/** The birthday he turns, shown as its digits. */
	age: 18,
	/** From here the digits of his age alternate on every beat under the barrage. */
	finale: 15.938,
	end: 24
} as const;

export type Sfouknuto = { readonly [K in keyof typeof SFOUKNUTO]: number };

/**
 * The 7-segment pattern of each character, bit 0 the top segment, then clockwise round to the
 * upper left, bit 6 the middle bar.
 */
export const SEGMENTS: Record<string, number> = {
	'0': 63,
	'1': 6,
	'2': 91,
	'3': 79,
	'4': 102,
	'5': 109,
	'6': 125,
	'7': 7,
	'8': 127,
	'9': 111,
	H: 118,
	A: 119,
	P: 115,
	Y: 110,
	b: 124,
	d: 94,
	' ': 0
};

/** The spelling, a character per slot of `letter` beats from `happy`, blanks between the words. */
export function spelling(o: Sfouknuto): { t: number; char: string }[] {
	const slot = (o.letter * 60) / o.bpm;
	return [...'HAPPY bdAY ', ...String(o.age)].map((char, k) => ({ t: o.happy + k * slot, char }));
}

/** Fireworks: one on each beat from the boom to the letters, in each blank, and a barrage at the end. */
export function fireworks(o: Sfouknuto): { t: number; pixel: number; tone: number; size: number }[] {
	const beat = 60 / o.bpm;
	const slot = o.letter * beat;
	const times: { t: number; size: number }[] = [];
	for (let k = 0; k < 4; k++) times.push({ t: o.boom + k * beat, size: 1 });
	for (const blank of [5, 10]) for (let k = 0; k < 3; k++) times.push({ t: o.happy + blank * slot + (k * slot) / 3, size: 0.8 });
	for (let t = o.finale; t < o.end - 2; t += beat / 2) times.push({ t, size: 0.7 + 0.3 * hash01(Math.round(t * 100)) });
	return times.map((f, k) => ({ t: f.t, pixel: Math.floor(hash01(k * 37 + 11) * RING), tone: k % 3, size: f.size }));
}

// ---- Půlnoc -------------------------------------------------------------------------------------

/**
 * Půlnoc, the minute before midnight: fog under three streetlamps going out one by one while a
 * clock ticks, a match in the corner, the leaf fire spreading to war drums, the fire drawn back
 * into the corner, a countdown from ten drawn in flame as 7-segment digits, and on the stroke of
 * midnight the backdraft. Every second is a beat.
 */
export const PULNOC = {
	/** The streetlamps go out on these ticks. */
	lamp1: 6,
	lamp2: 9,
	lamp3: 12,
	/** A match strikes in the corner and its flame takes the pile at `catch`. */
	match: 15,
	catch: 19,
	/** The fire runs both ways round the ring by this power, and has it all by `inhale`. */
	spread: 1.4,
	/** The war drums double at `double` and again at `again`. */
	double: 35,
	again: 44,
	/** The fire draws back into the corner; then ten to one, a number a second. */
	inhale: 49,
	count: 50,
	/** Midnight: the backdraft blows out of the corner both ways at `blast` px/s. */
	midnight: 60,
	blast: 600,
	end: 68
} as const;

export type Pulnoc = { readonly [K in keyof typeof PULNOC]: number };

/** The streetlamps on the ring, in the order they go out. */
export const LAMPS = [0.053, 0.365, 0.566].map((u) => Math.round(u * RING));

/** How far the fire has run from the corner each way, 0..RING/2, until it draws back. */
export function fireReach(o: Pulnoc, t: number): number {
	const u = Math.max(0, Math.min(1, (Math.min(t, o.inhale) - o.catch) / (o.inhale - o.catch)));
	return (RING / 2) * Math.pow(u, o.spread);
}

/** War drums from the catch: every second, then every half, then every quarter. */
export function warDrums(o: Pulnoc): { t: number; size: number }[] {
	const out: { t: number; size: number }[] = [];
	for (let t = o.catch; t < o.inhale - 1e-6; ) {
		const whole = Math.abs(t - Math.round(t)) < 1e-6;
		out.push({ t, size: whole ? 1 : 0.6 });
		t += t < o.double - 1e-6 ? 1 : t < o.again - 1e-6 ? 0.5 : 0.25;
	}
	return out;
}

/** The countdown: what the frame shows from each half second, ten as a one and then a nought. */
export function countdown(o: Pulnoc): { t: number; char: string }[] {
	const out = [
		{ t: o.count, char: '1' },
		{ t: o.count + 0.5, char: '0' }
	];
	for (let n = 9; n >= 1; n--) out.push({ t: o.count + (10 - n), char: String(n) });
	return out;
}

/** The pile's loud pops: a slot every 0.11 s while it burns, each somewhere already alight. */
export function pops(o: Pulnoc): { t: number; pixel: number }[] {
	const out: { t: number; pixel: number }[] = [];
	for (let s = Math.ceil((o.catch + 0.4) / 0.11); s * 0.11 < o.end - 1; s++) {
		const t = s * 0.11 + 0.06 * hash01(s * 13 + 1);
		if (t > o.inhale - 0.1 && t < o.midnight + 0.3) continue;
		if (hash01(s * 7 + 5) > 0.12 + 0.3 * Math.min(1, (t - o.catch) / (o.inhale - o.catch))) continue;
		const reach = t >= o.midnight ? RING / 2 : fireReach(o, t);
		const d = Math.floor(hash01(s * 31 + 2) * reach);
		const pixel = (((hash01(s * 3 + 9) < 0.5 ? HOME + d : HOME - d) % RING) + RING) % RING;
		out.push({ t, pixel });
	}
	return out;
}

// ---- Orionidy -----------------------------------------------------------------------------------

/**
 * Orionidy, after midnight: the Orionids are really falling that night, out of the north-east
 * where Orion rises. Meteors ever thicker on the drums, then a fireball crossing to home and
 * bursting, a breath of silence, and its sonic boom: the drop. 96 bpm.
 */
export const ORIONIDY = {
	bpm: 96,
	/** Meteors from `first`, `rateFrom` a second rising to `rateTo`. */
	first: 1.25,
	rateFrom: 0.6,
	rateTo: 9,
	/** Drums from `shower`, the roll from `storm`. */
	shower: 7.5,
	storm: 15,
	/** The fireball leaves the radiant and bursts over home, and its boom comes after. */
	bolide: 20,
	burst: 21.25,
	boom: 22.5,
	end: 30
} as const;

export type Orionidy = { readonly [K in keyof typeof ORIONIDY]: number };

/**
 * Meteors: a slot every 0.05 s, each leaving near the radiant and running away from it round the
 * ring. They thicken to the burst, stop for the breath, and come down hardest after the boom.
 */
export function meteors(o: Orionidy): { t: number; from: number; dir: number; speed: number; length: number; life: number }[] {
	const out: { t: number; from: number; dir: number; speed: number; length: number; life: number }[] = [];
	for (let s = Math.ceil(o.first / 0.05); s * 0.05 < o.end - 1; s++) {
		const t = s * 0.05;
		if (t >= o.burst && t < o.boom) continue;
		const rate = t >= o.boom ? o.rateTo * 1.4 : o.rateFrom * Math.pow(o.rateTo / o.rateFrom, Math.min(1, (t - o.first) / (o.burst - o.first)));
		if (hash01(s * 7 + 3) > rate * 0.05) continue;
		out.push({
			t,
			from: FAR + Math.round((hash01(s * 11 + 5) - 0.5) * 120),
			dir: hash01(s * 13 + 1) < 0.5 ? 1 : -1,
			speed: 250 + 400 * hash01(s * 17 + 2),
			length: 14 + Math.floor(26 * hash01(s * 19 + 4)),
			life: 0.35 + 0.45 * hash01(s * 23 + 6)
		});
	}
	return out;
}

/** The fireball's head, ring pixels from the radiant towards home through the east wall. */
export function bolideAt(o: Orionidy, t: number): number {
	const u = Math.max(0, Math.min(1, (t - o.bolide) / (o.burst - o.bolide)));
	return FAR + (HOME - FAR) * u * u * (3 - 2 * u);
}

// ---- Poslední list ------------------------------------------------------------------------------

/**
 * Poslední list, the end: hoarfrost silvers the frame as the music swells, the leaf lets go into
 * silence and falls home, and its landing throws a last wave of gold round the room that ebbs
 * back into the corner.
 */
export const LIST = {
	/** A tawny owl across the clear cold night. Silent by design. */
	owl: 1.4,
	/** Feathers of hoarfrost grow from `frost` and have silvered the frame by `rimed`. */
	frost: 3.4,
	rimed: 26,
	/** The frost closes in on the leaf along the beam; it shivers, then lets go. */
	shiver: 27.5,
	letGo: 31,
	/** It sways down the beam to its south end, then along the south wall into the corner. */
	swings: 9,
	land: 46,
	/** The gold wave holds, then ebbs back into the corner by `rest`. */
	ebb: 51,
	rest: 58,
	/** The gold leaves the corner both ways at `wave` px/s. */
	wave: 250,
	end: 66
} as const;

export type List = { readonly [K in keyof typeof LIST]: number };

/** The leaf's path: `LEAF` beam pixels down to the south end, then the south wall to home. */
export const PATH = LEAF + (HOME - SOUTH);

/** How far along its path the falling leaf is, 0..PATH, swinging back and forth as it goes. */
export function leafAlong(o: List, t: number): number {
	const u = Math.max(0, Math.min(1, (t - o.letGo) / (o.land - o.letGo)));
	const mean = PATH * smoothUnit(u);
	const swing = 9 * Math.sqrt(Math.sin(Math.PI * u)) * Math.sin(2 * Math.PI * o.swings * u);
	return Math.max(0, Math.min(PATH, mean + swing));
}

/** The far end of every swing, where the leaf turns back and the score sounds a note. */
export function swingTimes(o: List): number[] {
	return Array.from({ length: o.swings }, (_, k) => o.letGo + ((k + 0.25) / o.swings) * (o.land - o.letGo));
}

/** Feathers of hoarfrost on the ring: a slot every 0.12 s, likelier as it gets colder. */
export function tufts(o: List): { t: number; pixel: number; width: number; note: number }[] {
	const out: { t: number; pixel: number; width: number; note: number }[] = [];
	for (let s = 0; o.frost + s * 0.12 < o.rimed; s++) {
		const t = o.frost + s * 0.12 + 0.08 * hash01(s * 23 + 4);
		if (hash01(s * 11 + 6) > 0.25 + 0.7 * ((t - o.frost) / (o.rimed - o.frost))) continue;
		out.push({
			t,
			pixel: Math.floor(hash01(s * 37 + 12) * RING),
			width: 3 + Math.floor(hash01(s * 41 + 8) * 4),
			note: Math.floor(hash01(s * 53 + 2) * 5)
		});
	}
	return out;
}
