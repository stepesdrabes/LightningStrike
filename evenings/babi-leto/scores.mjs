/**
 * Scores for Babí léto's moments. Each lands its events on the times its effect reads from the
 * same timing table, builds on its own grid into a drop, and rings out after it. The night is in
 * A: minor for the storm, the fog and the fire's climb, major for every arrival.
 */
import {
	TAU,
	approach,
	chime,
	clack,
	crack,
	db,
	heartSound,
	howl,
	impact,
	pad,
	ping,
	pressure,
	ringX,
	rollHit,
	seedOf,
	smooth,
	streak
} from '../light-before-thunder/instruments.mjs';
import {
	blip,
	braam,
	brassLead,
	burst,
	celesta,
	chatter,
	churchBell,
	choir,
	clink,
	corkPop,
	crash,
	creak,
	crickets,
	fizzle,
	flame,
	flutter,
	frostTuft,
	hole,
	kick,
	launch,
	lineHum,
	matchStrike,
	ostinato,
	owl,
	pluck,
	pop,
	rattle,
	rustle,
	sailSnap,
	shepard,
	stemSnap,
	subDrop,
	swish,
	taiko,
	tick,
	twang,
	warmth,
	whump
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
	countdown,
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

const A_MAJOR_LOW = [55, 82.41, 110, 138.59, 164.81];
const A_MINOR_LOW = [55, 82.41, 110, 130.81];
const A_MAJOR_CHOIR = [220, 277.18, 329.63, 440, 554.37];
const A_MINOR_CHOIR = [220, 261.63, 329.63, 440];

/**
 * The arrival every moment builds to: brass, choir, drum, cymbal and the floor falling away, in A
 * major unless `shift` semitones move it.
 */
function arrival(mix, t, until, { size = 1, choirLevel = -15, shift = 0, seed }) {
	const k = Math.pow(2, shift / 12);
	braam(mix, t, Math.min(7, until - t), db(-5 + 4 * (size - 1)), A_MAJOR_LOW.map((f) => f * k), seedOf(seed, 1));
	choir(mix, t, until, A_MAJOR_CHOIR.map((f) => f * k), (u) => db(choirLevel) * smooth(t - 0.02, t + 0.25, u) * (1 - 0.6 * smooth(t + 1, until, u)), seedOf(seed, 2));
	taiko(mix, t, db(-2), 0, seedOf(seed, 3));
	crash(mix, t, db(-10), 0, seedOf(seed, 4));
	subDrop(mix, t, db(-5));
	impact(mix, t, db(-7), seedOf(seed, 5), 0);
	[880, 1108.73, 1318.51, 1760, 2217.46].forEach((note, j) => chime(mix, t + 0.05 + j * 0.07, db(-19 - j), note * k, (j - 2) * 0.3));
	pad(mix, t - 0.1, until, [110, 164.81, 220, 277.18, 329.63, 440].map((f) => f * k), (u) => db(-20) * smooth(t - 0.1, t + 1, u) * (1 - 0.7 * smooth(t + 1.5, until, u)));
}

/** Vítr: a still evening, two gusts, the storm's vortex on drums, the great gust, silence, gold. */
export function scoreVitr(mix, o) {
	const beat = 60 / o.bpm;
	const bar = 4 * beat;
	const cut = (t) => 1 - smooth(o.hush - 0.06, o.hush, t);
	const storming = (t) => smooth(o.storm, o.peak, t);

	// Go: the gossamer catches the sun, a shimmer from one side of the room to the other.
	[1760, 2217.46, 2637.02, 3520, 2637.02, 2217.46, 1760].forEach((note, k) => ping(mix, o.glint + k * 0.05, db(-24), note, -0.6 + (k / 6) * 1.2));
	chime(mix, o.glint, db(-20), 880, 0);
	pad(mix, 0, o.storm + 2, [110, 164.81, 220, 277.18, 329.63], (t) => db(-21) * smooth(0, 2, t) * (1 - smooth(o.storm - 1, o.storm + 2, t)));
	crickets(mix, 0.4, o.gust2 + 0.5, (t) => db(-27) * smooth(0.4, 2.5, t) * (1 - smooth(o.gust1, o.gust1 + 1, t) * 0.6) * (1 - smooth(o.gust2 - 0.3, o.gust2 + 0.3, t)), seedOf('crickets'));

	// The two gusts out of the west wall, the front running round to the east.
	[
		{ t: o.gust1, cross: o.cross1, size: 0.6 },
		{ t: o.gust2, cross: o.cross2, size: 0.85 }
	].forEach((g, k) => {
		const blow = (t) => smooth(g.t - 0.6, g.t + 0.4, t) * (1 - smooth(g.t + g.cross, g.t + g.cross + 3, t));
		const across = (t) => -0.6 + 1.2 * smooth(g.t, g.t + g.cross, t);
		howl(mix, g.t - 0.6, g.t + g.cross + 3.2, { pan: across, level: (t) => db(-30 + 7 * g.size) * blow(t), pitch: (t) => 170 + 170 * g.size * blow(t), muffle: (t) => 1800 + 5200 * g.size * blow(t) }, seedOf('gust', k));
		rustle(mix, g.t - 0.2, g.t + g.cross + 3.5, { level: (t) => db(-28 + 7 * g.size) * blow(t), pan: across }, seedOf('leaves', k));
		taiko(mix, g.t, db(-14 + 4 * k), -0.4, seedOf('gust drum', k));
	});
	creak(mix, o.gust2 + 0.9, 1.5, db(-20), -0.3, seedOf('branch', 2));
	pressure(mix, o.gust1, o.hush, (t) => db(-24 + 10 * smooth(o.gust1, o.peak, t)) * smooth(o.gust1, o.gust1 + 2, t) * cut(t), () => 55, seedOf('storm floor'));

	// The storm: the vortex whips the wind round the room, faster every lap.
	const round = (t) => 0.8 * Math.sin(TAU * vortexTurn(o, t));
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
			bright: (t) => 500 + 4800 * storming(t),
			level: (t) => db(-21 + 6 * storming(t)) * cut(t),
			speed: stop
		},
		seedOf('strings')
	);
	stormDrums(o).forEach((d, k) => taiko(mix, d.t, db(-14 + 8 * storming(d.t) + 6 * (d.size - 1)), k % 2 === 0 ? -0.2 : 0.2, seedOf('storm drum', k)));
	stormRoll(o).forEach((t, k) => rollHit(mix, t, db(-20 + 9 * smooth(o.rush, o.peak, t)), smooth(o.rush, o.peak, t), (k % 2 === 0 ? -1 : 1) * 0.2, seedOf('storm roll', k)));
	choir(mix, o.rush, o.hush, A_MINOR_CHOIR, (t) => db(-26 + 11 * smooth(o.rush, o.peak, t)) * cut(t), seedOf('storm choir'));
	shepard(mix, o.rush, o.peak, (t) => db(-30 + 10 * smooth(o.rush, o.peak, t)));
	approach(mix, o.peak - 2 * bar, o.peak, { gain: db(-15), fromHz: 220, toHz: 6400, spread: 0.85, turns: 3, seed: seedOf('storm rise') });

	// The great gust: the rest of the canopy goes in one blast, and the vortex flies apart.
	crack(mix, o.peak, db(-5), seedOf('great gust'), -0.3);
	braam(mix, o.peak, o.hush - o.peak + 0.15, db(-5), A_MINOR_LOW, seedOf('storm brass'));
	impact(mix, o.peak, db(-6), seedOf('storm weight'), 0);
	taiko(mix, o.peak, db(-1), 0, seedOf('storm last'));
	crash(mix, o.peak, db(-11), 0, seedOf('storm crash'));

	// The hush: the leaf holding on in the silence, two beats, and the breath before the gold.
	hole(mix, o.hush, o.gold);
	chime(mix, o.hush + 0.3, db(-17), 880, 0);
	for (const t of hushBeats(o)) heartSound(mix, t, db(-3), true, 0);
	approach(mix, hushBeats(o)[1] + 0.1, o.gold, { gain: db(-13), fromHz: 200, toHz: 6000, spread: 0.3, turns: 0.5, seed: seedOf('gold breath') });

	arrival(mix, o.gold, o.end, { seed: 'gold' });
	for (let k = 0; k < 10; k++) {
		ping(mix, o.gold + 0.9 + k * 0.6 + 0.2 * hash01(k * 7 + 1), db(-25), [1760, 2217.46, 2637.02][k % 3], (hash01(k * 13 + 2) - 0.5) * 1.2);
	}
}

/** Drakiáda: the kite climbs pull by pull, the gale, the line snapping, the spiral and the drop. */
export function scoreDrakiada(mix, o) {
	const beat = 60 / o.bpm;
	const drop = dropTime(o);
	const pulls = tugs(o);
	const up = (t) => kiteHeight(o, t) / (BEAM - 1);
	const kitePan = (t) => (t < o.snap ? 0 : panOf((NORTH + spiralRun(o, t)) % RING));
	const until = (t) => 1 - smooth(drop - 0.05, drop, t);

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
			level: (t) => db(-33 + 9 * up(t) + 11 * smooth(o.top, o.snap, t)) * smooth(o.launch, o.launch + 0.5, t) * (1 - smooth(o.snap - 0.02, o.snap, t)),
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
			if (onBeat && (n / 2) % 2 === 1) rollHit(mix, t, db(-15), 0.5, 0.15, seedOf('backbeat', n));
		} else {
			const gale = smooth(o.top, o.snap, t);
			rollHit(mix, t, db(-13 + 8 * gale), 0.4 + 0.5 * gale, onBeat ? -0.2 : 0.2, seedOf('gale', n));
			if (onBeat) taiko(mix, t, db(-9 + 5 * gale), 0, seedOf('gale drum', n));
		}
	}
	// Each pull is a drum and a brass stab a step higher up A major.
	const climb = [110, 123.47, 138.59, 146.83, 164.81, 185, 207.65, 220];
	pulls.forEach((t, k) => {
		taiko(mix, t, db(-7), 0, seedOf('pull drum', k));
		braam(mix, t, 0.55, db(-12 + 0.6 * k), [climb[k] / 2, climb[k], climb[k] * 1.5], seedOf('pull brass', k));
		sailSnap(mix, t, db(-20), 0, seedOf('pull', k));
	});
	ostinato(
		mix,
		o.launch,
		o.snap,
		{
			pattern: [440, 554.37, 659.26, 554.37, 440, 554.37, 739.99, 659.26],
			rate: (t) => (t < o.top ? 2 : 4) / beat,
			bright: (t) => 800 + 4500 * smooth(o.launch, o.snap, t),
			level: (t) => db(-24 + 6 * smooth(o.launch, o.snap, t)) * (1 - smooth(o.snap - 0.02, o.snap, t))
		},
		seedOf('kite strings')
	);
	// The kite passes the leaf on its way up, and the leaf answers with its note.
	let passes = o.launch;
	while (passes < o.top && kiteHeight(o, passes) < LEAF) passes += 0.01;
	rustle(mix, passes, passes + 0.8, { level: (t) => db(-26) * Math.sin((Math.PI * (t - passes)) / 0.8), pan: () => 0 }, seedOf('leaf brushed'));
	chime(mix, passes + 0.1, db(-21), 880, 0);
	// The gale: the voices hold a suspended chord under the line straining.
	choir(mix, o.top, o.snap, [329.63, 440, 493.88, 659.26], (t) => db(-22 + 11 * smooth(o.top, o.snap, t)) * (1 - smooth(o.snap - 0.03, o.snap, t)), seedOf('gale choir'));
	approach(mix, o.top, o.snap, { gain: db(-14), fromHz: 300, toHz: 4800, spread: 0.5, turns: 1.5, seed: seedOf('gale rise') });

	// The line snaps: the kite is free and spirals round the room, faster every lap.
	twang(mix, o.snap, db(-4), 0, seedOf('line snaps'));
	crack(mix, o.snap, db(-11), seedOf('snap crack'), 0);
	taiko(mix, o.snap, db(-3), 0, seedOf('snap drum'));
	approach(mix, o.snap, drop, { gain: db(-13), fromHz: 260, toHz: 6200, pan: 0, spread: 0.85, turns: o.laps, seed: seedOf('spiral') });
	shepard(mix, o.snap, drop, (t) => db(-27 + 9 * smooth(o.snap, drop, t)) * until(t));
	lapEnds(o).forEach((t, k) => {
		if (t < drop - 0.05) taiko(mix, t, db(-9 + 2 * k), 0, seedOf('lap drum', k));
	});
	for (let t = o.snap + 0.5; t < drop - 1e-6; ) {
		const u = (t - o.snap) / (drop - o.snap);
		rollHit(mix, t, db(-20 + 10 * u), u, 0, seedOf('spiral roll', Math.round(t * 1000)));
		t += 1 / (6 + 18 * u);
	}

	sailSnap(mix, drop, db(-6), 0, seedOf('full sail'));
	arrival(mix, drop, o.end, { seed: 'kite' });
}

/** Burčák: the bottle working to a groove, the cap rattling faster, the pop, the foam, the clink. */
export function scoreBurcak(mix, o) {
	const beat = 60 / o.bpm;
	const working = (t) => smooth(0, o.pop, t);
	const held = (t) => 1 - smooth(o.pop - 0.03, o.pop, t);

	bubbles(o).forEach((b, k) => blip(mix, b.t, db(-24), 1300 + 1500 * hash01(k * 19 + 4), (hash01(k * 5 + 9) - 0.5) * 0.3));
	fizzle(mix, 0, o.end, (t) => db(-36 + 16 * working(t) - 6 * smooth(o.clink + 1, o.end, t)) * smooth(0, 0.3, t), seedOf('fizz'));
	// The working bottle: a bass pulse in the cellar and plucked bubbles climbing over it.
	ostinato(
		mix,
		0,
		o.pop,
		{
			pattern: [55, 55, 110, 55, 98, 55, 110, 82.41],
			rate: () => 2 / beat,
			bright: (t) => 300 + 1700 * working(t),
			level: (t) => db(-11 + 3 * working(t)) * smooth(0, 1, t) * held(t)
		},
		seedOf('cellar bass')
	);
	const notes = [440, 523.25, 587.33, 659.26, 783.99, 880, 1046.5, 1174.66];
	for (let t = o.rattle, k = 0; t < o.pop - 1e-6; t += beat / 2, k++) {
		const u = (t - o.rattle) / (o.pop - o.rattle);
		pluck(mix, t, db(-13 + 4 * u), notes[(k + Math.floor(u * 4)) % notes.length], (k % 2 === 0 ? -1 : 1) * 0.35, seedOf('pluck', k));
	}
	rattles(o).forEach((t, k) => rattle(mix, t, db(-12 + 5 * working(t)), 0, seedOf('cap', k)));
	kicks(o).forEach((t) => kick(mix, t, db(-7)));
	for (const t of kicks(o)) if (Math.round((t - o.surge) / beat) % 2 === 1) rollHit(mix, t, db(-14), 0.6, 0.1, seedOf('clap', Math.round(t * 1000)));
	shepard(mix, o.surge, o.pop, (t) => db(-30 + 10 * smooth(o.surge, o.pop, t)));
	// The cap about to go: gas forcing the thread, rising until it gives.
	approach(mix, o.hiss, o.pop, { gain: db(-13), fromHz: 2600, toHz: 9000, spread: 0.2, turns: 0.5, seed: seedOf('cap hiss') });

	corkPop(mix, o.pop, db(-1), seedOf('cork'));
	streak(mix, o.pop, 0.6, db(-14), 0, 0, seedOf('cap flies'));
	taiko(mix, o.pop, db(-4), 0, seedOf('pop drum'));
	// The foam running both ways round the ring from the north end of the beam.
	for (const side of [-1, 1]) {
		rustle(
			mix,
			o.pop,
			o.pop + o.round + 0.4,
			{
				level: (t) => db(-16) * smooth(o.pop, o.pop + 0.1, t) * (1 - smooth(o.pop + o.round, o.pop + o.round + 0.4, t)),
				pan: (t) => side * 0.7 * smooth(o.pop, o.pop + o.round, t)
			},
			seedOf('foam', side)
		);
	}
	// Every glass raised: a breath in, then they meet.
	hole(mix, o.pop + o.round + 0.15, o.clink);
	approach(mix, o.pop + o.round, o.clink, { gain: db(-14), fromHz: 400, toHz: 7000, spread: 0.5, turns: 1, seed: seedOf('raised') });
	clink(mix, o.clink, db(-3), 0);
	kick(mix, o.clink, db(-2));
	arrival(mix, o.clink, o.end, { seed: 'clink' });
}

/** Poslední list: frost swelling to a held chord, silence, the fall, and the last light. */
export function scoreList(mix, o) {
	howl(mix, 0, o.end, { pan: (t) => 0.5 * Math.sin(t * 0.21), level: (t) => db(-36) * smooth(0, 1.5, t) * (1 - smooth(o.land, o.rest, t)), pitch: () => 150, muffle: () => 1000 }, seedOf('night air'));
	owl(mix, o.owl, db(-22), 420, 0.55);

	const ice = [1760, 1975.53, 2217.46, 2637.02, 2959.96];
	tufts(o).forEach((f, k) => frostTuft(mix, f.t, db(-29), ice[f.note], panOf(f.pixel), seedOf('tuft', k)));
	// The cold swelling to the moment the leaf lets go, and stopping dead there.
	const silenced = (t) => 1 - smooth(o.letGo - 0.04, o.letGo, t);
	pad(mix, 0, o.letGo, [440, 659.26, 880, 1108.73], (t) => db(-31 + 6 * smooth(o.frost, o.shiver, t)) * smooth(0, 3, t) * silenced(t));
	choir(mix, o.frost + 4, o.letGo, [220, 329.63, 440, 554.37, 659.26], (t) => db(-32 + 18 * smooth(o.frost + 4, o.shiver, t)) * silenced(t), seedOf('frost choir'));
	// Held on a suspension while the leaf shivers.
	choir(mix, o.shiver, o.letGo, [293.66, 440, 587.33], (t) => db(-20) * smooth(o.shiver, o.shiver + 1, t) * silenced(t), seedOf('suspension'));
	for (let t = o.rimed - 4, k = 0; t < o.letGo - 0.05; t += 1 / 16, k++) {
		taiko(mix, t, db(-30 + 16 * smooth(o.rimed - 4, o.letGo, t)), (k % 2 === 0 ? -1 : 1) * 0.2, seedOf('timpani', k));
	}
	approach(mix, o.rimed - 1, o.letGo, { gain: db(-20), fromHz: 1500, toHz: 7000, spread: 0.2, turns: 0.3, seed: seedOf('frost closing') });
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
		chime(mix, t, db(-17 + 0.4 * k), descent[k % descent.length], leafPan(t));
		heartSound(mix, t + 0.6, db(-10 - 0.5 * k), true, 0);
	});
	choir(mix, o.letGo + 3, o.land, [220, 329.63], (t) => db(-30 + 10 * smooth(o.letGo + 3, o.land, t)) * (1 - smooth(o.land - 0.04, o.land, t)), seedOf('falling'));
	approach(mix, o.land - 2, o.land, { gain: db(-15), fromHz: 250, toHz: 5000, spread: 0.6, turns: 0.5, seed: seedOf('landing breath') });

	// The last light: the arrival, and the frost ringing as the gold runs round it.
	arrival(mix, o.land, o.end, { size: 0.9, choirLevel: -13, seed: 'last light' });
	warmth(mix, o.land, db(-9), 55);
	for (let k = 0; k < 16; k++) {
		ping(mix, o.land + 0.1 + 0.07 * k, db(-25), ice[k % ice.length], (k % 2 === 0 ? -1 : 1) * Math.min(0.7, 0.1 + k * 0.045));
	}
	pad(mix, o.ebb, o.end, [110, 164.81, 220, 277.18], (t) => db(-22) * smooth(o.ebb, o.ebb + 2, t));
	chime(mix, o.rest, db(-21), 880, panOf(HOME));
}

/** The speed of something whose position is `at(t)`, in pixels a second. */
const speedOf = (at, t) => Math.abs(at(t + 0.01) - at(t - 0.01)) / 0.02;
const ringPan = (x) => panOf(((Math.round(x) % RING) + RING) % RING);

/** Špačci: the flock's chatter and wings on a building groove, the hush, and the cannon. */
export function scoreSpacci(mix, o) {
	const beat = 60 / o.bpm;
	const bar = 4 * beat;
	const held = (t) => 1 - smooth(o.hush - 0.04, o.hush, t);
	const flockPan = (t) => ringPan(flockAt(o, t));
	const flying = (t) => Math.min(1, speedOf((u) => flockAt(o, u), t) / 900);

	pad(mix, 0, o.hush, [110, 164.81, 220, 261.63], (t) => db(-24 + 6 * smooth(0, o.hush, t)) * smooth(0, 2, t) * held(t));
	chatter(
		mix,
		0.5,
		o.bang + 3,
		{
			density: (t) => (t < o.hush ? 20 + 380 * smooth(o.arrive, o.rush, t) : t < o.bang ? 0 : 900 * Math.exp(-(t - o.bang) / 0.7)),
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
	spacciDrums(o).forEach((d, k) => taiko(mix, d.t, db(-13 + 5 * smooth(o.swirl, o.hush, d.t) + 6 * (d.size - 1)), k % 2 === 0 ? -0.2 : 0.2, seedOf('flock drum', k)));
	ostinato(
		mix,
		o.swirl,
		o.hush,
		{
			pattern: [220, 261.63, 329.63, 261.63, 220, 261.63, 349.23, 329.63],
			rate: (t) => (t < o.rush ? 2 : 4) / beat,
			bright: (t) => 600 + 4600 * smooth(o.swirl, o.hush, t),
			level: (t) => db(-22 + 4 * smooth(o.swirl, o.hush, t)) * held(t)
		},
		seedOf('flock strings')
	);
	choir(mix, o.swirl, o.hush, [220, 261.63, 329.63, 440], (t) => db(-27 + 9 * smooth(o.swirl, o.hush, t)) * held(t), seedOf('flock choir'));
	for (let t = o.rush + bar, k = 0; t < o.hush - 1e-6; k++) {
		const u = (t - o.rush - bar) / (o.hush - o.rush - bar);
		rollHit(mix, t, db(-18 + 9 * u), u, (k % 2 === 0 ? -1 : 1) * 0.2, seedOf('flock roll', k));
		t += 1 / (6 + 18 * u);
	}
	shepard(mix, o.rush, o.hush, (t) => db(-29 + 10 * smooth(o.rush, o.hush, t)));
	approach(mix, o.rush, o.hush, { gain: db(-15), fromHz: 240, toHz: 6400, spread: 0.85, turns: 2, seed: seedOf('flock rise') });

	// The flock hangs in the silence, and the vineyard's cannon goes off.
	hole(mix, o.hush, o.bang);
	crack(mix, o.bang, db(0), seedOf('cannon'), 0.2);
	whump(mix, o.bang, db(-3), 0.2, seedOf('cannon weight'));
	arrival(mix, o.bang, o.end, { choirLevel: -11, seed: 'vineyard' });
}

/** Polární záře: the drone, the shimmer and the voices rising with the curtains, and the corona. */
export function scoreZare(mix, o) {
	const bar = 240 / o.bpm;
	const cut = (t) => 1 - smooth(o.corona - 0.4, o.corona - 0.36, t);
	pad(mix, 0, o.corona, [55, 110, 164.81], (t) => db(-19 + 3 * smooth(0, o.corona, t)) * smooth(0, 3, t) * cut(t));
	pad(mix, o.glow, o.corona, [440, 659.26, 880, 987.77], (t) => db(-24 + 7 * smooth(o.glow, o.corona, t)) * smooth(o.glow, o.glow + 3, t) * cut(t));
	choir(mix, o.curtain, o.corona, [220, 329.63, 440, 493.88, 659.26], (t) => db(-25 + 11 * smooth(o.curtain, o.corona, t)) * smooth(o.curtain, o.curtain + 2, t) * cut(t), seedOf('aurora choir'));
	const sparkle = [1760, 1975.53, 2637.02, 2959.96, 3520];
	for (let t = o.glow, k = 0; t < o.corona - 0.5; k++) {
		const u = smooth(o.glow, o.corona, t);
		ping(mix, t, db(-26 + 5 * u), sparkle[k % sparkle.length], (hash01(k * 7 + 3) - 0.5) * 1.4);
		t += (0.5 + hash01(k * 13 + 1)) / (2 + 12 * u);
	}
	howl(mix, o.glow, o.corona, { pan: (t) => 0.6 * Math.sin(t * 0.4), level: (t) => db(-34 + 10 * smooth(o.glow, o.corona, t)) * cut(t), pitch: (t) => 700 + 700 * smooth(o.glow, o.corona, t), muffle: () => 6000 }, seedOf('aurora air'));
	// The substorm: drums on the bar, a roll under the last of it, and the rise into the corona.
	for (let t = o.surge, k = 0; t < o.corona - 0.5; t += bar / 2, k++) taiko(mix, t, db(k % 2 === 0 ? -9 : -15), 0, seedOf('aurora drum', k));
	for (let t = o.corona - 2 * bar, k = 0; t < o.corona - 0.4; t += 1 / 14, k++) {
		taiko(mix, t, db(-26 + 14 * smooth(o.corona - 2 * bar, o.corona, t)), (k % 2 === 0 ? -1 : 1) * 0.2, seedOf('aurora roll', k));
	}
	shepard(mix, o.surge, o.corona - 0.4, (t) => db(-30 + 10 * smooth(o.surge, o.corona, t)));
	approach(mix, o.corona - bar, o.corona - 0.4, { gain: db(-14), fromHz: 300, toHz: 6000, spread: 0.6, turns: 1, seed: seedOf('aurora rise') });
	hole(mix, o.corona - 0.4, o.corona);
	arrival(mix, o.corona, o.end, { choirLevel: -11, seed: 'corona' });
	choir(mix, o.corona, o.end, [880, 1108.73, 1318.51], (t) => db(-20) * smooth(o.corona, o.corona + 0.5, t) * (1 - smooth(o.corona + 2, o.end, t)), seedOf('corona high'));
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

	// The lights go down; each candle is a match and a note, climbing.
	approach(mix, 0, o.dark + 0.4, { gain: db(-22), fromHz: 3000, toHz: 400, spread: 0.3, turns: 0.3, seed: seedOf('lights down') });
	const climb = [349.23, 392, 440, 523.25, 587.33];
	candles(o).forEach((c, k) => {
		matchStrike(mix, c.t - 0.06, db(-21), panOf(c.pixel), seedOf('candle match', k));
		celesta(mix, c.t, db(-15), climb[k % 5] * Math.pow(2, Math.floor(k / 5)), panOf(c.pixel));
	});
	flame(mix, o.light, o.end, { level: (t) => db(-34) * smooth(o.light, o.light + 4, t), size: () => 0.04, pan: () => 0 }, seedOf('candles burning'));
	pad(mix, o.light + 2, o.verse1, [174.61, 220, 261.63, 349.23], (t) => db(-26) * smooth(o.light + 2, o.verse1 - 1, t));

	// The first verse, in F, for everyone to sing: celesta and harp on the tune, a waltz under it.
	for (const n of notes.filter((m) => m.verse === 1)) {
		celesta(mix, n.t, db(-12), n.freq * 2, 0);
		pluck(mix, n.t, db(-16), n.freq, 0, seedOf('harp', Math.round(n.t * 1000)));
	}
	for (let b = 1; b < 25; b++) {
		const c = chordAt(b);
		const root = 87.31 * Math.pow(2, c.root / 12);
		const t = o.verse1 + b * beat;
		if ((b - 1) % 3 === 0) pluck(mix, t, db(-14), root, -0.2, seedOf('bass', b));
		else triad(root * 2, c.seventh).forEach((f, k) => pluck(mix, t, db(-22), f, 0.3 - k * 0.2, seedOf('waltz', b * 10 + k)));
	}
	pad(mix, o.verse1, o.verse2, [174.61, 220, 261.63], (t) => db(-27) * (1 - smooth(o.verse2 - 6 * beat, o.verse2 - 4 * beat, t)));

	// Two bars into the new key: a roll, the brass swelling on the new dominant, the rise.
	const build = o.verse2 - 6 * beat;
	for (let t = build, k = 0; t < o.verse2 - 0.02; t += 1 / 14, k++) taiko(mix, t, db(-26 + 18 * smooth(build, o.verse2, t)), (k % 2 === 0 ? -1 : 1) * 0.2, seedOf('birthday roll', k));
	braam(mix, build, o.verse2 - build, db(-11), [73.42, 146.83, 185, 220, 293.66], seedOf('to G'));
	approach(mix, build, o.verse2, { gain: db(-14), fromHz: 250, toHz: 6000, spread: 0.7, turns: 1, seed: seedOf('birthday rise') });

	// The second verse, in G, with everything: horns on the tune, voices, strings and drums.
	crash(mix, o.verse2, db(-9), 0, seedOf('verse two crash'));
	subDrop(mix, o.verse2, db(-7));
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
		ostinato(mix, from, until, { pattern: [tones[0], tones[1], tones[2], tones[0] * 2, tones[2], tones[1]], rate: () => 2 / beat, bright: () => 3800, level: () => db(-17) }, seedOf('verse strings', b));
		taiko(mix, from, db(-4), 0, seedOf('verse drum', b));
		taiko(mix, from + beat, db(-15), -0.2, seedOf('verse drum 2', b));
		taiko(mix, from + 2 * beat, db(-15), 0.2, seedOf('verse drum 3', b));
		pluck(mix, from, db(-9), root / 2, 0, seedOf('verse bass', b));
	}
	// The held last note: a roll swelling under it, then everything on the cut-off.
	const held = finish - (o.hold * beat);
	for (let t = held, k = 0; t < finish - 0.02; t += 1 / 16, k++) taiko(mix, t, db(-22 + 16 * smooth(held, finish, t)), (k % 2 === 0 ? -1 : 1) * 0.3, seedOf('last roll', k));
	crash(mix, held, db(-12), 0, seedOf('held crash'));
	arrival(mix, finish, o.end, { shift: -2, choirLevel: -13, seed: 'happy birthday' });
}

/** Sfouknuto: a breath, the candles out, a beat of dark, then fireworks, a groove and the letters. */
export function scoreSfouknuto(mix, o) {
	const beat = 60 / o.bpm;
	swish(mix, 0.02, 1, db(-9), -0.7, 0.7, seedOf('blow'));
	for (let k = 0; k < 18; k++) pop(mix, o.out + k * 0.05, db(-26), (k / 17) * 1.4 - 0.7, seedOf('candle out', k));
	approach(mix, 0.9, o.boom, { gain: db(-12), fromHz: 200, toHz: 7000, spread: 0.5, turns: 1, seed: seedOf('wish rise') });
	arrival(mix, o.boom, o.end, { size: 1.1, choirLevel: -13, shift: -2, seed: 'blown out' });

	// The groove under the letters: kick on every beat, claps on two and four, bass in G.
	for (let t = o.boom, k = 0; t < o.end - 2; t += beat, k++) {
		kick(mix, t, db(-6));
		if (k % 2 === 1) rollHit(mix, t, db(-13), 0.6, 0.1, seedOf('party clap', k));
	}
	ostinato(mix, o.boom, o.end - 2, { pattern: [49, 49, 98, 49, 73.42, 49, 98, 61.74], rate: () => 2 / beat, bright: () => 900, level: (t) => db(-12) * (1 - smooth(o.end - 3, o.end - 2, t)) }, seedOf('party bass'));
	// Every letter a brass stab, stepping up G major.
	const steps = [196, 220, 246.94, 261.63, 293.66, 0, 329.63, 369.99, 392, 440, 0, 493.88, 587.33];
	spelling(o).forEach((l, k) => {
		if (l.char === ' ') return;
		const root = steps[k] || 392;
		braam(mix, l.t, 0.55, db(-8), [root / 2, root, root * 1.5, root * 2], seedOf('letter', k));
		taiko(mix, l.t, db(-6), 0, seedOf('letter drum', k));
	});
	fireworks(o).forEach((f, k) => {
		launch(mix, f.t - 0.6, 0.6, db(-24), panOf(f.pixel) * 0.5, seedOf('launch', k));
		burst(mix, f.t, db(-11 + 4 * f.size), panOf(f.pixel), seedOf('burst', k));
	});
	braam(mix, o.finale, 6, db(-6), [49, 98, 123.47, 146.83, 196], seedOf('finale brass'));
	choir(mix, o.finale, o.end, [392, 493.88, 587.33, 783.99], (t) => db(-14) * smooth(o.finale, o.finale + 0.2, t) * (1 - smooth(o.finale + 3, o.end, t)), seedOf('finale choir'));
	crash(mix, o.finale, db(-8), 0, seedOf('finale crash'));
}

/** Půlnoc: the clock, the lamps out, the match, the fire to war drums, ten to one, and midnight. */
export function scorePulnoc(mix, o) {
	const size = (t) => fireReach(o, t) / (RING / 2);
	const held = (t) => 1 - smooth(o.inhale - 0.04, o.inhale, t);
	howl(mix, 0, o.catch + 1, { pan: (t) => 0.4 * Math.sin(t * 0.3), level: (t) => db(-34) * smooth(0, 1, t) * (1 - smooth(o.catch, o.catch + 1, t)), pitch: () => 140, muffle: () => 800 }, seedOf('fog air'));
	pad(mix, 0, o.inhale, [55, 110, 164.81, 220, 261.63], (t) => db(-22 + 4 * smooth(0, o.inhale, t)) * smooth(0, 2, t) * held(t));
	for (let t = 0, k = 0; t < o.count - 1e-6; t += 1, k++) tick(mix, t, db(-8 + 3 * smooth(o.catch, o.inhale, t)), k % 2 === 1, seedOf('clock', k));
	[o.lamp1, o.lamp2, o.lamp3].forEach((t, k) => clack(mix, t + 0.1, db(-22), seedOf('lamp', k), panOf(LAMPS[k])));

	matchStrike(mix, o.match, db(-5), panOf(HOME), seedOf('match'));
	flame(mix, o.match + 0.15, o.catch + 0.4, { level: (t) => db(-24) * smooth(o.match + 0.1, o.match + 0.6, t) * (1 - smooth(o.catch, o.catch + 0.4, t)), size: () => 0.06, pan: () => panOf(HOME) }, seedOf('match flame'));
	whump(mix, o.catch, db(-5), panOf(HOME), seedOf('catch'));
	const roar = (t) => (t < o.midnight ? size(t) : 1);
	flame(
		mix,
		o.catch - 0.05,
		o.end,
		{
			level: (t) => db(-23 + 10 * roar(t)) * smooth(o.catch - 0.05, o.catch + 0.3, t) * (t < o.midnight ? 1 - 0.95 * smooth(o.inhale, o.inhale + 0.3, t) : 1) * (1 - 0.5 * smooth(o.midnight + 2, o.end, t)),
			size: roar,
			pan: () => panOf(HOME)
		},
		seedOf('leaf fire')
	);
	pops(o).forEach((p, k) => pop(mix, p.t, db(-18), panOf(p.pixel), seedOf('pop', k)));
	warDrums(o).forEach((d, k) => taiko(mix, d.t, db(-10 + 3 * smooth(o.catch, o.inhale, d.t) + 7 * (d.size - 1)), k % 2 === 0 ? -0.25 : 0.25, seedOf('war drum', k)));
	choir(mix, o.catch, o.inhale, [110, 164.81, 220, 261.63, 329.63], (t) => db(-28 + 13 * smooth(o.catch, o.inhale, t)) * held(t), seedOf('fire choir'));
	ostinato(
		mix,
		o.double,
		o.inhale,
		{
			pattern: [110, 130.81, 164.81, 130.81, 110, 130.81, 196, 164.81],
			rate: (t) => (t < o.again ? 4 : 8),
			bright: (t) => 400 + 4200 * smooth(o.double, o.inhale, t),
			level: (t) => db(-22 + 4 * smooth(o.double, o.inhale, t)) * held(t)
		},
		seedOf('fire strings')
	);
	shepard(mix, o.again, o.inhale, (t) => db(-28 + 8 * smooth(o.again, o.inhale, t)) * held(t));

	// The fire drawn back into the corner, then the count: a bell and a drum for every number.
	hole(mix, o.inhale, o.count);
	approach(mix, o.inhale, o.count, { gain: db(-10), fromHz: 120, toHz: 5200, pan: panOf(HOME), spread: 0.4, turns: 0.5, seed: seedOf('inhale') });
	for (let n = 0; n < 10; n++) {
		const t = o.count + n;
		churchBell(mix, t, db(-5 + 0.3 * n), 146.83, 0);
		taiko(mix, t, db(-2), 0, seedOf('count drum', n));
		braam(mix, t, 0.7, db(-12 + 0.6 * n), [55, 110, 164.81 * Math.pow(2, n / 12)], seedOf('count brass', n));
	}
	choir(mix, o.count, o.midnight, [220, 261.63, 329.63, 440, 523.25], (t) => db(-24 + 12 * smooth(o.count, o.midnight, t)) * (1 - smooth(o.midnight - 0.16, o.midnight - 0.12, t)), seedOf('count choir'));
	shepard(mix, o.count, o.midnight - 0.12, (t) => db(-28 + 10 * smooth(o.count, o.midnight, t)));
	hole(mix, o.midnight - 0.12, o.midnight);

	// Midnight: the backdraft.
	whump(mix, o.midnight, db(1), 0, seedOf('backdraft'));
	crack(mix, o.midnight, db(-7), seedOf('backdraft crack'), 0);
	churchBell(mix, o.midnight, db(-5), 110, 0);
	arrival(mix, o.midnight, o.end, { size: 1.1, choirLevel: -11, seed: 'midnight' });
}

/** Orionidy: the night sky, meteors thickening on the drums, the fireball, the silence, the boom. */
export function scoreOrionidy(mix, o) {
	const beat = 60 / o.bpm;
	const bar = 4 * beat;
	const held = (t) => 1 - smooth(o.burst - 0.04, o.burst, t);
	pad(mix, 0, o.burst, [55, 110, 164.81, 220], (t) => db(-21 + 3 * smooth(0, o.burst, t)) * smooth(0, 2, t) * held(t));
	pad(mix, 0, o.burst, [880, 1318.51, 1760], (t) => db(-27 + 5 * smooth(0, o.burst, t)) * smooth(0, 3, t) * held(t));
	// The brightest meteors are heard as they go.
	meteors(o).forEach((m, k) => {
		if (m.length < 30 || (m.t > o.burst && m.t < o.boom + 0.5)) return;
		const to = m.from + m.dir * m.speed * m.life;
		streak(mix, m.t, m.life, db(-28), ringPan(m.from), ringPan(to), seedOf('meteor', k));
	});
	for (let t = o.shower, k = 0; t < o.burst - 1e-6; t += beat / 2, k++) {
		const inBar = k % 8;
		if (t < o.storm - 1e-6) {
			if (inBar === 0) taiko(mix, t, db(-9), 0, seedOf('sky drum', k));
			else if (inBar === 5) taiko(mix, t, db(-15), 0.2, seedOf('sky drum', k));
		} else if (k % 2 === 0) taiko(mix, t, db(-11 + 2 * smooth(o.storm, o.burst, t)), (k % 4 === 0 ? -1 : 1) * 0.2, seedOf('sky drum', k));
	}
	ostinato(mix, o.shower, o.burst, { pattern: [220, 329.63, 440, 329.63, 220, 329.63, 493.88, 440], rate: (t) => (t < o.storm ? 2 : 4) / beat, bright: (t) => 700 + 4200 * smooth(o.shower, o.burst, t), level: (t) => db(-22 + 4 * smooth(o.shower, o.burst, t)) * held(t) }, seedOf('sky strings'));
	choir(mix, o.storm - bar, o.burst, [220, 329.63, 440, 523.25], (t) => db(-26 + 8 * smooth(o.storm - bar, o.burst, t)) * held(t), seedOf('sky choir'));
	for (let t = o.storm + bar, k = 0; t < o.bolide - 1e-6; k++) {
		const u = (t - o.storm - bar) / (o.bolide - o.storm - bar);
		rollHit(mix, t, db(-18 + 8 * u), u, (k % 2 === 0 ? -1 : 1) * 0.2, seedOf('sky roll', k));
		t += 1 / (6 + 16 * u);
	}
	// The fireball: a roar growing as it crosses to home, then it bursts.
	approach(mix, o.bolide, o.burst, { gain: db(-11), fromHz: 150, toHz: 5000, pan: ringPan(bolideAt(o, o.bolide)), spread: 0.6, turns: 0.5, seed: seedOf('fireball') });
	shepard(mix, o.storm, o.burst, (t) => db(-29 + 10 * smooth(o.storm, o.burst, t)));
	burst(mix, o.burst, db(-2), ringPan(bolideAt(o, o.burst)), seedOf('fireball burst'));
	crack(mix, o.burst, db(-10), seedOf('fireball crack'), ringPan(bolideAt(o, o.burst)));
	// The breath of silence after the flash, then its sonic boom: light before thunder, once more.
	hole(mix, o.burst + 0.5, o.boom);
	impact(mix, o.boom, db(-2), seedOf('sonic boom'), 0);
	crack(mix, o.boom, db(-4), seedOf('boom crack'), 0);
	arrival(mix, o.boom, o.end, { size: 1.1, choirLevel: -11, seed: 'boom' });
}
