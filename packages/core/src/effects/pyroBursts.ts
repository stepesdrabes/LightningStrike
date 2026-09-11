import type { EffectDef } from '../contracts/effect.ts';
import { sectionBase } from '../contracts/frame.ts';
import { SLOT } from '../contracts/palette.ts';
import { addSample } from '../color/palette.ts';
import { clamp, lerp } from '../dsl/math.ts';
import { fadeToBlack } from '../dsl/buffer.ts';
import { noise3 } from '../dsl/wave.ts';
import { INTENSITY, param } from './helpers.ts';

const MAX_BURSTS = 8;

interface Pyro {
	alive: boolean;
	t0: number;
	corner: number;
}

/**
 * Read coherent noise along each column so neighbouring pixels flicker as flame, not
 * independent grain.
 */
export const pyroBursts: EffectDef = {
	id: 'pyroBursts',
	name: 'Pyro Bursts',
	role: 'transient',
	blurb: 'Flame columns erupting at the corners on chorus slams and drop phrases.',
	taste: {
		energy: 5,
		sections: ['groove', 'breakdown', 'build', 'drop'],
		minBars: 1,
		maxBars: 16,
		peakReserved: false,
		activity: 0.7,
		character: 'impact'
	},
	params: [INTENSITY, param('lifeBeats', 'Burst life beats', 4, 1, 8, 0.5)],
	create(g) {
		const walls = g.strips.filter((s) => s.inPerimeter);
		const bursts: Pyro[] = [];
		for (let i = 0; i < MAX_BURSTS; i++) bursts.push({ alive: false, t0: 0, corner: 0 });
		let next = 0;
		let armedFor = Number.NaN;

		return {
			reset() {
				for (const b of bursts) b.alive = false;
				next = 0;
				armedFor = Number.NaN;
			},
			render(out, ctx) {
				const { f, p, palette, hueShift, motion } = ctx;
				fadeToBlack(out, f.dt, 0.08);
				if (walls.length === 0) return;

				const bigMoment =
					sectionBase(f.section) === 'drop' && f.downbeat && (f.timeSinceDrop < 0.3 || f.phraseStart);
				const slam = f.kickEnv > 0.85 && f.snareEnv > 0.65;
				if ((bigMoment || slam) && armedFor !== f.barIndex) {
					armedFor = f.barIndex;
					for (let c = 0; c < 4; c++) {
						const b = bursts[next];
						next = (next + 1) % MAX_BURSTS;
						b.alive = true;
						b.t0 = f.t;
						b.corner = c;
					}
				}

				const life = Math.max(0.3, p.lifeBeats * f.beatPeriod) / Math.max(0.2, motion);
				const gain = 0.5 + p.intensity * 1.0;
				// Noise features/second; keep flame motion below rates that alias against the
				// frame clock.
				const flick = f.t * 3 * motion;

				for (const b of bursts) {
					if (!b.alive) continue;
					const u = (f.t - b.t0) / life;
					if (u >= 1) {
						b.alive = false;
						continue;
					}
					// The column shoots up fast then dies; brightness follows the height.
					const height = Math.min(1, u * 4) * (1 - u * u);
					const wall = walls[b.corner % walls.length];
					const fromEnd = b.corner % 2;
					const span = Math.min(wall.count, Math.floor(wall.count * 0.22 * height) + 2);
					for (let k = 0; k < span; k++) {
						const i = wall.offset + (fromEnd === 0 ? k : wall.count - 1 - k);
						// Cells about six pixels long, each corner's column on its own sheet.
						const fl = 0.7 + 0.3 * noise3(k * 0.18, flick, b.corner * 7.1);
						const heat = clamp((1 - k / Math.max(1, span)) * (1.1 - u)) * fl;
						const slot = heat > 0.85 ? SLOT.white : lerp(SLOT.deep, SLOT.glow, heat);
						addSample(out, i, palette, slot + hueShift, heat * height * gain);
					}
				}
			}
		};
	}
};
