import * as THREE from 'three';
import type { RoomSpec } from '@mv/core';
import { LIGHTING } from '../lighting.ts';
import type { SurfaceFactory } from './surfaceMaterial.ts';

/** The white diffuser reflects room light even while its own emitter is off. */
export function buildBounceLamp(spec: RoomSpec, surfaces: SurfaceFactory): THREE.Mesh {
	const b = spec.bounce;
	const geo = new THREE.CylinderGeometry(b.diameter / 2, b.diameter / 2, b.height, 24, 1, true);
	geo.rotateX(Math.PI / 2);

	const mat = surfaces.create({
		base: 0x16171b,
		ambient: 0.5,
		// White plastic returns more of the Frame than a dark wall does.
		reflect: 1.5,
		emit: LIGHTING.lampGain,
		litByLamp: false
	});
	mat.side = THREE.DoubleSide;

	const tube = new THREE.Mesh(geo, mat);
	tube.position.set(b.at[0], b.at[1], b.height / 2);
	return tube;
}
