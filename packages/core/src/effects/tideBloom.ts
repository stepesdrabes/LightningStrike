import type { EffectDef } from '../contracts/effect.ts';
import { sectionBase } from '../contracts/frame.ts';
import { SLOT } from '../contracts/palette.ts';
import { setSample } from '../color/palette.ts';
import { frac, lerp, smoothstep } from '../dsl/math.ts';
import { Edge, INTENSITY, param } from './helpers.ts';

/** Middle of the front wall in the counter-clockwise frame. */
const FRONT_THETA = 0.75;
/** Ring-units of white crest riding the wavefront. */
const CREST = 0.03;

/**
 * The euphoric arrival: one wave from front-centre around both sides of the ring at once,
 * meeting at the back, glow to white at the crest and a glow-filled room behind it. Grand
 * and continuous by construction - nothing in here flickers, the only movement is the
 * front itself and the slow relax after it.
 */
export const tideBloom: EffectDef = {
	id: 'tideBloom',
	name: 'Tide Bloom',
	role: 'master',
	blurb: 'A glow-to-white flood from front-centre around both sides of the ring; the beam lights last.',
	taste: {
		energy: 5,
		sections: ['drop', 'chorus'],
		minBars: 0,
		maxBars: 2,
		peakReserved: false,
		activity: 0.2,
		// A tide is a lift by definition; on a slam peak it reads as the punch going
		// missing - the A/B round's one regression was exactly this draw.
		peakStyle: 'bloom'
	},
	params: [
		INTENSITY,
		param('trigger', 'Trigger', 0, 0, 1, 1),
		param('sustain', 'Relax bars', 2, 0.5, 4, 0.5)
	],
	create(g) {
		// Front-centre found in perim space from the geometry, so the two wavefronts cover
		// equal metres and meet at the back of the room at the same moment.
		let frontPerim = 0;
		let best = Infinity;
		for (let i = 0; i < g.count; i++) {
			if (g.perim[i] < 0) continue;
			const d = Math.abs(frac(g.theta[i] - FRONT_THETA + 0.5) - 0.5);
			if (d < best) {
				best = d;
				frontPerim = g.perim[i];
			}
		}
		// Flood distance per LED: ring distance from the front for the walls, then on past
		// the meeting point along the beam from its back end, so the tide rolls off the
		// back wall onto the beam instead of the beam popping on as a separate fixture.
		const reach = new Float32Array(g.count);
		let maxReach = 0;
		for (let i = 0; i < g.count; i++) {
			const d =
				g.perim[i] >= 0
					? Math.abs(frac(g.perim[i] - frontPerim + 0.5) - 0.5)
					: 0.52 + 0.1 * (1 - g.local[i]);
			reach[i] = d;
			if (d > maxReach) maxReach = d;
		}

		const edge = new Edge();
		let armedFor = Number.NaN;
		let t0 = -1;
		let period = 0.5;

		return {
			reset() {
				edge.reset();
				armedFor = Number.NaN;
				t0 = -1;
				period = 0.5;
			},
			render(out, ctx) {
				const { f, p, palette, hueShift, motion } = ctx;

				// A chorus is the song vocabulary's drop; arming on the literal kind alone would
				// leave a pop peak carrying this and never firing it.
				if (sectionBase(f.section) === 'drop' && f.downbeat) {
					const impact = f.timeSinceDrop < 0.3;
					if ((impact || f.phraseStart) && armedFor !== f.barIndex) {
						armedFor = f.barIndex;
						t0 = f.t;
						period = f.beatPeriod;
					}
				}
				if (edge.update(p.trigger > 0.5)) {
					t0 = f.t;
					period = f.beatPeriod;
				}

				out.fill(0);
				if (t0 < 0) return;

				const age = f.t - t0;
				// Half the ring in two beats; the beam's extra reach follows at the same speed.
				const floodT = (period * 2) / Math.max(0.05, motion);
				const w = (0.5 * age) / floodT;
				const floodDone = (floodT * maxReach) / 0.5;
				const relaxT = (p.sustain * period * 4) / Math.max(0.05, motion);
				const relax = smoothstep(0, 1, (age - floodDone) / relaxT);

				// The crest is the event and the body is a room lit behind it: held under full so
				// the crest reads as white against it rather than as white on white.
				const gain = 0.35 + p.intensity * 0.7;
				const bodySlot = lerp(SLOT.glow, SLOT.base, relax);
				const body = lerp(0.6, 0.34, relax) * gain;

				for (let i = 0; i < g.count; i++) {
					const lead = w - reach[i];
					if (lead <= 0) continue;
					// 36 cm of soft leading edge, so the arrival is continuous rather than stepped.
					const lit = smoothstep(0, 0.02, lead);
					const crest = Math.exp((-lead * lead) / (2 * CREST * CREST));
					const slot = lerp(bodySlot, SLOT.white, crest);
					setSample(out, i, palette, slot + hueShift, lit * (body + crest * gain * 0.7));
				}
			}
		};
	}
};
