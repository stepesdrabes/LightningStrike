import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { addSample } from '../color/palette.ts';
import { clamp, lerp } from '../dsl/math.ts';
import { Follower } from '../dsl/env.ts';
import { ringU } from '../dsl/space.ts';
import { bandBetween } from '../dsl/spectrum.ts';
import { INTENSITY, param } from './helpers.ts';

/** Module-scope band positions avoid render allocations. */
const SPAN_LO = [0, 0.3, 0.65];
const SPAN_HI = [0.3, 0.65, 1];

/**
 * Overlapping spectral lobes carry quiet two-layer cues while their colour balance follows the
 * mix.
 */
export const bandBloom: EffectDef = {
	id: 'bandBloom',
	name: 'Band Bloom',
	role: 'accent',
	blurb: 'Low, middle and top of the mix as three overlapping fields across the room.',
	taste: {
		energy: 2,
		// Limit to quiet sections; a sustained field adds excess steady light to a drop stack.
		sections: ['intro', 'groove', 'breakdown', 'outro'],
		minBars: 2,
		maxBars: 48,
		peakReserved: false,
		activity: 0.1,
		quiet: 2.36
	},
	params: [INTENSITY, param('spread', 'Lobe width', 0.5), param('turn', 'How fast it turns', 0.4)],
	create(g) {
		// Follow each lobe's spectrum slice for between-beat detail.
		const bands = Array.from({ length: 3 }, () => new Follower(0.022, 0.15));
		const held = new Float32Array(3);
		// Use track-normalized energy for passage level and spectrum for articulation; a quiet
		// spectrum reading must not dim the whole field away.
		const body = new Follower(0.05, 0.6);
		const slots = [SLOT.base, SLOT.glow, SLOT.third];
		let turn = 0;

		return {
			reset() {
				held.fill(0);
				body.reset();
				turn = 0;
				for (const b of bands) b.reset();
			},
			render(out, ctx) {
				const { f, p, palette, hueShift, motion } = ctx;
				// Rewrite the field each frame; adding over decay would accumulate light and
				// trailing ripples.
				out.fill(0);

				turn += (f.dt / Math.max(0.15, f.beatPeriod * 48)) * motion * p.turn;

				let loudest = 0;
				for (let k = 0; k < 3; k++) {
					held[k] = bands[k].update(bandBetween(f, SPAN_LO[k], SPAN_HI[k]), f.dt);
					if (held[k] > loudest) loudest = held[k];
				}
				// Scale with passage energy so a filling accent cannot outshine the drop.
				const weight = body.update(f.energy, f.dt);
				const gain = (0.28 + p.intensity * 0.6) * clamp(0.16 + weight * 0.84);
				// How far the music is allowed to move anything, from the cue's own motion.
				const lively = clamp(0.25 + motion * 0.75);
				// Overlap lobes everywhere to keep a continuous field.
				const width = 0.28 + p.spread * 0.22;

				for (let i = 0; i < g.count; i++) {
					const u = ringU(g, i);
					for (let k = 0; k < 3; k++) {
						// Bound relative lobe gains so all remain lit while the balance moves.
						const centre = turn + k / 3 + held[k] * 0.06 * lively;
						const d = Math.abs(u - centre - Math.round(u - centre));
						const v = clamp(1 - d / width);
						if (v <= 0) continue;
						// Peak bands approach white; the dominant band earns the accent.
						const lead = clamp((held[k] - loudest) * 4 + 1) * clamp(held[k] * 1.5);
						const slot = lerp(
							lerp(slots[k], SLOT.white, held[k] * 0.35 * lively),
							SLOT.accent,
							lead * 0.45 * lively
						);
						// Unity-centred response keeps quiet spectra lit. The 0.3 depth
						// prioritizes spatial fill
						// over the extra movement of deeper modulation.
						const swell = 1 + (held[k] - 0.3) * 1.1 * lively;
						addSample(out, i, palette, slot + hueShift, v * v * gain * swell);
					}
				}
			}
		};
	}
};
