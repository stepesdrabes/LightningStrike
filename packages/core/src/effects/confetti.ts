import type { EffectDef } from '../contracts/effect.ts';
import { sectionBase } from '../contracts/frame.ts';
import { SLOT } from '../contracts/palette.ts';
import { sample } from '../color/palette.ts';
import { hash01 } from '../dsl/rng.ts';
import { frac } from '../dsl/math.ts';
import { fadeToBlack } from '../dsl/buffer.ts';
import { stampOnStrip } from '../dsl/space.ts';
import { beatRelease, INTENSITY, param } from './helpers.ts';

const SLOTS = [SLOT.base, SLOT.third, SLOT.accent, SLOT.white];

/**
 * Golden-angle placement separates neighbours deterministically; chorus density differs from
 * verse.
 */
export const confetti: EffectDef = {
	id: 'confetti',
	name: 'Confetti',
	role: 'accent',
	blurb: 'Beat-popped multicolour dots raining through the chorus.',
	taste: {
		energy: 3,
		sections: ['groove', 'breakdown', 'build', 'drop'],
		minBars: 2,
		maxBars: 32,
		peakReserved: false,
		activity: 0.4,
		quiet: 2.33,
		// Bursts of particles, and nothing at all between them.
		carries: false
	},
	params: [INTENSITY, param('perPop', 'Dots per pop', 14, 2, 24, 1)],
	create(g) {
		let popCount = 0;
		let lastBeat = Number.NaN;

		return {
			reset() {
				popCount = 0;
				lastBeat = Number.NaN;
			},
			render(out, ctx) {
				const { f, p, palette, hueShift } = ctx;
				fadeToBlack(out, f.dt, beatRelease(f.beatPeriod, 0.7));

				const popNow = sectionBase(f.section) === 'drop' ? f.beat : f.downbeat;
				if (!popNow || f.beatIndex === lastBeat) return;
				lastBeat = f.beatIndex;
				popCount++;

				const n = Math.round(p.perPop);
				const gain = 0.7 + p.intensity * 1.2;
				for (let k = 0; k < n; k++) {
					const seq = popCount * 32 + k;
					const pos = frac(seq * 0.381966) * g.count;
					const strip = g.strips[g.strip[Math.min(g.count - 1, Math.floor(pos))]];
					const slot = SLOTS[seq % SLOTS.length];
					const c = sample(palette, slot + hueShift, gain * (0.6 + hash01(seq) * 0.4));
					// A 2.5-pixel sigma stays visible from the floor without a hot point.
					stampOnStrip(out, g.count, strip, pos - strip.offset, 2.4, c);
				}
			}
		};
	}
};
