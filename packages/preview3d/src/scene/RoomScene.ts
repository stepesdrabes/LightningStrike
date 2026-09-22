import * as THREE from 'three';
import type { RoomModel } from '@mv/core';
import { layoutAtlas } from '../atlas.ts';
import { MAX_LINES, MAX_POINTS, lineEmitters, strongest, type PointEmitter } from '../emitters.ts';
import { LedTexture } from '../LedTexture.ts';
import { LIGHTING } from '../lighting.ts';
import { stripPieces, type StripPiece } from '../strips.ts';
import { buildHighlight } from './highlight.ts';
import { LAMP_PREVIEW_GAIN, buildLamp, lampFixture, type LampFixture } from './lamps.ts';
import { MatrixPanel } from './panel.ts';
import { buildRibbons } from './ribbons.ts';
import { buildRoom } from './room.ts';
import { SurfaceFactory } from './surfaceMaterial.ts';

/** A lamp the show paints as one pixel. */
interface Bulb extends LampFixture {
	led: number;
	level: number;
}

/** Something that lights the room from a point, and the colour it does it in. */
interface Glow {
	emitter: PointEmitter;
	colour: THREE.Color;
}

/** Everything one room draws: the box, its lights, and the textures they share. */
export class RoomScene {
	readonly root = new THREE.Group();

	private readonly model: RoomModel;
	private readonly pieces: StripPiece[];
	private readonly led: LedTexture;
	private readonly surfaces: SurfaceFactory;
	private readonly panels: MatrixPanel[] = [];
	/** Summary lamps, in `model.lamps` order, which is the order their bytes arrive in. */
	private readonly lamps: LampFixture[];
	private readonly bulbs: Bulb[] = [];
	/** The point emitters the surfaces take, in their uniform order. */
	private readonly glows: Glow[];
	private readonly needs: number;
	private readonly pulse: { value: number };
	private readonly sum = new Float64Array(4);
	private highlight: THREE.Group | null = null;

	/** `pulse` phases the highlight, shared so it runs on smoothly across rebuilt rooms. */
	constructor(model: RoomModel, pulse: { value: number }) {
		this.model = model;
		this.pulse = pulse;
		this.pieces = stripPieces(model.pixels);
		const atlas = layoutAtlas(this.pieces, model.pixels);
		this.led = new LedTexture(atlas);

		model.pixels.forEach(({ light, index }) => {
			if (light.kind === 'matrix') this.panels.push(new MatrixPanel(light, index));
			if (light.kind === 'lamp') {
				this.bulbs.push({ ...lampFixture(light), led: index[0], level: light.level ?? 1 });
			}
		});
		this.lamps = model.lamps.map(lampFixture);
		this.needs = Math.max(
			this.led.needs,
			...this.panels.map((p) => p.needs),
			...this.bulbs.map((b) => (b.led + 1) * 3)
		);

		this.glows = strongest<Glow>(
			[...this.lamps, ...this.bulbs, ...this.panels],
			MAX_POINTS,
			(g) => g.emitter.gain
		);
		this.surfaces = new SurfaceFactory(
			this.led.texture,
			strongest(lineEmitters(this.pieces, atlas), MAX_LINES, (l) => l.weight),
			this.glows.map((g) => g.emitter)
		);

		this.root.add(...buildRoom(model.layout, this.surfaces));
		for (const lamp of [...this.lamps, ...this.bulbs]) {
			this.root.add(buildLamp(lamp, this.surfaces, this.glows.indexOf(lamp)));
		}
		for (const panel of this.panels) this.root.add(panel.mesh);
		const ribbons = buildRibbons(this.pieces, atlas, this.led.texture);
		if (ribbons) this.root.add(ribbons);
	}

	/** `lamps` holds each summary lamp's gamma-encoded RGB pixel. Zero allocations. */
	update(bytes: Uint8Array, lamps?: Uint8Array): void {
		if (lamps) {
			const g = LAMP_PREVIEW_GAIN / 255;
			for (let i = 0; i < this.lamps.length && lamps.length >= i * 3 + 3; i++) {
				const o = i * 3;
				this.lamps[i].colour.setRGB(lamps[o] * g, lamps[o + 1] * g, lamps[o + 2] * g);
			}
		}

		// A frame for another room could read past its end; the last one stands until they agree.
		if (this.model.pixels.length > 0 && bytes.length >= this.needs) {
			const sum = this.sum.fill(0);
			this.led.upload(bytes, sum);
			for (const panel of this.panels) panel.upload(bytes, sum);
			for (const bulb of this.bulbs) {
				const i = bulb.led * 3;
				const r = bytes[i] * bulb.level;
				const g = bytes[i + 1] * bulb.level;
				const b = bytes[i + 2] * bulb.level;
				sum[0] += r;
				sum[1] += g;
				sum[2] += b;
				sum[3] += 1;
				bulb.colour.setRGB(r / 255, g / 255, b / 255);
			}
			const k = LIGHTING.frameAmbient / (sum[3] * 255);
			this.surfaces.ambient.value.setRGB(sum[0] * k, sum[1] * k, sum[2] * k);
		} else if (this.model.borrowed) {
			// With no LEDs of its own, the room's wash is its lamps'.
			let r = 0;
			let g = 0;
			let b = 0;
			for (const lamp of this.lamps) {
				r += lamp.colour.r;
				g += lamp.colour.g;
				b += lamp.colour.b;
			}
			const k = this.lamps.length > 0 ? LIGHTING.frameAmbient / this.lamps.length : 0;
			this.surfaces.ambient.value.setRGB(r * k, g * k, b * k);
		}

		const colours = this.surfaces.pointColor;
		for (let i = 0; i < this.glows.length; i++) {
			const c = this.glows[i].colour;
			colours[i * 3] = c.r;
			colours[i * 3 + 1] = c.g;
			colours[i * 3 + 2] = c.b;
		}
	}

	setHighlight(id: string | null): void {
		if (this.highlight) {
			this.root.remove(this.highlight);
			disposeTree(this.highlight);
			this.highlight = null;
		}
		if (id === null) return;
		this.highlight = buildHighlight(this.model, this.pieces, id, this.pulse);
		if (this.highlight) this.root.add(this.highlight);
	}

	dispose(): void {
		this.led.dispose();
		for (const panel of this.panels) panel.dispose();
		disposeTree(this.root);
	}
}

function disposeTree(root: THREE.Object3D): void {
	const done = new Set<object>();
	root.traverse((o) => {
		const mesh = o as THREE.Mesh;
		if (mesh.geometry && !done.has(mesh.geometry)) {
			done.add(mesh.geometry);
			mesh.geometry.dispose();
		}
		const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
		for (const m of materials) {
			if (m && !done.has(m)) {
				done.add(m);
				m.dispose();
			}
		}
	});
}
