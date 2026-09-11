import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { addSample } from '../color/palette.ts';
import { clamp, lerp } from '../dsl/math.ts';
import { Follower } from '../dsl/env.ts';
import { bandBetween } from '../dsl/spectrum.ts';
import { INTENSITY, param } from './helpers.ts';

export const pitchRibbon: EffectDef = {
	id: 'pitchRibbon',
	name: 'Pitch Ribbon',
	role: 'accent',
	blurb: 'A broad beam glow follows the voice and notes, opening gently with their spectral colour.',
	taste: {
		energy: 2,
		sections: ['intro', 'groove', 'breakdown', 'build', 'drop', 'outro'],
		minBars: 2,
		maxBars: 64,
		peakReserved: false,
		activity: 0.1,
		noteReactive: true,
		quiet: 4.54,
		carries: false
	},
	params: [INTENSITY, param('width', 'Ribbon width', 0.3)],
	create(g) {
		const beam: number[] = [];
		for (let i = 0; i < g.count; i++) if (g.perim[i] < 0) beam.push(i);
		// Rooms without a beam retain a soft continuation across their available pixels.
		const home = beam.length > 0 ? beam : Array.from({ length: g.count }, (_, i) => i);

		const spread = new Follower(0.4, 0.7);
		const level = new Follower(0.025, 0.16);
		const passage = new Follower(0.8, 1.2);

		return {
			reset() {
				spread.reset();
				level.reset();
				passage.reset();
			},
			render(out, ctx) {
				const { f, p, palette, hueShift } = ctx;
				out.fill(0);

				const body = bandBetween(f, 0.28, 0.5);
				const voice = bandBetween(f, 0.5, 0.7);
				const note = Math.max(body, voice);
				const heard = level.update(note, f.dt);
				const held = passage.update(note, f.dt);
				const colour = spread.update(voice / Math.max(0.001, body + voice), f.dt);
				// A spectral peak is often an overtone or cymbal, not a moving melody. Keep its
				// location stable and let same-scale spectral articulation shape the brightness.
				const articulation = clamp(heard * 0.8 + Math.max(0, heard - held) * 2.2);
				const sigma = (0.18 + p.width * 0.2 + colour * 0.06) * home.length;
				const centre = (home.length - 1) * 0.5;
				const gain = (0.3 + p.intensity * 0.8) * articulation;

				for (let k = 0; k < home.length; k++) {
					const d = (k - centre) / sigma;
					const w = Math.exp(-d * d);
					if (w < 0.02) continue;
					const slot = lerp(SLOT.base, SLOT.glow, w * 0.35);
					addSample(out, home[k], palette, slot + hueShift, w * gain);
				}
			}
		};
	}
};
