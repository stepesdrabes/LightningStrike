import { matrixOrder, mountNormal, planeOf, type MatrixLight, type Vec3 } from '@mv/core';
import type { PointEmitter } from './emitters.ts';
import { LIGHTING } from './lighting.ts';
import { STRIP_STANDOFF, STRIP_THICKNESS } from './strips.ts';
import { add, scale } from './vec.ts';

/** A matrix's face: its plane, and half its extent, half a cell past the outer LEDs. */
export interface PanelFrame {
	centre: Vec3;
	right: Vec3;
	up: Vec3;
	normal: Vec3;
	halfWidth: number;
	halfHeight: number;
	/** Metres between LED centres across and down. */
	cellU: number;
	cellV: number;
}

export function panelFrame(light: MatrixLight): PanelFrame {
	const u = light.columns > 1 ? light.width / (light.columns - 1) : 0;
	const v = light.rows > 1 ? light.height / (light.rows - 1) : 0;
	// A single line of LEDs borrows the other axis's spacing for its own.
	const either = Math.max(u, v) || STRIP_THICKNESS;
	const cellU = u > 1e-6 ? u : either;
	const cellV = v > 1e-6 ? v : either;
	const { right, up } = planeOf(light.mount);
	const normal = mountNormal(light.mount);
	return {
		centre: add(light.centre, scale(normal, STRIP_STANDOFF)),
		right,
		up,
		normal,
		halfWidth: (light.columns * cellU) / 2,
		halfHeight: (light.rows * cellV) / 2,
		cellU,
		cellV
	};
}

/**
 * The effect-buffer LED behind each texel, -1 where none. Texture rows run bottom up, so row r of
 * the panel is texture row `rows - 1 - r` and texel centres land on the LEDs' own positions.
 */
export function panelSource(light: MatrixLight, index: Int32Array): Int32Array {
	const { columns, rows } = light;
	const out = new Int32Array(columns * rows).fill(-1);
	matrixOrder(light).forEach(([c, r], i) => {
		out[(rows - 1 - r) * columns + c] = index[i];
	});
	return out;
}

/** A panel lights the room as the metres of strip folded into it would, from its middle. */
export function panelEmitter(light: MatrixLight): PointEmitter {
	const f = panelFrame(light);
	const half = Math.max(f.halfWidth, f.halfHeight);
	return {
		at: f.centre,
		soft: half * half,
		normal: f.normal,
		gain: LIGHTING.frameSpill * light.columns * light.rows * Math.sqrt(f.cellU * f.cellV)
	};
}
