import type { EffectDef } from '../contracts/effect.ts';
import { Band } from '../contracts/frame.ts';
import { SLOT } from '../contracts/palette.ts';
import { setSample } from '../color/palette.ts';
import { alphaFor, clamp, envelope, lerp } from '../dsl/math.ts';
import { nblend } from '../dsl/buffer.ts';
import { noise3 } from '../dsl/wave.ts';
import { BeatHold } from '../dsl/env.ts';
import { INTENSITY, param } from './helpers.ts';

/**
 * A 3-D noise field sampled at each LED's real position, so the colour reads as volume
 * moving through the room rather than as a pattern on five separate surfaces.
 */
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
		quiet: 2.13
	},
	params: [INTENSITY, param('scale', 'Scale', 0.4), param('surge', 'Bass surge', 0.6)],
	create(g) {
		// The passage's own level, latched on the beat: `f.energy` is beat-resolution data the
		// player interpolates per frame, so a brightness multiplied by it slides continuously.
		const passage = new BeatHold(0.45);
		const buf = new Float32Array(g.count * 3);
		// The kick pushes the noise clock forward rather than warping the geometry, so
		// every hit shoves the sky and the motion keeps its inertia.
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

				// The floor is high because the cue's own intensity already says the passage is
				// quiet. A bed that dims itself as well is dimmed twice, and two multiplications
				// of a number under one is how an intro reached byte zero.
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
