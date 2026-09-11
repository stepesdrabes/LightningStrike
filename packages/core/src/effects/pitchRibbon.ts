import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { addSample } from '../color/palette.ts';
import { clamp, lerp, paletteArc } from '../dsl/math.ts';
import { Follower } from '../dsl/env.ts';
import { bandAt } from '../dsl/spectrum.ts';
import { INTENSITY, param } from './helpers.ts';

/** The slice of the spectrum a melody lives in: above the bass, below the cymbals. */
const MELODY_LO = 0.3;
const MELODY_HI = 0.85;

/** Map the strongest melodic band to a beam position so repeated motifs retrace a stable shape. */
export const pitchRibbon: EffectDef = {
	id: 'pitchRibbon',
	name: 'Pitch Ribbon',
	role: 'accent',
	blurb: 'The melodic peak walks the ceiling beam - a motif traces the same shape every return.',
	taste: {
		energy: 2,
		sections: ['intro', 'groove', 'breakdown', 'build', 'drop', 'outro'],
		minBars: 2,
		maxBars: 64,
		peakReserved: false,
		activity: 0.1,
		quiet: 4.97,
		carries: false
	},
	params: [INTENSITY, param('width', 'Ribbon width', 0.3)],
	create(g) {
		const beam: number[] = [];
		for (let i = 0; i < g.count; i++) if (g.perim[i] < 0) beam.push(i);
		// A room with no beam still gets the ribbon, on the front wall's run.
		const home = beam.length > 0 ? beam : Array.from({ length: g.count }, (_, i) => i);

		// Smooth position more slowly than level so pitch leaps arrive instead of teleporting.
		const position = new Follower(0.12, 0.2);
		const level = new Follower(0.03, 0.22);

		return {
			reset() {
				position.reset();
				level.reset();
			},
			render(out, ctx) {
				const { f, p, palette, hueShift } = ctx;
				out.fill(0);

				// Scan at spectrum resolution, then smooth the argmax position to suppress
				// rival-band jitter.
				let bestU = 0.5;
				let bestV = 0;
				const steps = 12;
				for (let k = 0; k <= steps; k++) {
					const u = MELODY_LO + (k / steps) * (MELODY_HI - MELODY_LO);
					const v = bandAt(f, u);
					if (v > bestV) {
						bestV = v;
						bestU = (u - MELODY_LO) / (MELODY_HI - MELODY_LO);
					}
				}
				const at = position.update(bestU, f.dt);
				const amp = level.update(clamp(bestV), f.dt);
				if (amp < 0.03) return;

				const centre = at * (home.length - 1);
				const sigma = (0.05 + p.width * 0.12) * home.length;
				const gain = (0.6 + p.intensity * 1.0) * (0.25 + amp * 0.75);

				for (let k = 0; k < home.length; k++) {
					const d = (k - centre) / sigma;
					const w = Math.exp(-d * d);
					if (w < 0.02) continue;
					// Spatial palette colour and a glow crest give the ribbon a lit spine.
					const slot = lerp(paletteArc(at), SLOT.glow, w * 0.4);
					addSample(out, home[k], palette, slot + hueShift, w * gain);
				}
			}
		};
	}
};
