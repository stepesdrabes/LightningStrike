import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { setSample } from '../color/palette.ts';
import { clamp, lerp } from '../dsl/math.ts';
import { bandBetween } from '../dsl/spectrum.ts';
import { Follower, Presence, PulseEnv } from '../dsl/env.ts';
import { INTENSITY, param } from './helpers.ts';

/**
 * Hold a bright ring around a dark beam. Peak contrast comes from coverage and colour,
 * with only level and a kick filament moving.
 */
export const silhouette: EffectDef = {
	id: 'silhouette',
	name: 'Silhouette',
	role: 'master',
	blurb: 'The edge at full blaze, the centre dark: the room becomes a figure held against light.',
	taste: {
		energy: 5,
		sections: ['drop'],
		minBars: 0,
		// Hold through the peak phrase instead of behaving as a short burst.
		maxBars: 8,
		peakReserved: true,
		activity: 0.5,
		// Reserve for impact peaks; bloom arrivals need the centre lit.
		peakStyle: 'slam'
	},
	params: [INTENSITY, param('depth', 'Contrast depth', 0.85)],
	create(g) {
		// Follow the spectrum so the held edge articulates inside the bar.
		const breath = new Follower(0.5, 0.12);
		const push = new PulseEnv();
		// Only the kick push requires kit; a beatless peak must retain the hold.
		const kit = new Presence();

		return {
			reset() {
				breath.reset();
				push.reset();
				kit.reset();
			},
			render(out, ctx) {
				const { f, p, palette, hueShift } = ctx;

				const level = breath.update(clamp(bandBetween(f, 0.15, 0.85) * 1.4), f.dt);
				const playing = kit.update(f.kickEnv, f.dt, f.beatPeriod);
				if (f.beat && playing > 0.08) push.fire(playing);
				const v = push.decay(f.dt, f.beatPeriod, 1.6);

				// Keep the hold below full scale to leave headroom for kicks. Add only a touch
				// of white
				// so the push reads as level in one hue; the beam darkens for contrast.
				const edgeSlot = lerp(SLOT.accent, SLOT.white, v * 0.3);
				const edgeLevel = clamp(0.3 + 0.16 * level + 0.5 * v) * (0.5 + p.intensity * 0.4);
				const coreLevel = 0.05 * (1 - p.depth * 0.85) + 0.03 * (1 - v);

				for (let i = 0; i < g.count; i++) {
					if (g.perim[i] >= 0) {
						setSample(out, i, palette, edgeSlot + hueShift, edgeLevel);
					} else {
						setSample(out, i, palette, SLOT.deep + hueShift, clamp(coreLevel));
					}
				}
			}
		};
	}
};
