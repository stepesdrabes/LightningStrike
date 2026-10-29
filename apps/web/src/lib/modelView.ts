import { HEARING_HEADS, innerRows, type Hearing, type HearingInner } from '@mv/core';
import { ModelNet3d, OUTPUTS, RING, type NetFrame } from '$lib/modelNet3d.ts';
import type { LiveChunk, LivePass } from '$lib/striker.svelte.ts';
import type { StrikerGraph } from '$lib/types.ts';

/** The view holds the finished pass this long before it returns to the playing song. */
export const LINGER_MS = 3500;
/** Seconds of song either side of now; Striker hears both, so the future is as true as the past. */
const SPAN = 3;
/** How long a returned chunk's activations take to play through the tube. */
const REPLAY_MS = 2400;

const HEAD = Object.fromEntries(HEARING_HEADS.map((h, i) => [h, i])) as Record<(typeof HEARING_HEADS)[number], number>;

interface Lane {
	label: string;
	head: number;
	level: number | null;
	note: string;
}

const LANES: Lane[] = [
	{ label: 'kick', head: HEAD.kick, level: HEAD.kickLevel, note: 'Kick onset probability, brighter for harder hits' },
	{ label: 'snare', head: HEAD.snare, level: HEAD.snareLevel, note: 'Snare onset probability, claps and rims included' },
	{ label: 'hats', head: HEAD.hat, level: HEAD.hatLevel, note: 'Hi-hat onset probability' },
	{ label: 'cymbals', head: HEAD.cymbal, level: HEAD.cymbalLevel, note: 'Crash and ride onset probability' },
	{ label: 'toms', head: HEAD.tom, level: HEAD.tomLevel, note: 'Tom onset probability' },
	{ label: 'bass', head: HEAD.bass, level: HEAD.bassLevel, note: 'Bass note onset probability' }
];

type Row =
	| { kind: 'lane'; y: number; h: number; lane: Lane; index: number }
	| { kind: 'beat'; y: number; h: number }
	| { kind: 'stems'; y: number; h: number };

export interface Layout {
	w: number;
	h: number;
	x0: number;
	x1: number;
	wave: { y: number; h: number };
	net: { y: number; h: number };
	rows: Row[];
}

export function layout(w: number, h: number): Layout {
	const x0 = 60;
	const x1 = w - 14;
	const wave = { y: 46, h: Math.round(h * 0.12) };
	const unit = Math.max(9, Math.round(h * 0.031));
	const rows: Row[] = [];
	const lanesH = unit * LANES.length + unit * 1.1 + unit * 1.4 + 4;
	let y = h - 8 - lanesH;
	const net = { y: wave.y + wave.h + 2, h: y - 4 - (wave.y + wave.h + 2) };
	LANES.forEach((lane, index) => {
		if (index === 5) {
			rows.push({ kind: 'beat', y, h: unit * 1.1 });
			y += unit * 1.1;
		}
		rows.push({ kind: 'lane', y, h: unit, lane, index });
		y += unit;
	});
	rows.push({ kind: 'stems', y: y + 4, h: unit * 1.4 });
	return { w, h, x0, x1, wave, net, rows };
}

type Rgb = [number, number, number];
const ICE: Rgb = [205, 228, 255];
const SKY: Rgb = [110, 175, 255];
const rgba = (c: Rgb, a: number) => `rgba(${c[0]},${c[1]},${c[2]},${a < 0 ? 0 : a > 1 ? 1 : a})`;
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);
const easeOut = (v: number) => 1 - (1 - clamp01(v)) ** 3;

/** The playing audio's envelope, 250 bins a second: minimum, maximum and RMS of (L + R) / 2. */
interface Envelope {
	of: AudioBuffer;
	rate: number;
	min: Float32Array;
	max: Float32Array;
	rms: Float32Array;
}

function envelope(audio: AudioBuffer): Envelope {
	const rate = 250;
	const step = audio.sampleRate / rate;
	const bins = Math.ceil(audio.length / step);
	const left = audio.getChannelData(0);
	const right = audio.numberOfChannels > 1 ? audio.getChannelData(1) : left;
	const min = new Float32Array(bins);
	const max = new Float32Array(bins);
	const rms = new Float32Array(bins);
	for (let b = 0; b < bins; b++) {
		const from = Math.floor(b * step);
		const to = Math.min(audio.length, Math.floor((b + 1) * step));
		let lo = 0;
		let hi = 0;
		let sq = 0;
		for (let s = from; s < to; s++) {
			const v = (left[s] + right[s]) / 2;
			if (v < lo) lo = v;
			if (v > hi) hi = v;
			sq += v * v;
		}
		min[b] = lo;
		max[b] = hi;
		rms[b] = Math.sqrt(sq / Math.max(1, to - from));
	}
	return { of: audio, rate, min, max, rms };
}

/** Signed activation bytes back to standard deviations. */
const deviation = (byte: number) => (byte - 128) / 32;

/**
 * Each kept neuron's own mean and spread over a recording, [rows][layers][k] bytes: the recorder
 * measured against the first chunk, and a neuron offset for the rest of the song would never go dark.
 */
function norms(bytes: Uint8Array, neurons: number): Float32Array {
	const out = new Float32Array(neurons * 2);
	const rows = bytes.length / neurons;
	for (let n = 0; n < neurons; n++) {
		let sum = 0;
		let sq = 0;
		for (let r = 0; r < rows; r++) {
			const z = deviation(bytes[r * neurons + n]);
			sum += z;
			sq += z * z;
		}
		const mean = sum / Math.max(1, rows);
		out[n * 2] = mean;
		out[n * 2 + 1] = Math.sqrt(Math.max(0.01, sq / Math.max(1, rows) - mean * mean));
	}
	return out;
}
const normCache = new WeakMap<Uint8Array, Float32Array>();

/** Spreads from a neuron's own mean where it starts to light, and where it is full. */
const QUIET = 1.2;
const FULL = 3.2;

/** A neuron's deviation as activity in -1..1 against its own mean and spread. */
function activity(z: number, norm: Float32Array, neuron: number): number {
	const s = (z - norm[neuron * 2]) / norm[neuron * 2 + 1];
	const v = clamp01((Math.abs(s) - QUIET) / (FULL - QUIET)) ** 1.5;
	return s < 0 ? -v : v;
}

/** A head's probability as an output neuron's light: the model's doubt stays dark. */
const fired = (byte: number) => clamp01((byte / 255 - 0.15) / 0.7);

/** What the view shows: the live pass, the playing song's recording, or the network at rest. */
export type Scene =
	| { mode: 'live'; pass: LivePass; fade: number }
	| { mode: 'replay'; hearing: Hearing; audio: AudioBuffer | null; position: number; playing: boolean }
	| { mode: 'idle' };

export class ModelPainter {
	private readonly canvas: HTMLCanvasElement;
	private readonly ctx: CanvasRenderingContext2D;
	readonly net: ModelNet3d;
	private dpr = 1;
	private lay: Layout = layout(1, 1);
	private graph: StrikerGraph | null = null;
	/** The kept neurons the tube is built for, so their links are drawn. */
	private built: HearingInner | null | undefined = undefined;
	private sans = 'system-ui, sans-serif';
	private label = '#71717a';
	private wave: Envelope | null = null;
	private inner: HearingInner | null = null;

	constructor(canvas: HTMLCanvasElement, gl: HTMLCanvasElement) {
		this.canvas = canvas;
		this.ctx = canvas.getContext('2d')!;
		this.net = new ModelNet3d(gl);
	}

	resize(w: number, h: number, graph: StrikerGraph | null): Layout {
		this.dpr = Math.min(2, window.devicePixelRatio || 1);
		this.canvas.width = Math.round(w * this.dpr);
		this.canvas.height = Math.round(h * this.dpr);
		this.lay = layout(w, h);
		this.graph = graph;
		const css = getComputedStyle(this.canvas);
		this.sans = css.getPropertyValue('--sans').trim() || this.sans;
		this.label = css.getPropertyValue('--subtle-foreground').trim() || this.label;
		this.net.build(graph, this.inner);
		this.built = this.inner;
		this.net.resize(w, this.lay.net.h, this.dpr);
		return this.lay;
	}

	/** The tube's links depend on which neurons were kept: a new song may keep others. */
	private use(inner: HearingInner | null): void {
		this.inner = inner;
		if (this.built === inner) return;
		this.built = inner;
		this.net.build(this.graph, inner);
		this.net.resize(this.lay.w, this.lay.net.h, this.dpr);
	}

	draw(scene: Scene, now: number, motion: boolean): void {
		const { ctx, lay } = this;
		ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
		ctx.clearRect(0, 0, lay.w, lay.h);
		let frame: NetFrame = { values: this.net.layers.map(() => null), outputs: null, glow: null, turning: motion, smooth: true };
		if (scene.mode === 'replay') {
			this.use(scene.hearing.header.inner);
			frame = { ...this.replay(scene), glow: null, turning: motion && scene.playing, smooth: scene.playing };
		} else if (scene.mode === 'live') {
			ctx.globalAlpha = scene.fade;
			this.use(scene.pass.structure);
			frame = { ...this.live(scene.pass, now), turning: motion, smooth: true };
		} else {
			this.baselines();
		}
		ctx.globalAlpha = 1;
		this.stageLabels();
		this.laneLabels(scene);
		this.net.render(now, frame);
		this.outputLabels();
	}

	/** The output neurons' names beside them, lit as they fire. */
	private outputLabels(): void {
		const { ctx, lay } = this;
		ctx.font = `400 9.5px ${this.sans}`;
		ctx.textAlign = 'left';
		ctx.textBaseline = 'middle';
		this.net.outputsAt(lay.w, lay.net.h).forEach((p, j) => {
			const lit = this.net.outputLevel(j);
			ctx.fillStyle = lit > 0.05 ? rgba(ICE, 0.45 + 0.55 * lit) : rgba([150, 180, 220], 0.45);
			ctx.fillText(OUTPUTS[j].label, p.x + 8, lay.net.y + p.y);
		});
	}

	private baselines(): void {
		const { ctx, lay } = this;
		ctx.fillStyle = rgba(SKY, 0.12);
		ctx.fillRect(lay.x0, lay.wave.y + lay.wave.h / 2, lay.x1 - lay.x0, 0.7);
		for (const row of lay.rows) ctx.fillRect(lay.x0, row.y + row.h - 1.5, lay.x1 - lay.x0, 0.6);
	}

	/** Each stage's rate and blocks under the tube, and where the audio comes in and the heads go out. */
	private stageLabels(): void {
		const { ctx, lay } = this;
		ctx.font = `400 9.5px ${this.sans}`;
		ctx.textBaseline = 'alphabetic';
		ctx.textAlign = 'center';
		const y = lay.net.y + lay.net.h - 3;
		let right = -Infinity;
		for (const s of this.net.stages) {
			const x = (this.net.layerX(s.from, lay.w) + this.net.layerX(s.to, lay.w)) / 2;
			const width = ctx.measureText(s.label).width;
			if (x - width / 2 < right + 6) continue;
			ctx.fillStyle = rgba([150, 180, 220], 0.6);
			ctx.fillText(s.label, x, y);
			right = x + width / 2;
		}
		ctx.textAlign = 'left';
		ctx.textBaseline = 'middle';
		ctx.fillStyle = this.label;
		ctx.fillText('audio', 14, lay.wave.y + lay.wave.h / 2);
	}

	private laneLabels(scene: Scene): void {
		const { ctx, lay } = this;
		ctx.textBaseline = 'middle';
		ctx.textAlign = 'left';
		const firing = scene.mode === 'replay' ? this.firing(scene.hearing, scene.position) : null;
		for (const row of lay.rows) {
			const name = row.kind === 'lane' ? row.lane.label : row.kind;
			const lit = row.kind === 'lane' ? firing?.[row.index] ?? 0 : 0;
			ctx.font = `${lit > 0 ? 500 : 400} 10.5px ${this.sans}`;
			ctx.fillStyle = lit > 0 ? rgba(ICE, 0.5 + 0.5 * lit) : this.label;
			ctx.fillText(name, 14, row.y + row.h / 2);
		}
	}

	private firing(h: Hearing, position: number): number[] {
		const width = h.header.heads.length;
		const f = Math.round(position * h.header.fps);
		return LANES.map((lane) => {
			let p = 0;
			for (let d = -6; d <= 2; d++) {
				const g = f + d;
				if (g >= 0 && g < h.header.frames) p = Math.max(p, h.heads[g * width + lane.head] / 255);
			}
			return p > 0.55 ? clamp01((p - 0.55) / 0.35) : 0;
		});
	}

	/** The playing song: its real waveform and heads, and its real activations and outputs at now. */
	private replay(scene: Extract<Scene, { mode: 'replay' }>): Pick<NetFrame, 'values' | 'outputs'> {
		const { ctx, lay } = this;
		const { hearing: h, position } = scene;
		if (scene.audio && this.wave?.of !== scene.audio) this.wave = envelope(scene.audio);
		const nowX = (lay.x0 + lay.x1) / 2;
		const cols = Math.ceil(lay.x1 - lay.x0);

		const wave = scene.audio ? this.wave : null;
		const mid = lay.wave.y + lay.wave.h / 2;
		const amp = lay.wave.h / 2 - 1;
		ctx.fillStyle = rgba(SKY, 0.1);
		ctx.fillRect(lay.x0, mid, lay.x1 - lay.x0, 0.6);
		if (wave) {
			for (let c = 0; c < cols; c++) {
				const t0 = position - SPAN + (c / cols) * 2 * SPAN;
				const b0 = Math.floor(t0 * wave.rate);
				const b1 = Math.max(b0 + 1, Math.floor((t0 + (2 * SPAN) / cols) * wave.rate));
				if (b1 <= 0 || b0 >= wave.min.length) continue;
				let lo = 0;
				let hi = 0;
				let r = 0;
				for (let b = Math.max(0, b0); b < Math.min(wave.min.length, b1); b++) {
					lo = Math.min(lo, wave.min[b]);
					hi = Math.max(hi, wave.max[b]);
					r = Math.max(r, wave.rms[b]);
				}
				const x = lay.x0 + c;
				const past = t0 < position ? 1 : 0.7;
				ctx.fillStyle = rgba(SKY, 0.4 * past);
				ctx.fillRect(x, mid - hi * amp, 1, (hi - lo) * amp);
				ctx.fillStyle = rgba(ICE, 0.75 * past);
				ctx.fillRect(x, mid - r * amp, 1, 2 * r * amp);
			}
		}

		const fps = h.header.fps;
		const width = h.header.heads.length;
		for (const row of lay.rows) {
			for (let c = 0; c < cols; c++) {
				const t0 = position - SPAN + (c / cols) * 2 * SPAN;
				const f0 = Math.floor(t0 * fps);
				const f1 = Math.max(f0 + 1, Math.floor((t0 + (2 * SPAN) / cols) * fps));
				if (f1 <= 0 || f0 >= h.header.frames) continue;
				const x = lay.x0 + c;
				const base = row.y + row.h - 1.5;
				if (row.kind === 'stems') {
					const a = Math.floor(Math.max(0, f0) / h.header.activityStride);
					for (let s = 0; s < 4; s++) {
						const p = h.activity[a * 4 + s] / 255;
						if (p < 0.08) continue;
						ctx.fillStyle = rgba(SKY, 0.5 * p * p);
						ctx.fillRect(x, row.y + (s * row.h) / 4, 1, row.h / 4 - 1);
					}
					continue;
				}
				let p = 0;
				let q = 0;
				let level = 0;
				for (let f = Math.max(0, f0); f < Math.min(h.header.frames, f1); f++) {
					if (row.kind === 'beat') {
						p = Math.max(p, h.heads[f * width + HEAD.beat]);
						q = Math.max(q, h.heads[f * width + HEAD.downbeat]);
					} else {
						const v = h.heads[f * width + row.lane.head];
						if (v > p) {
							p = v;
							level = row.lane.level === null ? 255 : h.heads[f * width + row.lane.level];
						}
					}
				}
				const pv = p / 255;
				if (row.kind === 'beat') {
					const qv = q / 255;
					if (pv > 0.04) {
						ctx.fillStyle = rgba(ICE, 0.15 + 0.5 * pv * pv);
						ctx.fillRect(x, base - pv * (row.h - 3) * 0.55, 1, pv * (row.h - 3) * 0.55);
					}
					if (qv > 0.04) {
						ctx.fillStyle = rgba(ICE, 0.2 + 0.8 * qv * qv);
						ctx.fillRect(x, base - qv * (row.h - 3), 1, qv * (row.h - 3));
					}
					continue;
				}
				ctx.fillStyle = rgba(SKY, 0.1);
				ctx.fillRect(x, base, 1, 0.6);
				if (pv < 0.03) continue;
				const height = pv * (row.h - 3);
				ctx.fillStyle = rgba(ICE, (0.12 + 0.88 * pv ** 1.6) * (0.55 + 0.45 * level / 255));
				ctx.fillRect(x, base - height, 1, height);
			}
		}
		this.fade();
		this.now(nowX);

		// The output neurons at now: each head's peak over the frames since the last screen frame.
		const f = Math.round(position * fps);
		const outputs = Float32Array.from(OUTPUTS, (o) => {
			let p = 0;
			for (let g = Math.max(0, f - 3); g <= Math.min(h.header.frames - 1, f + 1); g++) p = Math.max(p, h.heads[g * width + o.head]);
			return fired(p);
		});

		// The activations at now, between the recording's rows.
		const inner = h.header.inner;
		if (!inner) return { values: this.net.layers.map(() => null), outputs };
		const rows = innerRows(h.header);
		const at = (position * inner.rate);
		const r0 = Math.max(0, Math.min(rows - 1, Math.floor(at)));
		const r1 = Math.min(rows - 1, r0 + 1);
		const u = clamp01(at - r0);
		const stride = inner.layers.length * inner.k;
		let norm = normCache.get(h.inner);
		if (!norm) normCache.set(h.inner, (norm = norms(h.inner, stride)));
		const values = this.net.layers.map((_, li) => {
			const v = new Float32Array(RING);
			for (let k = 0; k < Math.min(RING, inner.k); k++) {
				const a = deviation(h.inner[r0 * stride + li * inner.k + k]);
				const b = deviation(h.inner[r1 * stride + li * inner.k + k]);
				v[k] = activity(a + (b - a) * u, norm, li * inner.k + k);
			}
			return v;
		});
		return { values, outputs };
	}

	/** Fades the time axis's ends into the panel. */
	private fade(): void {
		const { ctx, lay } = this;
		ctx.save();
		ctx.globalCompositeOperation = 'destination-out';
		for (const [from, to] of [[lay.x0, lay.x0 + 26], [lay.x1, lay.x1 - 26]] as const) {
			const g = ctx.createLinearGradient(from, 0, to, 0);
			g.addColorStop(0, 'rgba(0,0,0,1)');
			g.addColorStop(1, 'rgba(0,0,0,0)');
			ctx.fillStyle = g;
			ctx.fillRect(Math.min(from, to), lay.wave.y, 26, lay.wave.h);
			ctx.fillRect(Math.min(from, to), lay.rows[0].y - 2, 26, lay.h - lay.rows[0].y);
		}
		ctx.restore();
	}

	/** Now, through the waveform and the lanes. */
	private now(x: number): void {
		const { ctx, lay } = this;
		ctx.fillStyle = rgba(SKY, 0.85);
		ctx.fillRect(x - 0.5, lay.wave.y - 2, 1, lay.wave.h + 4);
		const last = lay.rows.at(-1)!;
		ctx.fillRect(x - 0.5, lay.rows[0].y - 2, 1, last.y + last.h - lay.rows[0].y + 2);
		ctx.beginPath();
		ctx.moveTo(x - 3.5, lay.wave.y - 7);
		ctx.lineTo(x + 3.5, lay.wave.y - 7);
		ctx.lineTo(x, lay.wave.y - 2.5);
		ctx.fill();
	}

	/**
	 * A song going through the network: each chunk's real waveform enters; while it runs, the
	 * stages light in data order, each for its share of the arithmetic of the chunk's measured time;
	 * when it returns, its real activations play through the tube and its real heads appear.
	 */
	private live(pass: LivePass, now: number): Pick<NetFrame, 'values' | 'outputs' | 'glow'> {
		const { ctx, lay } = this;
		const count = this.net.layers.length;
		const glow = new Float32Array(count);
		const none: (Float32Array | null)[] = new Array(count).fill(null);
		const chunk = pass.chunks.find((c) => c.outAt === null) ?? pass.chunks.at(-1);
		if (!chunk) {
			this.baselines();
			return { values: none, outputs: null, glow };
		}
		const prev = pass.chunks.find((c) => c.index === chunk.index - 1);
		const startedAt = Math.max(chunk.inAt ?? pass.beganAt, prev?.outAt ?? pass.beganAt);
		const lastMs = [...pass.chunks].reverse().find((c) => c.ms !== null && c !== chunk)?.ms ?? 2600;
		const expected = Math.max(400, lastMs * Math.min(1, chunk.frames / (pass.chunks[0]?.frames || chunk.frames)));
		const finished = chunk.outAt !== null;
		const progress = finished ? 1 : Math.min(0.985, (now - startedAt) / expected);
		const span = lay.x1 - lay.x0;

		const mid = lay.wave.y + lay.wave.h / 2;
		const amp = lay.wave.h / 2 - 1;
		ctx.fillStyle = rgba(SKY, 0.1);
		ctx.fillRect(lay.x0, mid, span, 0.6);
		if (chunk.wave && chunk.wave.length > 0) {
			const reveal = easeOut((now - (chunk.inAt ?? now)) / 450);
			const n = chunk.wave.length / 2;
			for (let c = 0; c < n * reveal; c++) {
				const lo = chunk.wave[c * 2] / 127.5 - 1;
				const hi = chunk.wave[c * 2 + 1] / 127.5 - 1;
				ctx.fillStyle = rgba(ICE, finished ? 0.55 : 0.35 + 0.35 * progress);
				ctx.fillRect(lay.x0 + (c / n) * span, mid - hi * amp, Math.max(0.8, span / n), (hi - lo) * amp);
			}
		}

		if (!finished) {
			// The arithmetic moves through the stages in data order; the one it is in burns.
			for (const s of this.net.stages) {
				const active = progress >= s.start && progress < s.start + s.share;
				const done = progress >= s.start + s.share;
				for (let i = s.from; i <= s.to; i++) {
					glow[i] = active ? 0.4 + 0.2 * (0.5 + 0.5 * Math.sin(now / 110 + i)) : done ? 0.1 : 0;
				}
			}
			this.baselines();
			this.fade();
			return { values: none, outputs: null, glow };
		}

		// Returned: the chunk's real activations and outputs play through it, start to end.
		const t = ((now - chunk.outAt!) % REPLAY_MS) / REPLAY_MS;
		let values = none;
		if (chunk.inner && chunk.inner.length > 0) {
			const width = chunk.inner.length / 24;
			const k = width / count;
			const col = Math.min(23, Math.floor(t * 24));
			let norm = normCache.get(chunk.inner);
			if (!norm) normCache.set(chunk.inner, (norm = norms(chunk.inner, width)));
			values = this.net.layers.map((_, li) => {
				const v = new Float32Array(RING);
				for (let j = 0; j < Math.min(RING, k); j++) v[j] = activity(deviation(chunk.inner![col * width + li * k + j]), norm, li * k + j);
				return v;
			});
		}
		let outputs: Float32Array | null = null;
		if (chunk.heads) {
			const width = chunk.heads.length / chunk.cols;
			const col = Math.min(chunk.cols - 1, Math.floor(t * chunk.cols));
			outputs = Float32Array.from(OUTPUTS, (o) => {
				let p = 0;
				for (let c = Math.max(0, col - 2); c <= col; c++) p = Math.max(p, chunk.heads![c * width + o.head]);
				return fired(p);
			});
		}
		// The waveform marks how far through the chunk the playback is.
		ctx.fillStyle = rgba(SKY, 0.85);
		ctx.fillRect(lay.x0 + t * span - 0.5, lay.wave.y - 2, 1, lay.wave.h + 4);
		this.liveHeads(chunk, now);
		this.fade();
		return { values, outputs, glow };
	}

	private liveHeads(chunk: LiveChunk, now: number): void {
		const { ctx, lay } = this;
		if (!chunk.heads || !chunk.activity) return;
		const width = chunk.heads.length / chunk.cols;
		const reveal = easeOut((now - chunk.outAt!) / 650);
		const span = lay.x1 - lay.x0;
		for (const row of lay.rows) {
			for (let c = 0; c < chunk.cols * reveal; c++) {
				const x = lay.x0 + (c / chunk.cols) * span;
				const w = Math.max(0.8, span / chunk.cols - 0.2);
				const base = row.y + row.h - 1.5;
				if (row.kind === 'stems') {
					for (let s = 0; s < 4; s++) {
						const p = chunk.activity[c * 4 + s] / 255;
						if (p < 0.08) continue;
						ctx.fillStyle = rgba(SKY, 0.5 * p * p);
						ctx.fillRect(x, row.y + (s * row.h) / 4, w, row.h / 4 - 1);
					}
					continue;
				}
				const p = (row.kind === 'beat' ? chunk.heads[c * width + HEAD.downbeat] : chunk.heads[c * width + row.lane.head]) / 255;
				if (p < 0.04) continue;
				ctx.fillStyle = rgba(ICE, 0.12 + 0.88 * p ** 1.6);
				ctx.fillRect(x, base - p * (row.h - 3), w, p * (row.h - 3));
			}
		}
	}

	/** What is under the pointer, for the hover note. */
	describe(x: number, y: number): string | null {
		const { lay } = this;
		if (y >= lay.wave.y - 4 && y <= lay.wave.y + lay.wave.h + 2) {
			return 'The audio, as Striker hears it: its front end turns it into 179 bands a hundred times a second.';
		}
		if (y > lay.net.y && y < lay.net.y + lay.net.h) {
			const outputs = this.net.outputsAt(lay.w, lay.net.h);
			if (outputs.length > 0 && x > outputs[0].x - 10) {
				let j = 0;
				outputs.forEach((p, i) => (Math.abs(p.y + lay.net.y - y) < Math.abs(outputs[j].y + lay.net.y - y) ? (j = i) : 0));
				return `The ${OUTPUTS[j].label} output neuron: Striker's ${OUTPUTS[j].label} probability, lit only when it hears one. Its lines are its strongest learned inputs from the last layer, lit while they push it up.`;
			}
			let best = this.net.stages[0];
			let distance = Infinity;
			for (const s of this.net.stages) {
				const cx = (this.net.layerX(s.from, lay.w) + this.net.layerX(s.to, lay.w)) / 2;
				if (Math.abs(cx - x) < distance) {
					distance = Math.abs(cx - x);
					best = s;
				}
			}
			if (!best) return null;
			const layer = this.net.layers[best.from];
			const space = this.graph?.spaces[layer.space];
			const channels = this.inner?.spaces[layer.space]?.channels;
			const kept = channels ? `channels ${channels.slice(0, 4).join(', ')}… of ${space?.width}` : `of ${space?.width} channels`;
			return `${best.stage}: ${best.to - best.from + 1} ${best.to > best.from ? 'layers' : 'layer'} of the ${space ? `${space.width}-wide ${space.hz} Hz` : ''} stream, ${Math.round(best.share * 100)}% of the work. Its dots are the stream's ${RING} most active neurons (${kept}), lit as their real activation swings; a thread lights where one stays active from layer to layer.`;
		}
		const row = lay.rows.find((r) => y >= r.y - 1 && y <= r.y + r.h + 1);
		if (!row) return null;
		if (row.kind === 'lane') return row.lane.note;
		if (row.kind === 'beat') return 'Beat probability; the tall marks are downbeats';
		return 'Stem activity: drums, bass, vocals, other';
	}

	dispose(): void {
		this.net.dispose();
	}
}

/** The figures for the view's caption. */
export function graphFacts(g: StrikerGraph): { parameters: string; attention: number; work: string } {
	const attention = g.stages.filter((s) => s.kind === 'transformer').reduce((n, s) => n + s.blocks, 0);
	const macs = g.stages.reduce((n, s) => n + s.macs, 0);
	return { parameters: `${Math.round(g.parameters / 1e6)}M`, attention, work: `${Math.round(macs / 1e9)}G` };
}
