import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { addSample } from '../color/palette.ts';
import { clamp, smoothstep } from '../dsl/math.ts';
import { spectralTilt } from '../dsl/spectrum.ts';
import { INTENSITY } from './helpers.ts';

/**
 * Five bars filling toward the drop, one per strip.
 *
 * `meterBuild` fills the perimeter as a single continuous line, which reads as one long meter
 * lapping the room. This is the other reading of the same idea and the one the room is actually
 * built for: each strip is its own bar, so a build looks like five columns charging rather than a
 * dot travelling. The strips are staggered so they arrive in sequence and the last one lands on
 * the drop, which is what stops five identical bars reading as one wide one.
 *
 * The ceiling beam fills last on purpose. It is the only strip an occupant sees without turning
 * their head, so giving it the final quarter puts the arrival where it cannot be missed.
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
		// Per-strip index runs, built once. `render` may not allocate.
		const strips = g.strips.length;
		const offset = new Int32Array(strips);
		const length = new Int32Array(strips);
		const order = new Float32Array(strips);
		for (let s = 0; s < strips; s++) {
			offset[s] = g.strips[s].offset;
			length[s] = g.strips[s].count;
			// The beam last, the walls in their own order. Spread across the first three quarters
			// so every bar still has a quarter of the build to travel once it starts.
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

				// Slew, so it can only climb smoothly but collapses the moment the build ends. The
				// climb rate is in build-progress per second and the collapse is four times faster,
				// which is what stops a bar hanging over the downbeat it was pointing at.
				const delta = clamp(f.buildProgress - fill, -f.dt * 4, f.dt * 0.6 * (0.5 + motion));
				fill = clamp(fill + delta);
				if (fill < 0.01) return;

				// Colour, not brightness. A bright spectrum band must never reach a pixel's level:
				// per-band normalisation puts a quiet passage's bass near full and jitters by
				// several bytes a frame, which is what the room reads as blinking.
				const tilt = spectralTilt(f);
				const gain = 0.7 + p.intensity * 1.5;

				for (let s = 0; s < strips; s++) {
					// Each bar opens at its own point in the build and is full by the end of it.
					const span = 1 - order[s];
					const local = span > 1e-6 ? clamp((fill - order[s]) / span) : 0;
					if (local <= 0) continue;

					const n = length[s];
					const base = offset[s];
					const edge = local * n;
					const whiteness = local * local;

					for (let k = 0; k < n; k++) {
						if (k > edge) break;
						// The head is the bar's own leading edge, not a fixed pixel count, so a
						// short strip does not end up mostly head.
						const head = k > edge - Math.max(2, n * 0.02);
						// Body brightens toward the front rather than sitting flat, which is what
						// makes a bar read as charging instead of as a lit segment.
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
