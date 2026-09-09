import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { setSample } from '../color/palette.ts';
import { alphaFor, clamp, envelope, lerp } from '../dsl/math.ts';
import { nblend, setPixel } from '../dsl/buffer.ts';
import { sinewave } from '../dsl/wave.ts';
import { Follower } from '../dsl/env.ts';
import { bandBetween } from '../dsl/spectrum.ts';
import { INTENSITY } from './helpers.ts';

/**
 * A long release, so this tracks an 808's tail rather than a kick's snap. The glow
 * bleeds up into the beam only as the level rises, as if the bass were filling the room
 * from the walls inward; the darkness between notes is the point.
 */
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
		quiet: 1.93,
		// Driven entirely by the sub band, so a passage with no bass renders nothing.
		carries: false
	},
	params: [INTENSITY],
	create(g) {
		const buf = new Float32Array(g.count * 3);
		/**
		 * How much of the bottom end is harmonics rather than fundamental.
		 *
		 * A clean 808 is one colour; a distorted one has content an octave up and earns a second.
		 * Slow, because the slots differ in luminance as well as in hue and a colour driven at
		 * the speed of a note is a brightness driven at the speed of a note.
		 */
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

				// The spectrum rather than `f.bands`, which is a per-beat envelope and so cannot
				// follow an 808's tail at all - it can only step once a beat and glide. The gain is
				// 2.2 where the band read 1.5 because the two are not the same scale: a band
				// envelope is normalised across the track, the spectrum is a fixed window under it.
				//
				// Only the rising path gets through the asymmetric envelope, so the attack is the
				// one place frame-to-frame noise can reach the room. A tenth of a beat still lands
				// on the note and leaves the jitter behind.
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
					// The bass filling the room, made visible as colour rather than only as reach:
					// the ring holds the room's own hue and what has climbed onto the beam arrives
					// in the third, so the spread upward reads as the note opening out. How far it
					// gets is how much grit the 808 has - a clean sine stays home.
					//
					// Spatial, not temporal. `deep` to `base` is one hue at two lightnesses, which
					// is why this bed filled 95% of the room with a single colour; crossing to
					// `third` is what makes it a colour at all, and doing it by POSITION adds no
					// brightness movement of its own.
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
