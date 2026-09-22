import * as THREE from 'three';
import { describe, expect, it } from 'vitest';
import { DEFAULT_ROOM, roomModel, type Light, type RoomLayout } from '@mv/core';
import { LIGHTING } from '../lighting.ts';
import { LAMP_PREVIEW_GAIN } from './lamps.ts';
import { RoomScene } from './RoomScene.ts';

const room = (lights: Light[]): RoomLayout => ({
	width: 5,
	depth: 4,
	height: 2.6,
	front: 'south',
	lights
});

function meshes(scene: RoomScene): THREE.Mesh[] {
	const out: THREE.Mesh[] = [];
	scene.root.traverse((o) => {
		if ((o as THREE.Mesh).isMesh) out.push(o as THREE.Mesh);
	});
	return out;
}

function uniforms(mesh: THREE.Mesh): Record<string, THREE.IUniform> {
	return (mesh.material as THREE.ShaderMaterial).uniforms ?? {};
}

/** Every surface shares the room's wash; any one of them shows it. */
function surfaces(scene: RoomScene): THREE.Mesh[] {
	return meshes(scene).filter((m) => uniforms(m).uAmbient);
}

function build(layout: RoomLayout) {
	const model = roomModel(layout);
	return { model, scene: new RoomScene(model, { value: 0 }) };
}

describe('RoomScene', () => {
	it('washes the Frame in its average colour and lights its lamp as before', () => {
		const { model, scene } = build(DEFAULT_ROOM);
		const bytes = new Uint8Array(model.geometry.count * 3);
		for (let i = 0; i < model.geometry.count; i++) {
			bytes.set([i % 256, 128, 255 - (i % 256)], i * 3);
		}
		scene.update(bytes, new Uint8Array([200, 100, 50]));

		const sum = [0, 0, 0];
		bytes.forEach((b, i) => (sum[i % 3] += b));
		const k = LIGHTING.frameAmbient / (model.geometry.count * 255);
		const ambient = uniforms(surfaces(scene)[0]).uAmbient.value as THREE.Color;
		expect(ambient.r).toBeCloseTo(sum[0] * k, 9);
		expect(ambient.g).toBeCloseTo(sum[1] * k, 9);
		expect(ambient.b).toBeCloseTo(sum[2] * k, 9);

		const g = LAMP_PREVIEW_GAIN / 255;
		const tube = surfaces(scene).find((m) => uniforms(m).uEmitGain.value > 0)!;
		const glow = uniforms(tube).uGlow.value as THREE.Color;
		expect([glow.r, glow.g, glow.b]).toEqual([200 * g, 100 * g, 50 * g]);
		// The lamp is the room's one point, and cannot light its own tube.
		expect(Array.from(uniforms(tube).uPointColor.value)).toEqual(
			Array.from(new Float32Array([200 * g, 100 * g, 50 * g]))
		);
		expect(uniforms(tube).uSelf.value).toBe(0);
		expect(tube.position.toArray()).toEqual([-2.2, -1.7, 0.5]);

		const shader = (surfaces(scene)[0].material as THREE.ShaderMaterial).fragmentShader;
		expect(shader).toContain('#define LINES 5');
		expect(shader).toContain('#define SAMPLES 8');
		expect(shader).toContain('#define POINTS 1');
	});

	it('draws paths and rings as one mesh of ribbons, with a quad per straight run', () => {
		const { scene } = build(DEFAULT_ROOM);
		const ribbons = meshes(scene).filter((m) => m.geometry.getAttribute('strip'));
		expect(ribbons).toHaveLength(1);
		expect(ribbons[0].geometry.getAttribute('position').count).toBe(5 * 4);
		expect(ribbons[0].geometry.index!.count).toBe(5 * 6);
	});

	it('gathers panels and pixel lamps at their own levels into the wash', () => {
		const panel: Light = {
			id: 'panel',
			name: 'Panel',
			kind: 'matrix',
			centre: [0, 2, 1.4],
			width: 0.3,
			height: 0.3,
			columns: 4,
			rows: 4,
			mount: 'north',
			first: 'top-left',
			horizontal: true,
			serpentine: true,
			role: 'auto',
			level: 0.5
		};
		const bulb: Light = {
			id: 'bulb',
			name: 'Bulb',
			kind: 'lamp',
			at: [1, 1, 0],
			height: 1.2,
			diameter: 0.12,
			mode: 'pixel'
		};
		const { model, scene } = build(room([panel, bulb]));
		const bytes = new Uint8Array(model.geometry.count * 3).fill(101);
		scene.update(bytes);

		const texture = meshes(scene)
			.map((m) => uniforms(m).uPanel?.value as THREE.DataTexture | undefined)
			.find(Boolean)!;
		const data = texture.image.data as Uint8Array;
		expect(Array.from(data.subarray(0, 4))).toEqual([51, 51, 51, 255]);

		// Sixteen panel LEDs at round(101 / 2) and the bulb's one at 101.
		const ambient = uniforms(surfaces(scene)[0]).uAmbient.value as THREE.Color;
		const mean = (16 * 51 + 101) / 17;
		expect(ambient.r).toBeCloseTo((LIGHTING.frameAmbient * mean) / 255, 9);

		// The bulb and the panel's average, in the order they were taken.
		const points = uniforms(surfaces(scene)[0]).uPointColor.value as Float32Array;
		const [lit, dimmed] = [101 / 255, 51 / 255];
		expect(Array.from(points)).toEqual(
			Array.from(new Float32Array([lit, lit, lit, dimmed, dimmed, dimmed]))
		);
	});

	it('keeps the last frame when the bytes belong to a different room', () => {
		const { model, scene } = build(DEFAULT_ROOM);
		scene.update(new Uint8Array(model.geometry.count * 3).fill(255));
		const ambient = uniforms(surfaces(scene)[0]).uAmbient.value as THREE.Color;
		expect(ambient.r).toBeCloseTo(LIGHTING.frameAmbient, 9);
		scene.update(new Uint8Array(30));
		expect(ambient.r).toBeCloseTo(LIGHTING.frameAmbient, 9);
	});

	it('washes a borrowed room in its lamps alone and draws no LEDs', () => {
		const lamp = (id: string, x: number): Light => ({
			id,
			name: id,
			kind: 'lamp',
			at: [x, 0, 0],
			height: 1,
			diameter: 0.2,
			mode: 'summary'
		});
		const { model, scene } = build(room([lamp('a', -1), lamp('b', 1)]));
		expect(model.borrowed).toBe(true);
		const bytes = new Uint8Array(model.geometry.count * 3).fill(255);
		scene.update(bytes, new Uint8Array([255, 0, 0, 0, 0, 255]));
		const ambient = uniforms(surfaces(scene)[0]).uAmbient.value as THREE.Color;
		const half = (LIGHTING.frameAmbient * LAMP_PREVIEW_GAIN) / 2;
		expect([ambient.r, ambient.g, ambient.b].map((v) => +v.toFixed(9))).toEqual(
			[half, 0, half].map((v) => +v.toFixed(9))
		);
		expect(meshes(scene).some((m) => m.geometry.getAttribute('strip'))).toBe(false);
	});

	it('caps the lights a surface integrates', () => {
		const lights: Light[] = Array.from({ length: 30 }, (_, i) => ({
			id: `run${i}`,
			name: `Run ${i}`,
			kind: 'path',
			points: [
				[-2, -1.8 + i * 0.12, 2.5],
				[2, -1.8 + i * 0.12, 2.5]
			],
			counts: [20],
			closed: false,
			density: 60,
			mount: 'ceiling',
			role: 'auto'
		}));
		for (let i = 0; i < 10; i++) {
			lights.push({
				id: `bulb${i}`,
				name: `Bulb ${i}`,
				kind: 'lamp',
				at: [i * 0.3 - 1.5, 1.9, 0],
				height: 0.5,
				diameter: 0.1,
				mode: 'pixel'
			});
		}
		const { scene } = build(room(lights));
		const shader = (surfaces(scene)[0].material as THREE.ShaderMaterial).fragmentShader;
		expect(shader).toContain('#define LINES 24');
		expect(shader).toContain('#define SAMPLES 4');
		expect(shader).toContain('#define POINTS 8');
		// Two bulbs lost their spill to the cap, not their glow.
		const bulbs = surfaces(scene).filter((m) => uniforms(m).uEmitGain.value > 0);
		expect(bulbs).toHaveLength(10);
		expect(bulbs.filter((m) => uniforms(m).uSelf.value < 0)).toHaveLength(2);
	});

	it('picks out every kind of light and lets it go again', () => {
		const lights: Light[] = [
			...DEFAULT_ROOM.lights,
			{
				id: 'ring',
				name: 'Ring',
				kind: 'ring',
				centre: [0, 0, 2.5],
				radius: 0.5,
				count: 30,
				startAngle: 0,
				clockwise: true,
				mount: 'ceiling',
				role: 'field'
			},
			{
				id: 'panel',
				name: 'Panel',
				kind: 'matrix',
				centre: [0, 2, 1.4],
				width: 0.5,
				height: 0.5,
				columns: 6,
				rows: 6,
				mount: 'north',
				first: 'bottom-left',
				horizontal: false,
				serpentine: false,
				role: 'auto'
			},
			{
				id: 'bulb',
				name: 'Bulb',
				kind: 'lamp',
				at: [1, 1, 0],
				height: 1,
				diameter: 0.1,
				mode: 'pixel'
			}
		];
		const { scene } = build({ ...DEFAULT_ROOM, lights });
		const before = scene.root.children.length;
		for (const id of ['frame', 'beam', 'bounce', 'ring', 'panel', 'bulb']) {
			scene.setHighlight(id);
			expect(scene.root.children).toHaveLength(before + 1);
			const drawn = meshes(scene).map((m) => m.geometry.getAttribute('position').array);
			expect(drawn.every((a) => a.every(Number.isFinite))).toBe(true);
		}
		scene.setHighlight('nobody');
		expect(scene.root.children).toHaveLength(before);
		scene.setHighlight('ring');
		scene.setHighlight(null);
		expect(scene.root.children).toHaveLength(before);
		scene.dispose();
	});
});
