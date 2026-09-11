import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { setSample } from '../color/palette.ts';
import { clamp, lerp } from '../dsl/math.ts';
import { Follower } from '../dsl/env.ts';
import { ringU } from '../dsl/space.ts';
import { bandAt, spectralTilt, spectrumFocus } from '../dsl/spectrum.ts';
import { INTENSITY, param } from './helpers.ts';

/**
 * Follow separate spectral taps so each instrument articulates between beats. Beat latching
 * would impose grid stepping and discard stabs and cymbals.
 */
/**
 * Unity-centred relief preserves fill. Depth 1.3 balances response against quiet-passage
 * brightness; deeper cuts reduce coverage.
 */
const RELIEF = 1.1;
/** Release in seconds, longer than attack, so chords ring out instead of snapping off. */
const FALL = 0.16;

export const spectrumBed: EffectDef = {
	id: 'spectrumBed',
	name: 'Spectrum Bed',
	role: 'bed',
	blurb: 'The room laid out low to high, each part lit by what plays there as it plays.',
	taste: {
		energy: 2,
		sections: ['intro', 'groove', 'breakdown', 'build', 'void', 'drop', 'outro'],
		minBars: 2,
		maxBars: 64,
		peakReserved: false,
		activity: 0.1,
		quiet: 5.74
	},
	params: [INTENSITY, param('spread', 'Octaves across the room', 0.7), param('depth', 'Colour travel', 0.6)],
	create(g) {
		// Interpolate a few taps instead of allocating 720 followers.
		const TAPS = 12;
		const taps = Array.from({ length: TAPS }, () => new Follower(0.02, FALL));
		const held = new Float32Array(TAPS);
		// Smooth whole-room colour more slowly than local articulation.
		const tilt = new Follower(0.12, 0.4);
		const focus = new Follower(0.12, 0.4);

		return {
			reset() {
				for (const t of taps) t.reset();
				tilt.reset();
				focus.reset();
				held.fill(0);
			},
			render(out, ctx) {
				const { f, p, palette, hueShift } = ctx;

				const reach = 0.35 + p.spread * 0.65;
				for (let k = 0; k < TAPS; k++) {
					const u = (k / (TAPS - 1)) * reach;
					held[k] = taps[k].update(bandAt(f, u), f.dt);
				}
				const lean = tilt.update(spectralTilt(f), f.dt);
				// Reserve the accent for sparse passages so drops keep their answering colour.
				const sparse = focus.update(spectrumFocus(f), f.dt);

				// Cue intensity owns level; leave headroom so relief crests do not pin white.
				const gain = 0.4 + p.intensity * 0.5;
				const depth = clamp(p.depth);

				for (let i = 0; i < g.count; i++) {
					// Mirror low-to-high taps from the front wall on both halves.
					const u = ringU(g, i);
					const fold = u < 0.5 ? u * 2 : (1 - u) * 2;
					const at = fold * (TAPS - 1);
					const k = Math.min(TAPS - 2, Math.floor(at));
					const v = held[k] + (held[k + 1] - held[k]) * (at - k);

					// Map spatial frequency slice to hue and level to relief. Reach past glow
					// toward third
					// for colour variety; deep..glow alone contains one hue.
					const spread = 0.35 + depth * 0.65;
					let slot = lerp(SLOT.base, SLOT.third, clamp(fold * spread + lean * 0.2));
					// Allow a dominant band to use the third only when the arrangement leaves
					// space.
					slot = lerp(slot, SLOT.accent, clamp(sparse * 1.3 - 0.25) * clamp(v * 1.4) * depth);

					setSample(out, i, palette, slot + hueShift, gain * (1 + RELIEF * (v - 0.5)));
				}
			}
		};
	}
};
