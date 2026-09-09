import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { addSample } from '../color/palette.ts';
import { hash01 } from '../dsl/rng.ts';
import { clamp } from '../dsl/math.ts';
import { BeatHold } from '../dsl/env.ts';
import { bandAt } from '../dsl/spectrum.ts';
import { ringsFor } from '../dsl/space.ts';
import { INTENSITY, param } from './helpers.ts';

const MAX_SEGMENTS = 32;

/**
 * Random in space, never in time: which segments light is a hash of the grid slot index,
 * but the timing is always on the grid. Every fourth bar inverts figure and ground, so the
 * picked segments punch holes in a dim field instead of flashing over darkness.
 *
 * Eighths by default: sixteenths at 128 bpm are 8.5 Hz of random segments, which is the
 * band where a flashing room reads busiest, and the planner raises the rate to sixteenths
 * only where the hats actually play them.
 */
export const glitchScan: EffectDef = {
	id: 'glitchScan',
	name: 'Glitch Scan',
	role: 'rhythm',
	blurb: 'Hash-picked ring segments flashing on the eighth grid, inverting every 4 bars.',
	taste: {
		energy: 4,
		sections: ['groove', 'breakdown', 'build', 'drop'],
		minBars: 2,
		maxBars: 16,
		peakReserved: false,
		activity: 0.7
	},
	params: [
		INTENSITY,
		param('segments', 'Segments', 16, 8, 32, 4),
		param('perBeat', 'Steps per beat', 2, 1, 4, 1)
	],
	create(g) {
		const ring = ringsFor(g).perimeter;
		const segEnv = new Float32Array(MAX_SEGMENTS);
		const lit = new Float32Array(MAX_SEGMENTS);
		// Sampled once, when a segment fires. A colour read every frame would follow the
		// spectrum's own noise; read on the 16th grid it can only change when the segment does.
		const segSlot = new Float32Array(MAX_SEGMENTS).fill(SLOT.base);
		const level = new BeatHold(0.5);
		let lastSlot = -1;

		return {
			reset() {
				segEnv.fill(0);
				lit.fill(0);
				segSlot.fill(SLOT.base);
				level.reset();
				lastSlot = -1;
			},
			render(out, ctx) {
				const { f, p, palette, hueShift } = ctx;
				out.fill(0);

				const segs = Math.min(MAX_SEGMENTS, Math.max(8, Math.round(p.segments)));
				const slot = Math.floor((f.beatIndex + f.beatPhase) * Math.max(1, Math.round(p.perBeat)));
				if (slot !== lastSlot) {
					lastSlot = slot;
					const count = 2 + (hash01(slot * 31 + 7) < 0.5 ? 1 : 0);
					for (let c = 0; c < count; c++) {
						const idx = Math.floor(hash01(slot * 13 + c * 101) * segs);
						segEnv[idx] = 1;
						// How loud the spectrum is where that segment sits decides whether it
						// reads as the room's colour or as the answer to it. Three stops, not a
						// ramp: everything between two designed hues is a hue nobody chose.
						const band = bandAt(f, (idx + 0.5) / segs);
						segSlot[idx] = band > 0.6 ? SLOT.accent : band > 0.3 ? SLOT.third : SLOT.base;
					}
				}

				const inverted = Math.floor(f.barIndex / 4) % 2 === 1;
				const tail = Math.exp(-f.dt / Math.max(0.04, f.beatPeriod * 0.4));
				const held = level.update(f.energy, f.beat, f.dt, f.beatPeriod);
				const gain = (0.5 + p.intensity * 1.0) * clamp(0.6 + held * 0.4);
				const segPx = ring.length / segs;
				// Three pixels of crossfade at every seam: the segments still snap in TIME, but
				// a hard edge in space read as a row of switched fixtures from under the frame.
				const feather = 3 / segPx;

				for (let s = 0; s < segs; s++) {
					segEnv[s] *= tail;
					lit[s] = inverted ? 0.45 * (1 - segEnv[s]) + 0.02 : segEnv[s];
				}
				for (let k = 0; k < ring.length; k++) {
					const pos = k / segPx;
					const s = Math.min(segs - 1, Math.floor(pos));
					const t = pos - s;
					let w = 1;
					let other = -1;
					if (t < feather) {
						w = 0.5 + (0.5 * t) / feather;
						other = (s - 1 + segs) % segs;
					} else if (t > 1 - feather) {
						w = 0.5 + (0.5 * (1 - t)) / feather;
						other = (s + 1) % segs;
					}
					const a = lit[s] * w;
					if (a >= 0.015) {
						addSample(out, ring.map[k], palette, (inverted ? SLOT.deep + 0.06 : segSlot[s]) + hueShift, a * gain);
					}
					if (other < 0) continue;
					const b = lit[other] * (1 - w);
					if (b >= 0.015) {
						addSample(out, ring.map[k], palette, (inverted ? SLOT.deep + 0.06 : segSlot[other]) + hueShift, b * gain);
					}
				}
			}
		};
	}
};
