import type { EffectDef } from '../contracts/effect.ts';
import type { StripSpec } from '../contracts/room.ts';
import { SLOT } from '../contracts/palette.ts';
import { addSample } from '../color/palette.ts';
import { clamp, lerp } from '../dsl/math.ts';
import { Presence } from '../dsl/env.ts';
import { stripAxis } from '../dsl/space.ts';
import { INTENSITY, param } from './helpers.ts';

/**
 * The backbeat, as a bloom rather than a stamp: every snare opens both short walls from
 * their middles outward, white at the core cooling to glow as it widens, and the long walls
 * catch a dim echo at their ends a moment later. Written for the two and the four, which in
 * rap and pop is the thing the room should be answering and mostly was not.
 *
 * No `character`, because a bloom is light arriving rather than light interrupting: the
 * no-flash families may reach for it.
 */
export const backbeatBloom: EffectDef = {
	id: 'backbeatBloom',
	name: 'Backbeat Bloom',
	role: 'accent',
	blurb: 'Every snare blooms both short walls from the middle out, the long walls echoing at their ends.',
	taste: {
		energy: 4,
		sections: ['groove', 'verse', 'build', 'drop', 'chorus'],
		minBars: 2,
		maxBars: 32,
		peakReserved: false,
		activity: 0.6,
		carries: false,
		kit: 'snare'
	},
	params: [INTENSITY, param('reach', 'How far it opens', 0.6)],
	create(g) {
		const shorts: StripSpec[] = g.strips.filter((s) => s.inPerimeter && stripAxis(s) === 'y');
		const longs: StripSpec[] = g.strips.filter((s) => s.inPerimeter && stripAxis(s) === 'x');
		const kit = new Presence();
		let since = Infinity;
		let power = 0;

		return {
			reset() {
				kit.reset();
				since = Infinity;
				power = 0;
			},
			render(out, ctx) {
				const { f, p, palette, hueShift, motion } = ctx;
				out.fill(0);
				const playing = kit.update(f.snareEnv, f.dt, f.beatPeriod);
				if (f.snare && playing > 0.1) {
					since = 0;
					power = clamp(0.55 + 0.45 * f.snareEnv) * playing;
				} else {
					since += f.dt * Math.max(0.05, motion);
				}
				if (!Number.isFinite(since)) return;

				// Open inside a sixth of a beat, hold, and fade out over the rest of it: the
				// bloom has to be open before it starts leaving, or it is a flicker at the centre.
				const beat = Math.max(0.1, f.beatPeriod);
				const u = since / beat;
				if (u > 1.3) return;
				const open = Math.min(1, u * 6);
				const fade = u < 0.45 ? 1 : Math.pow(clamp(1 - (u - 0.45) / 0.85), 1.4);
				const gain = (0.9 + p.intensity * 1.3) * power * fade;
				const width = Math.max(0.06, (0.3 + p.reach * 0.55) * open);

				for (const wall of shorts) {
					for (let k = 0; k < wall.count; k++) {
						const x = Math.abs((k + 0.5) / wall.count - 0.5) * 2;
						// A flat-topped bloom: bright across most of its width, falling only at
						// the rim, or it is a spot with a halo rather than a wall opening.
						const v = Math.sqrt(clamp(1 - x / width));
						addSample(out, wall.offset + k, palette, lerp(SLOT.glow, SLOT.white, v * v) + hueShift, (0.18 + 0.82 * v) * gain);
					}
				}
				// The echo: the long walls' ends, a quarter-beat behind and much dimmer.
				const echo = clamp((u - 0.2) * 4) * fade * 0.4;
				if (echo <= 0.01) return;
				for (const wall of longs) {
					for (let k = 0; k < wall.count; k++) {
						const x = Math.abs((k + 0.5) / wall.count - 0.5) * 2;
						const v = clamp((x - 0.55) / 0.45);
						if (v <= 0) continue;
						addSample(out, wall.offset + k, palette, SLOT.glow + hueShift, v * v * echo * gain);
					}
				}
			}
		};
	}
};
