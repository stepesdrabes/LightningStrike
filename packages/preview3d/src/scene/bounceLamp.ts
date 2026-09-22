import * as THREE from 'three';
import type { LampLight } from '@mv/core';
import { LIGHTING } from '../lighting.ts';
import type { SurfaceFactory } from './surfaceMaterial.ts';

/** The white diffuser reflects room light even while its own emitter is off. */
export function buildBounceLamp(lamp: LampLight, surfaces: SurfaceFactory): THREE.Mesh {
	const geo = new THREE.CylinderGeometry(lamp.diameter / 2, lamp.diameter / 2, lamp.height, 24, 1, true);
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
	tube.position.set(lamp.at[0], lamp.at[1], lamp.at[2] + lamp.height / 2);
	return tube;
}
