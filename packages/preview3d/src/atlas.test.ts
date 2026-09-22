import { describe, expect, it } from 'vitest';
import { DEFAULT_ROOM, roomModel, type Light, type RoomLayout } from '@mv/core';
import { atlasU, atlasV, layoutAtlas, type AtlasLayout } from './atlas.ts';
import { lineEmitters } from './emitters.ts';
import { ATLAS_WIDTH, stripPieces, type StripPiece } from './strips.ts';

const room = (lights: Light[]): RoomLayout => ({
	width: 8,
	depth: 6,
	height: 3,
	front: 'south',
	lights
});

const run = (id: string, y: number, count: number, level?: number): Light => ({
	id,
	name: id,
	kind: 'path',
	points: [
		[-2, y, 2.5],
		[2, y, 2.5]
	],
	counts: [count],
	closed: false,
	density: 60,
	mount: 'ceiling',
	role: 'auto',
	...(level === undefined ? {} : { level })
});

function atlasOf(layout: RoomLayout): { atlas: AtlasLayout; pieces: StripPiece[] } {
	const model = roomModel(layout);
	const pieces = stripPieces(model.pixels);
	return { atlas: layoutAtlas(pieces, model.pixels), pieces };
}

/** Texel columns, fractional, that a u in 0..1 reads from. */
const texel = (atlas: AtlasLayout, u: number) => u * atlas.width;

describe('layoutAtlas', () => {
	it('packs the Frame into one row, a guard either side of every run', () => {
		const model = roomModel(DEFAULT_ROOM);
		const pieces = stripPieces(model.pixels);
		const atlas = layoutAtlas(pieces, model.pixels);
		expect([atlas.width, atlas.height]).toEqual([673 + 10, 1]);
		expect(atlas.slots).toEqual([
			{ x: 0, row: 0 },
			{ x: 172, row: 0 },
			{ x: 286, row: 0 },
			{ x: 458, row: 0 },
			{ x: 572, row: 0 }
		]);
		expect(atlas.level).toBeNull();

		pieces.forEach((p, i) => {
			const { index } = model.pixels[p.light];
			const at = atlas.slots[i].x;
			const { source } = atlas;
			expect(source[at]).toBe(-(index[p.before] + 2));
			for (let k = 0; k < p.count; k++) expect(source[at + 1 + k]).toBe(index[p.from + k]);
			expect(source[at + p.count + 1]).toBe(-(index[p.after] + 2));
		});
	});

	it('shows every LED exactly once, guards aside', () => {
		const model = roomModel(DEFAULT_ROOM);
		const { source } = layoutAtlas(stripPieces(model.pixels), model.pixels);
		const own = Array.from(source).filter((s) => s >= 0);
		expect(own.sort((a, b) => a - b)).toEqual(Array.from({ length: 673 }, (_, i) => i));
	});

	it('starts a new row rather than split a piece across one', () => {
		const lights = Array.from({ length: 7 }, (_, i) => run(`run${i}`, i * 0.5 - 1.5, 700));
		const { atlas, pieces } = atlasOf(room(lights));
		expect(atlas.width).toBe(ATLAS_WIDTH);
		expect(atlas.height).toBe(4);
		pieces.forEach((p, i) => {
			const { x, row } = atlas.slots[i];
			expect(x + p.count + 2).toBeLessThanOrEqual(atlas.width);
			for (let j = 0; j < i; j++) {
				const other = atlas.slots[j];
				const apart = x >= other.x + pieces[j].count + 2 || other.x >= x + p.count + 2;
				expect(other.row !== row || apart).toBe(true);
			}
		});
	});

	it('keeps a ribbon and its spill between its own guards', () => {
		const { atlas, pieces } = atlasOf({
			...DEFAULT_ROOM,
			lights: [
				...DEFAULT_ROOM.lights,
				{
					id: 'ring',
					name: 'Ring',
					kind: 'ring',
					centre: [0, 0, 2.5],
					radius: 0.7,
					count: 90,
					startAngle: 10,
					clockwise: false,
					mount: 'ceiling',
					role: 'field'
				}
			]
		});
		// Guard centres: the furthest a linear sample may reach without leaving its piece.
		const blocks = pieces.map((p, i) => ({
			v: atlasV(atlas, atlas.slots[i]),
			lo: atlas.slots[i].x + 0.5,
			hi: atlas.slots[i].x + p.count + 1.5
		}));
		pieces.forEach((p, i) => {
			const slot = atlas.slots[i];
			for (const x of [0, 0.5 / p.count, 0.5, 1]) {
				const t = texel(atlas, atlasU(atlas, slot, p.count, x));
				expect(t).toBeGreaterThanOrEqual(blocks[i].lo);
				expect(t).toBeLessThanOrEqual(blocks[i].hi);
			}
			expect(atlasV(atlas, slot) * atlas.height).toBeCloseTo(slot.row + 0.5, 9);
		});

		const lines = lineEmitters(pieces, atlas);
		expect(lines.length).toBeGreaterThan(pieces.length);
		for (const l of lines) {
			const [start, end] = [texel(atlas, l.u), texel(atlas, l.u + l.du)];
			const home = blocks.filter((b) => b.v === l.v && start >= b.lo && start <= b.hi);
			expect(home).toHaveLength(1);
			expect(end).toBeGreaterThanOrEqual(home[0].lo);
			expect(end).toBeLessThanOrEqual(home[0].hi);
		}
	});

	it('puts LED k of a piece at the centre of its own texel', () => {
		const { atlas, pieces } = atlasOf(DEFAULT_ROOM);
		pieces.forEach((p, i) => {
			const slot = atlas.slots[i];
			for (const k of [0, 1, p.count - 1]) {
				const t = texel(atlas, atlasU(atlas, slot, p.count, (k + 0.5) / p.count));
				expect(t).toBeCloseTo(slot.x + 1 + k + 0.5, 6);
			}
		});
	});

	it('carries a dimmed light level to its texels, guards included', () => {
		const { atlas } = atlasOf(room([run('bright', 0, 10), run('dim', 1, 10, 0.25)]));
		expect(atlas.level).not.toBeNull();
		expect(Array.from(atlas.level!)).toEqual([...Array(12).fill(1), ...Array(12).fill(0.25)]);
	});

	it('is one dark texel when there is nothing to draw', () => {
		const atlas = layoutAtlas([], []);
		expect([atlas.width, atlas.height, Array.from(atlas.source)]).toEqual([1, 1, [-1]]);
	});
});
