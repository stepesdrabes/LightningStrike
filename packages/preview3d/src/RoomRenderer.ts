import * as THREE from 'three';
import type { BloomEffect, EffectComposer } from 'postprocessing';
import type { RoomModel } from '@mv/core';
import { CameraRig } from './CameraRig.ts';
import { createComposer } from './post.ts';
import { PULSE_RATE } from './scene/highlight.ts';
import { RoomScene } from './scene/RoomScene.ts';
import type { CameraView, Viewport } from './types.ts';

/**
 * Cap bloom device pixels to preserve 60 fps; its soft glow benefits less from retina
 * resolution.
 */
const PIXEL_BUDGET = 3_000_000;

/** The room in a canvas: a scene, a camera rig and the post chain that makes LEDs read as LEDs. */
export class RoomRenderer {
	private readonly renderer: THREE.WebGLRenderer;
	private readonly scene = new THREE.Scene();
	private room: RoomScene;
	/**
	 * Rooms replaced since the last frame. They are disposed after it, once their successors hold
	 * the shader programs they share, so an edit does not recompile the same shaders.
	 */
	private readonly retired: RoomScene[] = [];
	private readonly rig: CameraRig;
	private readonly composer: EffectComposer;
	private readonly bloom: BloomEffect;
	/** The highlight's pulse phase, 0..1, kept small so it stays precise however long it runs. */
	private readonly pulse = { value: 0 };
	private highlighted: string | null = null;
	private disposed = false;

	constructor(canvas: HTMLCanvasElement, model: RoomModel) {
		this.renderer = new THREE.WebGLRenderer({
			canvas,
			antialias: false,
			powerPreference: 'high-performance',
			stencil: false,
			depth: true
		});
		this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
		// Tone mapping happens in the post chain, after bloom, in HDR.
		this.renderer.toneMapping = THREE.NoToneMapping;
		this.renderer.outputColorSpace = THREE.SRGBColorSpace;

		this.scene.background = new THREE.Color(0x05050a);
		this.room = new RoomScene(model, this.pulse);
		this.scene.add(this.room.root);
		this.rig = new CameraRig(canvas, model.layout);

		const post = createComposer(this.renderer, this.scene, this.rig.camera);
		this.composer = post.composer;
		this.bloom = post.bloom;
	}

	set bloomIntensity(v: number) {
		this.bloom.intensity = v;
	}

	/** Draw another room, or an edited one, keeping the camera unless the room box changed. */
	setRoom(model: RoomModel): void {
		if (this.disposed) return;
		this.scene.remove(this.room.root);
		this.retired.push(this.room);
		this.room = new RoomScene(model, this.pulse);
		this.room.setHighlight(this.highlighted);
		this.scene.add(this.room.root);
		this.rig.setLayout(model.layout);
	}

	/** Pick out one light by id for setup, or none. The show's colours are left alone. */
	highlight(lightId: string | null): void {
		if (this.disposed) return;
		this.highlighted = lightId;
		this.room.setHighlight(lightId);
	}

	setView(view: CameraView): void {
		this.rig.setView(view);
	}

	resize(width: number, height: number, viewport?: Viewport): void {
		if (width <= 0 || height <= 0) return;
		this.rig.resize(width, height, viewport);

		const ratio = Math.max(
			1,
			Math.min(window.devicePixelRatio || 1, 2, Math.sqrt(PIXEL_BUDGET / (width * height)))
		);
		// Before setSize on either: the composer sizes its buffers from the renderer's ratio.
		if (Math.abs(ratio - this.renderer.getPixelRatio()) > 0.01) this.renderer.setPixelRatio(ratio);

		this.renderer.setSize(width, height, false);
		this.composer.setSize(width, height);
	}

	/**
	 * `bytes` is the effect buffer, 3 gamma-encoded bytes per geometry pixel; `lamps` holds 3 per
	 * summary lamp in `model.lamps` order.
	 */
	render(bytes: Uint8Array, dt: number, lamps?: Uint8Array): void {
		if (this.disposed) return;
		this.pulse.value = (this.pulse.value + dt * PULSE_RATE) % 1;
		this.room.update(bytes, lamps);
		this.rig.update(dt);
		this.composer.render(dt);
		for (const room of this.retired) room.dispose();
		this.retired.length = 0;
	}

	dispose(): void {
		if (this.disposed) return;
		this.disposed = true;
		this.rig.dispose();
		this.composer.dispose();
		this.room.dispose();
		for (const room of this.retired) room.dispose();
		this.retired.length = 0;
		this.renderer.dispose();
	}
}
