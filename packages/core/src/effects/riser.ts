import type { EffectDef } from '../contracts/effect.ts';
import { Band } from '../contracts/frame.ts';
import { SLOT } from '../contracts/palette.ts';
import { setSample } from '../color/palette.ts';
import { clamp, lerp, smoothstep } from '../dsl/math.ts';
import { BeatHold, ratchet } from '../dsl/env.ts';
import { spectralTilt } from '../dsl/spectrum.ts';
import { sinewave } from '../dsl/wave.ts';
import { ringU } from '../dsl/space.ts';
import { INTENSITY, param } from './helpers.ts';

/**
 * In ring coordinates. A hard 0/1 front steps LED to LED as it advances, and a bar creeping
 * one pixel at a time reads as juddering rather than as filling.
 */
const FRONT_FEATHER = 0.004;

export const riser: EffectDef = {
	id: 'riser',
	name: 'Riser',
	role: 'rhythm',
	blurb: 'The room is the progress bar: fills from both ends and bleaches white on the drop.',
	taste: {
		energy: 4,
		sections: ['build'],
		minBars: 2,
		maxBars: 16,
		peakReserved: false,
		activity: 0.2
	},
	params: [INTENSITY, param('ticks', 'Segment ticks', 8, 0, 16, 1), param('bleach', 'Bleach', 0.8)],
	create(g) {
		// Outside a build there is no timeline to follow, so the fill follows the air band. It
		// has to be latched first: the ratchet collapses instantly when its target dips, and an
		// unlatched band dips several times a beat.
		const air = new BeatHold(0.5);
		const tilt = new BeatHold(0.25);
		let progress = 0;

		return {
			reset() {
				air.reset();
				tilt.reset();
				progress = 0;
			},
			render(out, ctx) {
				const { f, p, palette } = ctx;
				const held = air.update(clamp(f.bands[Band.Air]), f.beat, f.dt, f.beatPeriod);
				const target = f.buildProgress > 0 ? f.buildProgress : held;
				progress = ratchet(progress, target, f.dt, Math.max(0.05, f.beatPeriod * 0.25));

				const reach = progress * 0.5;
				const bleach = progress * progress * p.bleach;
				const ticks = Math.round(p.ticks);
				const warm = tilt.update(spectralTilt(f), f.beat, f.dt, f.beatPeriod);
				const slot = lerp(SLOT.base, SLOT.white, clamp(bleach + warm * 0.3)) + ctx.hueShift;
				const level = (0.5 + p.intensity * 0.9) * (0.5 + 0.5 * progress);

				for (let i = 0; i < g.count; i++) {
					// Mirrored around each run's own start, so the two fronts meet at the back wall
					// on the drop downbeat and the beam runs the same race along its own length.
					const along = ringU(g, i);
					const d = Math.min(along, 1 - along);
					let v = 1 - smoothstep(reach - FRONT_FEATHER, reach + FRONT_FEATHER, d);
					if (v > 0 && ticks > 0) {
						v *= 0.82 + 0.18 * sinewave(d * ticks * 2);
					}
					setSample(out, i, palette, slot, v * level);
				}
			}
		};
	}
};
