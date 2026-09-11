import * as THREE from 'three';
import type { Geometry, RoomSpec } from '@mv/core';
import { LIGHTING } from '../lighting.ts';
import type { LedTexture } from '../LedTexture.ts';
import { SURFACE_VERTEX, surfaceFragment } from '../shaders/surface.ts';

interface SurfaceOptions {
	/** Albedo before any light reaches it. */
	base: number;
	/** Share of the Frame's global wash this surface takes, 0..1. */
	ambient: number;
	/** Scales everything the surface receives. 1 is a dark wall; white plastic returns more. */
	reflect?: number;
	/** Emission of its own, on the emitter scale. Only the Bounce Lamp's tube has any. */
	emit?: number;
	/** False for the lamp itself, because a fixture cannot light itself. */
	litByLamp?: boolean;
}

/**
 * Integrate fixture spill in one shader; per-LED THREE.Lights would exhaust uniforms and frame
 * time.
 */
export class SurfaceFactory {
	/** The Bounce Lamp's one pixel, 0..1, shared by its tube and by everything it lights. */
	readonly lampColor = { value: new THREE.Color(0, 0, 0) };

	private readonly led: LedTexture;
	private readonly spec: RoomSpec;
	/** Each run of the Frame as a line in world space, so the shader walks the fixture it has. */
	private readonly seg: THREE.Vector4[];
	private readonly segUv: THREE.Vector3[];

	constructor(led: LedTexture, geometry: Geometry, spec: RoomSpec) {
		this.led = led;
		this.spec = spec;
		this.seg = geometry.strips.map(
			(s) => new THREE.Vector4(s.start[0], s.start[1], s.end[0], s.end[1])
		);
		this.segUv = geometry.strips.map((s) => led.rowUv(s));
	}

	create(o: SurfaceOptions): THREE.ShaderMaterial {
		const b = this.spec.bounce;
		const reflect = o.reflect ?? 1;
		return new THREE.ShaderMaterial({
			uniforms: {
				uLed: { value: this.led.texture },
				uSeg: { value: this.seg },
				uSegUv: { value: this.segUv },
				uFrameZ: { value: this.spec.fixture.height },
				uFrameGain: { value: reflect * LIGHTING.frameSpill },
				uAmbient: this.led.ambient,
				uAmbientMix: { value: o.ambient },
				uBase: { value: new THREE.Color(o.base) },
				uLampAt: { value: new THREE.Vector3(b.at[0], b.at[1], b.height / 2) },
				uLampColor: this.lampColor,
				// The column's own emitting area, as the radius its inverse square softens over.
				// Without it the two walls it stands against take a hot point rather than the
				// broad wash a metre of diffuser actually throws.
				uLampSize: { value: b.height * b.height * 0.25 },
				uLampGain: {
					value: o.litByLamp === false ? 0 : reflect * LIGHTING.lampSpill * b.height
				},
				uEmitGain: { value: o.emit ?? 0 }
			},
			vertexShader: SURFACE_VERTEX,
			fragmentShader: surfaceFragment(this.seg.length)
		});
	}
}
