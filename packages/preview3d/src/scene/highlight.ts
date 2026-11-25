import * as THREE from 'three';
import type { LampLight, LightPixels, MatrixLight, RoomModel, Vec3 } from '@mv/core';
import { entryLed, ledAt, panelChevrons, stripChevrons, type Chevron } from '../cues.ts';
import { bulbCentre } from '../emitters.ts';
import { panelFrame } from '../panels.ts';
import {
	HALO_FRAGMENT,
	HALO_VERTEX,
	LAMP_OUTLINE_VERTEX,
	OUTLINE_FRAGMENT,
	PANEL_OUTLINE_VERTEX
} from '../shaders/highlight.ts';
import { STRIP_STANDOFF, bandVertices, lengthOf, stepsOf, type StripPiece } from '../strips.ts';
import { add, cross, normalize, perpendicular, scale, sub } from '../vec.ts';
import { bandGeometry } from './bands.ts';

/** Cool white reads against any show colour without being one of them. */
const HALO = new THREE.Color(0.5, 0.56, 0.7);
const MARK = new THREE.Color(0.75, 0.82, 1);

/** Between a light and its mount, so nothing drawn there covers an LED. */
const BEHIND = STRIP_STANDOFF / 2;
/** Just in front of a panel, where chevrons fall between its dots. */
const IN_FRONT = STRIP_STANDOFF + 0.002;
/** Metres across a strip's halo, and past a panel's or lamp's edge. */
const HALO_WIDTH = 0.12;
const HALO_REACH = 0.07;
/** Metres out from a panel's edge where its outline is brightest. */
const PANEL_EDGE = 0.015;
/** Radii of the ring round a strip's entry LED, clear of the ribbon's own width. */
const ENTRY_INNER = 0.035;
const ENTRY_OUTER = 0.05;

/** Halo pulses a second; 0.6 m apart in the shader, so they run at 0.9 m/s. */
export const PULSE_RATE = 1.5;

interface ChevronSize {
	/** Metres across, along, and the width of each arm. */
	span: number;
	depth: number;
	width: number;
}

const STRIP_CHEVRON: ChevronSize = { span: 0.075, depth: 0.03, width: 0.009 };

/**
 * A light picked out for setup: a soft halo round it, a ring round the LED its data enters at
 * and chevrons the way the data runs. The LEDs stay as the show paints them. `pulse` is the
 * halo's phase, 0..1.
 */
export function buildHighlight(
	model: RoomModel,
	pieces: readonly StripPiece[],
	id: string,
	pulse: { value: number }
): THREE.Group | null {
	const light = model.layout.lights.find((l) => l.id === id);
	if (!light) return null;
	if (light.kind === 'lamp') return new THREE.Group().add(lampOutline(light));

	const index = model.pixels.findIndex((p) => p.light.id === id);
	const pixels: LightPixels | undefined = model.pixels[index];
	if (!pixels) return null;
	const entry = entryLed(pixels);

	if (light.kind === 'matrix') {
		const f = panelFrame(light);
		const cell = Math.max(f.cellU, f.cellV);
		const inner = Math.max(0.9 * cell, ENTRY_INNER);
		const size = { span: 0.5 * cell, depth: 0.25 * cell, width: 0.07 * cell };
		const out: number[] = [];
		// Behind the panel, which hides the part over its own LEDs.
		annulus(out, ledAt(pixels, entry), f.normal, inner, inner + Math.max(0.3 * cell, 0.012));
		for (const c of panelChevrons(light, pixels)) chevron(out, c, size, IN_FRONT);
		return new THREE.Group().add(panelOutline(light), marks(out));
	}

	const own = pieces.filter((p) => p.light === index);
	const first = own.find((p) => entry >= p.from && entry < p.from + p.count);
	if (!first) return null;
	const reversed = light.wiring?.reversed === true;
	const out: number[] = [];
	annulus(out, ledAt(pixels, entry), first.normal, ENTRY_INNER, ENTRY_OUTER);
	for (const c of stripChevrons(own, reversed)) chevron(out, c, STRIP_CHEVRON, BEHIND);
	return new THREE.Group().add(stripHalo(own, reversed, pulse), marks(out));
}

/** Every piece's band, `along` counting metres from where the data enters. */
function stripHalo(
	pieces: readonly StripPiece[],
	reversed: boolean,
	pulse: { value: number }
): THREE.Mesh {
	const total = pieces.reduce((s, p) => s + lengthOf(p.shape), 0);
	const bands: Float32Array[] = [];
	const along: number[] = [];
	let walked = 0;
	for (const p of pieces) {
		const length = lengthOf(p.shape);
		if (length > 1e-6) {
			const steps = stepsOf(p);
			bands.push(bandVertices(p.shape, p.normal, HALO_WIDTH, BEHIND, steps));
			for (let j = 0; j <= steps; j++) {
				const a = walked + (j / steps) * length;
				const metres = reversed ? total - a : a;
				along.push(metres, metres);
			}
		}
		walked += length;
	}
	const geometry = bandGeometry(bands);
	geometry.setAttribute('along', new THREE.BufferAttribute(new Float32Array(along), 1));
	return new THREE.Mesh(
		geometry,
		glowMaterial({
			uniforms: { uColor: { value: HALO }, uPulse: pulse },
			vertexShader: HALO_VERTEX,
			fragmentShader: HALO_FRAGMENT
		})
	);
}

function panelOutline(light: MatrixLight): THREE.Mesh {
	const f = panelFrame(light);
	const centre = add(f.centre, scale(f.normal, BEHIND - STRIP_STANDOFF));
	const w = f.halfWidth + HALO_REACH;
	const h = f.halfHeight + HALO_REACH;
	const position = new Float32Array(12);
	[
		[-1, -1],
		[1, -1],
		[-1, 1],
		[1, 1]
	].forEach(([su, sv], k) => {
		for (let d = 0; d < 3; d++) {
			position[k * 3 + d] = centre[d] + f.right[d] * su * w + f.up[d] * sv * h;
		}
	});
	const uv = new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]);
	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute('position', new THREE.BufferAttribute(position, 3));
	geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
	geometry.setIndex([0, 1, 2, 1, 3, 2]);
	return new THREE.Mesh(
		geometry,
		glowMaterial({
			uniforms: {
				uColor: { value: HALO },
				uHalf: { value: new THREE.Vector2(f.halfWidth, f.halfHeight) },
				// A panel does not hide what is behind it, so the glow starts at its edge.
				uRadius: { value: PANEL_EDGE },
				uReach: { value: HALO_REACH }
			},
			vertexShader: PANEL_OUTLINE_VERTEX,
			fragmentShader: OUTLINE_FRAGMENT
		})
	);
}

function lampOutline(lamp: LampLight): THREE.Mesh {
	const radius = lamp.diameter / 2;
	const tube = lamp.mode === 'summary' && lamp.height > 0;
	const [x, y, z] = tube ? lamp.at : bulbCentre(lamp);
	const mesh = new THREE.Mesh(
		new THREE.PlaneGeometry(2, 2),
		glowMaterial({
			uniforms: {
				uColor: { value: HALO },
				uBottom: { value: new THREE.Vector3(x, y, z) },
				uLength: { value: tube ? lamp.height : 0 },
				uRadius: { value: radius },
				uReach: { value: radius + HALO_REACH }
			},
			vertexShader: LAMP_OUTLINE_VERTEX,
			fragmentShader: OUTLINE_FRAGMENT
		})
	);
	// The vertex shader places it, so its own bounds say nothing about where it is.
	mesh.frustumCulled = false;
	return mesh;
}

function glowMaterial(parameters: THREE.ShaderMaterialParameters): THREE.ShaderMaterial {
	return new THREE.ShaderMaterial({
		...parameters,
		transparent: true,
		blending: THREE.AdditiveBlending,
		depthWrite: false,
		side: THREE.DoubleSide,
		toneMapped: false
	});
}

/** Flat triangles, drawn over each other without adding up where chevron arms meet. */
function marks(triangles: readonly number[]): THREE.Mesh {
	const geometry = new THREE.BufferGeometry();
	geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(triangles), 3));
	return new THREE.Mesh(
		geometry,
		new THREE.MeshBasicMaterial({
			color: MARK,
			transparent: true,
			depthWrite: false,
			side: THREE.DoubleSide,
			toneMapped: false
		})
	);
}

/** A ring round `at`, `BEHIND` along the normal. */
function annulus(out: number[], at: Vec3, normal: Vec3, inner: number, outer: number): void {
	const a = perpendicular(normal);
	const b = cross(normal, a);
	const centre = add(at, scale(normal, BEHIND));
	const steps = 40;
	const point = (j: number, r: number): Vec3 => {
		const t = (j / steps) * Math.PI * 2;
		return add(centre, add(scale(a, Math.cos(t) * r), scale(b, Math.sin(t) * r)));
	};
	for (let j = 0; j < steps; j++) {
		const [i0, o0] = [point(j, inner), point(j, outer)];
		const [i1, o1] = [point(j + 1, inner), point(j + 1, outer)];
		out.push(...i0, ...o0, ...i1, ...o0, ...o1, ...i1);
	}
}

/** Two arms meeting at a tip half the depth ahead of the chevron's middle. */
function chevron(out: number[], c: Chevron, size: ChevronSize, lift: number): void {
	const side = normalize(cross(c.normal, c.dir));
	const middle = add(c.at, scale(c.normal, lift));
	const tip = add(middle, scale(c.dir, size.depth / 2));
	const back = add(middle, scale(c.dir, -size.depth / 2));
	for (const s of [-1, 1]) {
		const end = add(back, scale(side, (s * size.span) / 2));
		const w = scale(normalize(cross(c.normal, sub(end, tip))), size.width / 2);
		const [a0, a1, b0, b1] = [add(tip, w), sub(tip, w), add(end, w), sub(end, w)];
		out.push(...a0, ...a1, ...b0, ...a1, ...b1, ...b0);
	}
}
