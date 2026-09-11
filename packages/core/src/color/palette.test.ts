import { describe, expect, it } from 'vitest';
import { PALETTE_ANCHORS, SLOT } from '../contracts/palette.ts';
import { hsv2rgb } from './hsv.ts';
import { makePalette, sample } from './palette.ts';

describe('palette slots', () => {
	const cases: [number, number, number][] = [
		[0, 180, 60],
		[45, 195, 105],
		[120, 300, 180],
		[204, 14, 157],
		[300, 90, 0]
	];

	it('delivers each named slot exactly, not a blend of its neighbours', () => {
		for (const [base, accent, third] of cases) {
			const sat = 0.94;
			const p = makePalette({ base, accent, third, sat, shade: 0.14, white: 0.06 });
			const want = (h: number, s: number, v: number) => hsv2rgb(h / 360, s, v, [0, 0, 0]);
			const check = (u: number, expected: [number, number, number], name: string) => {
				const got = sample(p, u, 1, [0, 0, 0]);
				const d = Math.hypot(got[0] - expected[0], got[1] - expected[1], got[2] - expected[2]);
				expect(d, `${name} at base ${base} accent ${accent}`).toBeLessThan(1e-6);
			};
			check(SLOT.base, want(base, sat, 1), 'base');
			check(SLOT.glow, want(base, sat * 0.72, 1), 'glow');
			check(SLOT.third, want(third, sat, 0.95), 'third');
			check(SLOT.accent, want(accent, sat, 1), 'accent');
		}
	});

	it('puts every slot on a whole anchor, which is what makes that possible', () => {
		for (const u of Object.values(SLOT)) {
			const pos = u * PALETTE_ANCHORS;
			expect(Math.abs(pos - Math.round(pos)), `slot at ${u}`).toBeLessThan(1e-9);
		}
	});

	it('wraps rather than clamping, so a slot plus an offset stays on the ring', () => {
		const p = makePalette({ base: 0, accent: 180 });
		const a = sample(p, 1.25, 1, [0, 0, 0]);
		const b = sample(p, 0.25, 1, [0, 0, 0]);
		expect([...a]).toEqual([...b]);
	});
});
