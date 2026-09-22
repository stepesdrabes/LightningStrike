import * as THREE from 'three';

/**
 * Bands from `bandVertices` as one indexed geometry: uv.x runs 0..1 along each band and uv.y
 * 0..1 across it.
 */
export function bandGeometry(bands: readonly Float32Array[]): THREE.BufferGeometry {
	let vertices = 0;
	for (const b of bands) vertices += b.length / 3;
	const position = new Float32Array(vertices * 3);
	const uv = new Float32Array(vertices * 2);
	const index = new Uint32Array((vertices - 2 * bands.length) * 3);

	let v = 0;
	let q = 0;
	for (const b of bands) {
		position.set(b, v * 3);
		const steps = b.length / 6 - 1;
		for (let j = 0; j <= steps; j++) {
			const at = (v + j * 2) * 2;
			uv[at] = j / steps;
			uv[at + 2] = j / steps;
			uv[at + 3] = 1;
		}
		for (let j = 0; j < steps; j++, q += 6) {
			const a = v + j * 2;
			index[q] = a;
			index[q + 1] = a + 1;
			index[q + 2] = a + 2;
			index[q + 3] = a + 1;
			index[q + 4] = a + 3;
			index[q + 5] = a + 2;
		}
		v += (steps + 1) * 2;
	}

	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
	geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
	geometry.setIndex(new THREE.BufferAttribute(index, 1));
	return geometry;
}

/** A per-vertex attribute holding one value per band, `size` floats each. */
export function perBand(
	bands: readonly Float32Array[],
	size: number,
	values: readonly (readonly number[])[]
): THREE.BufferAttribute {
	let vertices = 0;
	for (const b of bands) vertices += b.length / 3;
	const out = new Float32Array(vertices * size);
	let v = 0;
	bands.forEach((b, i) => {
		for (let k = 0; k < b.length / 3; k++, v++) out.set(values[i], v * size);
	});
	return new THREE.BufferAttribute(out, size);
}
