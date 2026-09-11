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
		// Require kicks so clap-only suspensions do not trigger whole-room slams.
		kit: 'kick'
	},
	params: [INTENSITY, param('beatsPerSlam', 'Beats per slam', 2, 0.5, 4, 0.5)],
	create(g) {
		const env = new PulseEnv();
		// Fixed per-pixel texture, so a full-on frame is not a flat card.
		const tex = new Float32Array(g.count);
		for (let i = 0; i < g.count; i++) tex[i] = 0.9 + 0.1 * hash01(i * 11);
		// Latch interpolated beat energy before applying it to brightness.
		const passage = new BeatHold(0.4);
		// Grid timing needs kit permission to rest during drumless passages.
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
					// Cool through one continuous hue family; thresholded colour changes would
					// flash again on decay.
					const slot = lerp(SLOT.base, SLOT.white, clamp(v * 1.4 - 0.2));
					// A punch with a little weight behind it: v^1.5 keeps the hard front and
					// leaves the slam in the room for a third of a beat rather than a frame.
					setSample(out, i, palette, slot + hueShift, Math.max(floor, Math.pow(v, 1.5) * gain * tex[i]));
				}
			}
		};
	}
};
