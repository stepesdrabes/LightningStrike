import { describe, expect, it } from 'vitest';
import { createShowFrame, type SectionKind } from '../contracts/frame.ts';
import { buildGeometry, DEFAULT_ROOM } from '../geometry.ts';
import { makePalette } from '../color/palette.ts';
import { comet } from './comet.ts';

const geometry = buildGeometry(DEFAULT_ROOM);
const palette = makePalette({ base: 140, accent: 320 });
const params = Object.fromEntries(comet.params.map((param) => [param.key, param.default]));

function performance(section: SectionKind, notes: boolean) {
	const effect = comet.create(geometry);
	const f = createShowFrame();
	f.section = section;
	f.energy = 0.3;
	f.beatPeriod = 0.5;
	f.dt = 1 / 60;
	f.bands.fill(0.3);
	const out = new Float32Array(geometry.count * 3);
	const frames: Float32Array[] = [];
	const ctx = { g: geometry, f, p: params, palette, hueShift: 0, motion: 0.7 };
	const run = () => {
		for (let k = 0; k < 120; k++) {
			f.t = k / 60;
			f.spectrum.fill(0.2);
			// An offbeat note at 1.2 seconds, without any beat or drum trigger.
			if (notes && f.t >= 1.2 && f.t < 1.3) f.spectrum.fill(0.9, 3, 15);
			effect.render(out, ctx);
			frames[k] = Float32Array.from(out);
		}
	};
	run();
	const first = frames.map((frame) => Float32Array.from(frame));
	effect.reset();
	run();
	expect(frames).toEqual(first);
	return frames;
}

describe('comet note articulation', () => {
	it.each(['intro', 'breakdown'] as const)('answers an offbeat note in a %s without moving or recolouring the shape', (section) => {
		const played = performance(section, true);
		const steady = performance(section, false);
		const at = 77;
		const sum = (frame: Float32Array) => frame.reduce((total, value) => total + value, 0);
		const gain = sum(played[at]) / sum(steady[at]);
		expect(gain).toBeGreaterThan(1.5);
		expect(gain).toBeLessThan(1.9);
		for (let i = 0; i < steady[at].length; i++) {
			expect(played[at][i]).toBeCloseTo(steady[at][i] * gain, 5);
		}
		expect(sum(played[100]) / sum(steady[100])).toBeLessThan(gain);
	});

	it.each(['groove', 'drop', 'chorus'] as const)('preserves the existing %s rendering', (section) => {
		expect(performance(section, true)).toEqual(performance(section, false));
	});
});
