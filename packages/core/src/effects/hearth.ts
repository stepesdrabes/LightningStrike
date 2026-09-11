import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { setSample } from '../color/palette.ts';
import { clamp, lerp } from '../dsl/math.ts';
import { noise3, sinewave } from '../dsl/wave.ts';
import { hash01 } from '../dsl/rng.ts';
import { ringU } from '../dsl/space.ts';
import { BeatHold } from '../dsl/env.ts';
import { INTENSITY, param } from './helpers.ts';

/** Give the beam even, slightly dimmer bounce. Keep enough level after gamma to carry the room. */
const BEAM_SPILL = 0.72;

/**
 * Multiply slow body, flame and shallow sputter noise to avoid a repeating flicker pattern.
 * Stay within deep..glow so the fire changes lightness within one hue.
 */
export const hearth: EffectDef = {
	id: 'hearth',
	name: 'Hearth',
	role: 'bed',
	blurb: 'Firelight pooling low around the room, brightest where the fire has settled.',
	taste: {
		energy: 1,
		sections: ['intro', 'breakdown', 'void', 'outro'],
		minBars: 2,
		maxBars: 64,
		peakReserved: false,
		activity: 0.05,
		quiet: 4.67
	},
	params: [INTENSITY, param('flicker', 'Flicker', 0.5), param('settle', 'How still it sits', 0.5)],
	create(g) {
		const grain = new Float32Array(g.count);
		const onBeam = new Uint8Array(g.count);
		for (let i = 0; i < g.count; i++) {
			grain[i] = hash01(i * 3 + 11);
			onBeam[i] = g.perim[i] < 0 ? 1 : 0;
		}
		// Latch passage level; fire responds to the room filling, not individual snares.
		const passage = new BeatHold(0.5);
		let phase = 0;
		let heard = 0;

		return {
			reset() {
				phase = 0;
				heard = 0;
				passage.reset();
			},
			render(out, ctx) {
				const { f, p, palette, hueShift, motion } = ctx;

				phase += f.dt * motion;
				heard = passage.update(f.energy, f.beat, f.dt, f.beatPeriod);

				const flicker = 0.2 + p.flicker * 0.55;
				// A settled fire wanders slowly and sits in fewer places; a young one roams.
				const roam = 1.35 - clamp(p.settle) * 0.75;
				const gain = (0.48 + p.intensity * 0.5) * (0.86 + heard * 0.3);

				for (let i = 0; i < g.count; i++) {
					const u = ringU(g, i);
					// Slow, broad crests retain a high trough so the far side stays lit.
					const body = onBeam[i]
						? BEAM_SPILL
						: 0.52 + 0.48 * sinewave(u * 2 + phase * 0.0055 * roam);
					// Expand Perlin about its centre so the flame has a visible range instead
					// of weak jitter.
					const raw = noise3(u * 5.5 * roam + phase * 0.42, phase * 0.11, 2.7);
					const flame = clamp((raw - 0.5) * 2.4 + 0.5);
					const sputter = noise3(u * 26 - phase * 1.05, 8.3, phase * 0.62);

					const v = clamp(
						body * (1 - flicker + flicker * (0.35 + 1.3 * flame)) * (0.86 + 0.14 * sputter)
					);
					// Grain per pixel, so the wall has embers in it rather than an even gradient.
					const level = v * gain * (0.88 + 0.12 * grain[i]);
					setSample(out, i, palette, lerp(SLOT.deep, SLOT.glow, v) + hueShift, level);
				}
			}
		};
	}
};
