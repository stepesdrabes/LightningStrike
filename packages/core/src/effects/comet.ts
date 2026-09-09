import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { addSample } from '../color/palette.ts';
import { lerp } from '../dsl/math.ts';
import { pxPerSecond, ringsFor, scatter } from '../dsl/space.ts';
import { INTENSITY, param } from './helpers.ts';

export const comet: EffectDef = {
	id: 'comet',
	name: 'Comet',
	role: 'rhythm',
	blurb: 'One hot head with an exponential tail lapping the ring; the tail swells on every kick.',
	taste: {
		energy: 3,
		sections: ['intro', 'groove', 'breakdown', 'build', 'drop'],
		minBars: 4,
		maxBars: 32,
		peakReserved: false,
		activity: 0.3
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
		let pos = 0;
		return {
			reset() {
				pos = 0;
				scratch.fill(0);
			},
			render(out, ctx) {
				const { f, p, palette } = ctx;
				const speed = pxPerSecond(ring, ring.metres / (p.bars * f.beatPeriod * 4));
				pos = (pos + speed * f.dt * ctx.motion) % ring.length;

				const tailPx = ring.length * p.tail * (1 + f.kickEnv * p.kickSwell);
				scratch.fill(0);

				const head = Math.round(pos);
				for (let k = 0; k < Math.ceil(tailPx * 3); k++) {
					const i = (((head - k) % ring.length) + ring.length) % ring.length;
					const w = Math.exp(-k / tailPx);
					if (w < 0.004) break;
					const slot = lerp(SLOT.accent, SLOT.white, w * w);
					addSample(scratch, i, palette, slot + ctx.hueShift, w * (0.37 + p.intensity * 0.66));
				}

				out.fill(0);
				scatter(ring, scratch, out);
			}
		};
	}
};
