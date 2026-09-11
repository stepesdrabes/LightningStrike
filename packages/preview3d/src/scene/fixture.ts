import * as THREE from 'three';
import type { Geometry } from '@mv/core';
import { LIGHTING } from '../lighting.ts';
import type { LedTexture } from '../LedTexture.ts';
import { STRIP_FRAGMENT, STRIP_VERTEX } from '../shaders/strip.ts';

const STRIP_THICKNESS = 0.03;
/** Standoff in metres prevents coplanar z-fighting. */
const STRIP_STANDOFF = 0.012;

/** The Frame as ribbons sampling the LED texture: one per run, the diffuser reading. */
export function buildStrips(geometry: Geometry, led: LedTexture): THREE.Mesh[] {
	return geometry.strips.map((strip) => {
		const [sx, sy, sz] = strip.start;
		const [ex, ey, ez] = strip.end;
		const len = Math.hypot(ex - sx, ey - sy, ez - sz);
		const uv = led.rowUv(strip);

		const mesh = new THREE.Mesh(
			new THREE.PlaneGeometry(len, STRIP_THICKNESS, Math.min(strip.count, 512), 1),
			new THREE.ShaderMaterial({
				uniforms: {
					uLed: { value: led.texture },
					uUScale: { value: uv.x },
					uUOffset: { value: uv.y },
					uRow: { value: uv.z },
					uCount: { value: strip.count },
					uGain: { value: LIGHTING.emitterGain }
				},
				vertexShader: STRIP_VERTEX,
				fragmentShader: STRIP_FRAGMENT,
				// Both sides, so orbiting past a wall does not make its strip vanish.
				side: THREE.DoubleSide,
				toneMapped: false
			})
		);

		const normal = new THREE.Vector3(strip.normal[0], strip.normal[1], strip.normal[2]);
		mesh.position.set(
			(sx + ex) / 2 + normal.x * STRIP_STANDOFF,
			(sy + ey) / 2 + normal.y * STRIP_STANDOFF,
			(sz + ez) / 2 + normal.z * STRIP_STANDOFF
		);

		const dir = new THREE.Vector3(ex - sx, ey - sy, ez - sz).normalize();
		const up = new THREE.Vector3().crossVectors(normal, dir).normalize();
		mesh.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(dir, up, normal));

		return mesh;
	});
}
