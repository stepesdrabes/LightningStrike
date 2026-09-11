import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { addSample } from '../color/palette.ts';
import { clamp, smoothstep } from '../dsl/math.ts';
import { spectralTilt } from '../dsl/spectrum.ts';
import { INTENSITY } from './helpers.ts';

/**
 * Stagger strip fills and finish on the beam, the arrival visible without turning toward a
 * wall.
 */
export const barFill: EffectDef = {
	id: 'barFill',
	name: 'Bar Fill',
	role: 'rhythm',
	blurb: 'Five bars, one per strip, charging in sequence to land full on the drop.',
	taste: {
		energy: 3,
		sections: ['build'],
		minBars: 2,
		maxBars: 16,
		peakReserved: false,
		activity: 0.3
	},
	params: [INTENSITY],
	create(g) {
		const strips = g.strips.length;
		const offset = new Int32Array(strips);
		const length = new Int32Array(strips);
		const order = new Float32Array(strips);
		for (let s = 0; s < strips; s++) {
			offset[s] = g.strips[s].offset;
			length[s] = g.strips[s].count;
			// Stagger starts within the first three quarters; every strip gets time to fill.
			order[s] = strips > 1 ? (s / (strips - 1)) * 0.75 : 0;
		}

		let fill = 0;

		return {
			reset() {
				fill = 0;
			},
			render(out, ctx) {
				const { f, p, palette, hueShift, motion } = ctx;
				out.fill(0);

				// Smooth the rise and collapse four times faster so the bar does not hang past
				// the drop.
				const delta = clamp(f.buildProgress - fill, -f.dt * 4, f.dt * 0.6 * (0.5 + motion));
				fill = clamp(fill + delta);
				if (fill < 0.01) return;

				// The spectrum changes colour, leaving brightness to build progress.
				const tilt = spectralTilt(f);
				const gain = 0.7 + p.intensity * 1.5;

				for (let s = 0; s < strips; s++) {
					const span = 1 - order[s];
					const local = span > 1e-6 ? clamp((fill - order[s]) / span) : 0;
					if (local <= 0) continue;

					const n = length[s];
					const base = offset[s];
					const edge = local * n;
					const whiteness = local * local;

					for (let k = 0; k < n; k++) {
						if (k > edge) break;
						// Scale the head with the strip so short strips do not become mostly
						// tip.
						const head = k > edge - Math.max(2, n * 0.02);
						// Brighten toward the front so the bar reads as charging.
						const body = 0.35 + 0.65 * smoothstep(0, 1, k / Math.max(1, edge));
						// A brighter mix walks the fill toward glow; the level never sees it.
						const slot = head
							? SLOT.white
							: SLOT.base + (SLOT.glow - SLOT.base) * clamp(whiteness + tilt * 0.35);
						addSample(out, base + k, palette, slot + hueShift, gain * (head ? 1.5 : 0.7 * body));
					}
				}
			}
		};
	}
};
