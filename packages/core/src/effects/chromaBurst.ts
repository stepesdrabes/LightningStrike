import type { EffectDef } from '../contracts/effect.ts';
import { sectionBase } from '../contracts/frame.ts';
import { sample } from '../color/palette.ts';
import { paletteArc } from '../dsl/math.ts';
import { setPixel } from '../dsl/buffer.ts';
import { Edge, INTENSITY, param } from './helpers.ts';

/**
 * The rationed special: three concentric shells carrying a slice of the palette by radius,
 * two beats of glory, then gone.
 *
 * This is the effect the picker hands the peak of nearly every track, which is exactly why it
 * may not have colours of its own: the biggest moment of a show is the last place the room
 * should stop being the colour it has been all night.
 */
export const chromaBurst: EffectDef = {
	id: 'chromaBurst',
	name: 'Chroma Burst',
	role: 'master',
	blurb: 'One-shot rainbow shockwave rings on the drop and its phrase starts.',
	taste: {
		energy: 5,
		sections: ['drop'],
		minBars: 0,
		maxBars: 2,
		peakReserved: true
	},
	params: [INTENSITY, param('trigger', 'Trigger', 0, 0, 1, 1)],
	create(g) {
		// Every LED on this fixture is coplanar, so `g.dist` starts at the beam's middle and
		// never reaches 0: swept against the raw figure the shells spend the first half of
		// their two beats on empty space and arrive with a quarter of their gain left. The
		// room measured 0.000 fill against silhouette's 0.833. Re-based on the room's own
		// range, the way kickTunnel and subSwell already are.
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
				const gain = (0.7 + p.intensity * 1.3) * (1 - u) * (1 - u);
				const maxR = 4.2;

				for (let i = 0; i < g.count; i++) {
					let r = 0;
					let gr = 0;
					let b = 0;
					// Three shells at staggered radii, each a spectrum slice by radius.
					for (let s = 0; s < 3; s++) {
						const radius = (u * (1 + s * 0.18) - s * 0.06) * maxR;
						if (radius < 0) continue;
						const d = Math.abs(depth[i] * maxR - radius);
						if (d > 0.28) continue;
						const v = Math.pow(1 - d / 0.28, 2);
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
