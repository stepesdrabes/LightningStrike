/**
 * Scores for the evening's other moments, on the storm's instruments. Each lands its events on the
 * times its effect reads from the same timing table.
 */
import {
	RATE,
	TAU,
	at,
	chime,
	crack,
	db,
	drip,
	ending,
	filter,
	fizz,
	heartSound,
	howl,
	pad,
	ping,
	pressure,
	rainfall,
	random,
	ringX,
	rumble,
	seedOf,
	smooth
} from './instruments.mjs';
import { cloudTurn, drips, dubDelay, glitter, lapCorners, lastLap, restingLubs, stars } from './timing.ts';

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

	// The thunder comes later, lower and softer after every flash.
	rumble(mix, o.thunder1, { duration: 4, rise: 0.05, cutoff: 950, gain: db(-19), pan: 0, spread: 0.4, decay: 1.8, seed: seedOf('away', 1) });
	crack(mix, o.thunder1, db(-18), seedOf('away crack', 1), 0.1);
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
	lapCorners(o).forEach((t, k) => chime(mix, t, db(-26 + 2 * k), toll[k], panOf([120, 300, 420][k])));
	// Home: an E major triad landing on the ember, over a sub that swells and settles.
	chime(mix, o.home, db(-17), 659.26, -0.35);
	chime(mix, o.home + 0.14, db(-21), 830.61, -0.15);
	chime(mix, o.home + 0.3, db(-24), 987.77, 0.1);
	bloom(mix, o.home, db(-13), 41.2);
	// The night opened in E; it closes on E major, with the fifth left ringing on top.
	pad(mix, o.home - 6, o.end, [164.81, 207.65, 246.94, 329.63], (t) => db(-22) * smooth(o.home - 6, o.home + 4, t));
	pad(mix, o.stars - 2, o.end, [493.88, 659.26], (t) => db(-33) * smooth(o.stars - 2, o.stars + 6, t));
	// One small bell for each star that comes out.
	const sky = [1318.51, 1479.98, 1760, 1975.53, 2349.32];
	for (const star of stars(o)) chime(mix, star.t, db(-31), sky[star.note], panOf(star.pixel));
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
	for (const t of [o.pulse1, o.pulse2, o.pulse3]) heartSound(mix, t, db(-4), true, 0);
	crack(mix, o.crack, 1, seedOf('wall crack'), 0);
	rumble(mix, o.crack, { duration: o.end - o.crack - 0.25, rise: 0.02, cutoff: 1200, gain: db(-16), pan: 0, spread: 0.5, decay: 3, seed: seedOf('wall roll') });
}

/** Open Sky: the last rain and the storm's last thunder far off, then a warm chord as the gold spreads and glitters. */
export function scoreOpenSky(mix, o) {
	rainfall(mix, 0, o.dry + 0.5, (t) => 0.7 * smooth(0, 0.8, t) * (1 - smooth(0.5, o.dry, t)), seedOf('last rain'));
	rumble(mix, o.thunder, { duration: 5, rise: 0.6, cutoff: 200, gain: db(-27), pan: 0.45, spread: 0.2, decay: 1.2, seed: seedOf('gone') });
	const rnd = random(seedOf('open drips'));
	for (let t = o.dry - 1.2; t < o.bloom + 0.4; t += 0.35 + 0.5 * rnd()) drip(mix, t, db(-18), (rnd() * 2 - 1) * 0.5);

	const fall = (t) => (1 - 0.3 * smooth(o.settle, o.end - 0.6, t)) * (1 - smooth(o.end - 0.6, o.end, t));
	const swell = (t) => db(-22 + 12 * smooth(o.bloom, o.settle, t)) * smooth(o.dry - 0.5, o.bloom + 0.5, t) * fall(t);
	pad(mix, o.dry - 0.5, o.end, [146.83, 185, 220, 293.66], swell);
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
