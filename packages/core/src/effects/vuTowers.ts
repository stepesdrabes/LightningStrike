import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { addSample, sample } from '../color/palette.ts';
import { hash01 } from '../dsl/rng.ts';
import { clamp, envelope, lerp, smoothstep } from '../dsl/math.ts';
import { stampGaussian } from '../dsl/buffer.ts';
import { Follower } from '../dsl/env.ts';
import { bandAt, bandBetween } from '../dsl/spectrum.ts';
import { beatRelease, INTENSITY, param } from './helpers.ts';

/**
 * Volume changes LENGTH, not brightness - that is the difference between a meter and a
 * wall that pulses. Falling peak dots under gravity make it legible as a measurement.
 *
 * Every strip owns a different slice of the spectrum, so the room is an analyser rather than a
 * row of identical meters. It used to drive all of them off the same three numbers and tell
 * them apart with a hashed bias, which looks like variety and measures nothing.
 *
 * A meter is only a meter while it has somewhere to go. This spent a long time pinned: the
 * drive summed a kick envelope onto two band levels that are already near 1.0 in any loud
 * passage, multiplied the total by a gain of up to 1.55, and clamped. Every strip read full
 * scale, every bar filled its whole strip, and the room became the flat bright wall the first
 * line here says it must not be - measured on a drop, 144 of the stack's 198 bytes and the
 * least movement of the four layers in it. The signal now has to reach full scale on its own
 * merits, and the headroom that leaves is what the differences between strips are drawn in.
 */
export const vuTowers: EffectDef = {
	id: 'vuTowers',
	name: 'VU Towers',
	role: 'rhythm',
	blurb: 'Centre-out gravity meters on every strip, bass-driven, white peak dots.',
	taste: {
		energy: 3,
		sections: ['groove', 'breakdown', 'build', 'drop'],
		minBars: 2,
		maxBars: 32,
		peakReserved: false,
		activity: 0.4
	},
	params: [INTENSITY, param('gravity', 'Peak fall', 0.4), param('span', 'Spectrum across the room', 1)],
	create(g) {
		const n = g.strips.length;
		const level = new Float32Array(n);
		const peak = new Float32Array(n);
		const vel = new Float32Array(n);
		// Which slice of the spectrum each strip meters, spread across the room in strip order
		// with a little jitter so two adjacent strips on one wall are not the same column.
		const slice = new Float32Array(n);
		for (let s = 0; s < n; s++) slice[s] = n > 1 ? (s + 0.35 * hash01(s * 31)) / n : 0.5;
		// A bar's length is a measurement, so it follows the spectrum at the rate the spectrum
		// moves. Latching it on the beat made every strip step in unison, which is a row of
		// identical meters by another route.
		const held = g.strips.map(() => new Follower(0.022, 0.13));

		return {
			reset() {
				level.fill(0);
				peak.fill(0);
				vel.fill(0);
				for (const h of held) h.reset();
			},
			render(out, ctx) {
				const { f, p, palette, hueShift, motion } = ctx;
				// A meter is a field, not a trail: every pixel is written every frame, or the
				// receding edge lags behind the bar and ripples at the frame rate.
				out.fill(0);

				// The bottom of the spectrum rather than `f.bands`, which is a per-beat envelope and
				// so cannot move a meter inside a bar however it is smoothed. Weighted to leave
				// room: the two together reach full scale only when the low end is loud AND a kick
				// is landing on it, which is the moment a meter should be pinned and the only one.
				const drive = clamp(bandBetween(f, 0, 0.22) * 0.7 + f.kickEnv * 0.35);
				const rel = beatRelease(f.beatPeriod, 0.55);
				const gravity = (0.8 + p.gravity * 6) * Math.max(0.2, motion);
				// Where intensity goes now: how brightly the measurement is drawn.
				const body = 0.13 + p.intensity * 0.25;

				for (let s = 0; s < n; s++) {
					const strip = g.strips[s];
					// This strip's own column of the spectrum, blended toward the shared kick drive
					// so the room still moves together on the downbeat. At span 0 it is the old
					// behaviour: one mix everywhere, told apart by nothing but a hashed bias.
					const own = held[s].update(bandAt(f, slice[s] * clamp(p.span)), f.dt);
					// No headroom multiplier on either side of the blend. Adding a kick envelope on
					// top of a band that already reads 1.0 in a drop is what removed the difference
					// between strips: past the clamp, a strip metering 0.8 and one metering 1.2 draw
					// the same bar.
					const mix = clamp(lerp(drive, own * 0.85 + f.kickEnv * 0.2, clamp(p.span) * 0.8));
					level[s] = envelope(level[s], mix, f.dt, 0, rel);

					// Intensity is the cue's brightness, not the meter's sensitivity. It used to
					// scale the reading itself, so a bright cue pinned the scale rather than lighting
					// the same measurement more strongly.
					const lvl = clamp(level[s]);
					if (lvl >= peak[s]) {
						peak[s] = lvl;
						vel[s] = 0;
					} else {
						vel[s] += gravity * f.dt;
						peak[s] = Math.max(lvl, peak[s] - vel[s] * f.dt);
					}

					const mid = strip.count / 2;
					const barPx = lvl * mid;

					for (let k = 0; k < strip.count; k++) {
						const d = Math.abs(k - mid);
						if (d > barPx + 1) continue;
						const edge = d > barPx ? 1 - (d - barPx) : 1;
						// The climb to the accent is held back to the outer stretch, so the body
						// of the meter sits ON the home hue instead of touring everything between
						// the two anchors on its way there.
						const slot = lerp(SLOT.base, SLOT.accent, smoothstep(0.55, 1, d / mid));
						addSample(out, strip.offset + k, palette, slot + hueShift, edge * body);
					}

					// The peak dots are a pixel and a half of sigma: a single-pixel dot at white is
					// a hot point that reads as a fault rather than as a meter's ballistics.
					const pk = peak[s] * mid;
					const c = sample(palette, SLOT.white + hueShift, 0.5);
					const lo = strip.offset;
					const hi = strip.offset + strip.count;
					stampGaussian(out, g.count, lo + mid + pk, 1.4, c[0], c[1], c[2], false, lo, hi);
					stampGaussian(out, g.count, lo + mid - pk, 1.4, c[0], c[1], c[2], false, lo, hi);
				}
			}
		};
	}
};
