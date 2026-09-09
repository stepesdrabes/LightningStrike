import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { addSample } from '../color/palette.ts';
import { clamp, lerp } from '../dsl/math.ts';
import { Follower } from '../dsl/env.ts';
import { ringU } from '../dsl/space.ts';
import { bandBetween } from '../dsl/spectrum.ts';
import { INTENSITY, param } from './helpers.ts';

/** Bottom, middle and top of the spectrum. At module scope because a literal here allocates. */
const SPAN_LO = [0, 0.3, 0.65];
const SPAN_HI = [0.3, 0.65, 1];

/**
 * Three bands of the mix, three overlapping fields, the whole room.
 *
 * Written as a second layer that is genuinely a layer. Most accents in the catalog are stamps
 * and sparks with almost nothing behind them, which is fine over a full drop stack and leaves a
 * two-layer intro cue lit by one and a half. This covers the room and still says something the
 * bed does not: where the weight of the mix is sitting, as it moves.
 *
 * Each lobe is its own meter, so the three answer different instruments. The low lobe swells on
 * the riff, the top lobe answers the hats, and because they overlap everywhere the room stays
 * covered while its colour balance moves. That balance is the reaction: a passage that is all
 * bottom end sits in the base colour, and one that opens up at the top pulls toward the third.
 */
export const bandBloom: EffectDef = {
	id: 'bandBloom',
	name: 'Band Bloom',
	role: 'accent',
	blurb: 'Low, middle and top of the mix as three overlapping fields across the room.',
	taste: {
		energy: 2,
		// The quiet passages only: this is a sustained field written to carry a two-layer
		// cue, and over a drop stack it was a fifth of the room's light with nothing to say.
		sections: ['intro', 'groove', 'breakdown', 'outro'],
		minBars: 2,
		maxBars: 48,
		peakReserved: false,
		activity: 0.1,
		quiet: 2.36
	},
	params: [INTENSITY, param('spread', 'Lobe width', 0.5), param('turn', 'How fast it turns', 0.4)],
	create(g) {
		// Per lobe, from the spectrum rather than from `f.energy`: the energy envelope is beat
		// resolution that the player interpolates, so a level taken from it can only ever slide
		// between beats however it is smoothed. These reach the same place by a route that has
		// the detail in it.
		const bands = Array.from({ length: 3 }, () => new Follower(0.022, 0.15));
		const held = new Float32Array(3);
		// The passage's weight, and deliberately from `f.energy` rather than from the spectrum.
		// Energy is normalised across the track, so it answers "how loud is this passage for this
		// song"; the spectrum is a fixed window against the track's loud passages, so a quiet
		// intro sits near the bottom of it and scaling the room by that dimmed this to nothing.
		// One is a level and the other is a reaction, and this layer needs both from their own
		// source. Followed rather than latched, so it swells instead of stepping.
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
				// Written every frame rather than added onto a decaying buffer. `fadeToBlack` plus
				// `addSample` is the idiom for trails and sparks: the buffer keeps a fraction of
				// the last frame while the full pattern is added on top, so a pattern that MOVES
				// leaves a lagging edge behind it and every pixel it crosses ripples at the frame
				// rate. Measured on a real intro that was 4.2 bytes of ripple, four times the
				// whole room's before this pass.
				out.fill(0);

				turn += (f.dt / Math.max(0.15, f.beatPeriod * 48)) * motion * p.turn;

				let loudest = 0;
				for (let k = 0; k < 3; k++) {
					held[k] = bands[k].update(bandBetween(f, SPAN_LO[k], SPAN_HI[k]), f.dt);
					if (held[k] > loudest) loudest = held[k];
				}
				// Scaled by the passage. An accent that fills the room is only useful if it is also
				// proportionate to it: at a flat gain this lit an intro brighter than the drop,
				// which is the contrast collapse a filling layer always risks.
				const weight = body.update(f.energy, f.dt);
				const gain = (0.28 + p.intensity * 0.6) * clamp(0.16 + weight * 0.84);
				// How far the music is allowed to move anything, from the cue's own motion.
				const lively = clamp(0.25 + motion * 0.75);
				// Wide enough that the three overlap everywhere: the room should read as one lit
				// field whose colour moves, not as three spots with gaps between them.
				const width = 0.28 + p.spread * 0.22;

				for (let i = 0; i < g.count; i++) {
					const u = ringU(g, i);
					for (let k = 0; k < 3; k++) {
						// Each lobe leans around the room with its own band and brightens with it,
						// so the three trade the room between them as the mix moves. Bounded well
						// under unity: all three stay lit, so what moves is the balance rather than
						// whether the room is on.
						const centre = turn + k / 3 + held[k] * 0.06 * lively;
						const d = Math.abs(u - centre - Math.round(u - centre));
						const v = clamp(1 - d / width);
						if (v <= 0) continue;
						// Toward white on this band's own peaks, and toward the accent on the one
						// that is currently loudest. The room answers in the show's colour when a
						// single part of the mix takes over, which is the gesture worth having.
						const lead = clamp((held[k] - loudest) * 4 + 1) * clamp(held[k] * 1.5);
						const slot = lerp(
							lerp(slots[k], SLOT.white, held[k] * 0.35 * lively),
							SLOT.accent,
							lead * 0.45 * lively
						);
						// Centred on unity, not reaching down to it. A lobe that multiplies its own
						// band straight into brightness is a dimmer in every quiet passage, where
						// the spectrum sits low by construction and this layer still has a room to
						// fill. The mixer's highlight compressor takes the tops.
						//
						// The centre trades fill against movement and this effect exists to fill:
						// 0.3 holds 0.41 of the room where 0.35 holds 0.38 and 0.4 holds 0.34, for
						// quiet movement of 3.30, 3.60 and 3.96. All three beat the beat-latched
						// version it replaces, which moved 2.30 across 0.43.
						const swell = 1 + (held[k] - 0.3) * 1.1 * lively;
						addSample(out, i, palette, slot + hueShift, v * v * gain * swell);
					}
				}
			}
		};
	}
};
