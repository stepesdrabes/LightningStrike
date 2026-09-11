import type { EffectDef } from '../contracts/effect.ts';
import { sectionBase } from '../contracts/frame.ts';
import { SLOT } from '../contracts/palette.ts';
import { sample } from '../color/palette.ts';
import { paletteArc } from '../dsl/math.ts';
import { setPixel } from '../dsl/buffer.ts';
import { Edge, INTENSITY, param } from './helpers.ts';

/** How long the impact frame holds the whole room at white before the shells take over. */
const IMPACT_HOLD = 0.08;

/**
 * Use the show's palette at its peak. A whole-room arrival and thick shells keep this short
 * reserved gesture visibly substantial.
 */
export const chromaBurst: EffectDef = {
	id: 'chromaBurst',
	name: 'Chroma Burst',
	role: 'master',
	blurb: 'The room struck white on the drop, then three thick palette shells rolling out of the centre.',
	taste: {
		energy: 5,
		sections: ['drop'],
		minBars: 0,
		maxBars: 2,
		peakReserved: true,
		activity: 0.7
	},
	params: [INTENSITY, param('trigger', 'Trigger', 0, 0, 1, 1)],
	create(g) {
		// Normalize actual fixture distances; the coplanar frame never reaches raw dist = 0.
		const depth = new Float32Array(g.count);
		let near = Infinity;
		let far = 0;
		for (let i = 0; i < g.count; i++) {
			if (g.dist[i] < near) near = g.dist[i];
			if (g.dist[i] > far) far = g.dist[i];
		}
		const span = Math.max(1e-3, far - near);
		for (let i = 0; i < g.count; i++) depth[i] = (g.dist[i] - near) / span;

		const rgb: [number, number, number] = [0, 0, 0];
		const edge = new Edge();
		let burstT = -1;
		let armedFor = Number.NaN;

		return {
			reset() {
				burstT = -1;
				armedFor = Number.NaN;
				edge.reset();
			},
			render(out, ctx) {
				const { f, p, palette, hueShift } = ctx;

				// A chorus is the song vocabulary's drop; arming on the literal kind alone left
				// a pop peak carrying this and never firing it.
				if (sectionBase(f.section) === 'drop' && f.downbeat) {
					const impact = f.timeSinceDrop < 0.3;
					if ((impact || f.phraseStart) && armedFor !== f.barIndex) {
						armedFor = f.barIndex;
						burstT = f.t;
					}
				}
				if (edge.update(p.trigger > 0.5)) burstT = f.t;

				const life = Math.max(0.4, f.beatPeriod * 2);
				const age = burstT >= 0 ? f.t - burstT : Infinity;
				if (age > life) {
					out.fill(0);
					return;
				}

				const u = age / life;
				const gain = (0.8 + p.intensity * 1.0) * (1 - u) * (1 - u);
				// The blow: white through the hold, then gone inside half a beat.
				const flash =
					age < IMPACT_HOLD ? 1 : Math.exp(-(age - IMPACT_HOLD) / Math.max(0.05, f.beatPeriod * 0.16));
				const white = sample(palette, SLOT.white + hueShift, flash * (0.7 + p.intensity * 0.5), rgb);
				const wr = white[0];
				const wg = white[1];
				const wb = white[2];
				const maxR = 4.2;

				for (let i = 0; i < g.count; i++) {
					let r = wr;
					let gr = wg;
					let b = wb;
					// Three shells at staggered radii, each a spectrum slice by radius, thick
					// enough that a shell is a band of the room rather than a line across it.
					for (let s = 0; s < 3; s++) {
						const radius = (u * (1 + s * 0.18) - s * 0.06) * maxR;
						if (radius < 0) continue;
						const d = Math.abs(depth[i] * maxR - radius);
						if (d > 0.55) continue;
						const v = Math.pow(1 - d / 0.55, 2);
						sample(palette, paletteArc(depth[i] * 0.8 + s * 0.33 + hueShift), v * gain, rgb);
						r += rgb[0];
						gr += rgb[1];
						b += rgb[2];
					}
					setPixel(out, i, r, gr, b);
				}
			}
		};
	}
};
