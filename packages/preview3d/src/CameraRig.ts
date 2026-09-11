import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import type { RoomSpec } from '@mv/core';
import type { CameraView, Viewport } from './types.ts';

/** Scratch for the framing maths, which runs on every resize. Module-level, so it allocates once. */
const FIT_EYE = new THREE.Vector3();
const FIT_CORNER = new THREE.Vector3();
const FIT_RIGHT = new THREE.Vector3();
const FIT_UP = new THREE.Vector3();
const POSE_POS = new THREE.Vector3();
const POSE_TARGET = new THREE.Vector3();
const GLIDE_OFFSET = new THREE.Vector3();
const GLIDE_AT = new THREE.Spherical();
const UP_Y = new THREE.Vector3(0, 1, 0);

/** Seconds for a visible but responsive preset glide. */
const GLIDE_SECONDS = 0.55;

/** A little air past the room's own extent, so a bloom halo is not clipped by the frame. */
const FIT_MARGIN = 1.04;

/** The vertical field of view the room is framed with, over the viewport rather than the canvas. */
const VIEW_FOV = 52;

/** Zero first AND second derivative at both ends, so a move has no visible start or stop. */
function smoother(t: number): number {
	return t * t * t * (t * (t * 6 - 15) + 10);
}

/** The short way round a circle, so a move never takes the long way for want of a wrap. */
function shortestTurn(delta: number): number {
	return delta - Math.PI * 2 * Math.round(delta / (Math.PI * 2));
}

/**
 * Interpolate in orbit coordinates; a world-space chord would swell the room midway through a
 * turn.
 */
interface Glide {
	from: THREE.Spherical;
	to: THREE.Spherical;
	fromTarget: THREE.Vector3;
	toTarget: THREE.Vector3;
	t: number;
}

/** The camera, its presets and the projection that frames them onto the viewport. */
export class CameraRig {
	readonly camera: THREE.PerspectiveCamera;
	readonly controls: OrbitControls;

	private readonly spec: RoomSpec;
	private canvas = { width: 1, height: 1 };
	private viewport: Viewport = { x: 0, y: 0, width: 1, height: 1 };

	/** Active preset, or null after manual orbiting. Only presets refit on resize. */
	private framed: CameraView | null = 'orbit';
	private glide: Glide | null = null;

	/** `Spherical` is defined about +y and this room stands on +z, so poses convert through these. */
	private readonly toOrbit = new THREE.Quaternion();
	private readonly fromOrbit = new THREE.Quaternion();

	constructor(canvas: HTMLElement, spec: RoomSpec) {
		this.spec = spec;

		// Both placeholders: `applyProjection` derives them from the viewport on first resize.
		this.camera = new THREE.PerspectiveCamera(VIEW_FOV, 1, 0.1, 40);
		this.camera.up.set(0, 0, 1);

		this.controls = new OrbitControls(this.camera, canvas);
		this.controls.enableDamping = true;
		this.controls.dampingFactor = 0.08;
		this.controls.minDistance = 0.8;
		this.controls.maxDistance = 22;
		// Touching the camera hands it over: from here it is the user's until a preset is pressed,
		// and a move still arriving gives way rather than fighting the drag.
		this.controls.addEventListener('start', () => {
			this.framed = null;
			this.glide = null;
		});

		this.toOrbit.setFromUnitVectors(this.camera.up, UP_Y);
		this.fromOrbit.copy(this.toOrbit).invert();

		this.poseFor('orbit', POSE_POS, POSE_TARGET);
		this.camera.position.copy(POSE_POS);
		this.controls.target.copy(POSE_TARGET);
		this.controls.update();
	}

	/** Pressing the same preset again completes its glide immediately. */
	setView(view: CameraView): void {
		const arrived = this.framed === view;
		this.framed = view;
		this.poseFor(view, POSE_POS, POSE_TARGET);

		if (arrived) {
			this.glide = null;
			this.camera.position.copy(POSE_POS);
			this.controls.target.copy(POSE_TARGET);
			this.controls.update();
			return;
		}
		this.startGlide(POSE_POS, POSE_TARGET);
	}

	resize(width: number, height: number, viewport?: Viewport): void {
		this.canvas = { width, height };
		this.viewport =
			viewport && viewport.width > 0 && viewport.height > 0
				? viewport
				: { x: 0, y: 0, width, height };
		this.applyProjection();

		// A preset means the same thing at every window shape, so it re-fits. A camera the user
		// has orbited is theirs, and a resize is not a reason to take it back.
		if (!this.framed) return;
		this.poseFor(this.framed, POSE_POS, POSE_TARGET);
		// A move already in flight is re-aimed rather than cancelled, so a window resized mid-turn
		// lands on the new framing instead of the one it set off for.
		if (this.glide) {
			this.aimGlide(POSE_POS, POSE_TARGET);
		} else {
			this.camera.position.copy(POSE_POS);
			this.controls.target.copy(POSE_TARGET);
		}
		this.controls.update();
	}

	/** Advance the rig before anything reads the camera, so a frame renders the pose it arrived at. */
	update(dt: number): void {
		if (this.glide) this.advanceGlide(dt);
		this.controls.update();
	}

	dispose(): void {
		this.controls.dispose();
	}

	/** Tilt top view off vertical to avoid OrbitControls' undefined azimuth at polar angle zero. */
	private poseFor(view: CameraView, pos: THREE.Vector3, target: THREE.Vector3): void {
		const s = this.spec;
		switch (view) {
			case 'top':
				pos.set(0, -s.depth * 0.14, s.height * 3.1);
				target.set(0, 0, 0);
				break;
			case 'front':
				pos.set(0, -s.depth * 2.1, s.height * 0.62);
				target.set(0, 0, s.height * 0.45);
				break;
			default:
				pos.set(s.width * 0.85, -s.depth * 1.15, s.height * 1.15);
				target.set(0, 0, s.height * 0.38);
				break;
		}
		this.fit(pos, target);
	}

	/** A pose as an orbit around its own target: azimuth, elevation, distance. */
	private orbitOf(pos: THREE.Vector3, target: THREE.Vector3, out: THREE.Spherical): void {
		out.setFromVector3(GLIDE_OFFSET.copy(pos).sub(target).applyQuaternion(this.toOrbit));
	}

	private startGlide(toPos: THREE.Vector3, toTarget: THREE.Vector3): void {
		const g =
			this.glide ??
			(this.glide = {
				from: new THREE.Spherical(),
				to: new THREE.Spherical(),
				fromTarget: new THREE.Vector3(),
				toTarget: new THREE.Vector3(),
				t: 0
			});

		// From wherever the camera actually is, so interrupting one move with another picks up
		// mid-flight rather than jumping back to where the last one started.
		this.orbitOf(this.camera.position, this.controls.target, g.from);
		g.fromTarget.copy(this.controls.target);
		this.aimGlide(toPos, toTarget);
		g.t = 0;
	}

	/** Point an in-flight move at a (possibly new) destination, keeping where it has got to. */
	private aimGlide(toPos: THREE.Vector3, toTarget: THREE.Vector3): void {
		const g = this.glide;
		if (!g) return;
		this.orbitOf(toPos, toTarget, g.to);
		g.to.theta = g.from.theta + shortestTurn(g.to.theta - g.from.theta);
		g.toTarget.copy(toTarget);
	}

	private advanceGlide(dt: number): void {
		const g = this.glide;
		if (!g) return;
		g.t = Math.min(1, g.t + dt / GLIDE_SECONDS);
		const e = smoother(g.t);

		this.controls.target.lerpVectors(g.fromTarget, g.toTarget, e);
		GLIDE_AT.theta = g.from.theta + (g.to.theta - g.from.theta) * e;
		GLIDE_AT.phi = g.from.phi + (g.to.phi - g.from.phi) * e;
		// Geometric, so closing half the gap looks the same from three metres as from twelve.
		GLIDE_AT.radius =
			Math.max(1e-4, g.from.radius) * Math.pow(g.to.radius / Math.max(1e-4, g.from.radius), e);
		GLIDE_AT.makeSafe();

		this.camera.position
			.copy(this.controls.target)
			.add(GLIDE_OFFSET.setFromSpherical(GLIDE_AT).applyQuaternion(this.fromOrbit));

		if (g.t >= 1) this.glide = null;
	}

	/** Shear the frustum onto the viewport; translating the camera would distort near/far framing. */
	private applyProjection(): void {
		const { width, height } = this.canvas;
		const v = this.viewport;
		const cx = v.x + v.width / 2;
		const cy = v.y + v.height / 2;
		// A virtual frame centred on the viewport and large enough to contain the canvas, so the
		// canvas is an off-centre cut of it.
		const halfW = Math.max(cx, width - cx);
		const halfH = Math.max(cy, height - cy);
		const t = Math.tan((VIEW_FOV * Math.PI) / 360);

		// `fov` describes the virtual frame, so it is the viewport's own angle scaled up by how
		// much taller that frame is.
		this.camera.fov = (2 * Math.atan((t * 2 * halfH) / v.height) * 180) / Math.PI;
		this.camera.aspect = halfW / halfH;
		this.camera.setViewOffset(2 * halfW, 2 * halfH, halfW - cx, halfH - cy, width, height);
		this.camera.updateProjectionMatrix();
	}

	/**
	 * Fit both viewport axes per room corner; independent extent bounds would move the camera too
	 * far away.
	 */
	private fit(pos: THREE.Vector3, target: THREE.Vector3): void {
		const s = this.spec;
		const eye = FIT_EYE.copy(pos).sub(target);
		const dist = eye.length();
		if (dist < 1e-4) return;
		eye.divideScalar(dist);

		const right = FIT_RIGHT.crossVectors(eye, this.camera.up);
		// Looking straight along `up` leaves no horizontal to measure. `top` is tilted off vertical
		// for OrbitControls' sake, so this only guards against a camera set by hand.
		if (right.lengthSq() < 1e-8) return;
		right.normalize();
		const up = FIT_UP.crossVectors(right, eye).normalize();

		// The viewport's own angles: the projection has already been sheared so that the camera
		// axis runs through the middle of it, which is what lets this ignore the canvas entirely.
		const fitV = Math.tan((VIEW_FOV * Math.PI) / 360);
		const fitH = fitV * (this.viewport.width / this.viewport.height);

		// A corner sits at depth `at - u.eye` and at a fixed offset across the screen, so the
		// distance it needs is `u.eye + offset / tan(half fov)`. The room wants the largest.
		let need = 0;
		for (let corner = 0; corner < 8; corner++) {
			const u = FIT_CORNER.set(
				(corner & 1 ? 0.5 : -0.5) * s.width,
				(corner & 2 ? 0.5 : -0.5) * s.depth,
				corner & 4 ? s.height : 0
			).sub(target);
			const along = u.dot(eye);
			need = Math.max(
				need,
				along + Math.abs(u.dot(up)) / fitV,
				along + Math.abs(u.dot(right)) / fitH
			);
		}

		const at = Math.max(
			this.controls.minDistance,
			Math.min(this.controls.maxDistance, need * FIT_MARGIN)
		);
		pos.copy(target).addScaledVector(eye, at);
	}
}
