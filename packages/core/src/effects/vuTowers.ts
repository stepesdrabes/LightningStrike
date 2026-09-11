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
 * Volume controls length; intensity controls brightness. Separate spectral slices and
 * measurement headroom keep strips from pinning into identical full bars.
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
		// Spread spectral slices across strips with slight jitter for adjacent columns.
		const slice = new Float32Array(n);
		for (let s = 0; s < n; s++) slice[s] = n > 1 ? (s + 0.35 * hash01(s * 31)) / n : 0.5;
		// Follow spectra continuously so all bars do not step together on beats.
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
				// Rewrite every pixel so receding meter edges cannot leave rippling trails.
				out.fill(0);

				// Weight low spectrum and kick so full scale requires both loud bass and a
				// landing hit.
				const drive = clamp(bandBetween(f, 0, 0.22) * 0.7 + f.kickEnv * 0.35);
				const rel = beatRelease(f.beatPeriod, 0.55);
				const gravity = (0.8 + p.gravity * 6) * Math.max(0.2, motion);
				const body = 0.13 + p.intensity * 0.25;

				for (let s = 0; s < n; s++) {
					const strip = g.strips[s];
					// Blend each strip's reading with shared kick drive for downbeat cohesion.
					const own = held[s].update(bandAt(f, slice[s] * clamp(p.span)), f.dt);
					// Avoid gain above the measurement range: clipping would erase differences
					// between strips.
					const mix = clamp(lerp(drive, own * 0.85 + f.kickEnv * 0.2, clamp(p.span) * 0.8));
					level[s] = envelope(level[s], mix, f.dt, 0, rel);

					// Intensity changes drawing brightness, never meter sensitivity.
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
						// Reach the accent only near the tip so the body stays on the home hue.
						const slot = lerp(SLOT.base, SLOT.accent, smoothstep(0.55, 1, d / mid));
						addSample(out, strip.offset + k, palette, slot + hueShift, edge * body);
					}

					// A 1.5-pixel sigma makes peak dots visible without white hot points.
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
