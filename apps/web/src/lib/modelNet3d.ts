import * as THREE from 'three';
import { HEARING_HEADS, type HearingInner } from '@mv/core';
import type { StrikerGraph } from '$lib/types.ts';

/** Neurons drawn per stream: as many as the recorder keeps. */
export const RING = 12;

const NAMES: Record<string, string> = { hat: 'hats', cymbal: 'cymbals', tom: 'toms' };

/** The output neurons at the end of the tube, as `HEARING_HEADS` indexes. */
export const OUTPUTS = (['kick', 'snare', 'hat', 'cymbal', 'tom', 'beat', 'downbeat', 'bass'] as const).map((head) => ({
	head: HEARING_HEADS.indexOf(head),
	label: NAMES[head] ?? head
}));

/** CSS pixels kept right of the output neurons for their names. */
const LABEL_PX = 50;
/** Output neurons' learned inputs drawn, the strongest of the kept neurons. */
const READOUT_INPUTS = 3;

/** One layer: a ring of its stream's kept neurons, placed along the flow. */
export interface Layer {
	id: string;
	stage: string;
	space: number;
	x: number;
	radius: number;
	nodes: THREE.Vector3[];
}

/** A stretch of layers of one stage, for its label. */
export interface StageSpan {
	stage: string;
	label: string;
	from: number;
	to: number;
	/** Its share of a chunk's arithmetic and where that share starts in a pass. */
	share: number;
	start: number;
}

/** What one frame shows. */
export interface NetFrame {
	/** Each kept neuron's activity in -1..1, [layer][k]: its swing against the layer's usual, signed by the side of its mean. */
	values: (Float32Array | null)[];
	/** Each output neuron's probability, in `OUTPUTS` order. */
	outputs: Float32Array | null;
	/** The live pass's progress through each layer. */
	glow: Float32Array | null;
	turning: boolean;
	/** Ease toward the values; a still frame shows them as they are. */
	smooth: boolean;
}

type Segment = { a: [number, number]; b: [number, number]; weight: number; link: boolean };
type Readout = { input: number; output: number; weight: number };

const VERTEX = `
	attribute float size;
	attribute float halo;
	attribute vec3 tint;
	varying vec3 vTint;
	varying float vHalo;
	uniform float scale;
	uniform vec2 depth;
	void main() {
		vec4 mv = modelViewMatrix * vec4(position, 1.0);
		vTint = tint * (1.0 - 0.45 * clamp((-mv.z - depth.x) / (depth.y - depth.x), 0.0, 1.0));
		vHalo = halo;
		gl_PointSize = size * scale / -mv.z;
		gl_Position = projectionMatrix * mv;
	}
`;
// A crisp dot; only an active neuron gets a soft halo.
const FRAGMENT = `
	varying vec3 vTint;
	varying float vHalo;
	void main() {
		float d = length(gl_PointCoord - 0.5);
		if (d > 0.5) discard;
		float core = 1.0 - smoothstep(0.12, 0.18, d);
		float glow = vHalo * 0.3 * pow(1.0 - 2.0 * d, 2.0);
		float light = core + glow;
		gl_FragColor = vec4(vTint * light, light);
	}
`;

const rate = (hz: number) => (Number.isInteger(hz) ? `${hz} Hz` : `${hz.toFixed(1)} Hz`);

type Rgb = readonly [number, number, number];
const REST: Rgb = [0.15, 0.25, 0.46];
const BLUE: Rgb = [0.2, 0.5, 1];
const ICE: Rgb = [0.8, 0.92, 1];

/** Deep blue through the model's blue to ice, for activity 0..1. */
function ramp(v: number, out: number[]): number[] {
	const [a, b, u] = v < 0.6 ? [REST, BLUE, v / 0.6] : [BLUE, ICE, (v - 0.6) / 0.4];
	for (let i = 0; i < 3; i++) out[i] = a[i] + (b[i] - a[i]) * u;
	return out;
}

/**
 * Striker 2.0's residual streams as a turning tube: a ring of each stream's kept neurons at every
 * layer, a thread for each neuron through its stream's blocks and across the skips, the learned
 * links where one stream feeds the next, and the output neurons the last layer feeds. At rest only
 * the neurons show; a thread or link lights only while the neurons at both its ends are active.
 */
export class ModelNet3d {
	private readonly renderer: THREE.WebGLRenderer;
	private readonly scene = new THREE.Scene();
	private readonly group = new THREE.Group();
	private readonly camera = new THREE.PerspectiveCamera(26, 2, 0.1, 100);
	private readonly material = new THREE.ShaderMaterial({
		uniforms: { scale: { value: 250 }, depth: { value: new THREE.Vector2(10, 14) } }, vertexShader: VERTEX, fragmentShader: FRAGMENT,
		transparent: true, depthWrite: false, blending: THREE.AdditiveBlending
	});
	private nodes: THREE.Points | null = null;
	private ends: THREE.Points | null = null;
	private paths: THREE.LineSegments | null = null;
	private feeds: THREE.LineSegments | null = null;
	private segments: Segment[] = [];
	/** Line pieces each segment is drawn with: one, or a skip's arc. */
	private pieces: number[] = [];
	private readouts: Readout[] = [];
	private readoutLayer = -1;
	private outputPoints: THREE.Vector3[] = [];
	/** Eased activity of every kept neuron and output, and the side of its mean each was last on. */
	private shown = new Float32Array(0);
	private side = new Float32Array(0);
	private outShown = new Float32Array(OUTPUTS.length);
	private spin = 0;
	private last = 0;
	private width = 1;
	private outX = 1;
	layers: Layer[] = [];
	stages: StageSpan[] = [];

	constructor(canvas: HTMLCanvasElement) {
		this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
		this.renderer.setClearColor(0x000000, 0);
		this.scene.add(this.group);
	}

	private clear(): void {
		for (const parent of [this.group, this.scene]) {
			for (const child of [...parent.children]) {
				if (child === this.group) continue;
				parent.remove(child);
				if (child instanceof THREE.Points || child instanceof THREE.LineSegments) {
					child.geometry.dispose();
					if (child.material !== this.material) (child.material as THREE.Material).dispose();
				}
			}
		}
	}

	/** Lays the tube out from the graph; `inner` adds the learned links between kept neurons. */
	build(graph: StrikerGraph | null, inner: HearingInner | null): void {
		this.clear();
		const layers = graph?.layers ?? [];
		const spaces = graph?.spaces ?? [];
		const widest = Math.max(1, ...spaces.map((s) => s.width));
		const radius = (s: number) => 0.32 + 1.55 * ((spaces[s]?.width ?? 0) / widest) ** 2;
		// Layers sit evenly along the flow, with a gap where one stage hands to the next.
		let x = 0;
		this.layers = layers.map((l, i) => {
			if (i > 0) x += l.stage === layers[i - 1].stage ? 0.34 : 0.85;
			const r = radius(l.space);
			const turn = l.space * 0.4;
			const nodes = Array.from({ length: RING }, (_, k) => {
				const a = (k / RING) * Math.PI * 2 + turn;
				return new THREE.Vector3(x, r * Math.cos(a), r * Math.sin(a));
			});
			return { id: l.id, stage: l.stage, space: l.space, x, radius: r, nodes };
		});
		this.outX = x + 1.45;
		const spread = 1.45;
		this.outputPoints = OUTPUTS.map((_, j) => new THREE.Vector3(this.outX, spread - (2 * spread * j) / (OUTPUTS.length - 1), 0));

		const total = graph ? graph.stages.reduce((s, st) => s + st.macs, 0) : 1;
		const share = new Map((graph?.stages ?? []).map((s) => [s.id, s.macs / total]));
		this.stages = [];
		let start = 0;
		this.layers.forEach((l, i) => {
			const last = this.stages.at(-1);
			if (last && last.stage === l.stage) {
				last.to = i;
				return;
			}
			const space = spaces[l.space];
			const blocks = layers.filter((m) => m.stage === l.stage).length;
			const label = blocks > 1 ? `${rate(space.hz)} · ${blocks}` : rate(space.hz);
			// Pooling or spreading before a stage counts toward it.
			const lead = (graph?.stages ?? []).filter((s, j, all) => (s.kind === 'down' || s.kind === 'up')
				&& all[j + 1]?.id === l.stage).reduce((n, s) => n + s.macs / total, 0);
			const own = (share.get(l.stage) ?? 0) + lead;
			this.stages.push({ stage: l.stage, label, from: i, to: i, share: own, start });
			start += own;
		});

		// Threads: each kept neuron through consecutive layers of its stream, and across skips.
		this.segments = [];
		const lastOf = new Map<number, number>();
		this.layers.forEach((l, i) => {
			const prev = lastOf.get(l.space);
			if (prev !== undefined) {
				for (let k = 0; k < RING; k++) this.segments.push({ a: [prev, k], b: [i, k], weight: 1, link: false });
			}
			lastOf.set(l.space, i);
		});
		// Links: where a stream feeds the next, each neuron's two strongest learned inputs.
		for (const link of inner?.links ?? []) {
			const toLayer = this.layers.findIndex((l, i) => l.space === link.to && i > 0 && this.layers[i - 1].space !== link.to
				&& this.layers[i - 1].space === link.from);
			if (toLayer < 0) continue;
			link.weights.forEach((row, j) => {
				const best = row.map((w, i) => [w, i] as const).sort((p, q) => q[0] - p[0]).slice(0, 2);
				for (const [w, i] of best) this.segments.push({ a: [toLayer - 1, i], b: [toLayer, j], weight: w, link: true });
			});
		}
		// Readout: each output neuron's strongest learned inputs among the last layer's kept neurons.
		this.readouts = [];
		this.readoutLayer = inner?.readout && inner.readout.layer < this.layers.length ? inner.readout.layer : -1;
		if (inner?.readout && this.readoutLayer >= 0) {
			const { heads, weights } = inner.readout;
			OUTPUTS.forEach((o, j) => {
				const row = weights[heads.indexOf(o.head)];
				if (!row) return;
				const best = row.map((w, k) => [w, k] as const).sort((p, q) => Math.abs(q[0]) - Math.abs(p[0])).slice(0, READOUT_INPUTS);
				for (const [w, k] of best) this.readouts.push({ input: k, output: j, weight: w });
			});
		}

		const positions: number[] = [];
		for (const s of this.segments) {
			const p = this.layers[s.a[0]].nodes[s.a[1]];
			const q = this.layers[s.b[0]].nodes[s.b[1]];
			if (s.b[0] - s.a[0] > 1) {
				// A skip arcs outward around the layers it passes, staying on its neuron's angle.
				let from = p;
				for (let t = 1; t <= 14; t++) {
					const u = t / 14;
					const v = p.clone().lerp(q, u);
					const lift = 1 + Math.sin(u * Math.PI) * 0.55;
					v.y *= lift;
					v.z *= lift;
					positions.push(from.x, from.y, from.z, v.x, v.y, v.z);
					from = v;
				}
			} else positions.push(p.x, p.y, p.z, q.x, q.y, q.z);
		}
		this.pieces = this.segments.map((s) => (s.b[0] - s.a[0] > 1 ? 14 : 1));
		this.paths = this.lines(positions.length / 3);
		this.paths.geometry.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
		this.group.add(this.paths);
		// The output neurons stay still while the tube turns, so their inputs are placed each frame.
		this.feeds = this.lines(this.readouts.length * 2);
		this.scene.add(this.feeds);

		const all = this.layers.flatMap((l) => l.nodes);
		this.nodes = this.points(all);
		this.group.add(this.nodes);
		this.ends = this.points(this.outputPoints);
		this.scene.add(this.ends);
		this.shown = new Float32Array(all.length);
		this.side = new Float32Array(all.length).fill(1);
		this.outShown = new Float32Array(OUTPUTS.length);
		this.fit();
	}

	private lines(vertices: number): THREE.LineSegments {
		const geometry = new THREE.BufferGeometry();
		geometry.setAttribute('position', new THREE.BufferAttribute(new Float32Array(vertices * 3), 3));
		geometry.setAttribute('color', new THREE.BufferAttribute(new Float32Array(vertices * 4), 4));
		return new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({
			vertexColors: true, transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, fog: true
		}));
	}

	private points(at: THREE.Vector3[]): THREE.Points {
		const geometry = new THREE.BufferGeometry().setFromPoints(at);
		geometry.setAttribute('size', new THREE.BufferAttribute(new Float32Array(at.length), 1));
		geometry.setAttribute('halo', new THREE.BufferAttribute(new Float32Array(at.length), 1));
		geometry.setAttribute('tint', new THREE.BufferAttribute(new Float32Array(at.length * 3), 3));
		return new THREE.Points(geometry, this.material);
	}

	resize(w: number, h: number, dpr: number): void {
		this.width = Math.max(1, w);
		this.renderer.setPixelRatio(dpr);
		this.renderer.setSize(w, h, false);
		this.camera.aspect = w / Math.max(1, h);
		this.material.uniforms.scale.value = h * dpr * 0.75;
		this.fit();
	}

	/** Fits the tube and its outputs to the width left of their names, or the widest ring to the height. */
	private fit(): void {
		const tan = Math.tan((this.camera.fov * Math.PI) / 360);
		const left = -0.7;
		const right = this.outX + 0.25;
		const free = Math.max(0.5, (this.width - LABEL_PX) / this.width);
		const across = (right - left) / 2 / (tan * this.camera.aspect * free);
		const tall = Math.max(1, ...this.layers.map((l) => l.radius)) * 1.7 / tan;
		const distance = Math.max(across, tall);
		const half = distance * tan * this.camera.aspect;
		const cx = (left + right) / 2 + half * (1 - free);
		this.camera.position.set(cx, distance * 0.22, distance);
		this.camera.lookAt(cx, 0, 0);
		this.camera.updateProjectionMatrix();
		// The far side of the tube dims, so it reads as depth while it turns.
		const r = Math.max(1, ...this.layers.map((l) => l.radius));
		(this.material.uniforms.depth.value as THREE.Vector2).set(distance - r, distance + r);
		this.scene.fog = new THREE.Fog(0x000000, distance - r, distance + r * 2.4);
	}

	private screen(v: THREE.Vector3, w: number, h: number): { x: number; y: number } {
		const p = v.clone().project(this.camera);
		return { x: ((p.x + 1) / 2) * w, y: ((1 - p.y) / 2) * h };
	}

	/** Where a layer's centre falls across the canvas, for stage labels. */
	layerX(i: number, w: number): number {
		const l = this.layers[i];
		if (!l) return 0;
		return this.screen(new THREE.Vector3(l.nodes[0].x, -Math.max(...this.layers.map((m) => m.radius)) * 1.15, 0), w, 1).x;
	}

	/** Where each output neuron sits on a w x h canvas. */
	outputsAt(w: number, h: number): { x: number; y: number }[] {
		return this.outputPoints.map((p) => this.screen(p, w, h));
	}

	/** An output neuron's light as last drawn, 0..1. */
	outputLevel(j: number): number {
		return this.outShown[j] ?? 0;
	}

	/** Draws one frame. */
	render(now: number, frame: NetFrame): void {
		if (!this.nodes || !this.ends || !this.paths || !this.feeds) return;
		const dt = this.last ? Math.min(0.1, (now - this.last) / 1000) : 0;
		this.last = now;
		if (frame.turning) this.spin += dt * 0.16;
		this.group.rotation.x = this.spin;
		const ease = (from: number, to: number, attack: number, release: number) =>
			frame.smooth ? from + (to - from) * (1 - Math.exp(-dt / (to > from ? attack : release))) : to;

		const rgb = [0, 0, 0];
		const size = this.nodes.geometry.getAttribute('size') as THREE.BufferAttribute;
		const halo = this.nodes.geometry.getAttribute('halo') as THREE.BufferAttribute;
		const tint = this.nodes.geometry.getAttribute('tint') as THREE.BufferAttribute;
		let n = 0;
		this.layers.forEach((_, i) => {
			const wave = frame.glow?.[i] ?? 0;
			for (let k = 0; k < RING; k++, n++) {
				const target = frame.values[i]?.[k] ?? 0;
				if (target !== 0) this.side[n] = Math.sign(target);
				this.shown[n] = ease(this.shown[n], Math.max(Math.abs(target), wave), 0.03, 0.28);
				const v = this.shown[n];
				ramp(v * 0.85, rgb);
				const b = 0.75 + 0.45 * v;
				size.setX(n, 1 + 1.1 * v);
				halo.setX(n, v);
				tint.setXYZ(n, rgb[0] * b, rgb[1] * b, rgb[2] * b);
			}
		});
		size.needsUpdate = halo.needsUpdate = tint.needsUpdate = true;

		const endSize = this.ends.geometry.getAttribute('size') as THREE.BufferAttribute;
		const endHalo = this.ends.geometry.getAttribute('halo') as THREE.BufferAttribute;
		const endTint = this.ends.geometry.getAttribute('tint') as THREE.BufferAttribute;
		OUTPUTS.forEach((_, j) => {
			this.outShown[j] = ease(this.outShown[j], frame.outputs?.[j] ?? 0, 0.02, 0.22);
			const v = this.outShown[j];
			ramp(v, rgb);
			const b = 0.9 + 0.7 * v;
			endSize.setX(j, 1.4 + 1.4 * v);
			endHalo.setX(j, v);
			endTint.setXYZ(j, rgb[0] * b, rgb[1] * b, rgb[2] * b);
		});
		endSize.needsUpdate = endHalo.needsUpdate = endTint.needsUpdate = true;

		const at = (i: number, k: number) => this.shown[i * RING + k];
		const colours = this.paths.geometry.getAttribute('color') as THREE.BufferAttribute;
		let vertex = 0;
		this.segments.forEach((s, j) => {
			const both = Math.sqrt(at(s.a[0], s.a[1]) * at(s.b[0], s.b[1]));
			const v = s.link ? s.weight * both : both;
			ramp(v * 0.85, rgb);
			for (let p = 0; p < this.pieces[j] * 2; p++) colours.setXYZW(vertex++, rgb[0], rgb[1], rgb[2], v * 0.85);
		});
		colours.needsUpdate = true;

		// An output's input lights while it fires and the neuron feeding it pushes it up.
		const from = this.feeds.geometry.getAttribute('position') as THREE.BufferAttribute;
		const feedColours = this.feeds.geometry.getAttribute('color') as THREE.BufferAttribute;
		const cos = Math.cos(this.spin);
		const sin = Math.sin(this.spin);
		this.readouts.forEach((r, j) => {
			const p = this.layers[this.readoutLayer].nodes[r.input];
			const q = this.outputPoints[r.output];
			from.setXYZ(j * 2, p.x, p.y * cos - p.z * sin, p.y * sin + p.z * cos);
			from.setXYZ(j * 2 + 1, q.x, q.y, q.z);
			const index = this.readoutLayer * RING + r.input;
			const push = Math.max(0, this.side[index] * r.weight);
			const v = Math.min(1, this.outShown[r.output] * Math.sqrt(this.shown[index] * push) * 1.4);
			ramp(v, rgb);
			feedColours.setXYZW(j * 2, rgb[0], rgb[1], rgb[2], v * 0.5);
			feedColours.setXYZW(j * 2 + 1, rgb[0], rgb[1], rgb[2], v * 0.9);
		});
		from.needsUpdate = feedColours.needsUpdate = true;
		this.renderer.render(this.scene, this.camera);
	}

	dispose(): void {
		this.clear();
		this.material.dispose();
		this.renderer.dispose();
	}
}
