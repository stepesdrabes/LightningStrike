import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { addSample } from '../color/palette.ts';
import { clamp, lerp } from '../dsl/math.ts';
import { sinewave } from '../dsl/wave.ts';
import { hash01 } from '../dsl/rng.ts';
import { ringU } from '../dsl/space.ts';
import { Follower } from '../dsl/env.ts';
import { bandAt } from '../dsl/spectrum.ts';
import { INTENSITY, param } from './helpers.ts';

const LAMPS = 5;

/**
 * Soft pools of light that wander the perimeter and settle, the way lamps sit round a bar.
 *
 * Each has its own wander period, its own breathing period and its own place on the palette, all
 * hashed from its index, so no two are ever in step and a seek reproduces every one of them. The
 * periods are deliberately not related by a whole number: five lamps on a common clock is a chase.
 *
 * Sparse by design, so it declares `carries: false` and always rides a bed. The beam takes the mean
 * of the lamps as an even spill rather than a sixth pool, because the ceiling is where a room's
 * light bounces and not where a lamp stands.
 */
export const lanterns: EffectDef = {
	id: 'lanterns',
	name: 'Lanterns',
	role: 'accent',
	blurb: 'A handful of soft pools drifting round the walls, each breathing on its own clock.',
	taste: {
		energy: 1,
		sections: ['intro', 'groove', 'breakdown', 'void', 'outro'],
		minBars: 4,
		maxBars: 64,
		peakReserved: false,
		activity: 0.1,
		quiet: 2.22,
		carries: false
	},
	params: [
		INTENSITY,
		param('drift', 'Drift', 0.45),
		param('width', 'Width', 0.5),
		param('listen', 'How much it hears', 0.5)
	],
	create(g) {
		const home = new Float32Array(LAMPS);
		const wander = new Float32Array(LAMPS);
		const breath = new Float32Array(LAMPS);
		const slot = new Float32Array(LAMPS);
		for (let k = 0; k < LAMPS; k++) {
			home[k] = k / LAMPS + hash01(k * 31 + 5) * 0.06;
			// Never a whole-number ratio between any two, so the set never lines up.
			wander[k] = 0.0031 + hash01(k * 17 + 2) * 0.0043;
			breath[k] = 0.021 + hash01(k * 53 + 9) * 0.031;
			// Most of them are the room's own colour; one takes the third, which is what makes a
			// row of lamps read as a room somebody furnished rather than as a fixture.
			slot[k] = hash01(k * 71 + 3) < 0.25 ? SLOT.third : lerp(SLOT.base, SLOT.glow, hash01(k * 13));
		}
		const pos = new Float32Array(LAMPS);
		const level = new Float32Array(LAMPS);
		const onBeam = new Uint8Array(g.count);
		for (let i = 0; i < g.count; i++) onBeam[i] = g.perim[i] < 0 ? 1 : 0;
		// One band per lamp, spread across the spectrum. Slow on the way down, because a lamp that
		// drops with every gap in the mix is a meter and the point of this is that it is furniture.
		const voices = Array.from({ length: LAMPS }, () => new Follower(0.09, 0.55));
		let phase = 0;

		return {
			reset() {
				phase = 0;
				pos.fill(0);
				level.fill(0);
				for (const v of voices) v.reset();
			},
			render(out, ctx) {
				const { f, p, palette, hueShift, motion } = ctx;
				out.fill(0);

				phase += f.dt * motion;
				const roam = 0.02 + clamp(p.drift) * 0.06;
				const sigma = 0.035 + clamp(p.width) * 0.075;
				const gain = 0.25 + p.intensity * 0.5;
				const listen = clamp(p.listen);

				let mean = 0;
				for (let k = 0; k < LAMPS; k++) {
					pos[k] = home[k] + (sinewave(phase * wander[k] + hash01(k * 7)) - 0.5) * roam;
					// Each lamp turns up a little for its own part of the mix. Centred on unity so
					// the room stays lit through a passage with nothing in it: this shades the
					// lamps, it does not switch them on.
					const voice = voices[k].update(bandAt(f, k / (LAMPS - 1)), f.dt);
					const breathing = 0.52 + 0.48 * sinewave(phase * breath[k] + hash01(k * 23));
					level[k] = breathing * gain * (1 + listen * (voice - 0.35));
					mean += level[k];
				}
				mean /= LAMPS;

				const twoSigmaSq = 2 * sigma * sigma;
				for (let i = 0; i < g.count; i++) {
					if (onBeam[i]) {
						// Bounce, not a lamp. Dim and even, and it is what keeps the ceiling from
						// reading as switched off in a room whose walls clearly are not.
						addSample(out, i, palette, SLOT.base + hueShift, mean * 0.3);
						continue;
					}
					const u = ringU(g, i);
					for (let k = 0; k < LAMPS; k++) {
						let d = Math.abs(u - pos[k]);
						if (d > 0.5) d = 1 - d;
						if (d > sigma * 3) continue;
						addSample(out, i, palette, slot[k] + hueShift, level[k] * Math.exp(-(d * d) / twoSigmaSq));
					}
				}
			}
		};
	}
};
