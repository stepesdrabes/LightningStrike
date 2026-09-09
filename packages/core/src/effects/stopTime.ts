import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { setSample } from '../color/palette.ts';
import { clamp, frac, lerp } from '../dsl/math.ts';
import { Presence, PulseEnv, Schmitt } from '../dsl/env.ts';
import { ringU } from '../dsl/space.ts';
import { INTENSITY, param } from './helpers.ts';

/**
 * The stop-time cut, half of hip-hop stagecraft: while the kit plays, a heavy pattern
 * crawls the ring; when the producer cuts the beat the picture FREEZES mid-stride and
 * dims, and the re-entry snaps it bright and moving in the same frame. The freeze is the
 * gesture - a room that keeps drifting through a stop-time was not listening, and one
 * that blacks out heard silence instead of suspense.
 */
export const stopTime: EffectDef = {
	id: 'stopTime',
	name: 'Stop Time',
	role: 'rhythm',
	blurb: 'The pattern freezes mid-stride when the beat cuts, and snaps back with the re-entry.',
	taste: {
		energy: 3,
		sections: ['groove', 'verse', 'drop', 'chorus'],
		minBars: 2,
		maxBars: 32,
		peakReserved: false,
		activity: 0.2,
		kit: 'any'
	},
	params: [INTENSITY, param('stride', 'Stride', 0.4)],
	create(g) {
		const presence = new Presence(2, 1);
		// Hysteresis so a sparse pattern's own gaps do not flicker the freeze on and off.
		const playing = new Schmitt(0.12, 0.35, true);
		const snap = new PulseEnv();
		let phase = 0;
		let wasPlaying = true;

		return {
			reset() {
				presence.reset();
				playing.reset(true);
				snap.reset();
				phase = 0;
				wasPlaying = true;
			},
			render(out, ctx) {
				const { f, p, palette, hueShift, motion } = ctx;

				const level = presence.update(Math.max(f.kickEnv, f.snareEnv), f.dt, f.beatPeriod);
				const live = playing.update(level);
				if (live && !wasPlaying) snap.fire(1);
				wasPlaying = live;

				// The crawl advances only while the beat is there: the freeze IS the phase
				// holding still. Speed in ring laps per beat, scaled by the cue's motion.
				if (live) {
					const laps = (0.06 + p.stride * 0.1) / Math.max(0.05, f.beatPeriod);
					phase = frac(phase + laps * f.dt * Math.max(0.05, motion));
				}
				const flash = snap.decay(f.dt, f.beatPeriod, 1.2);

				// Frozen: the same picture at half light. Playing: full weight, plus the
				// re-entry flash riding on top for a beat.
				const dim = live ? 1 : 0.45;
				const gain = (0.31 + p.intensity * 0.54) * dim;

				for (let i = 0; i < g.count; i++) {
					const u = frac(ringU(g, i) - phase);
					// Three heavy lobes with hard leading edges - a pattern with a stride,
					// not a wash - kept in one hue family so the freeze reads as light
					// stopping rather than colour changing.
					const tri = Math.abs(frac(u * 3) - 0.5) * 2;
					const lobe = Math.pow(1 - tri, 3);
					const slot = lerp(SLOT.deep, SLOT.glow, clamp(lobe + flash * 0.5));
					setSample(
						out,
						i,
						palette,
						slot + hueShift,
						clamp(lobe * gain + flash * 0.6 * (0.3 + lobe))
					);
				}
			}
		};
	}
};
