import * as THREE from 'three';
import type { MatrixLight } from '@mv/core';
import type { PointEmitter } from '../emitters.ts';
import { LIGHTING } from '../lighting.ts';
import { panelEmitter, panelFrame, panelSource } from '../panels.ts';
import { PANEL_FRAGMENT, PANEL_VERTEX } from '../shaders/panel.ts';

/** The spacing the strip look's dot distances were set on: 60 LEDs a metre. */
const STRIP_PITCH = 1 / 60;

/** A matrix as a diffuser over its grid, with a texture of its own laid out as the grid. */
export class MatrixPanel {
	readonly mesh: THREE.Mesh;
	readonly emitter: PointEmitter;
	/** Its LEDs' average this frame, 0..1, which is the light it throws. */
	readonly colour = new THREE.Color(0, 0, 0);
	/** Bytes a frame must hold to cover every LED it shows. */
	readonly needs: number;

	private readonly texture: THREE.DataTexture;
	private readonly data: Uint8Array;
	private readonly source: Int32Array;
	private readonly level: number;

	constructor(light: MatrixLight, index: Int32Array) {
		const { columns, rows } = light;
		this.source = panelSource(light, index);
		this.level = light.level ?? 1;
		this.emitter = panelEmitter(light);
		let top = -1;
		for (const s of this.source) top = Math.max(top, s);
		this.needs = (top + 1) * 3;

		this.data = new Uint8Array(columns * rows * 4);
		for (let i = 3; i < this.data.length; i += 4) this.data[i] = 255;
		this.texture = new THREE.DataTexture(
			this.data,
			columns,
			rows,
			THREE.RGBAFormat,
			THREE.UnsignedByteType
		);
		// Mipmaps average a dense panel seen small, as the diffuser would; it shares no texels.
		this.texture.generateMipmaps = true;
		this.texture.minFilter = THREE.LinearMipmapLinearFilter;
		this.texture.magFilter = THREE.LinearFilter;
		this.texture.wrapS = THREE.ClampToEdgeWrapping;
		this.texture.wrapT = THREE.ClampToEdgeWrapping;
		this.texture.colorSpace = THREE.NoColorSpace;
		this.texture.needsUpdate = true;

		const f = panelFrame(light);
		const position = new Float32Array(12);
		[
			[-1, -1],
			[1, -1],
			[-1, 1],
			[1, 1]
		].forEach(([su, sv], k) => {
			for (let d = 0; d < 3; d++) {
				position[k * 3 + d] =
					f.centre[d] + f.right[d] * su * f.halfWidth + f.up[d] * sv * f.halfHeight;
			}
		});
		const uv = new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]);
		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
		geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
		geometry.setIndex([0, 1, 2, 1, 3, 2]);

		this.mesh = new THREE.Mesh(
			geometry,
			new THREE.ShaderMaterial({
				uniforms: {
					uPanel: { value: this.texture },
					uCells: { value: new THREE.Vector2(columns, rows) },
					uNear: { value: Math.sqrt(f.cellU * f.cellV) / STRIP_PITCH },
					uGain: { value: LIGHTING.emitterGain }
				},
				vertexShader: PANEL_VERTEX,
				fragmentShader: PANEL_FRAGMENT,
				side: THREE.DoubleSide,
				toneMapped: false
			})
		);
	}

	/** Gather its LEDs, adding their light and count to `sum` as (r, g, b, n). Zero allocations. */
	upload(bytes: Uint8Array, sum: Float64Array): void {
		const { source, data } = this;
		const k = this.level;
		let r = 0;
		let g = 0;
		let b = 0;
		let n = 0;
		for (let t = 0; t < source.length; t++) {
			const s = source[t];
			if (s < 0) continue;
			const i = s * 3;
			const cr = k < 1 ? Math.round(bytes[i] * k) : bytes[i];
			const cg = k < 1 ? Math.round(bytes[i + 1] * k) : bytes[i + 1];
			const cb = k < 1 ? Math.round(bytes[i + 2] * k) : bytes[i + 2];
			const o = t * 4;
			data[o] = cr;
			data[o + 1] = cg;
			data[o + 2] = cb;
			r += cr;
			g += cg;
			b += cb;
			n++;
		}
		this.texture.needsUpdate = true;

		const avg = n > 0 ? 1 / (n * 255) : 0;
		this.colour.setRGB(r * avg, g * avg, b * avg);
		sum[0] += r;
		sum[1] += g;
		sum[2] += b;
		sum[3] += n;
	}

	dispose(): void {
		this.texture.dispose();
	}
}
