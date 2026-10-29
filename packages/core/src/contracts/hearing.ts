import type { ActivityStem } from './analysis.ts';

/**
 * What Striker 2.0 heard and answered for one song, saved beside it at preparation for the
 * model view: the graph's input features and the heads the lights use, quantised to bytes.
 * Nothing reads it to compose a show.
 */
export const HEARING_FORMAT = 'striker2-hearing';
export const HEARING_VERSION = 2;

/**
 * Real activations: in each residual stream, the neurons (channels) most active in the song's first
 * chunk, at every layer that writes into it.
 */
export interface HearingInner {
	/** Neurons kept per stream. */
	k: number;
	/** Rows a second; a faster layer keeps each row's most extreme value. */
	rate: number;
	layers: { id: string; stage: string; space: number }[];
	spaces: { width: number; hz: number; channels: number[] }[];
	/** Learned weights from one stream's kept neurons to the next one's, |w| summed over the kernel, as [to][from] in 0..1. */
	links: { stage: string; from: number; to: number; weights: number[][] }[];
	/**
	 * The output neurons and the layer they read: `heads` indexes `HEARING_HEADS`, `weights[head][k]`
	 * is the learned weight from that layer's kept neuron k, signed, scaled so the largest is 1.
	 */
	readout?: { layer: number; heads: number[]; weights: number[][] };
}

/** Heads kept per frame, each a sigmoid probability scaled to 255. */
export const HEARING_HEADS = [
	'kick', 'snare', 'hat', 'cymbal', 'tom',
	'kickLevel', 'snareLevel', 'hatLevel', 'cymbalLevel', 'tomLevel',
	'beat', 'downbeat', 'bass', 'bassLevel'
] as const;
export type HearingHead = (typeof HEARING_HEADS)[number];

export interface HearingHeader {
	format: typeof HEARING_FORMAT;
	version: number;
	/** The model's manifest name. */
	model: string;
	/** Song frames at `fps`. */
	frames: number;
	fps: number;
	/** Each feature column is the maximum over this many frames. */
	featureStep: number;
	/** Rows per front-end branch, lowest band first: A spans 20 Hz to 20 kHz, B 30 Hz to 1.2 kHz. */
	featureRows: { a: number; b: number };
	/** The feature value stored as 255; features are the front end's log10(1 + x). */
	featureCeiling: number;
	heads: readonly HearingHead[];
	activityStride: number;
	stems: readonly ActivityStem[];
	/** Null when the session could not expose them. */
	inner: HearingInner | null;
}

export interface Hearing {
	header: HearingHeader;
	/** Column-major: each column holds rows A then B. */
	features: Uint8Array;
	/** Frame-major: `heads.length` bytes a frame. */
	heads: Uint8Array;
	/** One row of stems every `activityStride` frames. */
	activity: Uint8Array;
	/** Row-major [rows][layers][k]: each activation as 128 + 32 standard deviations from its first-chunk mean. */
	inner: Uint8Array;
}

export function innerRows(h: HearingHeader): number {
	return h.inner ? Math.ceil((h.frames * h.inner.rate) / h.fps) : 0;
}

export function hearingSizes(h: HearingHeader): { features: number; heads: number; activity: number; inner: number } {
	return {
		features: Math.ceil(h.frames / h.featureStep) * (h.featureRows.a + h.featureRows.b),
		heads: h.frames * h.heads.length,
		activity: Math.ceil(h.frames / h.activityStride) * h.stems.length,
		inner: h.inner ? innerRows(h) * h.inner.layers.length * h.inner.k : 0
	};
}

/** JSON with every non-ASCII character escaped, so each byte is one character. */
function asciiJson(value: unknown): Uint8Array {
	const text = JSON.stringify(value)
		.replace(/[\u0080-￿]/g, (c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`);
	return Uint8Array.from(text, (c) => c.charCodeAt(0));
}

/** Before compression: header length (u32 LE), the header as ASCII JSON, then features, heads, activity, inner. */
export function writeHearing(h: Hearing): Uint8Array {
	const header = asciiJson(h.header);
	const parts = [header, h.features, h.heads, h.activity, h.inner];
	const out = new Uint8Array(4 + parts.reduce((n, p) => n + p.length, 0));
	new DataView(out.buffer).setUint32(0, header.length, true);
	let at = 4;
	for (const part of parts) {
		out.set(part, at);
		at += part.length;
	}
	return out;
}

export function readHearing(bytes: Uint8Array): Hearing {
	const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	const length = view.getUint32(0, true);
	let text = '';
	for (const b of bytes.subarray(4, 4 + length)) text += String.fromCharCode(b);
	const header = JSON.parse(text) as HearingHeader;
	if (header.format !== HEARING_FORMAT || header.version !== HEARING_VERSION) {
		throw new Error(`not a version ${HEARING_VERSION} ${HEARING_FORMAT}`);
	}
	const sizes = hearingSizes(header);
	let at = 4 + length;
	const take = (n: number) => bytes.subarray(at, (at += n));
	const hearing = {
		header, features: take(sizes.features), heads: take(sizes.heads), activity: take(sizes.activity),
		inner: take(sizes.inner)
	};
	if (at !== bytes.length) throw new Error(`a ${HEARING_FORMAT} of ${bytes.length} bytes, expected ${at}`);
	return hearing;
}
