import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { setSample } from '../color/palette.ts';
import { clamp, lerp } from '../dsl/math.ts';
import { BeatHold, PulseEnv } from '../dsl/env.ts';
import { spectralTilt } from '../dsl/spectrum.ts';
import { INTENSITY, param } from './helpers.ts';

/** Hard timed steps distinguish chase from sweep; alternate the direction each phrase. */
export const chase: EffectDef = {
	id: 'chase',
	name: 'Chase',
	role: 'rhythm',
	blurb: 'Ring segments snapping on in turn, the opposite one answering; direction flips every phrase.',
	taste: {
		energy: 3,
		sections: ['groove', 'breakdown', 'build', 'drop'],
		minBars: 2,
		maxBars: 32,
		peakReserved: false,
		activity: 0.5
	},
	params: [
		INTENSITY,
		param('segments', 'Segments', 8, 4, 24, 1),
		param('perBeat', 'Steps per beat', 1, 0.25, 4, 0.25),
		param('tail', 'Tail', 0.7, 0.1, 1.5)
	],
	create(g) {
		let lastStep = -1;
		const level = new Float32Array(32);
		// Hold the beam's downbeat answer past the eye's integration window.
		const beam = new PulseEnv();
		const passage = new BeatHold(0.45);
		// The spectrum picks the head's colour, never its level, so an opening arrangement whitens
		// the chase rather than brightening it.
		const tilt = new BeatHold(0.2);
		return {
			reset() {
				lastStep = -1;
				level.fill(0);
				beam.reset();
				passage.reset();
				tilt.reset();
			},
			render(out, ctx) {
				const { f, p, palette, hueShift, motion } = ctx;
				// A show is free to ask for more segments than the register holds, and reading past
				// the end of it would put NaN in every pixel of the ring.
				const segments = Math.min(level.length, Math.max(2, Math.round(p.segments)));
				const step = Math.floor((f.beatIndex + f.beatPhase) * p.perBeat);
				const phrase = Math.floor(f.barIndex / 8);
				const dir = phrase % 2 === 0 ? 1 : -1;

				if (step !== lastStep) {
					lastStep = step;
					const seg = (((step * dir) % segments) + segments) % segments;
					level[seg] = 1;
					const opposite = (seg + (segments >> 1)) % segments;
					if (level[opposite] < 0.55) level[opposite] = 0.55;
				}
				if (f.downbeat) beam.fire(1);

				// Half the tail as the time constant, so a segment is dark again before its turn
				// comes back round.
				const decay = 1 - Math.exp(-f.dt / ((p.tail * f.beatPeriod * 0.5) / Math.max(0.05, motion)));
				for (let s = 0; s < segments; s++) level[s] -= level[s] * decay;

				const beamV = beam.decay(f.dt, f.beatPeriod, 0.8 / Math.max(0.05, motion));
				const passageLevel = passage.update(f.energy, f.beat, f.dt, f.beatPeriod);
				const gain = (0.55 + p.intensity * 0.8) * clamp(0.7 + passageLevel * 0.3);
				const lean = tilt.update(spectralTilt(f), f.beat, f.dt, f.beatPeriod);
				const head = lerp(SLOT.glow, SLOT.white, lean);
				const rest = 0.12 * gain;
				// Soften spatial seams while keeping timed steps hard.
				const feather = 4 / (g.perimeterLength / g.pitch / segments);

				for (let i = 0; i < g.count; i++) {
					const along = g.perim[i];
					if (along < 0) {
						setSample(out, i, palette, SLOT.accent + hueShift, beamV * gain * 0.7);
						continue;
					}
					const pos = along * segments;
					const seg = Math.min(Math.floor(pos), segments - 1);
					const t = pos - seg;
					let v = level[seg];
					if (t < feather) {
						const w = 0.5 + (0.5 * t) / feather;
						v = v * w + level[(seg - 1 + segments) % segments] * (1 - w);
					} else if (t > 1 - feather) {
						const w = 0.5 + (0.5 * (1 - t)) / feather;
						v = v * w + level[(seg + 1) % segments] * (1 - w);
					}
					const slot = lerp(SLOT.base, head, v * v);
					setSample(out, i, palette, slot + hueShift, rest + v * gain);
				}
			}
		};
	}
};
