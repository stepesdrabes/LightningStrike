import * as THREE from 'three';
import type { LampLight } from '@mv/core';
import { bulbCentre, lampEmitter, type PointEmitter } from '../emitters.ts';
import { LIGHTING } from '../lighting.ts';
import type { SurfaceFactory } from './surfaceMaterial.ts';

/**
 * Attenuate a summary lamp in the preview so its direct image does not overpower the walls.
 * Recalibrate when bounce.ts level math changes.
 */
export const LAMP_PREVIEW_GAIN = 0.52;

/** A lamp and the colour it glows and throws, 0..1, rewritten every frame. */
export interface LampFixture {
	light: LampLight;
	emitter: PointEmitter;
	colour: THREE.Color;
}

export function lampFixture(light: LampLight): LampFixture {
	return { light, emitter: lampEmitter(light), colour: new THREE.Color(0, 0, 0) };
}

/**
 * A summary lamp with height is the Bounce Lamp's open tube; anything else is a bulb. The white
 * diffuser reflects room light even while its own emitter is off.
 */
export function buildLamp(
	fixture: LampFixture,
	surfaces: SurfaceFactory,
	self: number
): THREE.Mesh {
	const { light, colour } = fixture;
	const r = light.diameter / 2;
	const tube = light.mode === 'summary' && light.height > 0;
	const geometry = tube
		? new THREE.CylinderGeometry(r, r, light.height, 24, 1, true).rotateX(Math.PI / 2)
		: new THREE.SphereGeometry(r, 24, 16);

	const material = surfaces.create({
		base: 0x16171b,
		ambient: 0.5,
		// White plastic returns more of the room than a dark wall does.
		reflect: 1.5,
		emit: light.mode === 'summary' ? LIGHTING.lampGain : LIGHTING.emitterGain,
		glow: colour,
		self
	});
	if (tube) material.side = THREE.DoubleSide;

	const mesh = new THREE.Mesh(geometry, material);
	const at = tube ? fixture.emitter.at : bulbCentre(light);
	mesh.position.set(at[0], at[1], at[2]);
	return mesh;
}
