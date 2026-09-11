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

/** Soften the ring front so slow fills do not judder one LED at a time. */
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
		// Outside builds, latch the air-band target so the instant-down ratchet cannot shimmer.
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
					// Mirror fronts to meet at the back on the drop; the beam fills along its
					// own length.
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
