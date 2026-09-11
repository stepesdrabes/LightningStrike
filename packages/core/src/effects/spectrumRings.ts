import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { setSample } from '../color/palette.ts';
import { alphaFor, clamp, lerp, smoothstep } from '../dsl/math.ts';
import { BeatHold } from '../dsl/env.ts';
import { nblend } from '../dsl/buffer.ts';
import { ringU } from '../dsl/space.ts';
import { bandAt, spectrumPeak } from '../dsl/spectrum.ts';
import { INTENSITY, param } from './helpers.ts';

/** Rotate spectral slices on a slow grid-derived clock, retaining motion without drum hits. */
export const spectrumRings: EffectDef = {
	id: 'spectrumRings',
	name: 'Spectrum Rings',
	role: 'rhythm',
	blurb: 'The spectrum wrapped around the room, each band walking at its own rate.',
	taste: {
		energy: 2,
		sections: ['intro', 'groove', 'breakdown', 'build', 'drop', 'outro'],
		minBars: 2,
		maxBars: 48,
		peakReserved: false,
		activity: 0.2
	},
	params: [INTENSITY, param('turn', 'Rotation', 0.5), param('bands', 'Slices', 0.6)],
	create(g) {
		const buf = new Float32Array(g.count * 3);
		const level = new Float32Array(8);
		const loudness = new BeatHold(0.3);
		let turn = 0;

		return {
			reset() {
				buf.fill(0);
				level.fill(0);
				loudness.reset();
				turn = 0;
			},
			render(out, ctx) {
				const { f, p, palette, hueShift, motion } = ctx;

				// One turn per four phrases at motion 1 keeps rotation calm.
				turn += (f.dt / Math.max(0.2, f.beatPeriod * 128)) * motion * (0.4 + p.turn * 2.2);

				const slices = 3 + Math.round(clamp(p.bands) * 5);
				const a = 1 - Math.exp(-f.dt / Math.max(0.05, f.beatPeriod * 0.4));
				for (let k = 0; k < slices; k++) {
					const u = slices > 1 ? k / (slices - 1) : 0.5;
					level[k] += (bandAt(f, u) - level[k]) * a;
				}

				// Latch overall level to avoid frame shimmer; silence may still darken the
				// room.
				const loud = loudness.update(spectrumPeak(f), f.beat, f.dt, f.beatPeriod);
				const gain =
					(0.09 + p.intensity * 0.21) * clamp(0.5 + loud * 0.5) * smoothstep(0.01, 0.08, loud);

				for (let i = 0; i < g.count; i++) {
					const u = ringU(g, i) + turn;
					const pos = (u - Math.floor(u)) * slices;
					const k = Math.min(slices - 1, Math.floor(pos));
					const w = pos - k;
					// Blend neighbouring slices to avoid seams.
					const nk = (k + 1) % slices;
					const v = level[k] + (level[nk] - level[k]) * w;
					// Spend most band variation on colour and little on level.
					const slot = lerp(SLOT.base, SLOT.accent, clamp(((k + w) / slices) * 0.78 + v * 0.22));
					setSample(buf, i, palette, slot + hueShift, (0.55 + v * 0.5) * gain);
				}

				// Rewrite then low-pass the field; additive decay would leave rippling trails.
				nblend(out, buf, alphaFor(f.dt, 0.07));
			}
		};
	}
};
