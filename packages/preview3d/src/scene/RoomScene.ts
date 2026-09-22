import * as THREE from 'three';
import type { RoomModel } from '@mv/core';
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

	constructor(model: RoomModel) {
		this.led = new LedTexture(model.geometry);
		this.surfaces = new SurfaceFactory(this.led, model);

		this.scene.background = new THREE.Color(0x05050a);
		this.scene.add(...buildRoom(model.layout, this.surfaces));
		if (model.lamps[0]) this.scene.add(buildBounceLamp(model.lamps[0], this.surfaces));
		this.scene.add(...buildStrips(model.geometry, this.led));
	}

	/** `lamps` holds each summary lamp's gamma-encoded RGB pixel. */
	update(bytes: Uint8Array, lamps?: Uint8Array): void {
		this.led.upload(bytes);
		if (lamps && lamps.length >= 3) {
			const g = LAMP_PREVIEW_GAIN / 255;
			this.surfaces.lampColor.value.setRGB(lamps[0] * g, lamps[1] * g, lamps[2] * g);
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
