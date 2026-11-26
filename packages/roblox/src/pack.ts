import type {
	Cue,
	Hit,
	LayerSpec,
	OnsetStream,
	SectionKind,
	SectionSpan,
	Show,
	ShowPalette,
	TrackAnalysis
} from '@mv/core';
import { BUILT_IN_EFFECTS, LAYER_ROLES, NUM_BANDS, decodeBase64, encodeBase64 } from '@mv/core';
import { HIT_EFFECT } from './effects.ts';

/**
 * LSPK, the Track Pack: what core's renderer reads from a song's analysis and show, in this
 * order, little-endian, with every value either stored exactly or refused by the encoder.
 *
 *   u8[4] 'LSPK' | u16 packVersion | u16 flags, bit 0 set when the grid is trusted (the host
 *       plays lounge otherwise); other bits are zero
 *   u32 n | header, n bytes of ASCII JSON (PackHeader): ids and versions for the compatibility
 *       check, `effects` for the subset check, `duration` (cue ends, where the audio stops) and
 *       `rates` (samples per second of the spectrum, level and stereo curves)
 *   tempo     f64 bpm, firstBeat, beatPeriod, beatsPerBar, downbeatPhase, phraseAnchorBar,
 *             barsPerPhrase | u32 bars | f64[bars + 1] barTimes. Every frame, cue and hit time
 *             goes through grid.ts; downbeatPhase offsets the envelopes, beatsPerBar and
 *             barsPerPhrase count beats and phrases, and the rest are grid.ts fallbacks.
 *   structure bars x (u8 section, u8 energy, sub, low, mid, air): f.section, and the levels
 *             the player falls back to without beat envelopes | u32 n | n x (u16 index,
 *             u8 kind, u16 startBar, u16 endBar, f64 startTime, f64 endTime): phrase origins
 *             and ordinals for f.phraseStart, section progress, drop times and build spans
 *   envelopes u32 n | u8[n] energy | u8[n * 4] bands: f.energy and f.bands, n may be 0. The
 *             player samples them on the bar grid, so beat times are not shipped.
 *   spectrum  u32 frames | u8 bands | u8[frames * bands], each byte less the same band one
 *             frame earlier, mod 256: f.spectrum
 *   level     u32 frames | u8[frames]: f.level, intro articulation and where the audio ends
 *   stereo    u32 frames | i8[frames] pan x 100 | u8[frames] width x 100: f.pan, f.panWidth
 *   onsets    kick, snare, hat: u32 n | f64[n] times | u8[n] levels x 100: drum edges and
 *             envelopes. A missing level is stored as the 1 the player reads for it.
 *   u32 n | show, n bytes of ASCII JSON (PackShow): palette, defaults, cues and hits as the
 *       player reads them, exposure for the director, ending for the player
 *
 * Section kinds are indices into KINDS. Lossless by construction upstream and checked here:
 * bar and beat levels are whole percentages 0..100, pan, width and onset levels whole
 * hundredths, spectrum and level bytes. Times and tempo stay f64. Not shipped: bar drum
 * counts, vocal and events, key, movements, moments, beats, bass, activity, loudness, the
 * spectrum's centre frequencies, what only gridTrust reads (the flag stands for it), and the
 * show's brief, notes, seed and palette names. A show with generated effects is refused.
 */
export const PACK_VERSION = 1;

const MAGIC = 'LSPK';
const GRID_TRUSTED = 1;
/** v1's section codes. Frozen: a kind added upstream needs a new pack version. */
const KINDS: readonly SectionKind[] = [
	'intro', 'groove', 'verse', 'breakdown', 'build', 'void', 'drop', 'chorus', 'outro'
];
const HIT_KINDS: readonly Hit['kind'][] = ['slam', 'strobe', 'blackout', 'bump'];
const DRUMS = ['kick', 'snare', 'hat'] as const;
const BAR_LEVELS = ['energy', 'sub', 'low', 'mid', 'air'] as const;
const BUILT_IN = new Set(BUILT_IN_EFFECTS.map((d) => d.id));

/** What the box knows about a song beyond its analysis and show. */
export interface PackMeta {
	/** The box's id for the song. It keys `pk/<trackId>/<engineSet>` in a DataStore. */
	trackId: string;
	title: string;
	artist: string;
	/** False sends the song to lounge only: `gridTrust` failed and no listener overrode it. */
	gridTrusted: boolean;
}

export interface PackInput {
	analysis: TrackAnalysis;
	show: Show;
	meta: PackMeta;
}

export interface PackHeader {
	trackId: string;
	title: string;
	artist: string;
	/** Seconds. */
	duration: number;
	analysisHash: string;
	analysisVersion: number;
	showVersion: number;
	/** Every effect the show installs, by cue layers and by hits, sorted. */
	effects: string[];
	rates: { spectrum: number; level: number; stereo: number };
}

/** The header plus the prefix's version and flag. */
export interface PackInfo extends PackHeader {
	packVersion: number;
	gridTrusted: boolean;
}

type PackCue = Omit<Cue, 'note'>;
type PackHit = Omit<Hit, 'note'>;

export interface PackShow {
	palette: ShowPalette;
	defaults: Show['defaults'];
	exposure?: Show['exposure'];
	ending?: Show['ending'];
	cues: PackCue[];
	hits: PackHit[];
}

export function encodePack({ analysis, show, meta }: PackInput): Uint8Array {
	if (show.analysisHash !== analysis.hash) {
		throw new Error(`the show is for analysis ${show.analysisHash}, not ${analysis.hash}`);
	}
	if (show.generatedEffects.length > 0) {
		throw new Error('a show with generated effects cannot be packed');
	}
	if (typeof meta.gridTrusted !== 'boolean') throw new Error('gridTrusted has to be a boolean');
	const body = packShow(show);
	const header: PackHeader = {
		trackId: text(meta.trackId, 'trackId'),
		title: text(meta.title, 'title'),
		artist: text(meta.artist, 'artist'),
		duration: finite(analysis.duration, 'duration'),
		analysisHash: text(analysis.hash, 'analysis hash'),
		analysisVersion: integer(analysis.version, 0, 0xffff, 'analysis version'),
		showVersion: integer(show.version, 0, 0xffff, 'show version'),
		effects: effectsOf(body),
		rates: {
			spectrum: finite(analysis.spectrum.fps, 'spectrum rate'),
			level: finite(analysis.level?.fps ?? 0, 'level rate'),
			stereo: finite(analysis.stereo.fps, 'stereo rate')
		}
	};

	const w = new Writer();
	for (let i = 0; i < MAGIC.length; i++) w.u8(MAGIC.charCodeAt(i));
	w.u16(PACK_VERSION);
	w.u16(meta.gridTrusted ? GRID_TRUSTED : 0);
	w.json(header);

	const tempo = analysis.tempo;
	for (const v of [
		tempo.bpm, tempo.firstBeat, tempo.beatPeriod, tempo.beatsPerBar, tempo.downbeatPhase,
		tempo.phraseAnchorBar, tempo.barsPerPhrase
	]) {
		w.f64(v);
	}
	const bars = analysis.bars.length;
	if (tempo.barTimes.length !== bars + 1) {
		throw new Error(`${tempo.barTimes.length} bar times for ${bars} bars`);
	}
	w.u32(bars);
	for (const v of tempo.barTimes) w.f64(v);

	for (const row of analysis.bars) {
		w.u8(kindCode(row.section));
		for (const key of BAR_LEVELS) w.u8(integer(row[key], 0, 100, `bar ${key}`));
	}
	w.u32(analysis.sections.length);
	for (const s of analysis.sections) {
		w.u16(integer(s.index, 0, 0xffff, 'section index'));
		w.u8(kindCode(s.kind));
		w.u16(integer(s.startBar, 0, 0xffff, 'section start bar'));
		w.u16(integer(s.endBar, 0, 0xffff, 'section end bar'));
		w.f64(s.startTime);
		w.f64(s.endTime);
	}

	const { energy, bands } = analysis.envelopes;
	if (bands.length !== energy.length * NUM_BANDS) {
		throw new Error(`${bands.length} envelope bands for ${energy.length} beats`);
	}
	w.u32(energy.length);
	for (const v of energy) w.u8(integer(v, 0, 100, 'envelope energy'));
	for (const v of bands) w.u8(integer(v, 0, 100, 'envelope band'));

	const spectrum = analysis.spectrum.data ? decodeBase64(analysis.spectrum.data) : new Uint8Array(0);
	const perFrame = integer(analysis.spectrum.bands, 0, 0xff, 'spectrum bands');
	if (perFrame === 0 ? spectrum.length > 0 : spectrum.length % perFrame !== 0) {
		throw new Error(`${spectrum.length} spectrum bytes are not whole frames of ${perFrame}`);
	}
	w.u32(perFrame === 0 ? 0 : spectrum.length / perFrame);
	w.u8(perFrame);
	for (let i = 0; i < spectrum.length; i++) {
		w.u8((spectrum[i] - (i >= perFrame ? spectrum[i - perFrame] : 0)) & 0xff);
	}

	const level = analysis.level?.data ? decodeBase64(analysis.level.data) : new Uint8Array(0);
	w.u32(level.length);
	w.bytes(level);

	const { pan, width } = analysis.stereo;
	if (pan.length !== width.length) throw new Error(`${pan.length} pan samples, ${width.length} widths`);
	w.u32(pan.length);
	for (const v of pan) w.i8(hundredths(v, -100, 100, 'pan'));
	for (const v of width) w.u8(hundredths(v, 0, 100, 'width'));

	for (const drum of DRUMS) writeOnsets(w, analysis.onsets[drum], drum);

	w.json(body);
	return w.finish();
}

export function decodePack(bytes: Uint8Array): {
	analysis: TrackAnalysis;
	show: Show;
	meta: PackInfo;
} {
	const r = new Reader(bytes);
	for (let i = 0; i < MAGIC.length; i++) {
		if (r.u8('magic') !== MAGIC.charCodeAt(i)) throw new Error('not a Track Pack');
	}
	const packVersion = r.u16('version');
	if (packVersion !== PACK_VERSION) {
		throw new Error(`pack version ${packVersion}; this decoder reads ${PACK_VERSION}`);
	}
	const flags = r.u16('flags');
	if ((flags & ~GRID_TRUSTED) !== 0) throw new Error(`unknown pack flags ${flags}`);
	const header = readHeader(r.json('header'));

	const [bpm, firstBeat, beatPeriod, beatsPerBar, downbeatPhase, phraseAnchorBar, barsPerPhrase] =
		Array.from({ length: 7 }, () => r.f64('tempo'));
	const bars = r.count(8 + 6, 'bars');
	const barTimes = Array.from({ length: bars + 1 }, () => r.f64('bar times'));

	const barRows = Array.from({ length: bars }, (_, bar) => {
		const section = kindOf(r.u8('bars'));
		const [energy, sub, low, mid, air] = BAR_LEVELS.map(() => r.u8('bars'));
		return {
			bar,
			t: barTimes[bar],
			section,
			energy,
			sub,
			low,
			mid,
			air,
			kicks: 0,
			snares: 0,
			hats: 0,
			vocal: 0,
			events: []
		};
	});
	const sections: SectionSpan[] = Array.from({ length: r.count(23, 'sections') }, () => {
		const index = r.u16('section');
		const kind = kindOf(r.u8('section'));
		const startBar = r.u16('section');
		const endBar = r.u16('section');
		return {
			index,
			kind,
			startBar,
			endBar,
			startTime: r.f64('section'),
			endTime: r.f64('section'),
			lengthBars: endBar - startBar,
			meanEnergy: 0,
			peakEnergy: 0,
			energyRank: 0,
			group: 0,
			repeatOf: null
		};
	});

	const beats = r.count(1 + NUM_BANDS, 'envelopes');
	const energy = Array.from(r.bytes(beats, 'envelopes'));
	const bands = Array.from(r.bytes(beats * NUM_BANDS, 'envelopes'));

	const frames = r.count(0, 'spectrum');
	const perFrame = r.u8('spectrum');
	const spectrum = r.bytes(frames * perFrame, 'spectrum').slice();
	for (let i = perFrame; i < spectrum.length; i++) {
		spectrum[i] = (spectrum[i] + spectrum[i - perFrame]) & 0xff;
	}

	const level = r.bytes(r.count(1, 'level'), 'level');

	const stereoFrames = r.count(2, 'stereo');
	const pan = Array.from(r.bytes(stereoFrames, 'stereo'), (b) => ((b << 24) >> 24) / 100);
	const width = Array.from(r.bytes(stereoFrames, 'stereo'), (b) => b / 100);

	const [kick, snare, hat] = DRUMS.map((drum) => {
		const n = r.count(9, drum);
		const times = Array.from({ length: n }, () => r.f64(drum));
		return { times, levels: Array.from(r.bytes(n, drum), (b) => b / 100) };
	});

	const body = readShow(r.json('show'));
	if (!r.done) throw new Error(`${bytes.length - r.at} bytes after the show`);
	if (effectsOf(body).join() !== header.effects.join()) {
		throw new Error('the header names other effects than its show uses');
	}

	const analysis: TrackAnalysis = {
		version: header.analysisVersion,
		hash: header.analysisHash,
		trackId: header.trackId,
		title: header.title,
		duration: header.duration,
		sampleRate: 0,
		tempo: {
			bpm,
			confidence: 0,
			firstBeat,
			beatPeriod,
			beatsPerBar,
			downbeatPhase,
			phraseAnchorBar,
			barsPerPhrase,
			constant: false,
			meterConfidence: 0,
			ambiguous: false,
			alternativeBpm: [],
			barTimes
		},
		key: { tonic: 0, name: '', mode: 'major', confidence: 0 },
		bars: barRows,
		sections,
		moments: [],
		beats: [],
		envelopes: { energy, bands },
		spectrum: {
			fps: header.rates.spectrum,
			bands: perFrame,
			centreHz: [],
			data: encodeBase64(spectrum)
		},
		...(level.length > 0 ? { level: { fps: header.rates.level, data: encodeBase64(level) } } : {}),
		stereo: { fps: header.rates.stereo, pan, width },
		onsets: { kick, snare, hat },
		integratedLufs: 0,
		loudnessRange: 0,
		peakToLoudness: 0
	};
	const show: Show = {
		version: header.showVersion,
		trackId: header.trackId,
		title: header.title,
		analysisHash: header.analysisHash,
		brief: '',
		palette: body.palette,
		defaults: body.defaults,
		...(body.exposure === undefined ? {} : { exposure: body.exposure }),
		...(body.ending === undefined ? {} : { ending: body.ending }),
		generatedEffects: [],
		cues: body.cues.map((cue) => ({ ...cue, note: '' })),
		hits: body.hits
	};
	const meta = { ...header, packVersion, gridTrusted: (flags & GRID_TRUSTED) !== 0 };
	return { analysis, show, meta };
}

function writeOnsets(w: Writer, stream: OnsetStream, drum: string): void {
	w.u32(stream.times.length);
	for (const t of stream.times) w.f64(t);
	// The player reads a missing level as a full-strength hit.
	for (let i = 0; i < stream.times.length; i++) {
		w.u8(hundredths(stream.levels[i] ?? 1, 0, 100, `${drum} level`));
	}
}

/** The render fields, each checked: JSON would quietly turn a non-finite number into null. */
function packShow(show: Show): PackShow {
	return {
		palette: packPalette(show.palette, 'palette'),
		defaults: {
			intensity: finite(show.defaults.intensity, 'default intensity'),
			motion: finite(show.defaults.motion, 'default motion'),
			fadeBeats: finite(show.defaults.fadeBeats, 'default fade')
		},
		...(show.exposure === undefined
			? {}
			: { exposure: oneOf(show.exposure, ['auto', 'fixed'], 'exposure') }),
		...(show.ending === undefined
			? {}
			: { ending: oneOf(show.ending, ['ease', 'hold'], 'ending') }),
		cues: show.cues.map(packCue),
		hits: show.hits.map(packHit)
	};
}

function packCue(cue: Cue): PackCue {
	const layers: PackCue['layers'] = {};
	for (const role of LAYER_ROLES) {
		const spec = cue.layers[role];
		if (spec) layers[role] = packLayer(spec);
	}
	const out: PackCue = {
		bar: finite(cue.bar, 'cue bar'),
		section: KINDS[kindCode(cue.section)],
		layers
	};
	if (cue.palette !== undefined) {
		out.palette = typeof cue.palette === 'string'
			? oneOf(cue.palette, ['swap', 'inherit'], 'cue palette')
			: packPalette(cue.palette, `cue ${cue.bar} palette`);
	}
	if (cue.intensity !== undefined) out.intensity = finite(cue.intensity, 'cue intensity');
	if (cue.motion !== undefined) out.motion = finite(cue.motion, 'cue motion');
	if (cue.fadeBeats !== undefined) out.fadeBeats = finite(cue.fadeBeats, 'cue fade');
	if (cue.floor !== undefined) out.floor = finite(cue.floor, 'cue floor');
	return out;
}

function packLayer(spec: LayerSpec): LayerSpec {
	if (!BUILT_IN.has(spec.effect)) throw new Error(`effect "${spec.effect}" is not built in`);
	const out: LayerSpec = { effect: spec.effect };
	if (spec.opacity !== undefined) out.opacity = finite(spec.opacity, `${spec.effect} opacity`);
	if (spec.params !== undefined) out.params = packParams(spec.params, spec.effect);
	return out;
}

function packHit(hit: Hit): PackHit {
	const out: PackHit = {
		bar: finite(hit.bar, 'hit bar'),
		kind: oneOf(hit.kind, HIT_KINDS, 'hit kind'),
		beats: finite(hit.beats, 'hit length')
	};
	if (hit.beat !== undefined) out.beat = finite(hit.beat, 'hit beat');
	if (hit.params !== undefined) out.params = packParams(hit.params, `${hit.kind} hit`);
	return out;
}

function packPalette(p: ShowPalette, what: string): ShowPalette {
	const out: ShowPalette = {
		base: finite(p.base, `${what} base`),
		accent: finite(p.accent, `${what} accent`)
	};
	for (const key of ['third', 'sat', 'shade', 'white'] as const) {
		const v = p[key];
		if (v !== undefined) out[key] = finite(v, `${what} ${key}`);
	}
	return out;
}

function packParams(params: Record<string, number>, what: string): Record<string, number> {
	const out: Record<string, number> = {};
	for (const [key, v] of Object.entries(params)) out[key] = finite(v, `${what} ${key}`);
	return out;
}

function effectsOf(show: PackShow): string[] {
	const ids = new Set<string>();
	for (const cue of show.cues) {
		for (const role of LAYER_ROLES) {
			const spec = cue.layers[role];
			if (spec) ids.add(spec.effect);
		}
	}
	for (const hit of show.hits) {
		const id = HIT_EFFECT[hit.kind];
		if (id) ids.add(id);
	}
	return [...ids].sort();
}

function readHeader(value: unknown): PackHeader {
	const o = record(value, 'header');
	const rates = record(o.rates, 'rates');
	const effects = o.effects;
	if (!Array.isArray(effects) || !effects.every((e) => typeof e === 'string')) {
		throw new Error('the header has no effect list');
	}
	return {
		trackId: field(o, 'trackId', 'string'),
		title: field(o, 'title', 'string'),
		artist: field(o, 'artist', 'string'),
		duration: field(o, 'duration', 'number'),
		analysisHash: field(o, 'analysisHash', 'string'),
		analysisVersion: field(o, 'analysisVersion', 'number'),
		showVersion: field(o, 'showVersion', 'number'),
		effects,
		rates: {
			spectrum: field(rates, 'spectrum', 'number'),
			level: field(rates, 'level', 'number'),
			stereo: field(rates, 'stereo', 'number')
		}
	};
}

function readShow(value: unknown): PackShow {
	const o = record(value, 'show');
	record(o.palette, 'show palette');
	record(o.defaults, 'show defaults');
	if (!Array.isArray(o.cues) || !Array.isArray(o.hits)) throw new Error('the show lacks cues or hits');
	return o as unknown as PackShow;
}

function record(value: unknown, what: string): Record<string, unknown> {
	if (typeof value !== 'object' || value === null || Array.isArray(value)) {
		throw new Error(`${what} is not an object`);
	}
	return value as Record<string, unknown>;
}

function field<T extends 'string' | 'number'>(
	o: Record<string, unknown>,
	key: string,
	type: T
): T extends 'string' ? string : number {
	if (typeof o[key] !== type) throw new Error(`the header's ${key} is not a ${type}`);
	return o[key] as T extends 'string' ? string : number;
}

function kindCode(kind: SectionKind): number {
	const code = KINDS.indexOf(kind);
	if (code < 0) throw new Error(`section kind "${kind}" has no pack code`);
	return code;
}

function kindOf(code: number): SectionKind {
	const kind = KINDS[code];
	if (kind === undefined) throw new Error(`section code ${code} is not a kind`);
	return kind;
}

function oneOf<T extends string>(v: T, allowed: readonly NoInfer<T>[], what: string): T {
	if (!allowed.includes(v)) throw new Error(`${what} "${v}" is not one of ${allowed.join(', ')}`);
	return v;
}

function text(v: string, what: string): string {
	if (typeof v !== 'string') throw new Error(`${what} is not a string`);
	return v;
}

function finite(v: number, what: string): number {
	if (typeof v !== 'number' || !Number.isFinite(v)) throw new Error(`${what} ${v} is not finite`);
	return v;
}

function integer(v: number, lo: number, hi: number, what: string): number {
	if (!Number.isInteger(v) || v < lo || v > hi) {
		throw new Error(`${what} ${v} is not an integer in ${lo}..${hi}`);
	}
	return v;
}

/** A value the analysis rounded to hundredths, as its count of them; anything else is refused. */
function hundredths(v: number, lo: number, hi: number, what: string): number {
	const q = Math.round(v * 100);
	if (!(q / 100 === v) || q < lo || q > hi) {
		throw new Error(`${what} ${v} is not a whole hundredth in ${lo / 100}..${hi / 100}`);
	}
	return q;
}

/** JSON with every non-ASCII character escaped, so each byte is one character. */
function ascii(value: unknown): string {
	return JSON.stringify(value).replace(
		/[\u0080-￿]/g,
		(c) => `\\u${c.charCodeAt(0).toString(16).padStart(4, '0')}`
	);
}

class Writer {
	private buf = new Uint8Array(1 << 16);
	private view = new DataView(this.buf.buffer);
	private length = 0;

	// Each reserves its room first: growing replaces the buffer and its view.
	u8(v: number): void {
		const at = this.room(1);
		this.view.setUint8(at, v);
	}

	i8(v: number): void {
		const at = this.room(1);
		this.view.setInt8(at, v);
	}

	u16(v: number): void {
		const at = this.room(2);
		this.view.setUint16(at, v, true);
	}

	u32(v: number): void {
		const at = this.room(4);
		this.view.setUint32(at, v, true);
	}

	f64(v: number): void {
		const at = this.room(8);
		this.view.setFloat64(at, v, true);
	}

	bytes(b: Uint8Array): void {
		const at = this.room(b.length);
		this.buf.set(b, at);
	}

	json(value: unknown): void {
		const s = ascii(value);
		this.u32(s.length);
		const at = this.room(s.length);
		for (let i = 0; i < s.length; i++) this.buf[at + i] = s.charCodeAt(i);
	}

	finish(): Uint8Array {
		return this.buf.slice(0, this.length);
	}

	private room(n: number): number {
		const at = this.length;
		if (at + n > this.buf.length) {
			let size = this.buf.length * 2;
			while (size < at + n) size *= 2;
			const next = new Uint8Array(size);
			next.set(this.buf.subarray(0, at));
			this.buf = next;
			this.view = new DataView(next.buffer);
		}
		this.length = at + n;
		return at;
	}
}

class Reader {
	at = 0;
	private readonly src: Uint8Array;
	private readonly view: DataView;

	constructor(src: Uint8Array) {
		this.src = src;
		this.view = new DataView(src.buffer, src.byteOffset, src.byteLength);
	}

	get done(): boolean {
		return this.at === this.src.length;
	}

	u8(what: string): number {
		return this.view.getUint8(this.take(1, what));
	}

	u16(what: string): number {
		return this.view.getUint16(this.take(2, what), true);
	}

	u32(what: string): number {
		return this.view.getUint32(this.take(4, what), true);
	}

	f64(what: string): number {
		return this.view.getFloat64(this.take(8, what), true);
	}

	/** A u32 count of records `size` bytes each, refused when the rest of the pack is shorter. */
	count(size: number, what: string): number {
		const n = this.u32(what);
		if (n * size > this.src.length - this.at) throw new Error(`the pack ends inside its ${what}`);
		return n;
	}

	bytes(n: number, what: string): Uint8Array {
		const at = this.take(n, what);
		return this.src.subarray(at, at + n);
	}

	json(what: string): unknown {
		const n = this.u32(what);
		const at = this.take(n, what);
		let s = '';
		for (let i = at; i < at + n; i++) {
			if (this.src[i] > 0x7f) throw new Error(`the ${what} is not ASCII`);
			s += String.fromCharCode(this.src[i]);
		}
		return JSON.parse(s);
	}

	private take(n: number, what: string): number {
		if (this.at + n > this.src.length) throw new Error(`the pack ends inside its ${what}`);
		const at = this.at;
		this.at += n;
		return at;
	}
}
