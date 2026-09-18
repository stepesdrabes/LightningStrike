/**
 * Scores for the evening's other moments, on the storm's instruments. Each lands its events on the
 * times its effect reads from the same timing table.
 */
import {
	RATE,
	TAU,
	approach,
	at,
	chime,
	clack,
	crack,
	crackler,
	crystal,
	db,
	drip,
	ending,
	filter,
	fizz,
	hailstone,
	heartSound,
	howl,
	ignition,
	impact,
	pad,
	ping,
	pressure,
	rainfall,
	random,
	ringX,
	rollHit,
	rumble,
	seedOf,
	shatter,
	smooth,
	spark,
	streak,
	switchOff
} from './instruments.mjs';
import {
	SHOOT,
	cloudTurn,
	crystals,
	debris,
	drips,
	dubDelay,
	glitter,
	hail,
	lapCorners,
	lastLap,
	restingLubs,
	shards,
	shootingStars,
	stars,
	sundownRoll,
	sundownTurn
} from './timing.ts';

/** Where a pixel sits left to right in the room, for a sound placed on it. */
const panOf = (pixel) => (pixel < 600 ? (ringX(pixel) / 1.5) * 0.6 : 0);

/** A sub swelling under the spark's arrival: the ember taking the last of the night's charge. */
function bloom(mix, time, gain, freq) {
	const lp = [filter('lowpass', 320, 0.7), filter('lowpass', 320, 0.7)];
	const rnd = random(seedOf('bloom', Math.round(time * 1000)));
	let phase = 0;
	const start = at(time);
	const length = at(3.5);
	for (let n = 0; n < length; n++) {
		const t = n / RATE;
		phase += (freq * (1 + 0.25 * Math.exp(-t / 0.35))) / RATE;
		const env = (1 - Math.exp(-t / 0.05)) * Math.exp(-t / 1.1);
		const air = lp[1].run(lp[0].run(rnd() * 2 - 1)) * Math.exp(-t / 0.45) * 2.5;
		const v = gain * ending(n, length) * (env * (Math.sin(TAU * phase) + 0.3 * Math.sin(2 * TAU * phase)) + 0.25 * env * air);
		mix.put(start + n, v, v, 0.15, 0.4);
	}
}

/** Homecoming: rain easing off, the storm rolling away, the spark's last lap, stars, goodnight. */
export function scoreHomecoming(mix, o) {
	rainfall(mix, 0, o.dry + 1.5, (t) => smooth(0, 3, t) * (1 - smooth(o.ease, o.dry + 1, t)), seedOf('rain'));
	for (const d of drips(o)) drip(mix, d.t, db(-15), panOf(d.pixel));
	// The wind leaves with the storm, turning slowly across the room as it goes.
	howl(
		mix,
		0,
		o.dry + 2,
		{
			pan: (t) => 0.7 * Math.sin((TAU * t) / 26),
			level: (t) => db(-30) * smooth(0, 4, t) * (1 - smooth(o.ease, o.dry + 2, t)),
			pitch: () => 190,
			muffle: () => 1400
		},
		seedOf('leaving')
	);

	// The parting stroke is still overhead and lands like one; every thunder after it comes later,
	// lower and softer than the last.
	rumble(mix, o.thunder1, { duration: 4.5, rise: 0.03, cutoff: 1200, gain: db(-16), pan: 0, spread: 0.45, decay: 2, seed: seedOf('away', 1) });
	crack(mix, o.thunder1, db(-12), seedOf('away crack', 1), 0.05);
	impact(mix, o.thunder1, db(-12), seedOf('away weight'), 0);
	rumble(mix, o.thunder2, { duration: 4.5, rise: 0.15, cutoff: 520, gain: db(-23), pan: 0.2, spread: 0.35, decay: 1.6, seed: seedOf('away', 2) });
	rumble(mix, o.thunder3, { duration: 5.5, rise: 0.35, cutoff: 300, gain: db(-27), pan: 0.35, spread: 0.3, decay: 1.4, seed: seedOf('away', 3) });
	rumble(mix, o.thunder4, { duration: 7, rise: 0.6, cutoff: 190, gain: db(-31), pan: 0.45, spread: 0.2, decay: 1.2, seed: seedOf('away', 4) });

	const lubs = restingLubs(o);
	lubs.forEach((t, k) => {
		const gain = db(-6) * Math.pow(0.965, k);
		heartSound(mix, t, gain, true, -0.35);
		if (k < lubs.length - 1) heartSound(mix, t + dubDelay(lubs[k + 1] - t), gain * 0.62 * (1 - k / (lubs.length - 1)), false, -0.35);
	});

	const lap = (t) => db(-28) * smooth(o.leave, o.leave + 0.8, t) * (1 - smooth(o.home, o.home + 0.8, t));
	fizz(mix, o.leave, o.home + 0.8, (t) => panOf(480 + lastLap(o, t)), lap, seedOf('last lap'));
	// The spark tolls each corner of the frame on its way round, rising toward home.
	const toll = [329.63, 415.3, 493.88];
	// Ten dB up on what they were: the corner is the loudest thing since the parting thunder, and
	// the drips they land among are themselves at -15.
	lapCorners(o).forEach((t, k) => chime(mix, t, db(-16 + 2 * k), toll[k], panOf([120, 300, 420][k])));
	// Home: an E major triad landing on the ember, over a sub that swells and settles.
	chime(mix, o.home, db(-17), 659.26, -0.35);
	chime(mix, o.home + 0.14, db(-21), 830.61, -0.15);
	chime(mix, o.home + 0.3, db(-24), 987.77, 0.1);
	bloom(mix, o.home, db(-12), 41.2);
	// The night opened in E; it closes on E major, with the fifth left ringing on top. Both voices
	// are cut at the switch rather than faded: the set takes the sound with it.
	const held = (t) => 1 - smooth(o.off - 0.05, o.off, t);
	pad(mix, o.home - 6, o.off, [164.81, 207.65, 246.94, 329.63], (t) => db(-22) * smooth(o.home - 6, o.home + 4, t) * held(t));
	pad(mix, o.stars - 2, o.off, [493.88, 659.26], (t) => db(-33) * smooth(o.stars - 2, o.stars + 6, t) * held(t));
	// One small bell for each star that comes out, and a sweep of air for each one that falls.
	const sky = [1318.51, 1479.98, 1760, 1975.53, 2349.32];
	for (const star of stars(o)) chime(mix, star.t, db(-26), sky[star.note], panOf(star.pixel));
	shootingStars(o).forEach((s, k) => {
		// Each one nearer than the last, so the third is the last thing the night says before the switch.
		streak(mix, s.t, SHOOT, db(-27 + 4 * k), panOf(s.from), panOf(s.from + s.span), seedOf('falling', k));
		ping(mix, s.t + SHOOT * 0.82, db(-28 + 4 * k), sky[(k * 2 + 1) % sky.length], panOf(s.from + s.span));
	});

	// The set switches off, and the room is down to its standby ember and the cooling glass.
	switchOff(mix, o.off, { whineFrom: o.off - 7 });
}

/** Sundown: the day's last light laps the room, a roll doubling under it, and breaks over it. */
export function scoreSundown(mix, o) {
	// The light itself, running round the room with the lap and opening as it speeds up.
	howl(
		mix,
		o.lift,
		o.crest,
		{
			pan: (t) => 0.8 * Math.sin(TAU * sundownTurn(o, t)),
			level: (t) => db(-27 + 15 * smooth(o.lift, o.crest, t)) * smooth(o.lift, o.lift + 0.5, t),
			pitch: (t) => 240 * Math.pow(5, smooth(o.lift, o.crest, t)),
			muffle: (t) => 2000 * Math.pow(4.5, smooth(o.lift, o.crest, t))
		},
		seedOf('sundown air')
	);
	approach(mix, o.lift, o.crest, {
		gain: db(-15),
		fromHz: 200,
		toHz: 6200,
		spread: 0.75,
		turns: 2,
		seed: seedOf('sundown rise')
	});
	sundownRoll(o).forEach((t, k) => {
		const u = smooth(o.lift, o.crest, t);
		rollHit(mix, t, db(-21 + 9 * u), u, (k % 2 === 0 ? -1 : 1) * (0.1 + 0.35 * u), seedOf('sundown roll', k));
	});
	// A major under it all: the night's last set answers in D minor, so the rise sits on its dominant.
	const cut = (t) => 1 - smooth(o.crest - 0.02, o.crest, t);
	pad(mix, o.lift, o.crest, [110, 164.81, 220, 277.18], (t) => db(-25 + 11 * smooth(o.lift, o.crest, t)) * cut(t));
	// The crest breaks, and its weight rings on through the hole the first song lands in.
	crack(mix, o.crest, db(-13), seedOf('sundown crest'), 0);
	impact(mix, o.crest, db(-7), seedOf('sundown weight'), 0);
	for (const [k, note] of [880, 1108.73, 1318.51].entries()) chime(mix, o.crest + k * 0.05, db(-19 + k), note, (k - 1) * 0.3);
}

/** Black Ice: frost takes the frame crystal by crystal, holds under its own stress, and lets go. */
export function scoreBlackIce(mix, o) {
	// The cold coming in: a band of air narrowing and rising as the frame closes over.
	howl(
		mix,
		0,
		o.crack,
		{
			pan: (t) => 0.6 * Math.cos((TAU * t) / 3.4),
			level: (t) => db(-23) * smooth(0, 0.6, t) * (1 - 0.4 * smooth(o.frozen, o.crack, t)),
			pitch: (t) => 300 + 1100 * smooth(0, o.frozen, t),
			muffle: (t) => 3000 + 8000 * smooth(0, o.frozen, t)
		},
		seedOf('cold')
	);
	pressure(mix, 0, o.crack, (t) => db(-17) * smooth(0, 1, t), () => 33, seedOf('ice floor'));
	// Every crystal that forms rings once: the same slots the frost lights on the frame.
	const ice = [1567.98, 1864.66, 2093, 2489.02, 2793.83, 3135.96];
	for (const c of crystals(o)) crystal(mix, c.t, db(-25), ice[c.note], panOf(c.pixel));
	// The sheet under its own stress, bending up until it cannot hold.
	approach(mix, o.frozen - 0.5, o.crack, {
		gain: db(-19),
		fromHz: 1200,
		toHz: 7400,
		spread: 0.4,
		turns: 0.5,
		seed: seedOf('stress')
	});
	// The crack has to be the loudest thing in the moment, which means clearly above its own shards.
	shatter(mix, o.crack, db(4), seedOf('ice crack'), 0);
	impact(mix, o.crack, db(-9), seedOf('ice weight'), 0);
	for (const s of shards(o)) crystal(mix, s.t, db(-25), ice[s.note] * 1.5, panOf(s.pixel));
}

/** The mains dying after the breaker: the hum falls away and the room empties behind it. */
function mainsDown(mix, o) {
	const rnd = random(seedOf('mains'));
	const sizzle = [crackler(seedOf('drainL'), 1800), crackler(seedOf('drainR'), 1800)];
	const lp = [filter('lowpass', 900, 0.7), filter('lowpass', 900, 0.7)];
	let hum = 0;
	const length = at(o.glint1);
	for (let n = 0; n < length; n++) {
		const t = n / RATE;
		hum += (50 - 16 * (1 - Math.exp(-t / 0.7))) / RATE;
		const mains = Math.tanh(3 * Math.sin(TAU * hum)) * Math.exp(-t / 0.55) * (1 - Math.exp(-t / 0.01));
		const air = Math.exp(-t / 0.9);
		const density = 30 + 520 * Math.exp(-t / o.cut);
		const l = db(-17) * mains + db(-26) * lp[0].run(sizzle[0](density)) * air;
		const r = db(-17) * mains + db(-26) * lp[1].run(sizzle[1](density)) * air;
		mix.put(n, ending(n, length) * (l + 0.02 * rnd()), ending(n, length) * (r + 0.02 * rnd()), 0.1, 0.35);
	}
}

/** Lights Out: the breaker throws, the room drains dead, three glints gather and the hail starts. */
export function scoreLightsOut(mix, o) {
	clack(mix, 0, db(-3), seedOf('breaker out'), -0.5);
	mainsDown(mix, o);
	// Three glints in the corner, each closer and hotter than the last. They land in a dead room,
	// so each one needs its own attack rather than only the fizz behind it.
	for (const [k, t] of [o.glint1, o.glint2, o.glint3].entries()) {
		spark(mix, t, db(-13 + 4 * k), 0.18, -0.7, -0.7);
		ping(mix, t, db(-19 + 4 * k), 2600 + 700 * k, -0.6);
	}
	crack(mix, o.snap, db(-2), seedOf('lights snap'), 0);
	impact(mix, o.snap, db(-5), seedOf('lights weight'), 0);
	// The first stones through the snap, thinning as the block takes the room.
	hail(o).forEach((h, k) => hailstone(mix, h.t, db(-19), panOf(h.pixel), seedOf('stone', k)));
}

/** Static Charge: the colour races out of the corner and the air crackles on the frame behind it. */
export function scoreCharge(mix, o) {
	// The front itself, running round the frame from the corner and out to both sides of the room.
	fizz(
		mix,
		0,
		o.end,
		(t) => 0.75 * Math.sin((TAU * Math.min(t, o.round)) / (2 * o.round)),
		(t) => db(-19) * smooth(0, 0.12, t) * (1 - 0.35 * smooth(o.round, o.end, t)),
		seedOf('charge front')
	);
	approach(mix, 0, o.end, { gain: db(-14), fromHz: 260, toHz: 5200, spread: 0.7, turns: 1.5, seed: seedOf('charge rise sting') });
	ignition(mix, 0, db(-9), -0.55);
	// The two halves of the front meet on the far wall: the one hit the sweep has room to ring out.
	impact(mix, o.round, db(-9), seedOf('charge meet'), 0);
}

/** Wall Cloud: the wind whips round the room with the turning cloud, the pressure drops, the eye, a crack. */
export function scoreWallCloud(mix, o) {
	const until = (t) => smooth(o.form, o.form + 0.3, t) * (1 - smooth(o.eye - 0.01, o.eye, t));
	howl(
		mix,
		o.form,
		o.eye,
		{
			pan: (t) => 0.75 * Math.sin(TAU * cloudTurn(o, t)),
			level: (t) => db(-26 + 18 * smooth(o.form, o.eye, t)) * until(t),
			pitch: (t) => 220 * Math.pow(4, smooth(o.form, o.eye, t)),
			// The ears close as the pressure drops: the wind loses its top before the eye.
			muffle: (t) => 9000 * Math.pow(0.08, smooth(o.funnel - 1.5, o.eye, t))
		},
		seedOf('howl')
	);
	const low = (t) => db(-16 + 10 * smooth(o.form, o.eye, t)) * until(t);
	pressure(mix, o.form, o.eye, low, (t) => 30 + 14 * smooth(o.form, o.eye, t), seedOf('pressure'));
	rumble(mix, 1.4, { duration: 4, rise: 0.5, cutoff: 260, gain: db(-27), pan: -0.3, spread: 0.3, decay: 1.2, seed: seedOf('wall far', 1) });
	rumble(mix, 4.2, { duration: 3.5, rise: 0.3, cutoff: 420, gain: db(-25), pan: 0.3, spread: 0.3, decay: 1.4, seed: seedOf('wall far', 2) });
	// Debris torn off the wall, each piece whipped round the room the way the cloud turns.
	debris(o).forEach((d, k) => {
		const from = panOf(d.pixel);
		spark(mix, d.t, db(-25 + 7 * smooth(1.2, o.eye, d.t)), 0.18, from, -from, seedOf('debris', k));
	});
	for (const t of [o.pulse1, o.pulse2, o.pulse3]) heartSound(mix, t, db(-4), true, 0);
	// The funnel touches the floor under the beam's south end: a roar, the weight of it landing, and
	// a burst of what it lifts. Nothing here may outlast the eye, which is the whole point of the eye,
	// and `rumble` tapers for 0.4 s past its `duration`, so the duration is short by exactly that.
	rumble(mix, o.touch, {
		duration: o.eye - o.touch - 0.4,
		rise: 0.02,
		cutoff: 800,
		gain: db(-6),
		pan: -0.2,
		spread: 0.4,
		decay: 0.9,
		seed: seedOf('touchdown roar'),
		hallSend: 0.1
	});
	clack(mix, o.touch, db(-16), seedOf('touchdown'), -0.2);
	for (let k = 0; k < 3; k++) spark(mix, o.touch + k * 0.03, db(-15), 0.14, -0.6 + k * 0.6, 0.7 - k * 0.6, seedOf('touchdown debris', k));
	// The cloud whips round one last time and is gone; the eye is the hole the crack lands in.
	approach(mix, o.pulse1, o.eye, {
		gain: db(-14),
		fromHz: 300,
		toHz: 6000,
		spread: 0.85,
		turns: 2,
		seed: seedOf('wall rise')
	});
	crack(mix, o.crack, 1, seedOf('wall crack'), 0);
	impact(mix, o.crack, db(-6), seedOf('wall weight'), 0);
	rumble(mix, o.crack, { duration: o.end - o.crack - 0.25, rise: 0.02, cutoff: 1200, gain: db(-16), pan: 0, spread: 0.5, decay: 3, seed: seedOf('wall roll') });
}

/** Open Sky: the last rain and the storm's last thunder far off, then a warm chord as the gold spreads and glitters. */
export function scoreOpenSky(mix, o) {
	rainfall(mix, 0, o.dry + 0.5, (t) => 0.7 * smooth(0, 0.8, t) * (1 - smooth(0.5, o.dry, t)), seedOf('last rain'));
	rumble(mix, o.thunder, { duration: 5, rise: 0.6, cutoff: 200, gain: db(-27), pan: 0.45, spread: 0.2, decay: 1.2, seed: seedOf('gone') });
	const rnd = random(seedOf('open drips'));
	for (let t = o.dry - 1.2; t < o.bloom + 0.4; t += 0.35 + 0.5 * rnd()) drip(mix, t, db(-18), (rnd() * 2 - 1) * 0.5);

	// The sky opening is still a weather event: the gold arrives on a rise, not a fade.
	approach(mix, o.dry - 0.6, o.bloom, {
		gain: db(-25),
		fromHz: 180,
		toHz: 2400,
		spread: 0.7,
		turns: 1,
		seed: seedOf('opening')
	});

	// The bow: a high voice over the last of the rain, with a crystal on each colour of the arc.
	const bowUp = (t) => smooth(o.bow, o.bow + 1.2, t) * (1 - smooth(o.spill, o.glitter, t));
	pad(mix, o.bow, o.glitter, [880, 1108.73, 1318.51, 1760], (t) => db(-30) * bowUp(t));
	const arc = [1174.66, 1318.51, 1479.98, 1760, 1975.53, 2349.32, 2637.02];
	arc.forEach((note, k) => crystal(mix, o.bow + 0.35 + k * 0.16, db(-28), note, -0.55 + (k / (arc.length - 1)) * 1.1));

	const fall = (t) => (1 - 0.3 * smooth(o.settle, o.end - 0.6, t)) * (1 - smooth(o.end - 0.6, o.end, t));
	const swell = (t) => db(-22 + 12 * smooth(o.bloom, o.settle, t)) * smooth(o.dry - 0.5, o.bloom + 0.5, t) * fall(t);
	pad(mix, o.dry - 0.5, o.end, [146.83, 185, 220, 293.66], swell);
	// The sun coming up under the gold, and settling into the room the guests' hour runs in.
	bloom(mix, o.bloom, db(-15), 36.71);
	bloom(mix, o.settle, db(-19), 73.42);
	// A floor under the glitter, or the moment's low end falls away at the very cue marked as its drop.
	const floor = (t) => db(-20) * smooth(o.bloom, o.bloom + 1, t) * (1 - smooth(o.end - 1, o.end, t));
	pressure(mix, o.bloom, o.end, floor, () => 55, seedOf('sun floor'));
	chime(mix, o.bloom, db(-18), 587.33, 0);
	chime(mix, o.bloom + 0.12, db(-22), 880, 0.1);
	// The gold running round from both beam ends climbs the scale, out to both sides of the room.
	const scale = [587.33, 659.26, 739.99, 880, 987.77, 1174.66, 1318.51, 1479.98, 1760, 1975.53];
	for (let k = 0; k < 10; k++) {
		const t = o.spill + ((o.glitter - o.spill) * k) / 10;
		ping(mix, t, db(-20 + k * 0.6), scale[k], (k % 2 === 0 ? -1 : 1) * (0.15 + 0.06 * k));
	}
	const glints = [1174.66, 1318.51, 1479.98, 1760, 1975.53];
	for (const g of glitter(o)) ping(mix, g.t, db(-24), glints[g.note], panOf(g.pixel));
}
