import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { setSample } from '../color/palette.ts';
import { clamp, envelope, lerp } from '../dsl/math.ts';
import { Follower } from '../dsl/env.ts';
import { ringU } from '../dsl/space.ts';
import { bandBetween } from '../dsl/spectrum.ts';
import { sinewave, triwave } from '../dsl/wave.ts';
import { INTENSITY, param } from './helpers.ts';

/**
 * The room's contrast opens and closes with the bottom end while its total output holds still.
 *
 * Every other sub-driven look in the catalog answers the bass with LEVEL, which raises the
 * eye's adaptation state on every note and leaves the hundredth kick reading weaker than the
 * first. This holds the mean and moves the depth of a two-lobe standing pattern instead, so
 * the bass is legible as contrast against a floor that never brightens - and because nothing
 * gets brighter, it cannot fight the layers above it or tire over a long passage.
 *
 * The lobes are a standing wave rather than a travelling one: opposite walls breathe together,
 * which reads as the room answering rather than as something moving through it.
 */
export const subBreath: EffectDef = {
	id: 'subBreath',
	name: 'Sub Breath',
	role: 'bed',
	blurb: 'The room breathes with the bottom end at constant total output.',
	taste: {
		energy: 2,
		sections: ['intro', 'groove', 'breakdown', 'build', 'drop', 'outro'],
		minBars: 2,
		maxBars: 64,
		peakReserved: false,
		// Fills the room at an even floor whatever the bass is doing, which is the whole
		// difference between this and subThrob or bassRing: both of those go dark between
		// notes and both declare they cannot hold a cue.
		carries: true,
		// Measured over the cache's real quiet sections, 2026-08-28. Low for a bed, and
		// correctly so: the column ranks how much a look MOVES in a quiet passage and this one
		// holds its mean flat on purpose, so it should lose those coin tosses to spectrumBed
		// (5.63) and chorusBloom (4.55). Its own passages are the groove and the drop, where
		// the quiet rank is not consulted at all.
		quiet: 2.38
	},
	params: [INTENSITY, param('depth', 'Breath depth', 0.62)],
	create(g) {
		/** How much of the bottom end is harmonics: how far the ring may reach for a second hue. */
		const grit = new Follower(0.25, 0.9);
		let env = 0;
		let drift = 0;

		return {
			reset() {
				env = 0;
				drift = 0;
				grit.reset();
			},
			render(out, ctx) {
				const { f, p, palette, hueShift, motion } = ctx;

				// The spectrum through an asymmetric envelope, never `f.bands`: a band steps once
				// a beat, and a breath that can only change on the beat is a pulse.
				env = envelope(
					env,
					clamp(bandBetween(f, 0, 0.12) * 2.2),
					f.dt,
					Math.max(0.03, f.beatPeriod * 0.1),
					Math.max(0.4, f.beatPeriod * 1.1)
				);
				const harmonics = grit.update(clamp(bandBetween(f, 0.12, 0.32) * 1.4), f.dt);
				// The kick seasons the depth and never the mean, so a passage with no kick at all
				// still breathes with its bass rather than going still.
				const depth = clamp(env * 0.85 + f.kickEnv * 0.12) * p.depth;

				// One lap of the standing pattern per 32 bars, so the walls it favours change
				// over a passage without any of it being visible as movement.
				drift += (f.dt * motion) / Math.max(1, 128 * f.beatPeriod);
				const mean = 0.62;
				const gain = 0.45 + p.intensity * 0.75;

				for (let i = 0; i < g.count; i++) {
					const onBeam = g.perim[i] < 0;
					const u = ringU(g, i);
					// The beam holds the mean exactly. It is the room's one still reference, and
					// it is also what keeps the dimmest wall inside the carrying test.
					const lobe = onBeam ? mean : mean + depth * 0.38 * sinewave(2 * u + drift);
					// Colour by POSITION only, and only as far as the harmonics justify: a clean
					// sine stays one hue, a distorted 808 opens toward the third. Varying the slot
					// over time here would be varying brightness over time, which is the one thing
					// this effect exists not to do.
					const slot = lerp(SLOT.base, SLOT.third, triwave(u) * (0.3 + harmonics * 0.5));
					setSample(out, i, palette, slot + hueShift, clamp(lobe) * gain);
				}
			}
		};
	}
};
