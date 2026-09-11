import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { setSample } from '../color/palette.ts';
import { clamp, frac, lerp } from '../dsl/math.ts';
import { BeatHold } from '../dsl/env.ts';
import { spectralTilt, spectrumFocus } from '../dsl/spectrum.ts';
import { computeU } from '../dsl/space.ts';
import { INTENSITY, param } from './helpers.ts';

export const sweep: EffectDef = {
	id: 'sweep',
	name: 'Sweep',
	role: 'rhythm',
	blurb: 'A wavefront crossing the room in world space; the axis turns a quarter every 4 bars.',
	taste: {
		energy: 3,
		sections: ['groove', 'breakdown', 'build', 'drop'],
		minBars: 2,
		maxBars: 32,
		peakReserved: false,
		activity: 0.2
	},
	params: [
		INTENSITY,
		param('bars', 'Bars per pass', 2, 0.5, 8, 0.5),
		param('width', 'Front width', 0.16, 0.03, 0.5),
		param('turn', 'Turn axis', 1, 0, 1, 1)
	],
	create(g) {
		const u = new Float32Array(g.count);
		// Latch colour and thickness on beats; speed remains tied to the bar clock.
		const tilt = new BeatHold(0.25);
		const focus = new BeatHold(0.5);
		let quarter = -1;
		let phase = 0;

		return {
			reset() {
				tilt.reset();
				focus.reset();
				quarter = -1;
				phase = 0;
			},
			render(out, ctx) {
				const { f, p, palette } = ctx;
				const wanted = p.turn > 0.5 ? Math.floor(f.barIndex / 4) % 4 : 0;
				if (wanted !== quarter) {
					quarter = wanted;
					computeU(u, ctx.g, 'sweep', (quarter * Math.PI) / 2);
				}

				phase = frac(phase + (f.dt / (p.bars * f.beatPeriod * 4)) * ctx.motion);

				const warm = tilt.update(spectralTilt(f), f.beat, f.dt, f.beatPeriod);
				const focused = focus.update(spectrumFocus(f), f.beat, f.dt, f.beatPeriod);
				// One sustained note is a narrow front; a full arrangement is a broad one.
				const w = p.width * (0.65 + (1 - focused) * 0.7);
				const body = lerp(SLOT.base, SLOT.third, clamp(warm * 0.8));

				for (let i = 0; i < g.count; i++) {
					let d = u[i] - phase;
					d -= Math.floor(d + 0.5);
					const front = Math.exp(-(d * d) / (2 * w * w));
					const slot = lerp(body, SLOT.white, front * front);
					setSample(out, i, palette, slot + ctx.hueShift, front * (0.18 + p.intensity * 0.5));
				}
			}
		};
	}
};
