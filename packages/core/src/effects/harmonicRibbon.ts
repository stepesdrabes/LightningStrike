import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { addSample } from '../color/palette.ts';
import { clamp, lerp } from '../dsl/math.ts';
import { ringU } from '../dsl/space.ts';
import { spectralTilt, spectrumFocus, spectrumPeak } from '../dsl/spectrum.ts';
import { Follower } from '../dsl/env.ts';
import { INTENSITY, param } from './helpers.ts';

/** Centroid sets ribbon position and spectral focus its width; a floor lets it carry quiet cues. */
export const harmonicRibbon: EffectDef = {
	id: 'harmonicRibbon',
	name: 'Harmonic Ribbon',
	role: 'accent',
	blurb: 'A soft band tracking the brightest voice in the mix, tightening as it stands alone.',
	taste: {
		energy: 2,
		// Limit to quiet sections; drops already have a sustained floor.
		sections: ['intro', 'groove', 'breakdown', 'outro'],
		minBars: 2,
		maxBars: 32,
		peakReserved: false,
		activity: 0.1,
		quiet: 5.05
	},
	params: [INTENSITY, param('travel', 'How far it walks', 0.7), param('width', 'Band width', 0.5)],
	create(g) {
		// How loud the passage is, which is a level and belongs slow.
		const level = new Follower(0.1, 0.7);
		// Smooth position and width more slowly than level to avoid jumps while retaining
		// between-beat motion.
		const centroid = new Follower(0.1, 0.35);
		const width = new Follower(0.09, 0.3);
		// The one fast read: what is playing right now, which is what the ribbon is a picture of.
		const voice = new Follower(0.02, 0.13);

		return {
			reset() {
				level.reset();
				centroid.reset();
				width.reset();
				voice.reset();
			},
			render(out, ctx) {
				const { f, p, palette, hueShift, motion } = ctx;
				// Rewrite the band each frame; accumulating over decay would leave lagging,
				// rippling edges.
				out.fill(0);

				const at = centroid.update(spectralTilt(f), f.dt);
				const spread = width.update(1 - spectrumFocus(f), f.dt);
				const heard = level.update(f.energy, f.dt);
				// Peak above a slow floor captures articulation. Add it to gain so sustained
				// chords remain lit.
				const played = clamp((voice.update(spectrumPeak(f), f.dt) - heard * 0.55) * 2);

				// Level from the passage, with the articulation riding on top.
				const gain = (0.22 + p.intensity * 0.6) * clamp(0.15 + heard * 0.85) * (1 + played * 0.5);
				// Minimum width must cover a region, not a stripe, when carrying a quiet cue.
				const sigma = 0.07 + spread * 0.1 + p.width * 0.08;
				const slot = lerp(SLOT.glow, SLOT.accent, at);
				// Move around the perimeter so the melody crosses the room; cue motion sets the
				// travel range.
				const centre = 0.5 + (at - 0.5) * (0.4 + p.travel * 1.2) * clamp(0.25 + motion * 0.75);

				for (let i = 0; i < g.count; i++) {
					const d = Math.abs(ringU(g, i) - centre);
					const wrapped = Math.min(d, 1 - d);
					const v = Math.exp(-(wrapped * wrapped) / (2 * sigma * sigma));
					// A floor under the ribbon lets it carry a quiet cue.
					addSample(out, i, palette, slot + hueShift, (0.28 + v * 0.72) * gain);
				}
			}
		};
	}
};
