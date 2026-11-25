import * as THREE from 'three';
import type { AtlasLayout } from './atlas.ts';

/**
 * Every path and ring in one texture, a strip of texels per piece. PWM bytes represent linear
 * emitted light; linear filtering supplies the frosted diffuser.
 */
export class LedTexture {
	readonly texture: THREE.DataTexture;
	/** Bytes a frame must hold: three per LED, through the highest LED a texel shows. */
	readonly needs: number;

	private readonly layout: AtlasLayout;
	private readonly data: Uint8Array;

	constructor(layout: AtlasLayout) {
		this.layout = layout;
		this.data = new Uint8Array(layout.width * layout.height * 4);
		for (let i = 3; i < this.data.length; i += 4) this.data[i] = 255;

		let top = -1;
		for (const s of layout.source) top = Math.max(top, s >= 0 ? s : -s - 2);
		this.needs = (top + 1) * 3;

		this.texture = new THREE.DataTexture(
			this.data,
			layout.width,
			layout.height,
			THREE.RGBAFormat,
			THREE.UnsignedByteType
		);
		this.texture.minFilter = THREE.LinearFilter;
		this.texture.magFilter = THREE.LinearFilter;
		this.texture.wrapS = THREE.ClampToEdgeWrapping;
		this.texture.wrapT = THREE.ClampToEdgeWrapping;
		this.texture.colorSpace = THREE.NoColorSpace;
		this.texture.needsUpdate = true;
	}

	/**
	 * Gather this frame's LEDs, each at its light's level, and add their light and count to `sum`
	 * as (r, g, b, n); guards are copies and not counted. Zero allocations.
	 */
	upload(bytes: Uint8Array, sum: Float64Array): void {
		const { source, level } = this.layout;
		const td = this.data;
		let r = 0;
		let g = 0;
		let b = 0;
		let n = 0;

		for (let t = 0; t < source.length; t++) {
			const s = source[t];
			if (s === -1) continue;
			const i = (s >= 0 ? s : -s - 2) * 3;
			let cr = bytes[i];
			let cg = bytes[i + 1];
			let cb = bytes[i + 2];
			if (level !== null && level[t] < 1) {
				const k = level[t];
				cr = Math.round(cr * k);
				cg = Math.round(cg * k);
				cb = Math.round(cb * k);
			}
			const o = t * 4;
			td[o] = cr;
			td[o + 1] = cg;
			td[o + 2] = cb;
			if (s >= 0) {
				r += cr;
				g += cg;
				b += cb;
				n++;
			}
		}
		this.texture.needsUpdate = true;

		sum[0] += r;
		sum[1] += g;
		sum[2] += b;
		sum[3] += n;
	}

	dispose(): void {
		this.texture.dispose();
	}
}
