import * as THREE from 'three';
import type { Geometry, RoomSpec } from '@mv/core';
import { LedTexture } from '../LedTexture.ts';
import { buildBounceLamp } from './bounceLamp.ts';
import { buildStrips } from './fixture.ts';
import { buildRoom } from './room.ts';
import { SurfaceFactory } from './surfaceMaterial.ts';

/**
 * Attenuate the lamp in the preview so its direct image does not overpower the walls.
 * Recalibrate when bounce.ts level math changes.
 */
const LAMP_PREVIEW_GAIN = 0.52;

/** Everything that is drawn: the room, both fixtures, and the LED texture they all share. */
export class RoomScene {
	readonly scene = new THREE.Scene();
	readonly led: LedTexture;

	private readonly surfaces: SurfaceFactory;

	constructor(geometry: Geometry, spec: RoomSpec) {
		this.led = new LedTexture(geometry);
		this.surfaces = new SurfaceFactory(this.led, geometry, spec);

		this.scene.background = new THREE.Color(0x05050a);
		this.scene.add(...buildRoom(spec, this.surfaces));
		this.scene.add(buildBounceLamp(spec, this.surfaces));
		this.scene.add(...buildStrips(geometry, this.led));
	}

	/** bounce is the lamp's separate gamma-encoded RGB pixel. */
	update(bytes: Uint8Array, bounce?: Uint8Array): void {
		this.led.upload(bytes);
		if (bounce) {
			const g = LAMP_PREVIEW_GAIN / 255;
			this.surfaces.lampColor.value.setRGB(bounce[0] * g, bounce[1] * g, bounce[2] * g);
		}
	}

	dispose(): void {
		this.led.dispose();
		this.scene.traverse((o) => {
			const mesh = o as THREE.Mesh;
			if (mesh.geometry) mesh.geometry.dispose();
			const mat = mesh.material;
			if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
			else if (mat) (mat as THREE.Material).dispose();
		});
	}
}
