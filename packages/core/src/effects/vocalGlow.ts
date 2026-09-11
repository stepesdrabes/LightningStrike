import type { EffectDef } from '../contracts/effect.ts';
import { Band } from '../contracts/frame.ts';
import { SLOT } from '../contracts/palette.ts';
import { setSample } from '../color/palette.ts';
import { clamp, frac, lerp } from '../dsl/math.ts';
import { BeatHold } from '../dsl/env.ts';
import { spectrumFocus } from '../dsl/spectrum.ts';
import { INTENSITY, param } from './helpers.ts';

/** Middle of the front wall in the counter-clockwise frame. */
const FRONT = 0.75;

/** Smooth over breaths so the spotlight follows phrases, resting when the voice leaves. */
export const vocalGlow: EffectDef = {
	id: 'vocalGlow',
	name: 'Vocal Glow',
	role: 'accent',
	blurb: 'A front-of-room spotlight breathing with the vocal band.',
	taste: {
		energy: 2,
		// Outros may be carried by vocals alone.
		sections: ['intro', 'groove', 'breakdown', 'build', 'drop', 'outro'],
		minBars: 4,
		maxBars: 32,
		peakReserved: false,
		activity: 0,
		quiet: 5.02,
		// A front-wall spotlight needs a bed; its concentrated field cannot carry the room.
		carries: false
	},
	params: [INTENSITY, param('width', 'Spot width', 0.4)],
	create() {
		// Latch and glide the beat-resolution vocal estimate to keep its brightness at phrase
		// scale.
		const level = new BeatHold(0.6);
		const lean = new BeatHold(0.7);
		const spread = new BeatHold(0.3);
		const passage = new BeatHold(0.5);

		return {
			reset() {
				level.reset();
				lean.reset();
				spread.reset();
				passage.reset();
			},
			render(out, ctx) {
				const { f, g, p, palette, hueShift, motion } = ctx;
				// Rewrite the spot every frame; additive decay would accumulate and clip its
				// core.
				out.fill(0);

				// Mid minus sub approximates voice/lead content while rejecting bass-only
				// drops.
				const vocal = clamp(f.bands[Band.Mid] * 1.5 - f.bands[Band.Sub] * 0.2);
				const lvl = level.update(vocal, f.beat, f.dt, f.beatPeriod);
				// Bias position with pan to avoid lurching when the mix widens.
				const centre =
					FRONT + lean.update(f.pan, f.beat, f.dt, f.beatPeriod) * 0.07 * clamp(0.25 + motion * 0.75);
				// One voice is a spot, a whole arrangement is a wash.
				const focus = spread.update(1 - spectrumFocus(f), f.beat, f.dt, f.beatPeriod);
				const width = 0.12 + p.width * 0.28 + focus * 0.14;
				// Yield to loud passages so this quiet spotlight cannot add a steady floor over
				// drop strikers.
				const loud = passage.update(clamp(f.energy), f.beat, f.dt, f.beatPeriod);
				const gain = (0.6 + p.intensity * 1.3) * clamp(0.12 + lvl * 0.88) * (1 - 0.35 * loud);

				for (let i = 0; i < g.count; i++) {
					const d = Math.abs(frac(g.theta[i] - centre + 0.5) - 0.5);
					if (d > width) continue;
					const v = 1 - d / width;
					const soft = v * v;
					setSample(out, i, palette, lerp(SLOT.glow, SLOT.white, soft) + hueShift, soft * gain);
				}
			}
		};
	}
};
