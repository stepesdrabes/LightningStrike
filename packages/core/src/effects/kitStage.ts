import type { EffectDef } from '../contracts/effect.ts';
import type { Palette } from '../contracts/palette.ts';
import { SLOT } from '../contracts/palette.ts';
import { addSample } from '../color/palette.ts';
import { clamp } from '../dsl/math.ts';
import { Presence } from '../dsl/env.ts';
import { INTENSITY, param } from './helpers.ts';

/**
 * Every drum voice owns a fixed home, like a band on a stage: the kick lives in the four
 * corners, the snare at the centre of the ceiling beam, the hats along its ends. After
 * four bars the mapping is learned and the room reads as musicians in their places -
 * which is what the per-voice `Presence` protects: a voice that leaves the arrangement
 * has its spot go dark instead of flashing on ghosts.
 */
export const kitStage: EffectDef = {
	id: 'kitStage',
	name: 'Kit Stage',
	role: 'transient',
	blurb: 'Kick in the corners, snare mid-beam, hats at its ends - each voice keeps its seat.',
	taste: {
		energy: 3,
		sections: ['groove', 'verse', 'breakdown', 'drop', 'chorus'],
		minBars: 2,
		maxBars: 32,
		peakReserved: false,
		activity: 0.4,
		kit: 'any'
	},
	params: [INTENSITY, param('spotSize', 'Spot size', 0.4)],
	create(g) {
		// Corner LEDs: the perimeter positions where the strip id changes. Beam positions
		// from the strips outside the perimeter.
		const corners: number[] = [];
		const perim: number[] = [];
		for (let i = 0; i < g.count; i++) if (g.perim[i] >= 0) perim.push(i);
		perim.sort((a, b) => g.perim[a] - g.perim[b]);
		for (let k = 0; k < perim.length; k++) {
			const here = perim[k];
			const before = perim[(k - 1 + perim.length) % perim.length];
			if (g.strip[here] !== g.strip[before]) corners.push(here);
		}
		const beam: number[] = [];
		for (let i = 0; i < g.count; i++) if (g.perim[i] < 0) beam.push(i);
		const beamMid = beam.length > 0 ? beam[beam.length >> 1] : -1;
		const beamEnds = beam.length > 1 ? [beam[0], beam[beam.length - 1]] : [];

		const kickHome = new Presence();
		const snareHome = new Presence();
		const hatHome = new Presence(2, 2);

		/** A gaussian spot in INDEX space along whichever strip the seat sits on. */
		const spot = (
			out: Float32Array,
			at: number,
			radius: number,
			slot: number,
			amp: number,
			palette: Palette,
			hueShift: number
		) => {
			if (at < 0 || amp <= 0.01) return;
			const strip = g.strips[g.strip[at]];
			const lo = strip.offset;
			const hi = strip.offset + strip.count;
			const r = Math.max(1, Math.round(radius));
			for (let d = -r; d <= r; d++) {
				const i = at + d;
				if (i < lo || i >= hi) continue;
				const w = 1 - Math.abs(d) / (r + 1);
				addSample(out, i, palette, slot + hueShift, w * w * amp);
			}
		};

		return {
			reset() {
				kickHome.reset();
				snareHome.reset();
				hatHome.reset();
			},
			render(out, ctx) {
				const { f, p, palette, hueShift } = ctx;
				out.fill(0);

				const kick = kickHome.update(f.kickEnv, f.dt, f.beatPeriod);
				const snare = snareHome.update(f.snareEnv, f.dt, f.beatPeriod);
				const hat = hatHome.update(f.hatEnv, f.dt, f.beatPeriod);

				const size = 12 + p.spotSize * 24;
				const gain = 0.55 + p.intensity * 0.85;

				// The kick is the band's weight: all four corners breathe with it in the base
				// hue, brightest on the hit itself.
				const kickAmp = clamp(f.kickEnv * 0.9 + kick * 0.2) * gain;
				for (const c of corners) {
					spot(out, c, size, SLOT.base, kickAmp, palette, hueShift);
				}
				// The snare answers from the middle of the ceiling, a step brighter in the
				// same family - the backbeat sits above the room. Its presence scales the
				// seat like the hats' does, so a passage the snare left goes dark there.
				spot(
					out,
					beamMid,
					size * 1.3,
					SLOT.glow,
					clamp(f.snareEnv * (0.4 + 0.6 * snare)) * gain,
					palette,
					hueShift
				);
				// Hats tick at the beam's ends in near-white, small and fast: cymbals are
				// texture, not weight, so their presence window is deliberately short.
				for (const e of beamEnds) {
					spot(out, e, size * 0.5, SLOT.white, clamp(f.hatEnv * 0.55) * gain * hat, palette, hueShift);
				}
			}
		};
	}
};
