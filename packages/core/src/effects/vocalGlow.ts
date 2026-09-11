import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { setSample } from '../color/palette.ts';
import { clamp, frac, lerp, smoothstep } from '../dsl/math.ts';
import { Follower } from '../dsl/env.ts';
import { bandBetween, spectrumFocus } from '../dsl/spectrum.ts';
import { INTENSITY, param } from './helpers.ts';

/** Middle of the front wall in the counter-clockwise frame. */
const FRONT = 0.75;

/** A steady front-wall spot articulates middle-register notes and rests when they leave. */
export const vocalGlow: EffectDef = {
	id: 'vocalGlow',
	name: 'Vocal Glow',
	role: 'accent',
	blurb: 'A front-of-room spotlight breathing with voices and middle-register notes.',
	taste: {
		energy: 2,
		// Outros may be carried by vocals alone.
		sections: ['intro', 'groove', 'breakdown', 'build', 'drop', 'outro'],
		minBars: 4,
		maxBars: 32,
		peakReserved: false,
		activity: 0.1,
		noteReactive: true,
		quiet: 4.95,
		// A front-wall spotlight needs a bed; its concentrated field cannot carry the room.
		carries: false
	},
	params: [INTENSITY, param('width', 'Spot width', 0.4)],
	create() {
		const voice = new Follower(0.03, 0.16);
		const baseline = new Follower(0.65, 1.2);
		const lean = new Follower(0.3, 0.7);
		const spread = new Follower(0.25, 0.6);
		const passage = new Follower(0.35, 1.2);

		return {
			reset() {
				voice.reset();
				baseline.reset();
				lean.reset();
				spread.reset();
				passage.reset();
			},
			render(out, ctx) {
				const { f, g, p, palette, hueShift, motion } = ctx;
				// Rewrite the spot every frame; additive decay would accumulate and clip its
				// core.
				out.fill(0);

				const middle = bandBetween(f, 0.35, 0.78);
				const sung = voice.update(middle, f.dt);
				const played = clamp((sung - baseline.update(middle, f.dt)) * 5);
				// Bias position with pan to avoid lurching when the mix widens.
				const centre =
					FRONT + lean.update(f.pan, f.dt) * 0.07 * clamp(0.25 + motion * 0.75);
				// One voice is a spot, a whole arrangement is a wash.
				const focus = spread.update(1 - spectrumFocus(f), f.dt);
				const width = 0.12 + p.width * 0.28 + focus * 0.14;
				// Yield to loud passages so this quiet spotlight cannot add a steady floor over
				// drop strikers.
				const loud = passage.update(clamp(f.energy), f.dt);
				const presence = smoothstep(0.035, 0.22, sung);
				const gain = (0.44 + p.intensity * 0.96) * presence
					* clamp(0.24 + sung * 0.5 + played * 0.5) * (1 - 0.35 * loud);

				for (let i = 0; i < g.count; i++) {
					const d = Math.abs(frac(g.theta[i] - centre + 0.5) - 0.5);
					if (d > width) continue;
					const v = 1 - d / width;
					const soft = v * v;
					setSample(out, i, palette, lerp(SLOT.base, SLOT.glow, soft) + hueShift, soft * gain);
				}
			}
		};
	}
};
