import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { setSample } from '../color/palette.ts';
import { hash01 } from '../dsl/rng.ts';
import { clamp, lerp } from '../dsl/math.ts';
import { BeatHold, Presence, PulseEnv } from '../dsl/env.ts';
import { INTENSITY, param } from './helpers.ts';

/**
 * Where an EDM pulse breathes, this one punches: hard white over near-black, unison
 * across every strip, on the chug grid.
 */
export const moshSlam: EffectDef = {
	id: 'moshSlam',
	name: 'Mosh Slam',
	role: 'rhythm',
	blurb: 'Unison slams on the chug grid, near-black between. The room is a fist.',
	taste: {
		energy: 4,
		sections: ['groove', 'breakdown', 'build', 'drop'],
		minBars: 2,
		maxBars: 32,
		peakReserved: false,
		activity: 1,
		character: 'impact',
		// 'kick', not 'any': a clap backbeat with the kick out is exactly the passage this
		// used to pound through, and a unison white slam is a kick gesture, not a snare one.
		kit: 'kick'
	},
	params: [INTENSITY, param('beatsPerSlam', 'Beats per slam', 2, 0.5, 4, 0.5)],
	create(g) {
		const env = new PulseEnv();
		// Fixed per-pixel texture, so a full-on frame is not a flat card.
		const tex = new Float32Array(g.count);
		for (let i = 0; i < g.count; i++) tex[i] = 0.9 + 0.1 * hash01(i * 11);
		// The passage's own level, latched on the beat: `f.energy` is beat-resolution data the
		// player interpolates per frame, so a brightness multiplied by it slides continuously.
		const passage = new BeatHold(0.4);
		// The chug grid keeps the timing; the kit grants permission to strike. Without this
		// the slams pound straight through a sung verse or a suspension with the drums out.
		const kit = new Presence();
		let lastStep = -1;

		return {
			reset() {
				env.reset();
				passage.reset();
				kit.reset();
				lastStep = -1;
			},
			render(out, ctx) {
				const { f, p, palette, hueShift, motion } = ctx;

				const playing = kit.update(f.kickEnv, f.dt, f.beatPeriod);
				const step = Math.floor((f.beatIndex + f.beatPhase) / Math.max(0.5, p.beatsPerSlam));
				if (step !== lastStep) {
					lastStep = step;
					if (playing > 0.08) env.fire(playing);
				}
				const v = env.decay(f.dt, f.beatPeriod, 1.5 / Math.max(0.05, motion));

				const passageLevel = passage.update(f.energy, f.beat, f.dt, f.beatPeriod);
				const gain = (0.5 + p.intensity * 1.05) * clamp(0.5 + passageLevel * 0.7);
				const floor = 0.06 * gain;

				for (let i = 0; i < g.count; i++) {
					// One ramp from the room's colour up to white, so the slam cools in one
					// family; a cut from white to the base at a threshold was a second flash,
					// in colour, on the way down from every punch.
					const slot = lerp(SLOT.base, SLOT.white, clamp(v * 1.4 - 0.2));
					// A punch with a little weight behind it: v^1.5 keeps the hard front and
					// leaves the slam in the room for a third of a beat rather than a frame.
					setSample(out, i, palette, slot + hueShift, Math.max(floor, Math.pow(v, 1.5) * gain * tex[i]));
				}
			}
		};
	}
};
