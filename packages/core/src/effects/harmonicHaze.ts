import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { setSample } from '../color/palette.ts';
import { clamp, lerp } from '../dsl/math.ts';
import { Follower } from '../dsl/env.ts';
import { noise3 } from '../dsl/wave.ts';
import { ringU } from '../dsl/space.ts';
import { bandBetween, spectralTilt, spectrumFocus } from '../dsl/spectrum.ts';
import { INTENSITY, param } from './helpers.ts';

/**
 * Spectral density sets grain and colour rather than level, keeping kit-free passages
 * articulate.
 */
export const harmonicHaze: EffectDef = {
	id: 'harmonicHaze',
	name: 'Harmonic Haze',
	role: 'bed',
	blurb: 'A noise field whose grain and colour follow how busy and how bright the mix is.',
	taste: {
		energy: 2,
		sections: ['intro', 'groove', 'breakdown', 'build', 'void', 'drop', 'outro'],
		minBars: 2,
		maxBars: 64,
		peakReserved: false,
		activity: 0,
		quiet: 2.35
	},
	params: [INTENSITY, param('grain', 'Cell size', 0.5), param('drift', 'Drift speed', 0.5)],
	create(g) {
		let phase = 0;
		// Smooth grain and colour slowly because palette-slot changes also change luminance.
		const focus = new Follower(0.12, 0.45);
		const low = new Follower(0.12, 0.45);
		const lean = new Follower(0.12, 0.45);

		return {
			reset() {
				phase = 0;
				focus.reset();
				low.reset();
				lean.reset();
			},
			render(out, ctx) {
				const { f, p, palette, hueShift, motion } = ctx;

				// A 32-beat drift stays musical and calm.
				phase += (f.dt / Math.max(0.15, f.beatPeriod * 32)) * motion * (0.5 + p.drift);

				const busy = focus.update(spectrumFocus(f), f.dt);
				const bottom = low.update(bandBetween(f, 0, 0.35), f.dt);
				const tilt = lean.update(spectralTilt(f), f.dt);

				// A busy mix is a fine grain; one sustained voice is a broad slow field.
				const scale = (1.4 + p.grain * 2.2) * (0.6 + (1 - busy) * 1.8);
				const gain = 0.48 + p.intensity * 0.8;
				// Spectral tilt sets the central hue; density spreads cell colours around it.
				const centre = clamp(tilt * 1.2 - bottom * 0.35);
				const spread = 0.25 + busy * 0.45;

				for (let i = 0; i < g.count; i++) {
					const u = ringU(g, i);
					const n = noise3(u * scale, phase, tilt * 1.5);
					const v = clamp(0.4 + n * 0.75);
					// Offset a second noise field for uncorrelated cell colours that drift with
					// the grain.
					const tint = noise3(u * scale * 0.6 + 11.3, phase * 0.7 + 4.1, 2.7);
					const slot = lerp(SLOT.base, SLOT.third, clamp(centre + tint * spread));
					setSample(out, i, palette, lerp(slot, SLOT.glow, v * 0.2) + hueShift, (0.4 + v * 0.6) * gain);
				}
			}
		};
	}
};
