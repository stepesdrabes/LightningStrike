import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { setSample } from '../color/palette.ts';
import { clamp, lerp, lerpAngle01, smoothstep } from '../dsl/math.ts';
import { Follower, Presence } from '../dsl/env.ts';
import { ringU } from '../dsl/space.ts';
import { spectralTilt } from '../dsl/spectrum.ts';
import { INTENSITY, param } from './helpers.ts';

/** How much of the beat the lean occupies. The rest of it the room is perfectly still. */
const LEAD = 0.72;
/** Wide enough that roughly three fifths of the ring is lit at any instant. */
const SIGMA = 0.18;

/**
 * The room arrives by stopping.
 *
 * A broad lobe sits still for most of the beat, slides toward the next wall over the last
 * quarter of it, and comes to rest exactly on the beat. Nothing flashes and no level changes:
 * what lands is a motion discontinuity, which the eye reads as an impact because the movement
 * itself created the expectation. It is the console idiom of triggering on the "and" of the
 * preceding beat, which this repo already applies to its own hits - the player reads onsets
 * `HIT_LEAD_BEATS` early because early light reads tighter than late.
 *
 * The owner's standing rule is that an exact-arrival gesture needs the shape between arrivals
 * to be worth watching. Here the shape between arrivals IS the gesture: a slow eased slide
 * across a quarter of every beat, and stillness the rest of the time.
 */
export const lean: EffectDef = {
	id: 'lean',
	name: 'Lean',
	role: 'rhythm',
	blurb: 'A wide lobe leans toward the next wall and stops dead on the beat.',
	taste: {
		energy: 3,
		sections: ['groove', 'breakdown', 'build', 'drop'],
		minBars: 2,
		maxBars: 32,
		peakReserved: false,
		activity: 0.1,
		kit: 'kick'
	},
	params: [INTENSITY, param('travel', 'How far it leans', 0.7)],
	create(g) {
		// The middle of each perimeter run, in ring coordinates. Read off the geometry rather
		// than written down, because the runs are 3 m and 2 m and their midpoints are therefore
		// not evenly spaced round the ring - and a different room divides differently again.
		const seats: number[] = [];
		for (const s of g.strips) {
			if (!s.inPerimeter) continue;
			seats.push(g.perim[s.offset + (s.count >> 1)]);
		}
		seats.sort((a, b) => a - b);
		if (seats.length === 0) seats.push(0);

		// A gaussian this wide averages to about this much of its own peak around the ring, and
		// it is what the beam holds so the middle of the room never goes dark.
		const lobeMean = Math.min(1, SIGMA * Math.sqrt(2 * Math.PI));
		const kit = new Presence();
		const tilt = new Follower(0.4, 0.9);
		let seat = 0;
		let from = seats[0];
		/** Where the lean actually got to, which is not the seat it was aiming at. */
		let pos = seats[0];
		let lastBeat = Number.NaN;

		return {
			reset() {
				kit.reset();
				tilt.reset();
				seat = 0;
				from = seats[0];
				pos = seats[0];
				lastBeat = Number.NaN;
			},
			render(out, ctx) {
				const { f, p, palette, hueShift } = ctx;

				const playing = kit.update(f.kickEnv, f.dt, f.beatPeriod);

				// Whatever position the lean actually REACHED becomes the next one's start. It
				// matters that this is `pos` and not the seat: when the kit is resting the lean
				// only travels part of the way, and starting the next one from the seat instead
				// would snap the rest of the gap on the beat - the one frame this effect exists
				// to keep still.
				if (f.beatIndex !== lastBeat) {
					if (!Number.isNaN(lastBeat)) {
						from = pos;
						seat = (seat + 1) % seats.length;
					}
					lastBeat = f.beatIndex;
				}
				const to = seats[(seat + 1) % seats.length];

				// Grid-locked and never scaled by `motion`: the whole point is that the arrival
				// coincides with the beat, and a motion multiplier would slide it off.
				const lead = smoothstep(LEAD, 1, f.beatPhase);
				pos = lerpAngle01(from, to, lead * p.travel * clamp(0.3 + playing));
				const centre = pos;

				const tone = tilt.update(clamp(0.5 + spectralTilt(f) * 0.5), f.dt);
				const level = 0.2 + p.intensity * 0.24;

				for (let i = 0; i < g.count; i++) {
					const onBeam = g.perim[i] < 0;
					let v = lobeMean;
					if (!onBeam) {
						// Wrapped distance, so the lobe crosses the seam between the last run and
						// the first without a gap.
						let d = Math.abs(ringU(g, i) - centre);
						if (d > 0.5) d = 1 - d;
						const z = d / SIGMA;
						v = Math.exp(-0.5 * z * z);
					}
					// Colour by POSITION inside base..glow, which is the span that costs no light.
					const slot = lerp(SLOT.base, SLOT.glow, clamp(v * tone));
					setSample(out, i, palette, slot + hueShift, level * (0.25 + 0.75 * v));
				}
			}
		};
	}
};
