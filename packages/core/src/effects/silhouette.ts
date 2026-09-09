import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { setSample } from '../color/palette.ts';
import { clamp, lerp } from '../dsl/math.ts';
import { bandBetween } from '../dsl/spectrum.ts';
import { Follower, Presence, PulseEnv } from '../dsl/env.ts';
import { INTENSITY, param } from './helpers.ts';

/**
 * Figure/ground reversal, held: the ring blazes while the centre beam goes dark, so the
 * room's middle reads as a silhouette against its own edge. The documented rap-climax
 * look (Saint Pablo's figure against red fog, Stormzy's sculptural key light), and the
 * catalog's second "maximum by subtraction" after stopTime - that one withholds motion,
 * this one withholds the middle of the room.
 *
 * Deliberately static: the practice literature has the peak arriving as a discontinuity
 * in COVERAGE and COLOUR, never as acceleration. The only things that move are the
 * edge's level breathing with the record and a filament push toward white on each kick.
 */
export const silhouette: EffectDef = {
	id: 'silhouette',
	name: 'Silhouette',
	role: 'master',
	blurb: 'The edge at full blaze, the centre dark: the room becomes a figure held against light.',
	taste: {
		energy: 5,
		sections: ['drop'],
		minBars: 0,
		// Held, not burst: this is the whole point against chromaBurst's two bars. The
		// peak's opening cue takes this length, so the inversion owns the phrase.
		maxBars: 8,
		peakReserved: true,
		activity: 0.5,
		// The rap-climax look serves the impact treatment; an anthem chorus that arrives
		// as light wants its centre lit, not withheld.
		peakStyle: 'slam'
	},
	params: [INTENSITY, param('depth', 'Contrast depth', 0.85)],
	create(g) {
		// The edge breathes with the record: spectrum, not the beat envelope, because a
		// held look whose level can only move per beat reads as a poster, not a room.
		const breath = new Follower(0.5, 0.12);
		const push = new PulseEnv();
		// The push answers the kick and rests with it; the HOLD does not need the kit at
		// all, which is why this declares no taste.kit - a beatless peak still holds.
		const kit = new Presence();

		return {
			reset() {
				breath.reset();
				push.reset();
				kit.reset();
			},
			render(out, ctx) {
				const { f, p, palette, hueShift } = ctx;

				const level = breath.update(clamp(bandBetween(f, 0.15, 0.85) * 1.4), f.dt);
				const playing = kit.update(f.kickEnv, f.dt, f.beatPeriod);
				if (f.beat && playing > 0.08) push.fire(playing);
				const v = push.decay(f.dt, f.beatPeriod, 1.6);

				// Edge: a saturated hold that each kick pushes toward white, cooling back the
				// way a filament does. Centre: near-black, and the kick deepens it - the
				// inversion pulse. Contrast moves, the field never does.
				//
				// The hold sits well under full on purpose. At the peak's intensity the master
				// budget is the whole range, and a hold that already reaches white leaves the
				// push nowhere to go: measured, the ring sat at a mean of 141 bytes for eight
				// bars and the kicks were invisible on it.
				// A touch of white on the push, not a walk to it: the hold is one colour and the
				// kick moves its level, or every beat reads as the room changing colour.
				const edgeSlot = lerp(SLOT.accent, SLOT.white, v * 0.3);
				const edgeLevel = clamp(0.3 + 0.16 * level + 0.5 * v) * (0.5 + p.intensity * 0.4);
				const coreLevel = 0.05 * (1 - p.depth * 0.85) + 0.03 * (1 - v);

				for (let i = 0; i < g.count; i++) {
					if (g.perim[i] >= 0) {
						setSample(out, i, palette, edgeSlot + hueShift, edgeLevel);
					} else {
						setSample(out, i, palette, SLOT.deep + hueShift, clamp(coreLevel));
					}
				}
			}
		};
	}
};
