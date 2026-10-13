import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { sample } from '../color/palette.ts';
import { clamp, smoothstep } from '../dsl/math.ts';
import { stampGaussian } from '../dsl/buffer.ts';
import { Follower } from '../dsl/env.ts';
import { hash01 } from '../dsl/rng.ts';
import { noise3 } from '../dsl/wave.ts';
import { stripAxis } from '../dsl/space.ts';
import { INTENSITY, param } from './helpers.ts';

const MAX_FLAMES = 56;
/** Pixels of sway either side at full motion: about a hand's width on the frame. */
const SWAY = 8;

/**
 * A crowd swaying lighters to the bar. The sway is one world-space motion: flames on the walls
 * that run left to right travel with it, and the end walls lean brighter toward the side the
 * room swings to. More lighters come up as the passage swells.
 */
export const lighters: EffectDef = {
	id: 'lighters',
	name: 'Lighters',
	role: 'accent',
	blurb: 'A room of small flames swaying left and right with the bar, more of them raised as the song swells.',
	taste: {
		energy: 2,
		// A sung chorus, not a club drop: the sway is a crowd's, under a voice.
		sections: ['breakdown', 'chorus', 'outro'],
		minBars: 4,
		maxBars: 64,
		peakReserved: false,
		activity: 0.15,
		carries: false
	},
	params: [
		INTENSITY,
		param('flames', 'Lighters', 44, 16, MAX_FLAMES, 1),
		// The planner sets it from the tempo: whole bars per sway, a couple of seconds each.
		param('lapBars', 'Bars per sway', 1, 1, 4, 1)
	],
	create(g) {
		const walls = g.strips.filter((s) => s.inPerimeter);
		const total = walls.reduce((n, s) => n + s.count, 0);
		const strip = new Uint8Array(MAX_FLAMES);
		const home = new Float32Array(MAX_FLAMES);
		const along = new Int8Array(MAX_FLAMES);
		const lean = new Float32Array(MAX_FLAMES);
		const rank = new Float32Array(MAX_FLAMES);
		const lag = new Float32Array(MAX_FLAMES);
		const place = (flames: number) => {
			for (let k = 0; k < flames; k++) {
				// Spread over the ring by length, jittered so the crowd is never a row of posts.
				let at = ((k + 0.5 + (hash01(k * 53 + 1) - 0.5) * 0.6) / flames) * total;
				let w = 0;
				while (w < walls.length - 1 && at >= walls[w].count) at -= walls[w++].count;
				const s = walls[w];
				strip[k] = g.strips.indexOf(s);
				home[k] = Math.max(1, Math.min(s.count - 2, at));
				const x = s.end[0] - s.start[0];
				// Along-x walls carry the sway as motion, in the wall's own direction.
				along[k] = stripAxis(s) === 'x' ? (x > 0 ? 1 : -1) : 0;
				// End walls lean: +1 on the east wall, -1 on the west.
				lean[k] = stripAxis(s) === 'x' ? 0 : Math.sign(s.start[0] + s.end[0]);
				rank[k] = hash01(k * 197 + 31);
				lag[k] = (hash01(k * 89 + 7) - 0.5) * 0.08;
			}
		};
		const raised = new Follower(1.2, 3);
		let placed = 0;
		let clock = 0;
		const rgb: [number, number, number] = [0, 0, 0];

		return {
			reset() {
				raised.reset();
				placed = 0;
				clock = 0;
			},
			render(out, ctx) {
				const { f, p, palette, hueShift, motion } = ctx;
				const flames = Math.max(8, Math.min(MAX_FLAMES, Math.round(p.flames)));
				if (placed !== flames) {
					place(flames);
					placed = flames;
				}
				clock += f.dt * Math.max(0, motion);
				const up = clamp(0.3 + 0.75 * raised.update(f.energy, f.dt));
				const laps = Math.max(1, Math.round(p.lapBars));
				const phase = (f.barIndex + f.barPhase) / laps;
				const reach = SWAY * clamp(motion);
				const gain = 0.4 + p.intensity * 0.7;

				out.fill(0);
				for (let k = 0; k < flames; k++) {
					const shown = smoothstep(rank[k] - 0.1, rank[k] + 0.02, up);
					if (shown < 0.01) continue;
					const swing = Math.sin(2 * Math.PI * (phase + lag[k]));
					// A candle's breath, slow enough never to read as flicker.
					const breath = 0.8 + 0.2 * noise3(k * 3.7, clock * 1.3, 0.5);
					const tilt = 1 + 0.35 * lean[k] * swing * clamp(motion);
					const v = shown * breath * tilt * gain;
					const s = g.strips[strip[k]];
					const lo = s.offset;
					const hi = s.offset + s.count;
					const at = lo + home[k] + along[k] * swing * reach;
					sample(palette, SLOT.base + hueShift, v * 0.35, rgb);
					stampGaussian(out, g.count, at, 3.5, rgb[0], rgb[1], rgb[2], false, lo, hi);
					sample(palette, SLOT.white + hueShift, v * 0.55, rgb);
					stampGaussian(out, g.count, at, 1.3, rgb[0], rgb[1], rgb[2], false, lo, hi);
				}
			}
		};
	}
};
