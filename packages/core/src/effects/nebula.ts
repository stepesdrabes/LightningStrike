import type { EffectDef } from '../contracts/effect.ts';
import { Band } from '../contracts/frame.ts';
import { SLOT } from '../contracts/palette.ts';
import { setSample } from '../color/palette.ts';
import { alphaFor, clamp, envelope, lerp } from '../dsl/math.ts';
import { nblend } from '../dsl/buffer.ts';
import { noise3 } from '../dsl/wave.ts';
import { BeatHold } from '../dsl/env.ts';
import { INTENSITY, param } from './helpers.ts';

/** Sample world positions so noise moves as one volume across strips. */
export const nebula: EffectDef = {
	id: 'nebula',
	name: 'Nebula',
	role: 'bed',
	blurb: '3D colour field drifting through the room, surging forward on the bass.',
	taste: {
		energy: 2,
		sections: ['intro', 'groove', 'breakdown', 'build', 'void', 'drop', 'outro'],
		minBars: 2,
		maxBars: 64,
		peakReserved: false,
		activity: 0.05,
		quiet: 4.74
	},
	params: [INTENSITY, param('scale', 'Scale', 0.4), param('surge', 'Bass surge', 0.6)],
	create(g) {
		// Latch interpolated beat energy before applying it to brightness.
		const passage = new BeatHold(0.45);
		const buf = new Float32Array(g.count * 3);
		// Kick advances the noise clock to preserve inertial motion without warping geometry.
		let clock = 0;
		let bassEnv = 0;
		let level = 0;

		return {
			reset() {
				passage.reset();
				clock = 0;
				bassEnv = 0;
				level = 0;
				buf.fill(0);
			},
			render(out, ctx) {
				const { f, p, palette, hueShift, motion } = ctx;

				bassEnv = envelope(bassEnv, clamp(f.kickEnv + f.bands[Band.Low] * 0.5), f.dt, 0.01, 0.35);
				clock += f.dt * 0.14 * motion * (1 + bassEnv * p.surge * 2.2);

				// Keep a high floor because cue intensity already dims quiet passages.
				const heard = passage.update(f.energy, f.beat, f.dt, f.beatPeriod);
				level = envelope(level, clamp(0.55 + heard * 0.45), f.dt, 0.12, 0.7);
				const bright = level * (0.6 + p.intensity * 1.1);
				const scale = 1.2 + p.scale * 6;
				const t = clock;

				for (let i = 0; i < g.count; i++) {
					const n1 = noise3(
						g.nx[i] * scale + t,
						g.ny[i] * scale - t * 0.7,
						g.nz[i] * scale * 0.6 + t * 0.4
					);
					const n2 = noise3(g.nx[i] * scale * 2.3 + 31 - t * 0.5, g.ny[i] * scale * 2.3 + t, 7.7);
					const field = clamp(n1 * 0.72 + n2 * 0.28);
					// The field value walks the palette, so several designed hues appear with
					// no hue arithmetic anywhere.
					const slot =
						field < 0.55
							? lerp(SLOT.deep, SLOT.base, field / 0.55)
							: field < 0.85
								? lerp(SLOT.base, SLOT.third, (field - 0.55) / 0.3)
								: lerp(SLOT.third, SLOT.glow, (field - 0.85) / 0.15);
					setSample(buf, i, palette, slot + hueShift, (0.35 + 0.65 * field * field) * bright);
				}

				nblend(out, buf, alphaFor(f.dt, 0.07));
			}
		};
	}
};
