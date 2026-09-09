import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { addSample } from '../color/palette.ts';
import { clamp, lerp } from '../dsl/math.ts';
import { ringU } from '../dsl/space.ts';
import { spectralTilt, spectrumFocus, spectrumPeak } from '../dsl/spectrum.ts';
import { Follower } from '../dsl/env.ts';
import { INTENSITY, param } from './helpers.ts';

/**
 * A band of light that follows whatever is carrying the tune.
 *
 * The spectral centroid says where the energy is sitting and `spectrumFocus` says whether that
 * is one voice or a whole arrangement. Together they draw a line that walks with a vocal or a
 * lead and spreads into a wash when the mix fills out, which is a melody in the room - the one
 * thing a drum-driven catalog could never show.
 *
 * It carries, and it means it: a quiet cue whose second layer is this is genuinely two layers,
 * where the same cue behind a sparkle was one and a rumour.
 */
export const harmonicRibbon: EffectDef = {
	id: 'harmonicRibbon',
	name: 'Harmonic Ribbon',
	role: 'accent',
	blurb: 'A soft band tracking the brightest voice in the mix, tightening as it stands alone.',
	taste: {
		energy: 2,
		// The quiet passages only, for the same reason as bandBloom: a carrying field is a
		// floor, and a drop already has one.
		sections: ['intro', 'groove', 'breakdown', 'outro'],
		minBars: 2,
		maxBars: 32,
		peakReserved: false,
		activity: 0.1,
		quiet: 2.19
	},
	params: [INTENSITY, param('travel', 'How far it walks', 0.7), param('width', 'Band width', 0.5)],
	create(g) {
		// How loud the passage is, which is a level and belongs slow.
		const level = new Follower(0.1, 0.7);
		// Where the band sits and how wide it is. Slower than a meter because these are a
		// position and an extent, and a room whose geometry chases every sixteenth reads as a
		// fault - but followed, not latched, so a phrase that opens up moves the ribbon while it
		// is opening rather than at the next downbeat.
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
				// Written, not accumulated. A band that walks across a buffer decaying at 0.4 s
				// leaves a lagging edge on every pixel it crosses, which is a ripple at the frame
				// rate however slowly the band itself moves.
				out.fill(0);

				const at = centroid.update(spectralTilt(f), f.dt);
				const spread = width.update(1 - spectrumFocus(f), f.dt);
				const heard = level.update(f.energy, f.dt);
				// Peak minus a slow floor is the articulation rather than the level: a sustained
				// chord sits at the floor and adds nothing, a struck one rises above it. Added to
				// the gain rather than multiplied into it, so the ribbon never gates itself out.
				const played = clamp((voice.update(spectrumPeak(f), f.dt) - heard * 0.55) * 2);

				// Level from the passage, with the articulation riding on top.
				const gain = (0.22 + p.intensity * 0.6) * clamp(0.15 + heard * 0.85) * (1 + played * 0.5);
				// One voice is a line, a whole arrangement is a wash. The width is the measurement.
				// Wide enough at its narrowest that the band is a region of the room rather than a
				// stripe on one wall: as the only texture over a quiet bed, a stripe reads as a fault.
				const sigma = 0.07 + spread * 0.1 + p.width * 0.08;
				const slot = lerp(SLOT.glow, SLOT.accent, at);
				// Walked around the ring rather than up a strip, so the melody crosses the room
				// instead of climbing one wall.
				// Scaled by the cue's motion, which is how an effect is told the passage is quiet.
				// Across a whole ring per beat is a melody; a fifth of it is a room breathing.
				const centre = 0.5 + (at - 0.5) * (0.4 + p.travel * 1.2) * clamp(0.25 + motion * 0.75);

				for (let i = 0; i < g.count; i++) {
					const d = Math.abs(ringU(g, i) - centre);
					const wrapped = Math.min(d, 1 - d);
					const v = Math.exp(-(wrapped * wrapped) / (2 * sigma * sigma));
					// A floor under the band, because this is asked to carry a quiet cue: the
					// band is what it says, and the floor is what makes it a room rather than a
					// stripe on a dark wall.
					addSample(out, i, palette, slot + hueShift, (0.28 + v * 0.72) * gain);
				}
			}
		};
	}
};
