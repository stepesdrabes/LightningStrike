import { expect, it } from 'vitest';
import { makePalette } from '../color/palette.ts';
import { createShowFrame } from '../contracts/frame.ts';
import type { RenderCtx } from '../contracts/effect.ts';
import { DEFAULT_ROOM, buildGeometry } from '../geometry.ts';
import { snareBlade } from './snareBlade.ts';

const g = buildGeometry(DEFAULT_ROOM);
const palette = makePalette({ base: 30, accent: 210, third: 60 });

it('retains soft snare strength in an intro and clears the stroke when reset', () => {
	const effect = snareBlade.create(g);
	const f = createShowFrame();
	f.section = 'intro';
	f.beatPeriod = 0.5;
	f.dt = 1 / 60;
	f.snare = true;
	f.snareEnv = 0.2;
	const ctx: RenderCtx = { g, f, palette, hueShift: 0, motion: 0.7,
		p: Object.fromEntries(snareBlade.params.map((param) => [param.key, param.default])) };
	const out = new Float32Array(g.count * 3);
	effect.render(out, ctx);
	const soft = Math.max(...out);
	effect.reset();
	f.snareEnv = 1;
	effect.render(out, ctx);
	expect(Math.max(...out)).toBeGreaterThan(soft * 3);
	effect.reset();
	f.snare = false;
	f.snareEnv = 0;
	effect.render(out, ctx);
	expect(Math.max(...out)).toBe(0);
});
