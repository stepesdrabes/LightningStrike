import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { sample } from '../color/palette.ts';
import { clamp } from '../dsl/math.ts';
import { Follower } from '../dsl/env.ts';
import { stampOnStrip } from '../dsl/space.ts';
import { INTENSITY, param } from './helpers.ts';

const MAX_MARKS = 16;

interface Mark {
	alive: boolean;
	t0: number;
	/** 0 hat, 1 snare, 2 kick. */
	voice: number;
	/** Bar position 0..1 the hit fell on; the beam reads as the bar. */
	at: number;
	strength: number;
}

/**
 * Sparse-passage kit voice: every stick and kick leaves a short mark on the beam at its
 * place in the bar, sized by the hit and the room's momentary level, so a count-in ticks
 * and a band entry lands without the strikes a loud section would use.
 */
export const kitTicks: EffectDef = {
	id: 'kitTicks',
	name: 'Kit Ticks',
	role: 'transient',
	blurb: 'Short marks on the beam where each hat, snare and kick falls in the bar; the count-in, visible.',
	taste: {
		energy: 2,
		sections: ['intro', 'breakdown', 'outro'],
		minBars: 1,
		maxBars: 32,
		peakReserved: false,
		carries: false,
		activity: 0.25,
		kit: 'percussion'
	},
	params: [INTENSITY, param('reach', 'Wall reply', 0.5, 0, 1, 0.05)],
	create(g) {
		const beam = g.strips.find((s) => !s.inPerimeter) ?? g.strips[g.strips.length - 1];
		const walls = g.strips.filter((s) => s.inPerimeter);
		const marks: Mark[] = [];
		for (let i = 0; i < MAX_MARKS; i++) marks.push({ alive: false, t0: 0, voice: 0, at: 0, strength: 0 });
		let next = 0;
		const level = new Follower(0.02, 0.25);

		const spawn = (t: number, voice: number, at: number, strength: number) => {
			const m = marks[next];
			next = (next + 1) % MAX_MARKS;
			m.alive = true;
			m.t0 = t;
			m.voice = voice;
			m.at = at;
			m.strength = strength;
		};

		return {
			reset() {
				for (const m of marks) m.alive = false;
				next = 0;
				level.reset();
			},
			render(out, ctx) {
				const { f, p, palette, hueShift } = ctx;
				out.fill(0);

				// Softer where the record is quiet, without ever losing a played hit.
				const heard = 0.35 + 0.65 * clamp(level.update(f.level, f.dt) * 1.4);
				if (f.hat) spawn(f.t, 0, f.barPhase, (0.3 + 0.7 * f.hatEnv) * heard);
				if (f.snare) spawn(f.t, 1, f.barPhase, (0.4 + 0.6 * f.snareEnv) * heard);
				if (f.kick) spawn(f.t, 2, f.barPhase, (0.4 + 0.6 * f.kickEnv) * heard);

				const gain = 0.35 + p.intensity * 0.65;
				// Ticks last about a sixteenth: long enough to be seen, short enough to stay ticks.
				const tau = clamp(f.beatPeriod * 0.12, 0.05, 0.12);
				const hold = 0.03;
				const span = beam.count - 1;

				for (const m of marks) {
					if (!m.alive) continue;
					const age = f.t - m.t0;
					const env = age <= hold ? 1 : Math.exp(-(age - hold) / tau);
					if (env < 0.02 || age < 0) {
						m.alive = false;
						continue;
					}
					const a = m.strength * env * gain;
					const pos = m.at * span;
					if (m.voice === 0) {
						stampOnStrip(out, g.count, beam, pos, 1.4, sample(palette, SLOT.white + hueShift, a * 0.8));
					} else if (m.voice === 1) {
						stampOnStrip(out, g.count, beam, pos, 4.5, sample(palette, SLOT.accent + hueShift, a));
						stampOnStrip(out, g.count, beam, pos, 1.8, sample(palette, SLOT.white + hueShift, a * 0.5));
						for (const wall of walls) {
							const c = sample(palette, SLOT.accent + hueShift, a * 0.35 * p.reach);
							stampOnStrip(out, g.count, wall, wall.count / 2, wall.count * 0.16, c);
						}
					} else {
						stampOnStrip(out, g.count, beam, pos, 7, sample(palette, SLOT.glow + hueShift, a * 0.9));
						for (const wall of walls) {
							const c = sample(palette, SLOT.base + hueShift, a * 0.3 * p.reach);
							stampOnStrip(out, g.count, wall, wall.count / 2, wall.count * 0.3, c);
						}
					}
				}
			}
		};
	}
};
