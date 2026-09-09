import type { EffectDef } from '../contracts/effect.ts';
import { Band } from '../contracts/frame.ts';
import { SLOT } from '../contracts/palette.ts';
import { setSample } from '../color/palette.ts';
import { clamp, frac, lerp } from '../dsl/math.ts';
import { BeatHold } from '../dsl/env.ts';
import { spectrumFocus } from '../dsl/spectrum.ts';
import { INTENSITY, param } from './helpers.ts';

/** Middle of the front wall in the counter-clockwise frame. */
const FRONT = 0.75;

/**
 * Smoothed to breath length rather than syllable length, so the spotlight swells with
 * phrases. When the vocal drops out it rests: the emptiness IS the arrangement.
 */
export const vocalGlow: EffectDef = {
	id: 'vocalGlow',
	name: 'Vocal Glow',
	role: 'accent',
	blurb: 'A front-of-room spotlight breathing with the vocal band.',
	taste: {
		energy: 2,
		// An outro is where a vocal most often is the whole arrangement, and leaving it off the
		// list was what left one carrying accent for the end of a track.
		sections: ['intro', 'groove', 'breakdown', 'build', 'drop', 'outro'],
		minBars: 4,
		maxBars: 32,
		peakReserved: false,
		activity: 0,
		quiet: 2.30,
		// A spotlight on the front wall by design: 28% of the room lit and nearly half its
		// output in the brightest tenth of the pixels. Beautiful over a bed, and the reason a
		// quiet cue carrying it and nothing else showed as one lit wall in a dark room.
		carries: false
	},
	params: [INTENSITY, param('width', 'Spot width', 0.4)],
	create() {
		// The vocal band read once per beat and glided over most of one. `f.bands` is
		// beat-resolution data the player interpolates per frame, and each band is normalised
		// against its own distribution across the track, so a brightness that follows it
		// directly breathes at the frame rate rather than with the phrase.
		const level = new BeatHold(0.6);
		const lean = new BeatHold(0.7);
		const spread = new BeatHold(0.3);
		// The passage's loudness, latched like everything else read off `f.energy`.
		const passage = new BeatHold(0.5);

		return {
			reset() {
				level.reset();
				lean.reset();
				spread.reset();
				passage.reset();
			},
			render(out, ctx) {
				const { f, g, p, palette, hueShift, motion } = ctx;
				// A spotlight is a field, so every pixel is written every frame. Decaying the
				// buffer and adding the spot on top made the displayed level an integral of the
				// last tenth of a second, about six times what the effect asked for, which is
				// why its core sat clipped at white whatever the vocal was doing.
				out.fill(0);

				// The mid band leaning against the sub is the best guess at a voice the frame
				// offers: vocals and leads live there, and subtracting the bottom stops a bass
				// drop reading as somebody singing.
				const vocal = clamp(f.bands[Band.Mid] * 1.5 - f.bands[Band.Sub] * 0.2);
				const lvl = level.update(vocal, f.beat, f.dt, f.beatPeriod);
				// Leaned by the mix rather than placed by it: pan is a property of the recording,
				// and a light that maps it straight onto a wall lurches whenever a pad goes wide.
				const centre =
					FRONT + lean.update(f.pan, f.beat, f.dt, f.beatPeriod) * 0.07 * clamp(0.25 + motion * 0.75);
				// One voice is a spot, a whole arrangement is a wash.
				const focus = spread.update(1 - spectrumFocus(f), f.beat, f.dt, f.beatPeriod);
				const width = 0.12 + p.width * 0.28 + focus * 0.14;
				// A spotlight yields to a loud band: this is a quiet-passage device, and as the
				// calm accent of a drop it added a steady 30 bytes where the striker it replaced
				// added eight between events, which read as the room jumping between cues.
				const loud = passage.update(clamp(f.energy), f.beat, f.dt, f.beatPeriod);
				const gain = (0.6 + p.intensity * 1.3) * clamp(0.12 + lvl * 0.88) * (1 - 0.35 * loud);

				for (let i = 0; i < g.count; i++) {
					// The beam's centre catches the edge of the glow too.
					const d = Math.abs(frac(g.theta[i] - centre + 0.5) - 0.5);
					if (d > width) continue;
					const v = 1 - d / width;
					const soft = v * v;
					setSample(out, i, palette, lerp(SLOT.glow, SLOT.white, soft) + hueShift, soft * gain);
				}
			}
		};
	}
};
