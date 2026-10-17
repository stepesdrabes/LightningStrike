/**
 * Scores for Podzimní listí's moments. Each lands its events on the times its effect reads from the
 * same timing table and builds on its own grid; then, instead of a hit, it blooms: a wide chord
 * opening out of a breath, a harp through it and bells across the room, breathing on the beat
 * until the song takes over. The night is in A: minor for the storm, the fog and the fire's climb,
 * major for every arrival.
 */
import { TAU, clack, db, heartSound, howl, pressure, ringX, seedOf, smooth, streak } from '../light-before-thunder/instruments.mjs';
import {
	air,
	bell,
	blip,
	bloomSub,
	braam,
	brassLead,
	burst,
	celesta,
	chatter,
	choir,
	churchBell,
	clink,
	corkPop,
	crash,
	creak,
	crickets,
	cymbalSwell,
	fizzle,
	flame,
	flutter,
	frostTuft,
	glass,
	gliss,
	hole,
	kick,
	launch,
	lineHum,
	lush,
	matchStrike,
	ostinato,
	owl,
	pluck,
	pop,
	rattle,
	riser,
	rustle,
	sailSnap,
	shepard,
	snare,
	stemSnap,
	subDrop,
	swell,
	swish,
	synthPluck,
	taiko,
	tick,
	twang,
	whoosh,
	whump,
	wings
} from './voices.mjs';
import {
	BEAM,
	CHORDS,
	HOME,
	LAMPS,
	LEAF,
	NORTH,
	RING,
	SOUTH,
	bolideAt,
	bubbles,
	candles,
	dropTime,
	fireReach,
	fireworks,
	flockAt,
	hash01,
	hushBeats,
	kicks,
	kiteHeight,
	lapEnds,
	leafAlong,
	meteors,
	pops,
	rattles,
	spacciDrums,
	spelling,
	spiralRun,
	stormDrums,
	stormRoll,
	swingTimes,
	tufts,
	tugs,
	tune,
	vortexTurn,
	warDrums
} from './timing.ts';

/** Where a pixel sits left to right in the room, for a sound placed on it; the beam is the middle. */
const panOf = (pixel) => (pixel < RING ? (ringX(pixel) / 1.5) * 0.6 : 0);

const A_MINOR_LOW = [55, 82.41, 110, 130.81];
const A_MINOR_PAD = [110, 164.81, 220, 261.63, 329.63];
const A_MINOR_CHOIR = [220, 261.63, 329.63, 440];

/** The arrivals' voicings, from A2: add nine, major nine, six-nine, open fifths, and the full room. */
const ADD9 = [110, 164.81, 220, 277.18, 329.63, 493.88];
const MAJ9 = [110, 164.81, 207.65, 277.18, 329.63, 493.88];
const SIX9 = [110, 164.81, 220, 277.18, 369.99, 493.88];
const SUS2 = [110, 164.81, 246.94, 329.63, 440, 659.26];
const WHOLE = [55, 110, 164.81, 220, 277.18, 329.63, 440, 554.37];

const PENTA = [0, 2, 4, 7, 9];
/** `count` notes of the major pentatonic climbing from `root` Hz. */
const pentatonic = (root, count) => Array.from({ length: count }, (_, k) => root * Math.pow(2, (12 * Math.floor(k / 5) + PENTA[k % 5]) / 12));

/**
 * Where every moment arrives: not a hit but a bloom. A wide chord opening out of the dark over a
 * second and a half and breathing on the beat, a harp running up through it, a sub swelling under
 * it, a cascade across the room on the echo, and the shimmer climbing out of its tail. `key`
 * moves it from A in semitones; `voice` is the cascade's instrument.
 */
function bloom(mix, t, until, { beat, chord = ADD9, key = 0, size = 1, breathe = 0.35, voice = 'bell', rate = 2, choirLevel = -14, seed }) {
	const k = Math.pow(2, key / 12);
	const notes = chord.map((f) => f * k);
	const tail = (u) => 1 - 0.65 * smooth(t + 2.5, until, u);
	lush(mix, t, until, notes, (u) => db(-4 + 3 * (size - 1)) * smooth(t, t + 0.22, u) * tail(u), {
		bright: (u) => 420 + 8800 * smooth(t, t + 1.6, u) * (1 - 0.4 * smooth(t + 3, until, u)),
		detune: 0.18,
		width: 1,
		hall: 0.35,
		shimmer: 0.22,
		echo: 0.03,
		pump: true,
		seed: seedOf(seed, 1)
	});
	const top = notes.filter((f) => f >= 270 * k).map((f) => f * 2);
	lush(mix, t + 0.08, until, top, (u) => db(-12) * smooth(t + 0.08, t + 1.4, u) * tail(u), { bright: () => 14000, detune: 0.1, width: 0.8, hall: 0.4, shimmer: 0.35, body: 0, seed: seedOf(seed, 2) });
	choir(mix, t, until, notes.filter((f) => f >= 200 * k && f < 700 * k), (u) => db(choirLevel) * smooth(t, t + 0.7, u) * tail(u), seedOf(seed, 3), { hall: 0.6, shimmer: 0.3 });
	bloomSub(mix, t, db(-2 + 2 * (size - 1)), 55 * k, until - t);
	lush(mix, t, until, [55 * k, 110 * k], (u) => db(-6 + 2 * (size - 1)) * smooth(t, t + 0.3, u) * tail(u), { bright: () => 320, detune: 0.06, width: 0, hall: 0, shimmer: 0, body: 0.6, pump: true, seed: seedOf(seed, 6) });
	gliss(mix, t - 0.04, 0.6, pentatonic(220 * k, 12), db(-9), -0.8, 0.8, seedOf(seed, 4));
	air(mix, t, until, { level: (u) => db(-25) * smooth(t, t + 0.5, u) * Math.exp(-Math.max(0, u - t - 0.5) / 3), centre: () => 10000, q: 0.5, width: 0.4, hall: 0.2, shimmer: 0.05 }, seedOf(seed, 5));
	for (let b = t + beat; b < until - 0.5; b += beat) mix.duck(b, breathe * (1 - 0.7 * smooth(t, until, b)), beat * 0.85);
	// The cascade: the chord's upper notes walked up and down, falling away across the room.
	const walk = notes.slice(2).map((f) => f * 4);
	const order = [...walk, ...walk.slice(1, -1).reverse()];
	for (let j = 0, at = t + 0.25; at < until - 1.5; j++, at += beat / rate) {
		const fade = Math.exp(-(at - t) / 3.2);
		const f = order[j % order.length];
		const pan = (j % 2 === 0 ? -1 : 1) * (0.35 + 0.4 * hash01(j * 7 + 3));
		if (voice === 'bell') bell(mix, at, db(-16) * fade, f, pan, { decay: 1.6, index: 1.6 });
		else if (voice === 'glass') glass(mix, at, db(-14) * fade, f, pan, { decay: 0.45 });
		else synthPluck(mix, at, db(-13) * fade, f / 2, pan, { decay: 0.3, bright: 5200, echo: 0.4 });
	}
}

/** A short supersaw chord, struck and closing, like a stab at the end of a phrase. */
function stab(mix, t, length, gain, notes, seed) {
	lush(mix, t, t + length + 0.3, notes, (u) => gain * smooth(t, t + 0.006, u) * Math.exp(-(u - t) / (length * 0.45)) * (1 - smooth(t + length, t + length + 0.3, u)), {
		bright: (u) => 500 + 6000 * Math.exp(-(u - t) / 0.18),
		detune: 0.2,
		width: 1,
		hall: 0.3,
		echo: 0.15,
		shimmer: 0.05,
		seed
	});
}

/** Vítr: a still evening, two gusts, the storm's vortex on drums, the great gust, silence, gold. */
export function scoreVitr(mix, o) {
	mix.ride([[0, -8], [o.gust1, -8.5], [o.gust2, -7], [o.storm, -5.5], [o.rush, -4.5], [o.peak - 2, -2], [o.peak, -1], [o.hush, -1], [o.gold, 0]]);
	const beat = 60 / o.bpm;
	const bar = 4 * beat;
	const cut = (t) => 1 - smooth(o.hush - 0.06, o.hush, t);
	const storming = (t) => smooth(o.storm, o.peak, t);

	// Go: the gossamer catches the sun, a shimmer of glass from one side of the room to the other.
	[1760, 2217.46, 2637.02, 3520, 2637.02, 2217.46, 1760].forEach((note, k) => glass(mix, o.glint + k * 0.05, db(-22), note, -0.75 + (k / 6) * 1.5));
	bell(mix, o.glint, db(-18), 880, 0);
	lush(mix, 0, o.storm + 2, [110, 164.81, 220, 277.18, 329.63], (t) => db(-28) * smooth(0, 2.5, t) * (1 - smooth(o.storm - 1, o.storm + 2, t)), { bright: (t) => 1100 + 500 * Math.sin(t * 0.4), detune: 0.12, hall: 0.45, shimmer: 0.2, seed: seedOf('canopy') });
	crickets(mix, 0.4, o.gust2 + 0.5, (t) => db(-27) * smooth(0.4, 2.5, t) * (1 - smooth(o.gust1, o.gust1 + 1, t) * 0.6) * (1 - smooth(o.gust2 - 0.3, o.gust2 + 0.3, t)), seedOf('crickets'));

	// The two gusts out of the west wall, the front running round to the east.
	[
		{ t: o.gust1, cross: o.cross1, size: 0.6 },
		{ t: o.gust2, cross: o.cross2, size: 0.85 }
	].forEach((g, k) => {
		const blow = (t) => smooth(g.t - 0.6, g.t + 0.4, t) * (1 - smooth(g.t + g.cross, g.t + g.cross + 3, t));
		const across = (t) => -0.7 + 1.4 * smooth(g.t, g.t + g.cross, t);
		howl(mix, g.t - 0.6, g.t + g.cross + 3.2, { pan: across, level: (t) => db(-30 + 7 * g.size) * blow(t), pitch: (t) => 170 + 170 * g.size * blow(t), muffle: (t) => 1800 + 5200 * g.size * blow(t) }, seedOf('gust', k));
		rustle(mix, g.t - 0.2, g.t + g.cross + 3.5, { level: (t) => db(-28 + 7 * g.size) * blow(t), pan: across }, seedOf('leaves', k));
		whoosh(mix, g.t - 0.5, g.cross + 1, db(-24 + 5 * g.size), -0.8, 0.8, seedOf('gust air', k));
		taiko(mix, g.t, db(-14 + 4 * k), -0.4, seedOf('gust drum', k));
	});
	creak(mix, o.gust2 + 0.9, 1.5, db(-20), -0.3, seedOf('branch', 2));
	pressure(mix, o.gust1, o.hush, (t) => db(-26 + 10 * smooth(o.gust1, o.peak, t)) * smooth(o.gust1, o.gust1 + 2, t) * cut(t), () => 55, seedOf('storm floor'));

	// The storm: the vortex whips the wind round the room, faster every lap.
	const round = (t) => 0.85 * Math.sin(TAU * vortexTurn(o, t));
	howl(
		mix,
		o.storm - 1,
		o.hush,
		{
			pan: round,
			level: (t) => db(-28 + 15 * storming(t)) * smooth(o.storm - 1, o.storm + 1, t) * cut(t),
			pitch: (t) => 200 + 520 * storming(t),
			muffle: (t) => 2500 + 9000 * storming(t)
		},
		seedOf('vortex')
	);
	rustle(mix, o.storm, o.hush, { level: (t) => db(-27 + 9 * storming(t)) * cut(t), pan: round }, seedOf('vortex leaves'));
	creak(mix, o.rush + bar, 1.6, db(-17), 0.2, seedOf('branch', 3));
	creak(mix, o.peak - bar, 1.4, db(-14), -0.1, seedOf('branch', 4));
	// The strings, in eighths and then sixteenths, slowing to a stop as the vortex flies apart.
	const stop = (t) => (t < o.peak + beat ? 1 : Math.max(0.2, 1 - 0.8 * smooth(o.peak + beat, o.hush, t)));
	ostinato(
		mix,
		o.storm,
		o.hush,
		{
			pattern: [220, 261.63, 329.63, 261.63, 220, 261.63, 392, 329.63],
			rate: (t) => (t < o.rush ? 2 : 4) / beat,
			bright: (t) => 700 + 5200 * storming(t),
			level: (t) => db(-20 + 6 * storming(t)) * cut(t),
			speed: stop,
			pump: true
		},
		seedOf('strings')
	);
	lush(mix, o.storm, o.peak, A_MINOR_PAD, (t) => db(-32 + 8 * storming(t)) * smooth(o.storm, o.storm + 2, t), { bright: (t) => 600 + 3000 * storming(t), pump: true, hall: 0.3, seed: seedOf('storm pad') });
	stormDrums(o).forEach((d, k) => {
		taiko(mix, d.t, db(-14 + 8 * storming(d.t) + 6 * (d.size - 1)), k % 2 === 0 ? -0.2 : 0.2, seedOf('storm drum', k));
		mix.duck(d.t, 0.45 * d.size, beat * 0.9);
	});
	stormRoll(o).forEach((t, k) => snare(mix, t, db(-21 + 9 * smooth(o.rush, o.peak, t)), smooth(o.rush, o.peak, t), (k % 2 === 0 ? -1 : 1) * 0.25, seedOf('storm roll', k)));
	choir(mix, o.rush, o.hush, A_MINOR_CHOIR, (t) => db(-26 + 11 * smooth(o.rush, o.peak, t)) * cut(t), seedOf('storm choir'));
	shepard(mix, o.rush, o.peak, (t) => db(-30 + 10 * smooth(o.rush, o.peak, t)));
	riser(mix, o.peak - 2 * bar, o.peak, { gain: db(-15), fromHz: 220, toHz: 6400, notes: [220, 329.63, 440], seed: seedOf('storm rise') });

	// The great gust: the rest of the canopy goes in one blast of air, and the vortex flies apart.
	whoosh(mix, o.peak - 0.1, 2.4, db(-5), -0.9, 0.9, seedOf('great gust'));
	braam(mix, o.peak, o.hush - o.peak + 0.15, db(-6), A_MINOR_LOW, seedOf('storm brass'));
	taiko(mix, o.peak, db(-2), 0, seedOf('storm last'));
	crash(mix, o.peak, db(-12), 0, seedOf('storm crash'));
	subDrop(mix, o.peak, db(-8));

	// The hush: the leaf holding on in the silence, two beats, and the gold drawn in out of nothing.
	hole(mix, o.hush, o.gold);
	bell(mix, o.hush + 0.3, db(-17), 880, 0, { decay: 2.6 });
	for (const t of hushBeats(o)) heartSound(mix, t, db(-3), true, 0);
	const breath = o.gold - hushBeats(o)[1] - 0.15;
	swell(mix, o.gold, breath, [220, 329.63, 440, 554.37, 659.26], db(-13), seedOf('gold breath'));
	cymbalSwell(mix, o.gold, breath, db(-22), seedOf('gold air'));

	bloom(mix, o.gold, o.end, { beat, chord: ADD9, voice: 'bell', seed: 'gold' });
	// The gossamer glittering in the gold.
	for (let k = 0; k < 14; k++) {
		glass(mix, o.gold + 0.7 + k * 0.42 + 0.2 * hash01(k * 7 + 1), db(-25), [1760, 2217.46, 2637.02, 3520][k % 4], (hash01(k * 13 + 2) - 0.5) * 1.6);
	}
	rustle(mix, o.gold, o.gold + 4, { level: (t) => db(-32) * Math.exp(-(t - o.gold) / 1.2), pan: (t) => 0.6 * Math.sin(t) }, seedOf('settling'));
}

/** Drakiáda: the kite climbs pull by pull, the gale, the line snapping, the spiral, and it soars. */
export function scoreDrakiada(mix, o) {
	const beat = 60 / o.bpm;
	const drop = dropTime(o);
	const pulls = tugs(o);
	const up = (t) => kiteHeight(o, t) / (BEAM - 1);
	const kitePan = (t) => (t < o.snap ? 0 : panOf((NORTH + spiralRun(o, t)) % RING));
	const until = (t) => 1 - smooth(drop - 0.05, drop, t);
	mix.ride([[0, -4.5], [o.top, -4], [o.snap, -2.5], [o.snap + 0.3, -5], [drop - 0.15, -2.5], [drop, 0]]);

	howl(
		mix,
		0,
		drop + 1,
		{
			pan: (t) => (t < o.snap ? 0.5 * Math.sin(t * 0.7) : kitePan(t)),
			level: (t) => db(-29 + 9 * smooth(0, o.top, t) + 6 * smooth(o.top, o.snap, t)) * smooth(0, 0.6, t) * (1 - smooth(drop, drop + 1, t)),
			pitch: (t) => 200 + 200 * smooth(0, o.top, t) + 400 * smooth(o.top, drop, t),
			muffle: (t) => 2500 + 9000 * smooth(0, drop, t)
		},
		seedOf('kite wind')
	);
	flutter(
		mix,
		o.launch - 0.1,
		drop,
		{
			level: (t) => db(-24 + 7 * smooth(o.launch, o.snap, t)) * smooth(o.launch - 0.1, o.launch + 0.2, t) * until(t),
			rate: (t) => 8 + 10 * smooth(o.launch, o.top, t) + 10 * smooth(o.top, o.snap, t),
			pan: kitePan
		},
		seedOf('sail')
	);
	lineHum(
		mix,
		o.launch,
		o.snap,
		{
			level: (t) => db(-35 + 9 * up(t) + 11 * smooth(o.top, o.snap, t)) * smooth(o.launch, o.launch + 0.5, t) * (1 - smooth(o.snap - 0.02, o.snap, t)),
			pitch: (t) => 360 + 420 * up(t) + 700 * smooth(o.top, o.snap, t),
			pan: () => 0
		},
		seedOf('line')
	);

	// The groove: a pickup, then drums driving under the climb, eighths in the gale.
	for (let t = 0; t < o.snap - 1e-6; t += beat / 2) {
		const n = Math.round(t / (beat / 2));
		const onBeat = n % 2 === 0;
		if (t < o.launch) {
			if (n >= 2 && onBeat) taiko(mix, t, db(-14 + 2 * n), 0, seedOf('pickup', n));
		} else if (t < o.top) {
			if (onBeat && (n / 2) % 2 === 1) snare(mix, t, db(-16), 0.5, 0.15, seedOf('backbeat', n));
			if (onBeat) mix.duck(t, 0.4, beat * 0.9);
		} else {
			const gale = smooth(o.top, o.snap, t);
			snare(mix, t, db(-15 + 8 * gale), 0.4 + 0.5 * gale, onBeat ? -0.25 : 0.25, seedOf('gale', n));
			if (onBeat) {
				taiko(mix, t, db(-9 + 5 * gale), 0, seedOf('gale drum', n));
				mix.duck(t, 0.5, beat * 0.9);
			}
		}
	}
	// Each pull is a drum and a brass stab a step higher up A major.
	const climb = [110, 123.47, 138.59, 146.83, 164.81, 185, 207.65, 220];
	pulls.forEach((t, k) => {
		taiko(mix, t, db(-7), 0, seedOf('pull drum', k));
		braam(mix, t, 0.55, db(-14 + 0.6 * k), [climb[k] / 2, climb[k], climb[k] * 1.5], seedOf('pull brass', k));
		stab(mix, t, 0.5, db(-21 + 0.5 * k), [climb[k] * 2, climb[k] * 3, climb[k] * 4], seedOf('pull stab', k));
		sailSnap(mix, t, db(-20), 0, seedOf('pull', k));
	});
	ostinato(
		mix,
		o.launch,
		o.snap,
		{
			pattern: [440, 554.37, 659.26, 554.37, 440, 554.37, 739.99, 659.26],
			rate: (t) => (t < o.top ? 2 : 4) / beat,
			bright: (t) => 900 + 5000 * smooth(o.launch, o.snap, t),
			level: (t) => db(-23 + 6 * smooth(o.launch, o.snap, t)) * (1 - smooth(o.snap - 0.02, o.snap, t)),
			pump: true,
			echo: 0.2
		},
		seedOf('kite strings')
	);
	// The kite passes the leaf on its way up, and the leaf answers with its note.
	let passes = o.launch;
	while (passes < o.top && kiteHeight(o, passes) < LEAF) passes += 0.01;
	rustle(mix, passes, passes + 0.8, { level: (t) => db(-26) * Math.sin((Math.PI * (t - passes)) / 0.8), pan: () => 0 }, seedOf('leaf brushed'));
	bell(mix, passes + 0.1, db(-20), 880, 0);
	// The gale: the voices hold a suspended chord under the line straining.
	choir(mix, o.top, o.snap, [329.63, 440, 493.88, 659.26], (t) => db(-22 + 11 * smooth(o.top, o.snap, t)) * (1 - smooth(o.snap - 0.03, o.snap, t)), seedOf('gale choir'));
	riser(mix, o.top, o.snap, { gain: db(-15), fromHz: 300, toHz: 4800, notes: [329.63, 493.88, 659.26], seed: seedOf('gale rise') });

	// The line snaps: the kite is free and spirals round the room, faster every lap.
	twang(mix, o.snap, db(-4), 0, seedOf('line snaps'));
	whoosh(mix, o.snap - 0.05, 1.2, db(-9), 0.8, -0.8, seedOf('snap air'));
	taiko(mix, o.snap, db(-3), 0, seedOf('snap drum'));
	riser(mix, o.snap, drop, { gain: db(-13), fromHz: 260, toHz: 6200, notes: [220, 329.63, 440, 554.37], seed: seedOf('spiral') });
	shepard(mix, o.snap, drop, (t) => db(-27 + 9 * smooth(o.snap, drop, t)) * until(t));
	lapEnds(o).forEach((t, k) => {
		if (t < drop - 0.05) {
			taiko(mix, t, db(-9 + 2 * k), 0, seedOf('lap drum', k));
			whoosh(mix, t - 0.3, 0.7, db(-18 + 2 * k), k % 2 === 0 ? -0.8 : 0.8, k % 2 === 0 ? 0.8 : -0.8, seedOf('lap air', k));
		}
	});
	for (let t = o.snap + 0.5; t < drop - 1e-6; ) {
		const u = (t - o.snap) / (drop - o.snap);
		snare(mix, t, db(-21 + 10 * u), u, 0, seedOf('spiral roll', Math.round(t * 1000)));
		t += 1 / (6 + 18 * u);
	}
	hole(mix, drop - 0.12, drop);

	// It soars: the wind takes it up and away over the room, and everything opens with it.
	whoosh(mix, drop - 0.1, 2.6, db(-10), -0.9, 0.9, seedOf('soaring'));
	bloom(mix, drop, o.end, { beat, chord: SUS2, voice: 'pluck', rate: 4, breathe: 0.4, seed: 'kite' });
	lush(mix, drop + 1.2, o.end, [277.18, 554.37], (t) => db(-29) * smooth(drop + 1.2, drop + 3, t) * (1 - 0.6 * smooth(drop + 4, o.end, t)), { bright: () => 5000, width: 1, hall: 0.5, shimmer: 0.4, seed: seedOf('kite third') });
}

/** Burčák: the bottle working to a groove, the cap rattling faster, the pop, the foam, the clink. */
export function scoreBurcak(mix, o) {
	mix.ride([[0, -6], [o.surge, -5], [o.hiss, -3], [o.pop, -1.5], [o.clink, 0]]);
	const beat = 60 / o.bpm;
	const working = (t) => smooth(0, o.pop, t);
	const held = (t) => 1 - smooth(o.pop - 0.03, o.pop, t);

	bubbles(o).forEach((b, k) => blip(mix, b.t, db(-24), 1300 + 1500 * hash01(k * 19 + 4), (hash01(k * 5 + 9) - 0.5) * 0.8));
	fizzle(mix, 0, o.end, (t) => db(-36 + 16 * working(t) - 6 * smooth(o.clink + 1, o.end, t)) * smooth(0, 0.3, t), seedOf('fizz'));
	// The working bottle: a bass pulse in the cellar and plucked bubbles climbing over it.
	ostinato(
		mix,
		0,
		o.pop,
		{
			pattern: [55, 55, 110, 55, 98, 55, 110, 82.41],
			rate: () => 2 / beat,
			bright: (t) => 400 + 1800 * working(t),
			level: (t) => db(-11 + 3 * working(t)) * smooth(0, 1, t) * held(t),
			pump: true,
			echo: 0
		},
		seedOf('cellar bass')
	);
	lush(mix, o.surge, o.pop, [220, 261.63, 329.63, 440], (t) => db(-30 + 6 * smooth(o.surge, o.pop, t)) * smooth(o.surge, o.surge + 1, t) * held(t), { bright: (t) => 900 + 3500 * smooth(o.surge, o.pop, t), pump: true, hall: 0.3, seed: seedOf('cellar pad') });
	const notes = [440, 523.25, 587.33, 659.26, 783.99, 880, 1046.5, 1174.66];
	for (let t = o.rattle, k = 0; t < o.pop - 1e-6; t += beat / 2, k++) {
		const u = (t - o.rattle) / (o.pop - o.rattle);
		synthPluck(mix, t, db(-17 + 4 * u), notes[(k + Math.floor(u * 4)) % notes.length], (k % 2 === 0 ? -1 : 1) * 0.45, { decay: 0.22, bright: 3000 + 4000 * u, echo: 0.3 });
	}
	rattles(o).forEach((t, k) => rattle(mix, t, db(-12 + 5 * working(t)), (k % 2 === 0 ? -1 : 1) * 0.15, seedOf('cap', k)));
	kicks(o).forEach((t) => kick(mix, t, db(-7)));
	for (const t of kicks(o)) if (Math.round((t - o.surge) / beat) % 2 === 1) snare(mix, t, db(-15), 0.6, 0.1, seedOf('clap', Math.round(t * 1000)));
	shepard(mix, o.surge, o.pop, (t) => db(-30 + 10 * smooth(o.surge, o.pop, t)));
	// The cap about to go: gas forcing the thread, rising until it gives.
	riser(mix, o.hiss, o.pop, { gain: db(-13), fromHz: 2600, toHz: 9000, seed: seedOf('cap hiss') });

	corkPop(mix, o.pop, db(-2), seedOf('cork'));
	streak(mix, o.pop, 0.6, db(-14), 0, 0, seedOf('cap flies'));
	// The foam running both ways round the ring from the north end of the beam.
	for (const side of [-1, 1]) {
		rustle(
			mix,
			o.pop,
			o.pop + o.round + 0.4,
			{
				level: (t) => db(-16) * smooth(o.pop, o.pop + 0.1, t) * (1 - smooth(o.pop + o.round, o.pop + o.round + 0.4, t)),
				pan: (t) => side * 0.8 * smooth(o.pop, o.pop + o.round, t)
			},
			seedOf('foam', side)
		);
	}
	// Every glass raised: a breath in, then they meet, and the room fizzes gold.
	hole(mix, o.pop + o.round + 0.15, o.clink);
	swell(mix, o.clink, o.clink - o.pop - o.round - 0.2, [440, 554.37, 659.26, 880], db(-15), seedOf('raised'));
	clink(mix, o.clink, db(-3), 0);
	bloom(mix, o.clink, o.end, { beat, chord: ADD9, voice: 'glass', rate: 4, breathe: 0.45, seed: 'clink' });
	// The bubbles racing up through the new wine.
	for (let k = 0; k < 40; k++) {
		const at = o.clink + 0.15 + k * 0.07 + 0.03 * hash01(k * 3 + 1);
		glass(mix, at, db(-27) * Math.exp(-k / 25), 1760 * Math.pow(2, (k % 12) / 12), (hash01(k * 11 + 5) - 0.5) * 1.6, { decay: 0.12, echo: 0.2 });
	}
}

/** Poslední list: frost swelling to a held chord, silence, the fall, and the last light. */
export function scoreList(mix, o) {
	mix.ride([[0, 3], [o.land - 0.2, 3], [o.land, 0], [o.ebb, -1], [o.rest, -8], [o.end, -12]]);
	const beat = 60 / 60;
	howl(mix, 0, o.end, { pan: (t) => 0.5 * Math.sin(t * 0.21), level: (t) => db(-36) * smooth(0, 1.5, t) * (1 - smooth(o.land, o.rest, t)), pitch: () => 150, muffle: () => 1000 }, seedOf('night air'));
	owl(mix, o.owl, db(-22), 420, 0.55);

	const ice = [1760, 1975.53, 2217.46, 2637.02, 2959.96];
	tufts(o).forEach((f, k) => frostTuft(mix, f.t, db(-29), ice[f.note], panOf(f.pixel), seedOf('tuft', k)));
	// The cold swelling to the moment the leaf lets go, and stopping dead there.
	const silenced = (t) => 1 - smooth(o.letGo - 0.04, o.letGo, t);
	lush(mix, 0, o.letGo, [440, 659.26, 880, 1108.73], (t) => db(-37 + 6 * smooth(o.frost, o.shiver, t)) * smooth(0, 3, t) * silenced(t), { bright: (t) => 1800 + 3000 * smooth(o.frost, o.shiver, t), detune: 0.1, hall: 0.5, shimmer: 0.35, body: 0.2, seed: seedOf('frost pad') });
	choir(mix, o.frost + 4, o.letGo, [220, 329.63, 440, 554.37, 659.26], (t) => db(-32 + 18 * smooth(o.frost + 4, o.shiver, t)) * silenced(t), seedOf('frost choir'));
	// Held on a suspension while the leaf shivers.
	choir(mix, o.shiver, o.letGo, [293.66, 440, 587.33], (t) => db(-20) * smooth(o.shiver, o.shiver + 1, t) * silenced(t), seedOf('suspension'));
	for (let t = o.rimed - 4, k = 0; t < o.letGo - 0.05; t += 1 / 16, k++) {
		taiko(mix, t, db(-31 + 15 * smooth(o.rimed - 4, o.letGo, t)), (k % 2 === 0 ? -1 : 1) * 0.3, seedOf('timpani', k));
	}
	riser(mix, o.rimed - 1, o.letGo, { gain: db(-20), fromHz: 1500, toHz: 7000, seed: seedOf('frost closing') });
	rustle(mix, o.shiver, o.letGo, { level: (t) => db(-27) * (0.5 + 0.5 * Math.sin(TAU * 9 * t)) ** 2 * smooth(o.shiver, o.shiver + 0.5, t), pan: () => 0 }, seedOf('shiver'));
	hole(mix, o.letGo, o.letGo + 0.9);
	stemSnap(mix, o.letGo, db(-8), 0, seedOf('stem'));

	// The fall: each swing turns on a note of the leaf's descent, over a heart slowing under it.
	const leafPan = (t) => {
		const along = leafAlong(o, t);
		return along <= LEAF ? 0 : panOf(SOUTH + (along - LEAF));
	};
	const descent = [1318.51, 1174.66, 1108.73, 987.77, 880, 830.61, 739.99, 659.26, 587.33];
	swingTimes(o).forEach((t, k) => {
		swish(mix, t - 0.45, 0.8, db(-24), leafPan(t - 0.45), leafPan(t + 0.35), seedOf('swing', k));
		bell(mix, t, db(-17 + 0.4 * k), descent[k % descent.length], leafPan(t), { decay: 2.2, index: 1.4 });
		heartSound(mix, t + 0.6, db(-10 - 0.5 * k), true, 0);
	});
	choir(mix, o.letGo + 3, o.land, [220, 329.63], (t) => db(-30 + 10 * smooth(o.letGo + 3, o.land, t)) * (1 - smooth(o.land - 0.04, o.land, t)), seedOf('falling'));
	swell(mix, o.land, 2.2, [220, 329.63, 440, 554.37], db(-16), seedOf('landing breath'));

	// The last light: a warm bloom out of the corner, the frost ringing as the gold runs round it.
	bloom(mix, o.land, o.end, { beat: 2 * beat, chord: ADD9, size: 0.8, voice: 'bell', rate: 2, breathe: 0.12, choirLevel: -15, seed: 'last light' });
	for (let k = 0; k < 16; k++) {
		glass(mix, o.land + 0.1 + 0.07 * k, db(-26), ice[k % ice.length], (k % 2 === 0 ? -1 : 1) * Math.min(0.8, 0.1 + k * 0.05), { decay: 0.6 });
	}
	lush(mix, o.ebb, o.end, [110, 164.81, 220, 277.18], (t) => db(-30) * smooth(o.ebb, o.ebb + 2, t), { bright: () => 1600, detune: 0.1, hall: 0.5, shimmer: 0.3, seed: seedOf('ebb') });
	bell(mix, o.rest, db(-20), 880, panOf(HOME), { decay: 3 });
}

/** The speed of something whose position is `at(t)`, in pixels a second. */
const speedOf = (at, t) => Math.abs(at(t + 0.01) - at(t - 0.01)) / 0.02;
const ringPan = (x) => panOf(((Math.round(x) % RING) + RING) % RING);

/** Špačci: the flock's chatter and wings on a building groove, the hush, and the flock taking off. */
export function scoreSpacci(mix, o) {
	mix.ride([[0, -5], [o.swirl, -7], [o.rush, -6.5], [o.hush, -6], [o.lift, 0]]);
	const beat = 60 / o.bpm;
	const bar = 4 * beat;
	const held = (t) => 1 - smooth(o.hush - 0.04, o.hush, t);
	const flockPan = (t) => ringPan(flockAt(o, t));
	const flying = (t) => Math.min(1, speedOf((u) => flockAt(o, u), t) / 900);

	lush(mix, 0, o.hush, [110, 164.81, 220, 261.63], (t) => db(-31 + 6 * smooth(0, o.hush, t)) * smooth(0, 2, t) * held(t), { bright: (t) => 900 + 2500 * smooth(o.swirl, o.hush, t), pump: true, hall: 0.35, seed: seedOf('dusk') });
	chatter(
		mix,
		0.5,
		o.lift + 3,
		{
			density: (t) => (t < o.hush ? 20 + 380 * smooth(o.arrive, o.rush, t) : t < o.lift ? 0 : 900 * Math.exp(-(t - o.lift) / 0.7)),
			pan: flockPan
		},
		seedOf('starlings')
	);
	howl(
		mix,
		o.arrive - 0.5,
		o.hush,
		{ pan: flockPan, level: (t) => db(-30 + 15 * flying(t)) * smooth(o.arrive - 0.5, o.arrive + 0.5, t) * held(t), pitch: (t) => 260 + 500 * flying(t), muffle: (t) => 2200 + 7000 * flying(t) },
		seedOf('wings')
	);
	spacciDrums(o).forEach((d, k) => {
		taiko(mix, d.t, db(-13 + 5 * smooth(o.swirl, o.hush, d.t) + 6 * (d.size - 1)), k % 2 === 0 ? -0.2 : 0.2, seedOf('flock drum', k));
		mix.duck(d.t, 0.45 * d.size, beat * 0.9);
	});
	ostinato(
		mix,
		o.swirl,
		o.hush,
		{
			pattern: [220, 261.63, 329.63, 261.63, 220, 261.63, 349.23, 329.63],
			rate: (t) => (t < o.rush ? 2 : 4) / beat,
			bright: (t) => 800 + 4800 * smooth(o.swirl, o.hush, t),
			level: (t) => db(-21 + 4 * smooth(o.swirl, o.hush, t)) * held(t),
			pump: true
		},
		seedOf('flock strings')
	);
	choir(mix, o.swirl, o.hush, [220, 261.63, 329.63, 440], (t) => db(-27 + 9 * smooth(o.swirl, o.hush, t)) * held(t), seedOf('flock choir'));
	for (let t = o.rush + bar, k = 0; t < o.hush - 1e-6; k++) {
		const u = (t - o.rush - bar) / (o.hush - o.rush - bar);
		snare(mix, t, db(-19 + 9 * u), u, (k % 2 === 0 ? -1 : 1) * 0.25, seedOf('flock roll', k));
		t += 1 / (6 + 18 * u);
	}
	shepard(mix, o.rush, o.hush, (t) => db(-29 + 10 * smooth(o.rush, o.hush, t)));
	riser(mix, o.rush, o.hush, { gain: db(-15), fromHz: 240, toHz: 6400, notes: [220, 329.63, 440], seed: seedOf('flock rise') });

	// The flock hangs in the silence, then lifts all at once into the sunset.
	hole(mix, o.hush, o.lift);
	wings(mix, o.lift - 0.08, o.lift + 3.5, { level: (t) => db(-8) * smooth(o.lift - 0.08, o.lift + 0.05, t) * Math.exp(-Math.max(0, t - o.lift) / 0.9), lift: (t) => Math.exp(-Math.max(0, t - o.lift) / 1.2), pan: (t) => 0.7 * Math.sin(2.2 * (t - o.lift)) }, seedOf('take off'));
	whoosh(mix, o.lift - 0.05, 2, db(-11), -0.9, 0.9, seedOf('take off air'));
	bloom(mix, o.lift, o.end, { beat, chord: SIX9, voice: 'bell', rate: 2, choirLevel: -15, seed: 'sunset' });
}

/** Polární záře: the drone, the shimmer and the voices rising with the curtains, and the corona. */
export function scoreZare(mix, o) {
	mix.ride([[0, -4], [o.curtain, -5.5], [o.surge, -5], [o.corona - 2, -3], [o.corona, 0]]);
	const bar = 240 / o.bpm;
	const beat = bar / 4;
	const cut = (t) => 1 - smooth(o.corona - 0.4, o.corona - 0.36, t);
	lush(mix, 0, o.corona, [55, 110, 164.81], (t) => db(-25 + 3 * smooth(0, o.corona, t)) * smooth(0, 3, t) * cut(t), { bright: (t) => 500 + 900 * smooth(0, o.corona, t), detune: 0.1, hall: 0.4, body: 0.6, seed: seedOf('aurora drone') });
	lush(mix, o.glow, o.corona, [440, 659.26, 880, 987.77], (t) => db(-32 + 7 * smooth(o.glow, o.corona, t)) * smooth(o.glow, o.glow + 3, t) * cut(t), { bright: (t) => 2200 + 4000 * smooth(o.glow, o.corona, t), detune: 0.14, width: 1, hall: 0.55, shimmer: 0.45, body: 0.1, pump: true, seed: seedOf('aurora veil') });
	choir(mix, o.curtain, o.corona, [220, 329.63, 440, 493.88, 659.26], (t) => db(-25 + 11 * smooth(o.curtain, o.corona, t)) * smooth(o.curtain, o.curtain + 2, t) * cut(t), seedOf('aurora choir'));
	const sparkle = [1760, 1975.53, 2637.02, 2959.96, 3520];
	for (let t = o.glow, k = 0; t < o.corona - 0.5; k++) {
		const u = smooth(o.glow, o.corona, t);
		glass(mix, t, db(-25 + 5 * u), sparkle[k % sparkle.length], (hash01(k * 7 + 3) - 0.5) * 1.6, { decay: 0.5, echo: 0.3 });
		t += (0.5 + hash01(k * 13 + 1)) / (2 + 12 * u);
	}
	howl(mix, o.glow, o.corona, { pan: (t) => 0.7 * Math.sin(t * 0.4), level: (t) => db(-34 + 10 * smooth(o.glow, o.corona, t)) * cut(t), pitch: (t) => 700 + 700 * smooth(o.glow, o.corona, t), muffle: () => 6000 }, seedOf('aurora air'));
	// The substorm: drums on the bar, a roll under the last of it, and the rise into the corona.
	for (let t = o.surge, k = 0; t < o.corona - 0.5; t += bar / 2, k++) {
		taiko(mix, t, db(k % 2 === 0 ? -9 : -15), 0, seedOf('aurora drum', k));
		mix.duck(t, k % 2 === 0 ? 0.35 : 0.2, beat * 1.6);
	}
	for (let t = o.corona - 2 * bar, k = 0; t < o.corona - 0.4; t += 1 / 14, k++) {
		taiko(mix, t, db(-26 + 14 * smooth(o.corona - 2 * bar, o.corona, t)), (k % 2 === 0 ? -1 : 1) * 0.25, seedOf('aurora roll', k));
	}
	shepard(mix, o.surge, o.corona - 0.4, (t) => db(-30 + 10 * smooth(o.surge, o.corona, t)));
	riser(mix, o.corona - bar, o.corona - 0.4, { gain: db(-14), fromHz: 300, toHz: 6000, notes: [440, 659.26, 880], seed: seedOf('aurora rise') });
	hole(mix, o.corona - 0.4, o.corona);
	swell(mix, o.corona, 0.38, [440, 554.37, 659.26, 830.61], db(-16), seedOf('corona breath'));
	bloom(mix, o.corona, o.end, { beat, chord: MAJ9, voice: 'glass', rate: 2, breathe: 0.2, choirLevel: -13, seed: 'corona' });
	choir(mix, o.corona + 0.3, o.end, [880, 1108.73, 1318.51], (t) => db(-21) * smooth(o.corona + 0.3, o.corona + 1.5, t) * (1 - smooth(o.corona + 3, o.end, t)), seedOf('corona high'));
}

/** The major triad on `root` Hz, with its seventh when asked. */
const triad = (root, seventh) => [root, root * Math.pow(2, 4 / 12), root * Math.pow(2, 7 / 12), ...(seventh ? [root * Math.pow(2, 10 / 12)] : [])];
/** The chord under beat `beat` of the tune. */
const chordAt = (beat) => CHORDS.reduce((found, c) => (c.beat <= beat + 1e-6 ? c : found), CHORDS[0]);

/** Hodně štěstí: the dark, eighteen candles, the tune softly for singing, then with everything. */
export function scoreNarozeniny(mix, o) {
	const beat = 60 / o.bpm;
	const notes = tune(o);
	const second = notes.filter((n) => n.verse === 2);
	const lastNote = second[second.length - 1];
	const finish = lastNote.t + lastNote.length;
	mix.ride([[0, -4], [o.verse1, -6.5], [o.verse2 - 6 * beat, -5], [o.verse2 - 0.5, -1], [o.verse2, 0]]);

	// The lights go down; each candle is a match and a note, climbing.
	air(mix, 0, o.dark + 0.4, { level: (t) => db(-24) * smooth(0, o.dark + 0.3, t) * (1 - smooth(o.dark + 0.3, o.dark + 0.4, t)), centre: (t) => 3000 * Math.pow(400 / 3000, Math.min(1, t / (o.dark + 0.4))), q: 1, hall: 0.3 }, seedOf('lights down'));
	const climb = [349.23, 392, 440, 523.25, 587.33];
	candles(o).forEach((c, k) => {
		matchStrike(mix, c.t - 0.06, db(-21), panOf(c.pixel), seedOf('candle match', k));
		celesta(mix, c.t, db(-14), climb[k % 5] * Math.pow(2, Math.floor(k / 5)), panOf(c.pixel));
	});
	flame(mix, o.light, o.end, { level: (t) => db(-34) * smooth(o.light, o.light + 4, t), size: () => 0.04, pan: () => 0 }, seedOf('candles burning'));
	lush(mix, o.light + 2, o.verse1, [174.61, 220, 261.63, 349.23], (t) => db(-33) * smooth(o.light + 2, o.verse1 - 1, t), { bright: () => 1300, detune: 0.1, hall: 0.45, shimmer: 0.2, seed: seedOf('candle pad') });

	// The first verse, in F, for everyone to sing: celesta and harp on the tune, a waltz under it.
	for (const n of notes.filter((m) => m.verse === 1)) {
		celesta(mix, n.t, db(-11), n.freq * 2, 0);
		pluck(mix, n.t, db(-16), n.freq, 0, seedOf('harp', Math.round(n.t * 1000)));
	}
	for (let b = 1; b < 25; b++) {
		const c = chordAt(b);
		const root = 87.31 * Math.pow(2, c.root / 12);
		const t = o.verse1 + b * beat;
		if ((b - 1) % 3 === 0) pluck(mix, t, db(-14), root, 0, seedOf('bass', b), { hall: 0.15, echo: 0 });
		else triad(root * 2, c.seventh).forEach((f, k) => pluck(mix, t, db(-22), f, 0.4 - k * 0.3, seedOf('waltz', b * 10 + k)));
	}
	lush(mix, o.verse1, o.verse2, [174.61, 220, 261.63], (t) => db(-35) * (1 - smooth(o.verse2 - 6 * beat, o.verse2 - 4 * beat, t)), { bright: () => 1200, detune: 0.1, hall: 0.45, seed: seedOf('verse pad') });

	// Two bars into the new key: a roll, the brass swelling on the new dominant, the rise.
	const build = o.verse2 - 6 * beat;
	for (let t = build, k = 0; t < o.verse2 - 0.02; t += 1 / 14, k++) taiko(mix, t, db(-26 + 18 * smooth(build, o.verse2, t)), (k % 2 === 0 ? -1 : 1) * 0.25, seedOf('birthday roll', k));
	braam(mix, build, o.verse2 - build, db(-12), [73.42, 146.83, 185, 220, 293.66], seedOf('to G'));
	riser(mix, build, o.verse2, { gain: db(-14), fromHz: 250, toHz: 6000, notes: [293.66, 369.99, 440], seed: seedOf('birthday rise') });

	// The second verse, in G, with everything: horns on the tune, voices, strings and drums.
	crash(mix, o.verse2, db(-10), 0, seedOf('verse two crash'));
	subDrop(mix, o.verse2, db(-8));
	gliss(mix, o.verse2 - 0.02, 0.5, pentatonic(196, 11), db(-14), -0.8, 0.8, 21);
	for (const n of second) {
		brassLead(mix, n.t, n.length * 0.95, db(-7), n.freq, seedOf('horn', Math.round(n.t * 1000)));
		brassLead(mix, n.t, n.length * 0.95, db(-12), n.freq / 2, seedOf('low horn', Math.round(n.t * 1000)));
	}
	for (let b = 0; b < 25 + o.hold - 3; b += 3) {
		const c = chordAt(Math.min(b + 1, 24));
		const root = 98 * Math.pow(2, c.root / 12);
		const from = o.verse2 + (b + 1) * beat;
		const until = Math.min(finish, from + 3 * beat);
		if (from >= finish) break;
		const tones = triad(root * 2, c.seventh);
		choir(mix, from, until, tones.map((f) => f * 2), (t) => db(-13) * smooth(from, from + 0.08, t) * (1 - smooth(until - 0.08, until, t)), seedOf('verse choir', b));
		lush(mix, from, until, tones, (t) => db(-28) * smooth(from, from + 0.05, t) * (1 - smooth(until - 0.08, until, t)), { bright: () => 2600, pump: true, hall: 0.35, seed: seedOf('verse pad', b) });
		ostinato(mix, from, until, { pattern: [tones[0], tones[1], tones[2], tones[0] * 2, tones[2], tones[1]], rate: () => 2 / beat, bright: () => 4200, level: () => db(-18) }, seedOf('verse strings', b));
		taiko(mix, from, db(-4), 0, seedOf('verse drum', b));
		taiko(mix, from + beat, db(-15), -0.25, seedOf('verse drum 2', b));
		taiko(mix, from + 2 * beat, db(-15), 0.25, seedOf('verse drum 3', b));
		mix.duck(from, 0.4, beat);
		pluck(mix, from, db(-9), root / 2, 0, seedOf('verse bass', b), { hall: 0.1, echo: 0 });
	}
	// The held last note: a roll swelling under it, then the whole room blooming on the cut-off.
	const held = finish - o.hold * beat;
	for (let t = held, k = 0; t < finish - 0.02; t += 1 / 16, k++) taiko(mix, t, db(-23 + 15 * smooth(held, finish, t)), (k % 2 === 0 ? -1 : 1) * 0.3, seedOf('last roll', k));
	crash(mix, held, db(-13), 0, seedOf('held crash'));
	cymbalSwell(mix, finish, 2.5, db(-20), seedOf('held air'));
	bloom(mix, finish, o.end, { beat: 3 * beat, chord: ADD9, key: -2, size: 1.05, voice: 'bell', rate: 3, breathe: 0.2, choirLevel: -13, seed: 'happy birthday' });
	for (let k = 0; k < 5; k++) celesta(mix, finish + 0.5 + k * beat, db(-16 - k), [783.99, 987.77, 1174.66, 1567.98, 1975.53][k], (k - 2) * 0.35);
}

/** Sfouknuto: a breath, the candles out, a beat of dark, then fireworks, a groove and the letters. */
export function scoreSfouknuto(mix, o) {
	mix.ride([[0, 0], [o.boom + 1.5, 0], [o.happy + 1, -2], [o.finale - 0.5, -2], [o.finale, 0]]);
	const beat = 60 / o.bpm;
	swish(mix, 0.02, 1, db(-9), -0.7, 0.7, seedOf('blow'));
	for (let k = 0; k < 18; k++) pop(mix, o.out + k * 0.05, db(-26), (k / 17) * 1.6 - 0.8, seedOf('candle out', k));
	riser(mix, 0.9, o.boom, { gain: db(-12), fromHz: 200, toHz: 7000, notes: [196, 293.66, 392], seed: seedOf('wish rise') });
	whoosh(mix, o.boom - 0.05, 1.6, db(-10), -0.9, 0.9, seedOf('everything up'));
	bloom(mix, o.boom, o.end, { beat, chord: ADD9, key: -2, size: 1.1, voice: 'pluck', rate: 2, breathe: 0.55, choirLevel: -15, seed: 'blown out' });

	// The groove under the letters: kick on every beat, claps on two and four, bass in G.
	for (let t = o.boom, k = 0; t < o.end - 2; t += beat, k++) {
		kick(mix, t, db(-6));
		if (k % 2 === 1) snare(mix, t, db(-14), 0.6, 0.1, seedOf('party clap', k));
	}
	ostinato(mix, o.boom, o.end - 2, { pattern: [49, 49, 98, 49, 73.42, 49, 98, 61.74], rate: () => 2 / beat, bright: () => 1100, level: (t) => db(-12) * (1 - smooth(o.end - 3, o.end - 2, t)), pump: true, echo: 0 }, seedOf('party bass'));
	// Every letter a chord stab and a bell, stepping up G major.
	const steps = [196, 220, 246.94, 261.63, 293.66, 0, 329.63, 369.99, 392, 440, 0, 493.88, 587.33];
	spelling(o).forEach((l, k) => {
		if (l.char === ' ') return;
		const root = steps[k] || 392;
		stab(mix, l.t, 0.5, db(-15), [root, root * 1.5, root * 2, root * 2.5198], seedOf('letter', k));
		bell(mix, l.t, db(-18), root * 4, (k % 2 === 0 ? -1 : 1) * 0.4, { decay: 1.2 });
		taiko(mix, l.t, db(-9), 0, seedOf('letter drum', k));
	});
	fireworks(o).forEach((f, k) => {
		launch(mix, f.t - 0.6, 0.6, db(-24), panOf(f.pixel) * 0.6, seedOf('launch', k));
		burst(mix, f.t, db(-13 + 4 * f.size), panOf(f.pixel) * 1.3, seedOf('burst', k));
	});
	// The finale: the voices and a harp over the barrage, everything opening wider.
	choir(mix, o.finale, o.end, [392, 493.88, 587.33, 783.99], (t) => db(-14) * smooth(o.finale, o.finale + 0.4, t) * (1 - smooth(o.finale + 3, o.end, t)), seedOf('finale choir'));
	lush(mix, o.finale, o.end, [783.99, 987.77, 1174.66], (t) => db(-27) * smooth(o.finale, o.finale + 0.6, t) * (1 - smooth(o.finale + 3, o.end, t)), { bright: () => 8000, width: 1, hall: 0.5, shimmer: 0.5, body: 0, seed: seedOf('finale air') });
	gliss(mix, o.finale - 0.05, 0.6, pentatonic(392, 11), db(-13), 0.8, -0.8, 18);
	crash(mix, o.finale, db(-14), 0, seedOf('finale crash'));
}

/** Půlnoc: the clock, the lamps out, the match, the fire to war drums, ten to one, and midnight. */
export function scorePulnoc(mix, o) {
	mix.ride([[0, -6], [o.match, -5.5], [o.catch + 2, -5], [o.double, -3.5], [o.again, -1.5], [o.inhale, 0]]);
	const size = (t) => fireReach(o, t) / (RING / 2);
	const held = (t) => 1 - smooth(o.inhale - 0.04, o.inhale, t);
	howl(mix, 0, o.catch + 1, { pan: (t) => 0.5 * Math.sin(t * 0.3), level: (t) => db(-34) * smooth(0, 1, t) * (1 - smooth(o.catch, o.catch + 1, t)), pitch: () => 140, muffle: () => 800 }, seedOf('fog air'));
	lush(mix, 0, o.inhale, [55, 110, 164.81, 220, 261.63], (t) => db(-29 + 4 * smooth(0, o.inhale, t)) * smooth(0, 2, t) * held(t), { bright: (t) => 500 + 2500 * smooth(o.catch, o.inhale, t), detune: 0.12, hall: 0.4, body: 0.5, pump: true, seed: seedOf('fog pad') });
	for (let t = 0, k = 0; t < o.count - 1e-6; t += 1, k++) tick(mix, t, db(-8 + 3 * smooth(o.catch, o.inhale, t)), k % 2 === 1, seedOf('clock', k));
	[o.lamp1, o.lamp2, o.lamp3].forEach((t, k) => clack(mix, t + 0.1, db(-22), seedOf('lamp', k), panOf(LAMPS[k])));

	matchStrike(mix, o.match, db(-5), panOf(HOME), seedOf('match'));
	flame(mix, o.match + 0.15, o.catch + 0.4, { level: (t) => db(-24) * smooth(o.match + 0.1, o.match + 0.6, t) * (1 - smooth(o.catch, o.catch + 0.4, t)), size: () => 0.06, pan: () => panOf(HOME) }, seedOf('match flame'));
	whump(mix, o.catch, db(-6), panOf(HOME), seedOf('catch'));
	const roar = (t) => (t < o.midnight ? size(t) : 1);
	flame(
		mix,
		o.catch - 0.05,
		o.end,
		{
			level: (t) => db(-23 + 10 * roar(t)) * smooth(o.catch - 0.05, o.catch + 0.3, t) * (t < o.midnight ? 1 - 0.95 * smooth(o.inhale, o.inhale + 0.3, t) : 1) * (1 - 0.6 * smooth(o.midnight + 2, o.end, t)),
			size: roar,
			pan: () => panOf(HOME)
		},
		seedOf('leaf fire')
	);
	pops(o).forEach((p, k) => pop(mix, p.t, db(-18), panOf(p.pixel) * 1.3, seedOf('pop', k)));
	warDrums(o).forEach((d, k) => {
		taiko(mix, d.t, db(-10 + 3 * smooth(o.catch, o.inhale, d.t) + 7 * (d.size - 1)), k % 2 === 0 ? -0.3 : 0.3, seedOf('war drum', k));
		if (d.size === 1) mix.duck(d.t, 0.4, 0.8);
	});
	choir(mix, o.catch, o.inhale, [110, 164.81, 220, 261.63, 329.63], (t) => db(-28 + 13 * smooth(o.catch, o.inhale, t)) * held(t), seedOf('fire choir'));
	ostinato(
		mix,
		o.double,
		o.inhale,
		{
			pattern: [110, 130.81, 164.81, 130.81, 110, 130.81, 196, 164.81],
			rate: (t) => (t < o.again ? 4 : 8),
			bright: (t) => 600 + 4400 * smooth(o.double, o.inhale, t),
			level: (t) => db(-21 + 4 * smooth(o.double, o.inhale, t)) * held(t),
			pump: true
		},
		seedOf('fire strings')
	);
	shepard(mix, o.again, o.inhale, (t) => db(-28 + 8 * smooth(o.again, o.inhale, t)) * held(t));

	// The fire drawn back into the corner, then the count: a bell, a drum and a chord for every number.
	hole(mix, o.inhale, o.count);
	riser(mix, o.inhale, o.count, { gain: db(-11), fromHz: 120, toHz: 5200, seed: seedOf('inhale') });
	swell(mix, o.count, 0.9, [220, 261.63, 329.63, 440], db(-16), seedOf('inhale chord'));
	for (let n = 0; n < 10; n++) {
		const t = o.count + n;
		const step = Math.pow(2, n / 12);
		churchBell(mix, t, db(-6 + 0.3 * n), 146.83, (n % 2 === 0 ? -1 : 1) * 0.2);
		taiko(mix, t, db(-3), 0, seedOf('count drum', n));
		stab(mix, t, 0.8, db(-16 + 0.5 * n), [110, 164.81 * step, 220 * step, 261.63 * step], seedOf('count stab', n));
		mix.duck(t, 0.4, 0.8);
	}
	choir(mix, o.count, o.midnight, [220, 261.63, 329.63, 440, 523.25], (t) => db(-24 + 12 * smooth(o.count, o.midnight, t)) * (1 - smooth(o.midnight - 0.16, o.midnight - 0.12, t)), seedOf('count choir'));
	shepard(mix, o.count, o.midnight - 0.12, (t) => db(-28 + 10 * smooth(o.count, o.midnight, t)));
	riser(mix, o.midnight - 3, o.midnight - 0.12, { gain: db(-14), fromHz: 300, toHz: 7000, notes: [220, 329.63, 440], seed: seedOf('last seconds') });
	hole(mix, o.midnight - 0.12, o.midnight);

	// Midnight: the bell, the fire rushing round the room, and everything opening into A major.
	churchBell(mix, o.midnight, db(-5), 110, 0);
	whoosh(mix, o.midnight - 0.05, 2.5, db(-8), -0.9, 0.9, seedOf('backdraft'));
	bloom(mix, o.midnight, o.end, { beat: 1, chord: WHOLE, size: 1.15, voice: 'glass', rate: 4, breathe: 0.3, choirLevel: -12, seed: 'midnight' });
	gliss(mix, o.midnight + 0.6, 0.8, pentatonic(440, 11), db(-15), 0.8, -0.8, 31);
}

/** Orionidy: the night sky, meteors thickening on the drums, the fireball, the silence, the shower. */
export function scoreOrionidy(mix, o) {
	mix.ride([[0, -6.5], [o.shower - 0.3, -6.5], [o.shower, -2.5], [o.storm, -2], [o.burst, -1], [o.fall, 0]]);
	const beat = 60 / o.bpm;
	const bar = 4 * beat;
	const held = (t) => 1 - smooth(o.burst - 0.04, o.burst, t);
	lush(mix, 0, o.burst, [55, 110, 164.81, 220], (t) => db(-28 + 3 * smooth(0, o.burst, t)) * smooth(0, 2, t) * held(t), { bright: (t) => 600 + 1800 * smooth(0, o.burst, t), detune: 0.12, hall: 0.4, body: 0.5, pump: true, seed: seedOf('night pad') });
	lush(mix, 0, o.burst, [880, 1318.51, 1760], (t) => db(-35 + 5 * smooth(0, o.burst, t)) * smooth(0, 3, t) * held(t), { bright: () => 7000, detune: 0.1, width: 1, hall: 0.55, shimmer: 0.45, body: 0, seed: seedOf('night veil') });
	// The brightest meteors are heard as they go.
	meteors(o).forEach((m, k) => {
		if (m.length < 30 || (m.t > o.burst && m.t < o.fall + 0.5)) return;
		const to = m.from + m.dir * m.speed * m.life;
		streak(mix, m.t, m.life, db(-28), ringPan(m.from) * 1.3, ringPan(to) * 1.3, seedOf('meteor', k));
	});
	for (let t = o.shower, k = 0; t < o.burst - 1e-6; t += beat / 2, k++) {
		const inBar = k % 8;
		if (t < o.storm - 1e-6) {
			if (inBar === 0) {
				taiko(mix, t, db(-9), 0, seedOf('sky drum', k));
				mix.duck(t, 0.35, beat * 1.5);
			} else if (inBar === 5) taiko(mix, t, db(-15), 0.2, seedOf('sky drum', k));
		} else if (k % 2 === 0) {
			taiko(mix, t, db(-11 + 2 * smooth(o.storm, o.burst, t)), (k % 4 === 0 ? -1 : 1) * 0.25, seedOf('sky drum', k));
			mix.duck(t, 0.4, beat * 0.9);
		}
	}
	ostinato(mix, o.shower, o.burst, { pattern: [220, 329.63, 440, 329.63, 220, 329.63, 493.88, 440], rate: (t) => (t < o.storm ? 2 : 4) / beat, bright: (t) => 900 + 4400 * smooth(o.shower, o.burst, t), level: (t) => db(-21 + 4 * smooth(o.shower, o.burst, t)) * held(t), pump: true }, seedOf('sky strings'));
	choir(mix, o.storm - bar, o.burst, [220, 329.63, 440, 523.25], (t) => db(-26 + 8 * smooth(o.storm - bar, o.burst, t)) * held(t), seedOf('sky choir'));
	for (let t = o.storm + bar, k = 0; t < o.bolide - 1e-6; k++) {
		const u = (t - o.storm - bar) / (o.bolide - o.storm - bar);
		snare(mix, t, db(-19 + 8 * u), u, (k % 2 === 0 ? -1 : 1) * 0.25, seedOf('sky roll', k));
		t += 1 / (6 + 16 * u);
	}
	// The fireball: a roar growing as it crosses to home, then it bursts into sparks.
	riser(mix, o.bolide, o.burst, { gain: db(-11), fromHz: 150, toHz: 5000, notes: [220, 329.63, 440], seed: seedOf('fireball') });
	shepard(mix, o.storm, o.burst, (t) => db(-29 + 10 * smooth(o.storm, o.burst, t)));
	burst(mix, o.burst, db(-3), ringPan(bolideAt(o, o.burst)), seedOf('fireball burst'));
	whoosh(mix, o.burst - 0.05, 1.2, db(-10), ringPan(bolideAt(o, o.burst)), -ringPan(bolideAt(o, o.burst)), seedOf('fireball air'));
	for (let k = 0; k < 10; k++) glass(mix, o.burst + 0.05 + k * 0.04, db(-20 - k), 3520 * Math.pow(2, -k / 7), (hash01(k * 5 + 1) - 0.5) * 1.6, { decay: 0.2 });
	// The breath of silence after the flash, then the whole sky coming down in a shower of light.
	hole(mix, o.burst + 0.5, o.fall);
	swell(mix, o.fall, o.fall - o.burst - 0.55, [440, 554.37, 659.26, 880], db(-15), seedOf('sky breath'));
	bloom(mix, o.fall, o.end, { beat, chord: ADD9, size: 1.05, voice: 'glass', rate: 4, breathe: 0.35, choirLevel: -14, seed: 'shower' });
	for (let k = 0; k < 36; k++) {
		const at = o.fall + 0.3 + k * 0.16 + 0.08 * hash01(k * 9 + 2);
		glass(mix, at, db(-24) * Math.exp(-k / 30), 1760 * Math.pow(2, -(k % 8) / 12) * (k % 3 === 0 ? 2 : 1), (hash01(k * 17 + 4) - 0.5) * 1.8, { decay: 0.35, echo: 0.3 });
	}
}
