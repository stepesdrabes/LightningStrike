import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { setSample } from '../color/palette.ts';
import { clamp, lerp } from '../dsl/math.ts';
import { Follower } from '../dsl/env.ts';
import { noise3 } from '../dsl/wave.ts';
import { ringU } from '../dsl/space.ts';
import { bandBetween, spectralTilt, spectrumFocus } from '../dsl/spectrum.ts';
import { INTENSITY, param } from './helpers.ts';

/**
 * A drifting field whose grain is set by how busy the arrangement is.
 *
 * One voice on its own leaves the room smooth and slow; a full mix breaks it into finer, faster
 * cells. That is a texture reading the ARRANGEMENT rather than the level, which is what a
 * passage with no percussion has to be lit by, and it fills the whole room while doing it.
 *
 * The colour walks between the base and the third hue on the bottom-to-top balance of the mix,
 * so a bassline entering is a change of colour as well as of brightness.
 */
export const harmonicHaze: EffectDef = {
	id: 'harmonicHaze',
	name: 'Harmonic Haze',
	role: 'bed',
	blurb: 'A noise field whose grain and colour follow how busy and how bright the mix is.',
	taste: {
		energy: 2,
		sections: ['intro', 'groove', 'breakdown', 'build', 'void', 'drop', 'outro'],
		minBars: 2,
		maxBars: 64,
		peakReserved: false,
		activity: 0,
		quiet: 2.35
	},
	params: [INTENSITY, param('grain', 'Cell size', 0.5), param('drift', 'Drift speed', 0.5)],
	create(g) {
		let phase = 0;
		// All three set the grain and the colour of the field, never how bright it is, so they
		// are followed slowly: a hue driven fast is a brightness driven fast, because the slots
		// differ in luminance as well as in colour.
		const focus = new Follower(0.12, 0.45);
		const low = new Follower(0.12, 0.45);
		const lean = new Follower(0.12, 0.45);

		return {
			reset() {
				phase = 0;
				focus.reset();
				low.reset();
				lean.reset();
			},
			render(out, ctx) {
				const { f, p, palette, hueShift, motion } = ctx;

				// Beats, not seconds, so the drift keeps time with the track rather than with
				// the wall clock. Thirty-two of them: a bed at rest should take most of a minute
				// to go round, and anything faster than that reads as the room being restless.
				phase += (f.dt / Math.max(0.15, f.beatPeriod * 32)) * motion * (0.5 + p.drift);

				const busy = focus.update(spectrumFocus(f), f.dt);
				const bottom = low.update(bandBetween(f, 0, 0.35), f.dt);
				const tilt = lean.update(spectralTilt(f), f.dt);

				// A busy mix is a fine grain; one sustained voice is a broad slow field.
				const scale = (1.4 + p.grain * 2.2) * (0.6 + (1 - busy) * 1.8);
				const gain = 0.48 + p.intensity * 0.8;
				// Where the whole haze sits: bottom-heavy walks toward the room's own colour,
				// bright toward the third. How far the CELLS spread either side of it is how busy
				// the mix is - one sustained voice is a haze of one colour, a full arrangement is
				// a haze of several, which is the same thing the grain already says said in hue.
				const centre = clamp(tilt * 1.2 - bottom * 0.35);
				const spread = 0.25 + busy * 0.45;

				for (let i = 0; i < g.count; i++) {
					const u = ringU(g, i);
					const n = noise3(u * scale, phase, tilt * 1.5);
					const v = clamp(0.4 + n * 0.75);
					// A second cut of the same field, offset far enough to be uncorrelated with the
					// first. Colour therefore varies cell by cell rather than the whole room sitting
					// on one palette position - which is what made a bed covering the ENTIRE room a
					// single hue - and it drifts with the field instead of on a clock of its own.
					const tint = noise3(u * scale * 0.6 + 11.3, phase * 0.7 + 4.1, 2.7);
					const slot = lerp(SLOT.base, SLOT.third, clamp(centre + tint * spread));
					setSample(out, i, palette, lerp(slot, SLOT.glow, v * 0.2) + hueShift, (0.4 + v * 0.6) * gain);
				}
			}
		};
	}
};
