import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { setSample } from '../color/palette.ts';
import { alphaFor, clamp, lerp } from '../dsl/math.ts';
import { BeatHold } from '../dsl/env.ts';
import { INTENSITY, param } from './helpers.ts';

/**
 * The hip-hop head-nod: the room's weight sits on the front wall for beats one and two
 * and eases to the back for three and four. The move is the ease - a teleport would read
 * as a cut, and half a beat is about the time a head actually takes to swing.
 */
export const halftimeBounce: EffectDef = {
	id: 'halftimeBounce',
	name: 'Halftime Bounce',
	role: 'rhythm',
	blurb: 'A broad warm lobe on the front wall for beats one-two, the back for three-four.',
	taste: {
		energy: 3,
		sections: ['groove', 'verse', 'drop', 'chorus'],
		minBars: 2,
		maxBars: 32,
		peakReserved: false,
		activity: 0.2
	},
	params: [INTENSITY, param('width', 'Lobe width', 0.3, 0.15, 0.6)],
	create(g) {
		// ny is normalised by the room's longest side, so the depth axis covers only part of
		// 0..1; spanned here so the lobe's two seats are the actual walls.
		let lo = Infinity;
		let hi = -Infinity;
		for (let i = 0; i < g.count; i++) {
			if (g.ny[i] < lo) lo = g.ny[i];
			if (g.ny[i] > hi) hi = g.ny[i];
		}
		const span = hi - lo || 1;
		// The passage's own level, latched on the beat: `f.energy` is beat-resolution data
		// the player interpolates per frame, so a brightness multiplied by it slides.
		const passage = new BeatHold(0.45);
		let seat = Number.NaN;

		return {
			reset() {
				passage.reset();
				seat = Number.NaN;
			},
			render(out, ctx) {
				const { f, p, palette, hueShift, motion } = ctx;

				// Seat from the bar grid, never from a counted beat, so a seek re-seats it.
				const target = f.barPhase < 0.5 ? 0 : 1;
				if (Number.isNaN(seat)) seat = target;
				seat += (target - seat) * alphaFor(f.dt, (f.beatPeriod * 0.17) / Math.max(0.05, motion));

				const level = passage.update(f.energy, f.beat, f.dt, f.beatPeriod);
				const snare = f.snareEnv;
				// The backbeat widens and brightens the lobe rather than moving it: the snare is
				// an emphasis on the nod, not a second nod.
				const width = p.width + snare * 0.15;
				const gain = (0.14 + p.intensity * 0.43) * clamp(0.35 + level * 0.65) * (0.75 + snare * 0.5);

				for (let i = 0; i < g.count; i++) {
					const d = (g.ny[i] - lo) / span - seat;
					const lobe = Math.exp((-d * d) / (2 * width * width));
					const slot = lerp(SLOT.base, SLOT.glow, lobe * (0.4 + snare * 0.5));
					setSample(out, i, palette, slot + hueShift, lobe * gain);
				}
			}
		};
	}
};
