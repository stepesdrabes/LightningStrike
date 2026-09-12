import { describe, expect, it } from 'vitest';
import { createShowFrame } from '../contracts/frame.ts';
import { makePalette } from '../color/palette.ts';
import { DEFAULT_ROOM, buildGeometry } from '../geometry.ts';
import { ripple } from './ripple.ts';

describe('ripple', () => {
	it('swells each ring in over its first moments rather than switching it on', () => {
		const g = buildGeometry(DEFAULT_ROOM);
		const effect = ripple.create(g);
		const f = createShowFrame();
		f.dt = 1 / 60;
		const ctx = {
			g,
			f,
			p: Object.fromEntries(ripple.params.map((p) => [p.key, p.default])),
			palette: makePalette({ base: 200, accent: 30 }),
			hueShift: 0,
			motion: 1
		};
		const out = new Float32Array(g.count * 3);
		const peak = () => out.reduce((m, v) => Math.max(m, v), 0);

		effect.render(out, ctx);
		const born = peak();
		for (let i = 0; i < 30; i++) effect.render(out, ctx);
		const grown = peak();
		expect(grown).toBeGreaterThan(0.2);
		expect(born).toBeLessThan(grown * 0.1);
	});
});
