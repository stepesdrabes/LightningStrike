import { describe, expect, it } from 'vitest';
import { DEFAULT_ROOM, roomModel } from '../geometry.ts';
import { LightTest } from './test.ts';

const model = roomModel(DEFAULT_ROOM);
const frame = model.pixels.find((p) => p.light.id === 'frame')!;
const beam = model.pixels.find((p) => p.light.id === 'beam')!;

function run(kind: 'identify' | 'walk' | 'colours', ids: string[], seconds: number) {
	const test = new LightTest(model);
	const bytes = new Uint8Array(model.geometry.count * 3).fill(200);
	const lamps = new Uint8Array(model.lamps.length * 3).fill(200);
	test.start(kind, ids);
	for (let t = 0; t < seconds; t += 1 / 60) test.apply(bytes, lamps, 1 / 60);
	return { test, bytes, lamps };
}

const pixel = (bytes: Uint8Array, i: number) => [bytes[i * 3], bytes[i * 3 + 1], bytes[i * 3 + 2]];

describe('testing a light', () => {
	it('lights only the lights under test', () => {
		const { bytes, lamps } = run('identify', ['beam'], 0.5);
		expect(Math.max(...[...frame.index].map((i) => pixel(bytes, i)[0]))).toBe(0);
		expect(pixel(bytes, beam.index[50])[0]).toBeGreaterThan(0);
		expect([...lamps]).toEqual([0, 0, 0]);
	});

	it('marks where the data enters in green and where it ends in red while the dot walks', () => {
		const { bytes } = run('walk', ['beam'], 0.9);
		expect(pixel(bytes, beam.index[0])).toEqual([0, 255, 0]);
		expect(pixel(bytes, beam.index[beam.index.length - 1])).toEqual([255, 0, 0]);
		const lit = [...beam.index].slice(1, -1).filter((i) => pixel(bytes, i)[0] > 0);
		expect(lit.length).toBeGreaterThan(0);
		expect(lit.length).toBeLessThanOrEqual(6);
	});

	it('steps through red, green and blue so a swapped colour order shows', () => {
		expect(pixel(run('colours', ['frame'], 0.1).bytes, frame.index[0])).toEqual([110, 0, 0]);
		expect(pixel(run('colours', ['frame'], 0.9).bytes, frame.index[0])).toEqual([0, 110, 0]);
		expect(pixel(run('colours', ['bounce'], 1.7).lamps, 0)).toEqual([0, 0, 110]);
	});

	it('gives the room back when stopped, and stops itself when forgotten', () => {
		const { test } = run('identify', ['beam'], 61);
		expect(test.active).toBe(false);
	});
});
