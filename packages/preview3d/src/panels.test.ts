import { describe, expect, it } from 'vitest';
import { roomModel, type Corner, type MatrixLight, type RoomLayout } from '@mv/core';
import { LIGHTING } from './lighting.ts';
import { panelEmitter, panelFrame, panelSource } from './panels.ts';
import { STRIP_STANDOFF, STRIP_THICKNESS } from './strips.ts';

const panel = (overrides: Partial<MatrixLight> = {}): MatrixLight => ({
	id: 'panel',
	name: 'Panel',
	kind: 'matrix',
	centre: [0.2, 2.5, 1.4],
	width: 0.8,
	height: 0.4,
	columns: 5,
	rows: 3,
	mount: 'north',
	first: 'top-left',
	horizontal: true,
	serpentine: false,
	role: 'auto',
	...overrides
});

const room = (light: MatrixLight): RoomLayout => ({
	width: 6,
	depth: 5,
	height: 3,
	front: 'south',
	lights: [light]
});

describe('panelSource', () => {
	it('lays every wiring out as the grid, each texel centre on its own LED', () => {
		const corners: Corner[] = ['top-left', 'top-right', 'bottom-left', 'bottom-right'];
		for (const mount of ['north', 'ceiling', 'east'] as const) {
			for (const first of corners) {
				for (const horizontal of [true, false]) {
					for (const serpentine of [true, false]) {
						const light = panel({ mount, first, horizontal, serpentine });
						const [pixels] = roomModel(room(light)).pixels;
						const source = panelSource(light, pixels.index);
						const f = panelFrame(light);
						for (let t = 0; t < source.length; t++) {
							const i = Array.from(pixels.index).indexOf(source[t]);
							expect(i).toBeGreaterThanOrEqual(0);
							const u = ((t % light.columns) + 0.5) / light.columns;
							const v = (Math.floor(t / light.columns) + 0.5) / light.rows;
							for (let d = 0; d < 3; d++) {
								const at =
									f.centre[d] -
									f.normal[d] * STRIP_STANDOFF +
									f.right[d] * (2 * u - 1) * f.halfWidth +
									f.up[d] * (2 * v - 1) * f.halfHeight;
								expect(at).toBeCloseTo(pixels.position[i * 3 + d], 5);
							}
						}
					}
				}
			}
		}
	});
});

describe('panelFrame', () => {
	it('reaches half a cell past the outer LEDs', () => {
		const f = panelFrame(panel());
		expect([f.cellU, f.cellV]).toEqual([0.2, 0.2]);
		expect(f.halfWidth).toBeCloseTo(0.5, 12);
		expect(f.halfHeight).toBeCloseTo(0.3, 12);
		expect(f.normal).toEqual([0, -1, 0]);
		expect(f.centre).toEqual([0.2, 2.5 - STRIP_STANDOFF, 1.4]);
	});

	it('lends a single line the spacing of its other axis, or a strip width', () => {
		expect(panelFrame(panel({ rows: 1, height: 0 })).cellV).toBe(0.2);
		expect(panelFrame(panel({ columns: 1, width: 0 })).cellU).toBe(0.2);
		const dot = panelFrame(panel({ columns: 1, rows: 1, width: 0, height: 0 }));
		expect([dot.cellU, dot.cellV]).toEqual([STRIP_THICKNESS, STRIP_THICKNESS]);
	});
});

describe('panelEmitter', () => {
	it('throws what its LEDs folded into a strip would, from its face', () => {
		const e = panelEmitter(panel());
		expect(e.gain).toBeCloseTo(LIGHTING.frameSpill * 15 * 0.2, 12);
		expect(e.normal).toEqual([0, -1, 0]);
		expect(e.soft).toBeCloseTo(0.25, 12);
	});
});
