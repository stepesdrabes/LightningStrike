import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { addSample } from '../color/palette.ts';
import { clamp, lerp } from '../dsl/math.ts';
import { Follower } from '../dsl/env.ts';
import { pxPerSecond, ringsFor, scatter } from '../dsl/space.ts';
import { bandBetween } from '../dsl/spectrum.ts';
import { INTENSITY, param } from './helpers.ts';

export const comet: EffectDef = {
	id: 'comet',
	name: 'Comet',
	role: 'rhythm',
	blurb: 'A hot head and soft tail orbit the room; notes brighten it and kicks open the tail.',
	taste: {
		energy: 3,
		sections: ['intro', 'groove', 'breakdown', 'build', 'drop'],
		minBars: 4,
		maxBars: 32,
		peakReserved: false,
		activity: 0.3,
		noteReactive: true
	},
	params: [
		INTENSITY,
		param('bars', 'Bars per lap', 4, 1, 16, 0.5),
		param('tail', 'Tail length', 0.3, 0.05, 0.6),
		param('kickSwell', 'Kick swell', 0.5)
	],
	create(g) {
		const rings = ringsFor(g);
		const ring = rings.perimeter;
		const scratch = new Float32Array(ring.length * 3);
		const body = new Follower(0.12, 0.75);
		const voice = new Follower(0.08, 0.5);
		const passage = new Follower(1.5, 3);
		let pos = 0;
		return {
			reset() {
				pos = 0;
				scratch.fill(0);
				body.reset();
				voice.reset();
				passage.reset();
			},
			render(out, ctx) {
				const { f, p, palette } = ctx;
				const speed = pxPerSecond(ring, ring.metres / (p.bars * f.beatPeriod * 4));
				pos = (pos + speed * f.dt * ctx.motion) % ring.length;
				const beats = f.dt / Math.max(0.15, f.beatPeriod);
				const low = body.update(bandBetween(f, 0.15, 0.5), beats);
				const mid = voice.update(bandBetween(f, 0.35, 0.75), beats);
				const heard = low * 0.4 + mid * 0.6;
				const held = passage.update(heard, beats);
				// Articulate notes through brightness so the orbit and colour remain steady.
				const listen = f.section === 'intro' || f.section === 'breakdown' || f.section === 'build';
				const noteGain = listen ? clamp(0.86 + heard * 0.2 + (heard - held) * 2.8, 0.65, 1.55) : 1;

				const tailPx = ring.length * p.tail * (1 + f.kickEnv * p.kickSwell);
				scratch.fill(0);

				const head = Math.round(pos);
				for (let k = 0; k < Math.ceil(tailPx * 3); k++) {
					const i = (((head - k) % ring.length) + ring.length) % ring.length;
					const w = Math.exp(-k / tailPx);
					if (w < 0.004) break;
					const slot = lerp(SLOT.accent, SLOT.white, w * w);
					addSample(scratch, i, palette, slot + ctx.hueShift, w * (0.37 + p.intensity * 0.66) * noteGain);
				}

				out.fill(0);
				scatter(ring, scratch, out);
			}
		};
	}
};
