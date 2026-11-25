import * as THREE from 'three';
import {
	packLines,
	packPoints,
	samplesFor,
	type LineEmitter,
	type PointEmitter
} from '../emitters.ts';
import { LIGHTING } from '../lighting.ts';
import { SURFACE_VERTEX, surfaceFragment } from '../shaders/surface.ts';

interface SurfaceOptions {
	/** Albedo before any light reaches it. */
	base: number;
	/** Share of the room's global wash this surface takes, 0..1. */
	ambient: number;
	/** Scales everything the surface receives. 1 is a dark wall; white plastic returns more. */
	reflect?: number;
	/** Emission of its own, on the emitter scale, in `glow`. Only lamps have any. */
	emit?: number;
	glow?: THREE.Color;
	/** Its own point emitter, because a fixture cannot light itself. */
	self?: number;
}

/**
 * Integrate fixture spill in one shader; per-LED THREE.Lights would exhaust uniforms and frame
 * time.
 */
export class SurfaceFactory {
	/** The room's wash, wired live into every surface: its LEDs' average, or its lamps'. */
	readonly ambient = { value: new THREE.Color(0, 0, 0) };
	/** Each point emitter's colour, 0..1, rewritten every frame. */
	readonly pointColor: Float32Array;

	private readonly led: THREE.Texture;
	private readonly lines: Float32Array;
	private readonly points: Float32Array;
	private readonly fragment: string;

	constructor(
		led: THREE.Texture,
		lines: readonly LineEmitter[],
		points: readonly PointEmitter[]
	) {
		this.led = led;
		this.lines = packLines(lines);
		this.points = packPoints(points);
		this.pointColor = new Float32Array(points.length * 3);
		this.fragment = surfaceFragment(lines.length, samplesFor(lines.length), points.length);
	}

	create(o: SurfaceOptions): THREE.ShaderMaterial {
		const reflect = o.reflect ?? 1;
		return new THREE.ShaderMaterial({
			uniforms: {
				uLed: { value: this.led },
				uLine: { value: this.lines },
				uPoint: { value: this.points },
				uPointColor: { value: this.pointColor },
				uSelf: { value: o.self ?? -1 },
				uLineGain: { value: reflect * LIGHTING.frameSpill },
				uReflect: { value: reflect },
				uAmbient: this.ambient,
				uAmbientMix: { value: o.ambient },
				uBase: { value: new THREE.Color(o.base) },
				uGlow: { value: o.glow ?? new THREE.Color(0, 0, 0) },
				uEmitGain: { value: o.emit ?? 0 }
			},
			vertexShader: SURFACE_VERTEX,
			fragmentShader: this.fragment
		});
	}
}
