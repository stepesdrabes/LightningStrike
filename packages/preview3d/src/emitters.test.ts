import { describe, expect, it } from 'vitest';
import { DEFAULT_ROOM, roomModel, type LampLight, type Light, type RoomLayout } from '@mv/core';
import { layoutAtlas } from './atlas.ts';
import {
	MAX_LINES,
	MAX_POINTS,
	chordsOf,
	lampEmitter,
	lineEmitters,
	packLines,
	packPoints,
	samplesFor,
	strongest
} from './emitters.ts';
import { LIGHTING } from './lighting.ts';
import { stripPieces } from './strips.ts';
import { dot, length, sub } from './vec.ts';

const room = (lights: Light[]): RoomLayout => ({
	width: 8,
	depth: 6,
	height: 3,
	front: 'south',
	lights
});

function linesOf(layout: RoomLayout) {
	const model = roomModel(layout);
	const pieces = stripPieces(model.pixels);
	const atlas = layoutAtlas(pieces, model.pixels);
	return { lines: lineEmitters(pieces, atlas), pieces, atlas };
}

const lamp = (overrides: Partial<LampLight> = {}): LampLight => ({
	id: 'lamp',
	name: 'Lamp',
	kind: 'lamp',
	at: [1, 1, 0],
	height: 0,
	diameter: 0.12,
	mode: 'summary',
	...overrides
});

describe('lineEmitters', () => {
	it('walks the Frame as it always has: each run from its first LED to its last', () => {
		const { lines, pieces, atlas } = linesOf(DEFAULT_ROOM);
		expect(lines.map((l) => [l.a, l.b])).toEqual(
			pieces.map(({ shape }) => (shape.kind === 'line' ? [shape.a, shape.b] : []))
		);
		lines.forEach((l, i) => {
			const { count } = pieces[i];
			const { x } = atlas.slots[i];
			expect(l.normal).toEqual([0, 0, -1]);
			// Texel centres of the first and the last LED, as the old per-strip rows had them.
			expect(l.u * atlas.width).toBeCloseTo(x + 1.5, 6);
			expect((l.u + l.du) * atlas.width).toBeCloseTo(x + count + 0.5, 6);
			expect(l.v).toBe(0.5);
		});
		expect(lines.map((l) => l.weight)).toEqual([3, 2, 3, 2, 2]);
	});

	it('walks a ring as chords on its circle, reading the arc each spans', () => {
		const ring: Light = {
			id: 'ring',
			name: 'Ring',
			kind: 'ring',
			centre: [0, 0, 2.5],
			radius: 0.8,
			count: 64,
			startAngle: 30,
			clockwise: true,
			mount: 'ceiling',
			role: 'auto'
		};
		const { lines, pieces, atlas } = linesOf(room([ring]));
		const shape = pieces[0].shape;
		if (shape.kind !== 'arc') throw new Error('a ring is an arc');
		expect(lines).toHaveLength(chordsOf(shape));
		expect(lines).toHaveLength(8);
		for (const l of lines) {
			expect(length(sub(l.a, [0, 0, 2.5]))).toBeCloseTo(0.8, 9);
			expect(length(sub(l.b, [0, 0, 2.5]))).toBeCloseTo(0.8, 9);
		}
		// Each chord starts where the last ended, and all eight read the ring end to end.
		for (let i = 1; i < lines.length; i++) {
			expect(lines[i].u).toBeCloseTo(lines[i - 1].u + lines[i - 1].du, 12);
			expect(lines[i].a).toEqual(lines[i - 1].b);
		}
		const { x } = atlas.slots[0];
		expect(lines[0].u * atlas.width).toBeCloseTo(x + 1, 6);
		const last = lines[lines.length - 1];
		expect((last.u + last.du) * atlas.width).toBeCloseTo(x + 1 + 64, 6);
	});

	it('gives a small ring three chords and a big one eight', () => {
		const arc = (radius: number) => ({
			kind: 'arc' as const,
			centre: [0, 0, 0] as const,
			radius,
			right: [1, 0, 0] as const,
			up: [0, 1, 0] as const,
			angle: 0,
			sweep: Math.PI * 2
		});
		expect(chordsOf(arc(0.05))).toBe(3);
		expect(chordsOf(arc(0.5))).toBe(6);
		expect(chordsOf(arc(3))).toBe(8);
		expect(chordsOf({ ...arc(3), sweep: Math.PI / 4 })).toBe(5);
		expect(chordsOf({ ...arc(0.05), sweep: Math.PI / 4 })).toBe(1);
	});

	it('draws no light from a run of no length', () => {
		const flat: Light = {
			id: 'flat',
			name: 'Flat',
			kind: 'path',
			points: [
				[0, 0, 2.5],
				[0, 0, 2.5],
				[1, 0, 2.5]
			],
			counts: [5, 20],
			closed: false,
			density: 60,
			mount: 'ceiling',
			role: 'auto'
		};
		const { lines } = linesOf(room([flat]));
		expect(lines).toHaveLength(1);
		expect(lines[0].a).toEqual([0, 0, 2.5]);
		const values = lines.flatMap((l) => [...l.a, ...l.b, l.u, l.du, l.v]);
		expect(values.every(Number.isFinite)).toBe(true);
	});

	it('faces a wall strip into the room', () => {
		const wall: Light = {
			id: 'wall',
			name: 'Wall',
			kind: 'path',
			points: [
				[-1, -3, 1.2],
				[1, -3, 1.2]
			],
			counts: [60],
			closed: false,
			density: 60,
			mount: 'south',
			role: 'auto'
		};
		const [line] = linesOf(room([wall])).lines;
		expect(line.normal).toEqual([0, 1, 0]);
		expect(dot(line.normal, sub(line.b, line.a))).toBe(0);
	});
});

describe('caps', () => {
	it('keeps the heaviest lines, in the order they came', () => {
		const lights = Array.from({ length: 30 }, (_, i): Light => ({
			id: `run${i}`,
			name: `Run ${i}`,
			kind: 'path',
			points: [
				[-3, -2.5 + i * 0.17, 2.5],
				[-3 + 0.1 + (i % 10) * 0.5, -2.5 + i * 0.17, 2.5]
			],
			counts: [10],
			closed: false,
			density: 60,
			mount: 'ceiling',
			role: 'auto'
		}));
		const { lines } = linesOf(room(lights));
		const kept = strongest(lines, MAX_LINES, (l) => l.weight);
		// Six runs of 0.1 and 0.6 m are the lightest.
		expect(kept).toHaveLength(MAX_LINES);
		expect(kept.map((l) => lines.indexOf(l))).toEqual(
			lines.map((_, i) => i).filter((i) => lines[i].weight > 1)
		);
	});

	it('breaks ties by order and passes a short list through', () => {
		const items = [1, 3, 2, 3, 1].map((weight, id) => ({ id, weight }));
		expect(strongest(items, 3, (x) => x.weight).map((x) => x.id)).toEqual([1, 2, 3]);
		expect(strongest(items, 2, (x) => x.weight).map((x) => x.id)).toEqual([1, 3]);
		expect(strongest(items, 9, (x) => x.weight)).toEqual(items);
	});

	it('spreads a fixed tap budget over many lines and keeps eight for a few', () => {
		expect(samplesFor(0)).toBe(0);
		expect(samplesFor(5)).toBe(8);
		expect(samplesFor(12)).toBe(8);
		expect(samplesFor(16)).toBe(6);
		expect(samplesFor(MAX_LINES)).toBe(4);
	});

	it('leaves the surface shader room under the 224 fragment vec4 WebGL2 guarantees', () => {
		// Three per line, two per point plus its colour, and a dozen for everything else.
		expect(MAX_LINES * 3 + MAX_POINTS * 3 + 12).toBeLessThanOrEqual(224);
	});
});

describe('lampEmitter', () => {
	it('keeps the Bounce Lamp where the spill has always come from', () => {
		const bounce = DEFAULT_ROOM.lights.find((l): l is LampLight => l.kind === 'lamp')!;
		expect(lampEmitter(bounce)).toEqual({
			at: [-2.2, -1.7, 0.5],
			soft: 0.25,
			normal: null,
			gain: LIGHTING.lampSpill
		});
	});

	it('lights a bulb from where it glows, softened by its size', () => {
		const bulb = lampEmitter(lamp());
		expect([bulb.at, bulb.normal, bulb.gain]).toEqual([[1, 1, 0], null, LIGHTING.bulbSpill]);
		expect(bulb.soft).toBeCloseTo(0.06 * 0.06, 12);
		const pixel = lampEmitter(lamp({ mode: 'pixel', height: 1.4 }));
		expect(pixel.at).toEqual([1, 1, 1.4]);
		expect(pixel.gain).toBe(LIGHTING.bulbSpill);
	});
});

describe('packing', () => {
	it('lays lines out as three vec4 and points as two', () => {
		const { lines } = linesOf(DEFAULT_ROOM);
		const packed = packLines(lines);
		expect(packed).toHaveLength(lines.length * 12);
		const l = lines[1];
		expect(Array.from(packed.subarray(12, 24))).toEqual(
			Array.from(new Float32Array([...l.a, l.u, ...l.b, l.du, ...l.normal, l.v]))
		);

		const points = packPoints([
			{ at: [1, 2, 3], soft: 0.5, normal: null, gain: 0.3 },
			{ at: [4, 5, 6], soft: 0.1, normal: [0, 0, -1], gain: 2 }
		]);
		expect(Array.from(points)).toEqual(
			Array.from(new Float32Array([1, 2, 3, 0.5, 0, 0, 0, 0.3, 4, 5, 6, 0.1, 0, 0, -1, 2]))
		);
	});
});
