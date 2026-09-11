import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { setSample } from '../color/palette.ts';
import { alphaFor, clamp, envelope, lerp } from '../dsl/math.ts';
import { nblend, setPixel } from '../dsl/buffer.ts';
import { sinewave } from '../dsl/wave.ts';
import { Follower } from '../dsl/env.ts';
import { bandBetween } from '../dsl/spectrum.ts';
import { INTENSITY } from './helpers.ts';

/** Long release follows an 808 tail. Beam spill grows with level; gaps between notes stay dark. */
export const subThrob: EffectDef = {
	id: 'subThrob',
	name: 'Subwoofer Throb',
	role: 'bed',
	blurb: 'The 808 tail as a slow perimeter throb bleeding toward the ceiling.',
	taste: {
		energy: 2,
		sections: ['intro', 'groove', 'breakdown', 'build', 'void', 'drop', 'outro'],
		minBars: 2,
		maxBars: 64,
		peakReserved: false,
		activity: 0.15,
		quiet: 4.38,
		// Driven entirely by the sub band, so a passage with no bass renders nothing.
		carries: false
	},
	params: [INTENSITY],
	create(g) {
		const buf = new Float32Array(g.count * 3);
		/** Slowly measured bass harmonics earn a second hue without note-rate colour flashes. */
		const grit = new Follower(0.2, 0.8);
		let env = 0;

		return {
			reset() {
				env = 0;
				grit.reset();
				buf.fill(0);
			},
			render(out, ctx) {
				const { f, p, palette, hueShift } = ctx;

				// Spectrum gain 2.2 compensates for its lower scale than band envelopes.
				// A tenth-beat attack suppresses jitter while retaining the note.
				const bottom = bandBetween(f, 0, 0.12);
				env = envelope(
					env,
					clamp(bottom * 2.2),
					f.dt,
					Math.max(0.03, f.beatPeriod * 0.1),
					Math.max(0.5, f.beatPeriod * 1.4)
				);
				const gain = env * (0.3 + p.intensity * 0.6);
				const harmonics = grit.update(clamp(bandBetween(f, 0.12, 0.32) * 1.5 - bottom * 0.4), f.dt);

				for (let i = 0; i < g.count; i++) {
					const onRing = g.perim[i] >= 0;
					const reach = onRing ? 1 : clamp(env * 1.6 - 0.35);
					if (reach <= 0.01) {
						setPixel(buf, i, 0, 0, 0);
						continue;
					}
					// Keep ring hue at base and spread toward third on the beam as harmonic
					// grit grows.
					// Spatial colour avoids adding a brightness modulation in time.
					const climb = onRing ? 0 : clamp(reach * 1.2);
					const slot = lerp(
						lerp(SLOT.deep, SLOT.base, clamp(env * 1.25)),
						SLOT.third,
						climb * (0.3 + harmonics * 0.7)
					);
					const wave = 0.85 + 0.15 * sinewave((onRing ? g.perim[i] : g.local[i]) * 1.5 + env);
					setSample(buf, i, palette, slot + hueShift, gain * reach * wave);
				}

				nblend(out, buf, alphaFor(f.dt, 0.07));
			}
		};
	}
};
