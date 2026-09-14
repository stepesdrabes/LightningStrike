import type { GenreFamily } from '../contracts/context.ts';
import type { LayerRole, ParamSpec, Params } from '../contracts/effect.ts';
import { LAYER_ROLES } from '../contracts/effect.ts';
import type {
	BlockSpec,
	ClockSpec,
	Criteria,
	EntryHit,
	EntrySpec,
	EveningScript,
	FillOrder,
	FillSource,
	FillSpec,
	Finding,
	HitKind,
	HoldSpec,
	LookSpec,
	MomentSpec,
	NarrationEnd,
	NarrationSpec,
	OverlaySpec,
	PauseSpec,
	Position,
	Pulse,
	SegmentSpec,
	SongItem,
	SongLighting,
	SongSpec,
	SourceLine,
	StepSpec,
	StingSpec
} from '../contracts/evening.ts';
import { EVENING_VERSION } from '../contracts/evening.ts';
import type { SectionKind } from '../contracts/frame.ts';
import { SECTION_KINDS } from '../contracts/frame.ts';
import type { ShowPalette } from '../contracts/palette.ts';
import type { GeneratedEffect, LayerSpec } from '../contracts/show.ts';
import { AMBIENT_SCENES } from '../ambient/scenes.ts';
import { NAMED_PALETTES } from '../color/named.ts';
import { BUILT_IN_EFFECTS } from '../effects/index.ts';
import { compileGenerated } from '../effects/sandbox.ts';
import { buildGeometry, DEFAULT_ROOM } from '../geometry.ts';
import { DEFAULT_OPACITY } from '../mixer.ts';
import { parseClock, parseLength } from './time.ts';

export interface CompileOptions {
	/** Resolve a narration path written relative to the evening file. */
	resolvePath?: (path: string) => string;
}

export interface CompileResult {
	script: EveningScript | null;
	findings: Finding[];
}

/** A silent segment's default grid. */
export const DEFAULT_CLOCK: ClockSpec = { bpm: 120, beatsPerBar: 4, pulse: 'none' };
/** Seconds a pause's music fades out over at its end. */
export const DEFAULT_FADE_OUT = 6;

const GENRE_FAMILIES: readonly GenreFamily[] = [
	'techno', 'house', 'edm', 'trance', 'bass', 'pop', 'rock', 'metal', 'punk', 'hiphop', 'rnb',
	'ballad', 'ambient', 'latin', 'disco'
];
const HIT_KINDS: readonly HitKind[] = ['slam', 'strobe', 'blackout', 'bump'];
const ENTRY_HITS: readonly EntryHit[] = ['slam', 'strobe', 'bump'];
const PULSES: readonly Pulse[] = ['none', 'kick', 'backbeat', 'four-on-the-floor'];
const FILL_ORDERS: readonly FillOrder[] = ['rising', 'falling', 'steady', 'shuffle'];
const FILL_SOURCES: readonly FillSource[] = ['library', 'requests', 'requests-then-library'];
const POSITIONS = ['start', 'end', 'first-drop', 'last-drop', 'peak'];
const YOUTUBE_ID = /^[A-Za-z0-9_-]{11}$/;
const EFFECT_ID = /^[A-Za-z][A-Za-z0-9_-]{0,47}$/;

type Obj = Record<string, unknown>;

function isObj(v: unknown): v is Obj {
	return typeof v === 'object' && v !== null && !Array.isArray(v);
}

function lineOf(v: unknown): SourceLine | undefined {
	if (!isObj(v) || !isObj(v.line)) return undefined;
	const { file, line } = v.line;
	return typeof file === 'string' && typeof line === 'number' ? { file, line } : undefined;
}

export function slug(name: string): string {
	return name
		.normalize('NFKD')
		.replace(/[\u0300-\u036f]/g, '')
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, '-')
		.replace(/^-+|-+$/g, '');
}

/**
 * Turn an effect's `create`, however it was written, into the `function create(g)` source the
 * sandbox evaluates. Method shorthand is not an expression on its own, so it is wrapped back
 * into the object it came from.
 */
export function serializeCreate(fn: unknown): string | null {
	if (typeof fn !== 'function') return null;
	const text = Function.prototype.toString.call(fn).trim();
	if (/^async\b/.test(text) || /^\*/.test(text) || text.includes('[native code]')) return null;
	const expression =
		/^function\b/.test(text) || /^\(/.test(text) || /^[A-Za-z_$][\w$]*\s*=>/.test(text)
			? `(${text})`
			: /^create\s*\(/.test(text)
				? `({ ${text} }).create`
				: null;
	if (!expression) return null;
	return `const __create = ${expression};\nfunction create(g) {\n\treturn __create(g);\n}`;
}

class Compiler {
	readonly findings: Finding[] = [];
	private readonly effects = new Map<string, { source: unknown; gen: GeneratedEffect }>();
	private readonly stings = new Map<string, { source: unknown; spec: StingSpec }>();
	private readonly builtIn = new Map(BUILT_IN_EFFECTS.map((e) => [e.id, e]));
	private readonly geometry = buildGeometry(DEFAULT_ROOM);
	private segment: string | undefined;
	private readonly options: CompileOptions;

	constructor(options: CompileOptions) {
		this.options = options;
	}

	error(message: string, line?: SourceLine): void {
		this.findings.push({ severity: 'error', message, segment: this.segment, line });
	}

	warn(message: string, line?: SourceLine): void {
		this.findings.push({ severity: 'warning', message, segment: this.segment, line });
	}

	evening(value: unknown): EveningScript | null {
		if (!isObj(value) || value.kind !== 'evening') {
			this.error("The file's default export must be evening(...).");
			return null;
		}
		const line = lineOf(value);
		const name = typeof value.name === 'string' && value.name.trim() ? value.name.trim() : null;
		if (!name) this.error('The evening needs a name.', line);
		const spec = isObj(value.spec) ? value.spec : {};
		const palette = spec.palette === undefined ? undefined : this.palette(spec.palette, line);
		const heat: Record<string, number> = {};
		if (spec.heat !== undefined) {
			if (!isObj(spec.heat)) this.error('heat must map track ids to numbers from 1 to 5.', line);
			else {
				for (const [id, v] of Object.entries(spec.heat)) {
					if (typeof v === 'number' && v >= 1 && v <= 5) heat[id] = v;
					else this.error(`heat for ${id} must be a number from 1 to 5.`, line);
				}
			}
		}
		const raw = Array.isArray(spec.segments) ? spec.segments : null;
		if (!raw || raw.length === 0) {
			this.error('The evening needs at least one segment.', line);
			return null;
		}

		const segments: SegmentSpec[] = [];
		const ids = new Set<string>();
		raw.forEach((item, index) => {
			const compiled = this.segmentOf(item, index);
			if (!compiled) return;
			if (ids.has(compiled.id)) {
				this.segment = compiled.id;
				this.error(`Two segments share the id "${compiled.id}"; give one an explicit id.`, compiled.line);
			}
			ids.add(compiled.id);
			segments.push(compiled);
		});
		this.segment = undefined;
		this.checkOrder(segments);

		const effects = [...this.effects.values()].map((e) => e.gen);
		for (const gen of effects) this.gate(gen, lineOf(this.effects.get(gen.id)?.source));

		return {
			version: EVENING_VERSION,
			name: name ?? 'Evening',
			...(palette ? { palette } : {}),
			heat,
			effects,
			stings: [...this.stings.values()].map((s) => s.spec),
			segments
		};
	}

	private segmentOf(item: unknown, index: number): SegmentSpec | null {
		if (!isObj(item) || item.kind !== 'segment') {
			this.segment = undefined;
			this.error(`segments[${index}] is not a segment: use block, pause, hold, moment or narration.`);
			return null;
		}
		const line = lineOf(item);
		const name = typeof item.name === 'string' && item.name.trim() ? item.name.trim() : '';
		const spec = isObj(item.spec) ? item.spec : {};
		const explicit = typeof spec.id === 'string' ? spec.id.trim() : '';
		const id = explicit || slug(name) || `${String(item.type)}-${index + 1}`;
		this.segment = id;
		if (!name) this.error(`segments[${index}] needs a name.`, line);

		const base = {
			id,
			name: name || id,
			...this.timing(spec, line),
			...(spec.enter === undefined ? {} : { enter: this.entry(spec.enter, line) }),
			...(line ? { line } : {})
		};

		switch (item.type) {
			case 'block':
				return this.block(base, spec, line);
			case 'pause':
				return this.pause(base, spec, line);
			case 'hold':
				return this.hold(base, spec, line);
			case 'moment':
				return this.moment(base, spec, line);
			case 'narration':
				return this.narration(base, spec, line);
			default:
				this.error(`segments[${index}] has an unknown type.`, line);
				return null;
		}
	}

	private timing(spec: Obj, line?: SourceLine): { at?: string; notBefore?: string } {
		const out: { at?: string; notBefore?: string } = {};
		for (const key of ['at', 'notBefore'] as const) {
			if (spec[key] === undefined) continue;
			if (parseClock(spec[key]) === null) this.error(`${key} must be a time like '21:00'.`, line);
			else out[key] = String(spec[key]).trim().padStart(5, '0');
		}
		if (out.at && out.notBefore) this.error('Use either at or notBefore, not both.', line);
		return out;
	}

	private entry(value: unknown, line?: SourceLine): EntrySpec {
		const out: EntrySpec = {};
		if (!isObj(value)) {
			this.error('enter must be an object.', line);
			return out;
		}
		if (value.sting !== undefined) {
			const sting = this.sting(value.sting, line);
			if (sting) out.sting = sting.id;
		}
		if (value.gap !== undefined) {
			const gap = this.length(value.gap, 'enter.gap', line);
			if (gap !== null) out.gap = gap;
		}
		if (value.light !== undefined) {
			if (value.light === 'cut') out.light = 0;
			else {
				const light = this.length(value.light, 'enter.light', line);
				if (light !== null) out.light = Math.min(light, 30);
			}
		}
		if (value.hit !== undefined) {
			if (ENTRY_HITS.includes(value.hit as EntryHit)) out.hit = value.hit as EntryHit;
			else this.error(`enter.hit must be one of ${ENTRY_HITS.join(', ')}.`, line);
		}
		if (value.crossfade !== undefined) {
			const crossfade = this.length(value.crossfade, 'enter.crossfade', line);
			if (crossfade !== null) out.crossfade = Math.min(crossfade, 12);
		}
		return out;
	}

	private length(value: unknown, what: string, line?: SourceLine): number | null {
		const seconds = parseLength(value);
		if (seconds === null) this.error(`${what} must be a length like 90, '45s', '8m' or '3:30'.`, line);
		return seconds;
	}

	private block(base: BaseSpec, spec: Obj, line?: SourceLine): BlockSpec {
		const items = this.items(spec.songs, 'songs', line);
		if (items.length === 0) this.error('A block needs at least one song or fill.', line);
		// An open block's last fill keeps choosing songs, so it alone may go without a count.
		const lastFill = items.map((i) => i.kind).lastIndexOf('fill');
		this.counted(items.filter((_, i) => !(spec.open === true && i === lastFill)), line);
		const between: BlockSpec['between'] = {};
		if (spec.between !== undefined) {
			if (!isObj(spec.between)) this.error('between must be an object.', line);
			else {
				if (spec.between.light === 'cut') between.light = 0;
				else if (spec.between.light !== undefined) {
					const light = this.length(spec.between.light, 'between.light', line);
					if (light !== null) between.light = Math.min(light, 30);
				}
				if (spec.between.crossfade !== undefined) {
					const crossfade = this.length(spec.between.crossfade, 'between.crossfade', line);
					if (crossfade !== null) between.crossfade = Math.min(crossfade, 12);
				}
			}
		}
		const palette = spec.palette === undefined ? undefined : this.palette(spec.palette, line);
		const lighting = spec.lighting === undefined ? undefined : this.songLighting(spec.lighting, line);
		return {
			...base,
			kind: 'block',
			items,
			between,
			...(palette ? { palette } : {}),
			...(lighting ? { lighting } : {}),
			open: spec.open === true
		};
	}

	private pause(base: BaseSpec, spec: Obj, line?: SourceLine): PauseSpec {
		const length = spec.length === undefined ? undefined : this.length(spec.length, 'length', line) ?? undefined;
		let until: string | undefined;
		if (spec.until !== undefined) {
			if (parseClock(spec.until) === null) this.error("until must be a time like '21:00'.", line);
			else until = String(spec.until).trim().padStart(5, '0');
		}
		if (length !== undefined && until !== undefined) this.error('Use either length or until, not both.', line);
		const music = spec.music === undefined ? [] : this.items(spec.music, 'music', line);
		this.counted(music, line);
		if (length === undefined && until === undefined && music.length === 0) {
			this.error('A pause needs a length, an until time or music.', line);
		}
		if (length === undefined && until === undefined && music.some((m) => m.kind === 'fill' && m.count === undefined)) {
			this.error("A pause without a length plays its music's own length, so its fills need a count.", line);
		}
		const fadeOut = spec.fadeOut === undefined ? DEFAULT_FADE_OUT : this.length(spec.fadeOut, 'fadeOut', line) ?? DEFAULT_FADE_OUT;
		return {
			...base,
			kind: 'pause',
			...(length !== undefined ? { length } : {}),
			...(until ? { until } : {}),
			...(spec.look !== undefined || spec.palette !== undefined
				? { look: this.lookOrScene(spec.look ?? 'resting', spec.palette, line, music.length === 0) }
				: {}),
			music,
			fadeOut
		};
	}

	private hold(base: BaseSpec, spec: Obj, line?: SourceLine): HoldSpec {
		const out: HoldSpec = {
			...base,
			kind: 'hold',
			look: this.lookOrScene(spec.look ?? 'resting', spec.palette, line, true)
		};
		if (spec.expect !== undefined) {
			const expect = this.length(spec.expect, 'expect', line);
			if (expect !== null) out.expect = expect;
		}
		if (spec.expectEnd !== undefined) {
			if (parseClock(spec.expectEnd) === null) this.error("expectEnd must be a time like '20:00'.", line);
			else out.expectAt = String(spec.expectEnd).trim().padStart(5, '0');
		}
		if (out.expect !== undefined && out.expectAt !== undefined) {
			this.error('Use either expect or expectEnd, not both.', line);
		}
		if (typeof spec.note === 'string' && spec.note.trim()) out.note = spec.note.trim();
		return out;
	}

	private moment(base: BaseSpec, spec: Obj, line?: SourceLine): MomentSpec | null {
		const length = this.length(spec.length, 'length', line);
		if (length !== null && length <= 0) this.error('A moment needs a length above zero.', line);
		const clock = this.clock(spec, line);
		const palette = spec.palette === undefined ? undefined : this.palette(spec.palette, line);
		const timeline = this.timeline(spec.timeline, clock, line, true);
		if (timeline.length === 0) this.error('A moment needs a timeline with at least one step.', line);
		return {
			...base,
			kind: 'moment',
			length: length ?? 0,
			clock,
			timeline,
			...(palette ? { palette } : {})
		};
	}

	private narration(base: BaseSpec, spec: Obj, line?: SourceLine): NarrationSpec {
		const audio = typeof spec.audio === 'string' && spec.audio.trim() ? spec.audio.trim() : '';
		if (!audio) this.error('A narration needs an audio path.', line);
		const clock = this.clock(spec, line);
		const palette = spec.palette === undefined ? undefined : this.palette(spec.palette, line);
		const look = this.lookOrScene(spec.look ?? 'resting', undefined, line, false);
		const timeline = spec.timeline === undefined ? [] : this.timeline(spec.timeline, clock, line, false);
		if (timeline.length === 0 || timeline[0].at > 0) timeline.unshift({ at: 0, look, section: 'intro' });
		else if (!timeline[0].look) timeline[0] = { ...timeline[0], look };
		let volume = 1;
		if (spec.volume !== undefined) {
			if (typeof spec.volume === 'number' && spec.volume >= 0 && spec.volume <= 1) volume = spec.volume;
			else this.error('volume must be a number from 0 to 1.', line);
		}
		let end: NarrationEnd = 'ease';
		if (spec.end !== undefined) {
			if (spec.end === 'ease' || spec.end === 'hold') end = spec.end;
			else this.error("end must be 'ease' or 'hold'.", line);
		}
		return {
			...base,
			kind: 'narration',
			audio: audio && this.options.resolvePath ? this.options.resolvePath(audio) : audio,
			clock,
			timeline,
			...(palette ? { palette } : {}),
			volume,
			end
		};
	}

	private counted(items: SongItem[], line?: SourceLine): void {
		for (const item of items) {
			if (item.kind === 'fill' && item.count === undefined && item.length === undefined) {
				this.error('A fill needs a count or a length.', item.line ?? line);
			}
		}
	}

	private items(value: unknown, what: string, line?: SourceLine): SongItem[] {
		if (!Array.isArray(value)) {
			this.error(`${what} must be a list of song(...) and fill(...).`, line);
			return [];
		}
		const out: SongItem[] = [];
		for (const item of value) {
			if (isObj(item) && item.kind === 'song') {
				const song = this.song(item);
				if (song) out.push(song);
			} else if (isObj(item) && item.kind === 'fill') {
				const fill = this.fill(item);
				if (fill) out.push(fill);
			} else {
				this.error(`${what} may hold only song(...) and fill(...).`, line);
			}
		}
		return out;
	}

	private song(item: Obj): SongSpec | null {
		const line = lineOf(item);
		const title = typeof item.title === 'string' ? item.title.trim() : '';
		if (!title) {
			this.error('song(...) needs a title.', line);
			return null;
		}
		const options = isObj(item.options) ? item.options : {};
		const out: SongSpec = { kind: 'song', title, overlays: [], ...(line ? { line } : {}) };
		if (typeof options.by === 'string' && options.by.trim()) out.by = options.by.trim();
		if (options.id !== undefined) {
			if (typeof options.id === 'string' && YOUTUBE_ID.test(options.id)) out.id = options.id;
			else this.error(`"${title}": id must be an 11-character YouTube id.`, line);
		}
		if (options.lighting !== undefined) {
			const lighting = this.songLighting(options.lighting, line);
			if (lighting) out.lighting = lighting;
		}
		if (options.overlays !== undefined) {
			if (!Array.isArray(options.overlays)) this.error(`"${title}": overlays must be a list.`, line);
			else {
				for (const overlay of options.overlays) {
					const compiled = this.overlay(overlay, title, line);
					if (compiled) out.overlays.push(compiled);
				}
			}
		}
		if (options.hit !== undefined) {
			if (ENTRY_HITS.includes(options.hit as EntryHit)) out.hit = options.hit as EntryHit;
			else this.error(`"${title}": hit must be one of ${ENTRY_HITS.join(', ')}.`, line);
		}
		return out;
	}

	private overlay(value: unknown, title: string, line?: SourceLine): OverlaySpec | null {
		if (!isObj(value)) {
			this.error(`"${title}": each overlay needs from, to and look.`, line);
			return null;
		}
		const from = this.position(value.from, title, line);
		const to = this.position(value.to, title, line);
		if (!isObj(value.look) || value.look.kind !== 'look') {
			this.error(`"${title}": an overlay's look must be look(...).`, line);
			return null;
		}
		const look = this.look(value.look, undefined, lineOf(value.look) ?? line);
		let end: EntryHit | undefined;
		if (value.end !== undefined) {
			if (ENTRY_HITS.includes(value.end as EntryHit)) end = value.end as EntryHit;
			else this.error(`"${title}": an overlay's end must be one of ${ENTRY_HITS.join(', ')}.`, line);
		}
		return from && to ? { from, to, look, ...(end ? { end } : {}) } : null;
	}

	private position(value: unknown, title: string, line?: SourceLine): Position | null {
		if (typeof value === 'string' && POSITIONS.includes(value)) return value as Position;
		if (isObj(value) && typeof value.bar === 'number' && value.bar >= 0) return { bar: value.bar };
		if (isObj(value) && SECTION_KINDS.includes(value.section as SectionKind)) {
			const nth = value.nth === undefined ? 1 : value.nth;
			if (typeof nth === 'number' && Number.isInteger(nth) && nth >= 1) {
				return { section: value.section as SectionKind, nth };
			}
		}
		this.error(
			`"${title}": a position is 'start', 'end', 'first-drop', 'last-drop', 'peak', { bar } or { section, nth }.`,
			line
		);
		return null;
	}

	private songLighting(value: unknown, line?: SourceLine): SongLighting | null {
		if (value === 'show' || value === 'calm') return value;
		if (isObj(value) && value.kind === 'look') return this.look(value, undefined, lineOf(value) ?? line);
		this.error("lighting must be 'show', 'calm' or look(...).", line);
		return null;
	}

	private fill(item: Obj): FillSpec | null {
		const line = lineOf(item);
		const spec = isObj(item.spec) ? item.spec : {};
		const out: FillSpec = {
			kind: 'fill',
			from: 'library',
			where: {},
			order: 'rising',
			...(line ? { line } : {})
		};
		if (spec.count !== undefined) {
			if (typeof spec.count === 'number' && Number.isInteger(spec.count) && spec.count >= 1 && spec.count <= 200) {
				out.count = spec.count;
			} else this.error('fill count must be a whole number from 1 to 200.', line);
		}
		if (spec.length !== undefined) {
			const length = this.length(spec.length, 'fill length', line);
			if (length !== null) out.length = length;
		}
		if (out.count !== undefined && out.length !== undefined) this.error('A fill takes a count or a length, not both.', line);
		if (spec.from !== undefined) {
			if (FILL_SOURCES.includes(spec.from as FillSource)) out.from = spec.from as FillSource;
			else this.error(`fill from must be one of ${FILL_SOURCES.join(', ')}.`, line);
		}
		if (spec.order !== undefined) {
			if (FILL_ORDERS.includes(spec.order as FillOrder)) out.order = spec.order as FillOrder;
			else this.error(`fill order must be one of ${FILL_ORDERS.join(', ')}.`, line);
		}
		if (spec.lighting !== undefined) {
			if (spec.lighting === 'show' || spec.lighting === 'calm') out.lighting = spec.lighting;
			else this.error("fill lighting must be 'show' or 'calm'.", line);
		}
		if (spec.where !== undefined) out.where = this.criteria(spec.where, line);
		return out;
	}

	private criteria(value: unknown, line?: SourceLine): Criteria {
		const out: Criteria = {};
		if (!isObj(value)) {
			this.error('where must be an object.', line);
			return out;
		}
		if (value.families !== undefined) {
			const families = Array.isArray(value.families) ? value.families : [];
			const bad = families.filter((f) => !GENRE_FAMILIES.includes(f as GenreFamily));
			if (!Array.isArray(value.families) || bad.length > 0 || families.length === 0) {
				this.error(`families must list genre families: ${GENRE_FAMILIES.join(', ')}.`, line);
			} else out.families = families as GenreFamily[];
		}
		if (value.heat !== undefined) {
			const range = typeof value.heat === 'number' ? [value.heat, value.heat] : value.heat;
			if (this.range(range, 1, 5)) out.heat = range as [number, number];
			else this.error('heat is a number from 1 to 5, or a range like [3, 5].', line);
		}
		if (value.bpm !== undefined) {
			if (this.range(value.bpm, 30, 300)) out.bpm = value.bpm as [number, number];
			else this.error('bpm is a range like [110, 130].', line);
		}
		if (value.minutes !== undefined) {
			if (this.range(value.minutes, 0, 60)) out.minutes = value.minutes as [number, number];
			else this.error('minutes is a range like [2, 5].', line);
		}
		for (const key of ['artists', 'exclude'] as const) {
			if (value[key] === undefined) continue;
			const list = value[key];
			if (Array.isArray(list) && list.every((x) => typeof x === 'string')) out[key] = list as string[];
			else this.error(`${key} must be a list of strings.`, line);
		}
		return out;
	}

	private range(value: unknown, lo: number, hi: number): boolean {
		return (
			Array.isArray(value) &&
			value.length === 2 &&
			value.every((v) => typeof v === 'number' && v >= lo && v <= hi) &&
			(value[0] as number) <= (value[1] as number)
		);
	}

	private clock(spec: Obj, line?: SourceLine): ClockSpec {
		const clock = { ...DEFAULT_CLOCK };
		if (spec.bpm !== undefined) {
			if (typeof spec.bpm === 'number' && spec.bpm >= 20 && spec.bpm <= 300) clock.bpm = spec.bpm;
			else this.error('bpm must be a number from 20 to 300.', line);
		}
		if (spec.beatsPerBar !== undefined) {
			if (typeof spec.beatsPerBar === 'number' && Number.isInteger(spec.beatsPerBar) && spec.beatsPerBar >= 1 && spec.beatsPerBar <= 12) {
				clock.beatsPerBar = spec.beatsPerBar;
			} else this.error('beatsPerBar must be a whole number from 1 to 12.', line);
		}
		if (spec.pulse !== undefined) {
			if (PULSES.includes(spec.pulse as Pulse)) clock.pulse = spec.pulse as Pulse;
			else this.error(`pulse must be one of ${PULSES.join(', ')}.`, line);
		}
		return clock;
	}

	private timeline(value: unknown, clock: ClockSpec, line: SourceLine | undefined, silent: boolean): StepSpec[] {
		if (!Array.isArray(value)) {
			this.error('timeline must be a list of steps.', line);
			return [];
		}
		const barLength = (60 / clock.bpm) * clock.beatsPerBar;
		const steps: StepSpec[] = [];
		value.forEach((raw, index) => {
			if (!isObj(raw)) {
				this.error(`timeline[${index}] must be a step object.`, line);
				return;
			}
			let at: number | null;
			if (isObj(raw.at) && typeof raw.at.bar === 'number' && raw.at.bar >= 0) at = raw.at.bar * barLength;
			else at = parseLength(raw.at);
			if (at === null) {
				this.error(`timeline[${index}].at must be a length like 12 or '0:12', or { bar }.`, line);
				return;
			}
			const step: StepSpec = { at };
			if (raw.section !== undefined) {
				if (SECTION_KINDS.includes(raw.section as SectionKind)) step.section = raw.section as SectionKind;
				else this.error(`timeline[${index}].section must be one of ${SECTION_KINDS.join(', ')}.`, line);
			}
			if (raw.look !== undefined) step.look = this.lookOrScene(raw.look, undefined, lineOf(raw.look) ?? line, silent);
			if (raw.palette !== undefined) {
				const palette = this.palette(raw.palette, line);
				if (palette) step.palette = palette;
			}
			for (const key of ['intensity', 'motion', 'energy'] as const) {
				if (raw[key] === undefined) continue;
				const v = raw[key];
				const hi = key === 'motion' ? 4 : key === 'intensity' ? 1.5 : 1;
				if (typeof v === 'number' && v >= 0 && v <= hi) step[key] = v;
				else this.error(`timeline[${index}].${key} must be a number from 0 to ${hi}.`, line);
			}
			if (raw.fade !== undefined) {
				if (typeof raw.fade === 'number' && raw.fade >= 0 && raw.fade <= 64) step.fade = raw.fade;
				else this.error(`timeline[${index}].fade is beats, from 0 to 64.`, line);
			}
			if (raw.hit !== undefined) {
				if (HIT_KINDS.includes(raw.hit as HitKind)) step.hit = raw.hit as HitKind;
				else this.error(`timeline[${index}].hit must be one of ${HIT_KINDS.join(', ')}.`, line);
			}
			if (raw.beats !== undefined) {
				if (typeof raw.beats === 'number' && raw.beats > 0 && raw.beats <= 16) step.beats = raw.beats;
				else this.error(`timeline[${index}].beats must be a number above 0, up to 16.`, line);
			}
			if (raw.kick !== undefined && raw.kick !== false) {
				if (raw.kick === true) step.kick = 1;
				else if (typeof raw.kick === 'number' && raw.kick > 0 && raw.kick <= 1) step.kick = raw.kick;
				else this.error(`timeline[${index}].kick must be true or a strength above 0, up to 1.`, line);
			}
			steps.push(step);
		});
		steps.sort((a, b) => a.at - b.at);
		return steps;
	}

	private sting(value: unknown, line?: SourceLine): StingSpec | null {
		if (!isObj(value) || value.kind !== 'sting') {
			this.error('enter.sting must be sting(...).', line);
			return null;
		}
		const own = lineOf(value) ?? line;
		const spec = isObj(value.spec) ? value.spec : {};
		const name = typeof value.name === 'string' && value.name.trim() ? value.name.trim() : 'Sting';
		const id = (typeof spec.id === 'string' && spec.id.trim()) || slug(name) || 'sting';
		const known = this.stings.get(id);
		if (known && (known.source === value || sameContent(known.source, value))) return known.spec;
		if (known) {
			this.error(`Two different stings share the id "${id}".`, own);
			return known.spec;
		}
		const length = this.length(spec.length, `sting "${name}" length`, own) ?? 0;
		if (length <= 0) this.error(`Sting "${name}" needs a length above zero.`, own);
		const clock = this.clock(spec, own);
		const palette = spec.palette === undefined ? undefined : this.palette(spec.palette, own);
		const timeline = this.timeline(spec.timeline, clock, own, true);
		if (timeline.length === 0) this.error(`Sting "${name}" needs a timeline.`, own);
		const compiled: StingSpec = {
			id,
			name,
			length,
			clock,
			timeline,
			...(palette ? { palette } : {}),
			...(own ? { line: own } : {})
		};
		this.stings.set(id, { source: value, spec: compiled });
		return compiled;
	}

	private lookOrScene(value: unknown, palette: unknown, line: SourceLine | undefined, silent: boolean): LookSpec {
		const own = palette === undefined ? undefined : this.palette(palette, line) ?? undefined;
		if (typeof value === 'string') {
			const look = sceneLook(value);
			if (!look) {
				this.error(`"${value}" is not a scene: ${AMBIENT_SCENES.map((s) => s.id).join(', ')}.`, line);
				return { layers: {}, ...(own ? { palette: own } : {}) };
			}
			if (silent && AMBIENT_SCENES.find((s) => s.id === value)?.needsMusic) {
				this.warn(`The "${value}" scene needs music to move, and this segment is silent.`, line);
			}
			return { ...look, ...(own ? { palette: own } : {}) };
		}
		if (isObj(value) && value.kind === 'look') {
			return this.look(value, own, lineOf(value) ?? line);
		}
		this.error('A look must be look(...) or a scene name.', line);
		return { layers: {} };
	}

	private look(value: Obj, palette: ShowPalette | undefined, line?: SourceLine): LookSpec {
		const spec = isObj(value.spec) ? value.spec : {};
		const layers: LookSpec['layers'] = {};
		for (const role of LAYER_ROLES) {
			const choice = spec[role];
			if (choice === undefined) continue;
			const layer = this.layer(role, choice, line);
			if (layer) layers[role] = layer;
		}
		if (Object.keys(layers).length === 0) this.error('A look needs at least one layer.', line);
		const out: LookSpec = { layers };
		const own = spec.palette === undefined ? palette : this.palette(spec.palette, line) ?? palette;
		if (own) out.palette = own;
		if (spec.intensity !== undefined) {
			if (typeof spec.intensity === 'number' && spec.intensity >= 0 && spec.intensity <= 1.5) out.intensity = spec.intensity;
			else this.error('A look\'s intensity must be a number from 0 to 1.5.', line);
		}
		if (spec.motion !== undefined) {
			if (typeof spec.motion === 'number' && spec.motion >= 0 && spec.motion <= 4) out.motion = spec.motion;
			else this.error('A look\'s motion must be a number from 0 to 4.', line);
		}
		if (spec.floor !== undefined) {
			if (typeof spec.floor === 'number' && spec.floor >= 0 && spec.floor <= 1) out.floor = spec.floor;
			else this.error('A look\'s floor must be a number from 0 to 1.', line);
		}
		return out;
	}

	private layer(role: LayerRole, choice: unknown, line?: SourceLine): LayerSpec | null {
		let effectRef: unknown = choice;
		let opacity: number | undefined;
		let params: Params | undefined;
		if (isObj(choice) && choice.kind !== 'effect') {
			effectRef = choice.effect;
			if (choice.opacity !== undefined) {
				if (typeof choice.opacity === 'number' && choice.opacity >= 0 && choice.opacity <= 1) opacity = choice.opacity;
				else this.error(`${role} opacity must be a number from 0 to 1.`, line);
			}
			if (choice.params !== undefined) {
				if (isObj(choice.params) && Object.values(choice.params).every((v) => typeof v === 'number' && Number.isFinite(v))) {
					params = { ...(choice.params as Params) };
				} else this.error(`${role} params must map names to numbers.`, line);
			}
		}

		let id: string | null = null;
		let paramKeys: string[] = [];
		if (typeof effectRef === 'string') {
			const def = this.builtIn.get(effectRef);
			if (!def) {
				this.error(`"${effectRef}" is not a built-in effect.`, line);
				return null;
			}
			if (def.role !== role) this.warn(`"${effectRef}" is a ${def.role} effect placed in the ${role} layer.`, line);
			id = def.id;
			paramKeys = def.params.map((p) => p.key);
		} else if (isObj(effectRef) && effectRef.kind === 'effect') {
			const gen = this.customEffect(effectRef);
			if (!gen) return null;
			if (gen.role !== role) this.warn(`Effect "${gen.id}" is a ${gen.role} effect placed in the ${role} layer.`, line);
			id = gen.id;
			paramKeys = gen.params.map((p) => p.key);
		} else {
			this.error(`The ${role} layer must name a built-in effect or use effect(...).`, line);
			return null;
		}

		// A master that stays dark until a hit arms it is meant to be lit when a look names it.
		if (paramKeys.includes('trigger') && params?.trigger === undefined) params = { ...params, trigger: 1 };
		if (params) {
			for (const key of Object.keys(params)) {
				if (!paramKeys.includes(key)) this.warn(`"${id}" has no parameter "${key}".`, line);
			}
		}
		// A custom effect sets its own brightness, so it is not dimmed to a built-in role's share.
		const custom = typeof effectRef !== 'string';
		return { effect: id, opacity: opacity ?? (custom ? 1 : DEFAULT_OPACITY[role]), ...(params ? { params } : {}) };
	}

	private customEffect(value: Obj): GeneratedEffect | null {
		const line = lineOf(value);
		const id = typeof value.id === 'string' ? value.id : '';
		if (!EFFECT_ID.test(id)) {
			this.error(`Effect id "${id}" must start with a letter and use letters, digits, - or _.`, line);
			return null;
		}
		if (this.builtIn.has(id)) {
			this.error(`Effect id "${id}" is already a built-in effect; choose another.`, line);
			return null;
		}
		const known = this.effects.get(id);
		if (known) {
			if (known.source !== value && !sameContent(known.source, value)) this.error(`Two different effects share the id "${id}".`, line);
			return known.gen;
		}
		const role = value.role as LayerRole;
		if (!LAYER_ROLES.includes(role)) {
			this.error(`Effect "${id}" needs a role: ${LAYER_ROLES.join(', ')}.`, line);
			return null;
		}
		const source = serializeCreate(value.create);
		if (!source) {
			this.error(`Effect "${id}" needs a create(g) function (not async).`, line);
			return null;
		}
		const params: ParamSpec[] = [];
		if (isObj(value.params)) {
			for (const [key, raw] of Object.entries(value.params)) {
				if (typeof raw === 'number' && Number.isFinite(raw)) {
					params.push({ key, label: key, min: Math.min(0, raw), max: Math.max(1, raw), step: 0.01, default: raw });
				} else if (isObj(raw) && typeof raw.default === 'number') {
					const min = typeof raw.min === 'number' ? raw.min : Math.min(0, raw.default);
					const max = typeof raw.max === 'number' ? raw.max : Math.max(1, raw.default);
					params.push({
						key,
						label: typeof raw.label === 'string' ? raw.label : key,
						min,
						max,
						step: typeof raw.step === 'number' ? raw.step : 0.01,
						default: raw.default
					});
				} else {
					this.error(`Effect "${id}" parameter "${key}" must be a number or { default }.`, line);
				}
			}
		}
		const gen: GeneratedEffect = {
			id,
			name: typeof value.name === 'string' && value.name ? value.name : id,
			role,
			blurb: typeof value.blurb === 'string' ? value.blurb : '',
			params,
			source
		};
		this.effects.set(id, { source: value, gen });
		return gen;
	}

	private gate(gen: GeneratedEffect, line?: SourceLine): void {
		const outer = this.segment;
		this.segment = undefined;
		const compiled = compileGenerated(gen, this.geometry);
		if (compiled.def) gen.admitted = true;
		for (const failure of compiled.failures) {
			const hint = /is not defined/.test(failure)
				? ' Inside create only the effect vocabulary and its own locals exist; move constants into create.'
				: '';
			this.error(`Effect "${gen.id}" failed the effect gate: ${failure}.${hint}`, line);
		}
		this.segment = outer;
	}

	private palette(value: unknown, line?: SourceLine): ShowPalette | undefined {
		if (typeof value === 'string') {
			const named = NAMED_PALETTES.find((p) => p.name === value);
			if (named) {
				const { name, base, accent, third, sat, shade } = named;
				return { name, base, accent, third, sat, shade };
			}
			this.error(`"${value}" is not a palette name: ${NAMED_PALETTES.map((p) => p.name).join(', ')}.`, line);
			return undefined;
		}
		if (isObj(value) && typeof value.base === 'number' && typeof value.accent === 'number') {
			const out: ShowPalette = { base: value.base, accent: value.accent };
			for (const key of ['third', 'sat', 'shade', 'white'] as const) {
				if (typeof value[key] === 'number') out[key] = value[key] as number;
			}
			if (typeof value.name === 'string') out.name = value.name;
			return out;
		}
		this.error('A palette is a name like \'ember\' or { base, accent } in hue degrees.', line);
		return undefined;
	}

	private checkOrder(segments: SegmentSpec[]): void {
		let last: { at: number; id: string } | null = null;
		segments.forEach((segment, index) => {
			this.segment = segment.id;
			if (segment.kind === 'block' && segment.open && index !== segments.length - 1) {
				this.error('Only the last segment can be open.', segment.line);
			}
			const clock = segment.at ?? segment.notBefore;
			if (!clock) return;
			const minutes = (parseClock(clock)! - 12 * 60 + 1440) % 1440;
			if (last && minutes < last.at) {
				this.error(`${clock} comes before the time set on "${last.id}"; times must run in order.`, segment.line);
			}
			last = { at: minutes, id: segment.id };
		});
		this.segment = undefined;
	}
}

type BaseSpec = {
	id: string;
	name: string;
	at?: string;
	notBefore?: string;
	enter?: EntrySpec;
	line?: SourceLine;
};

/** Two definitions agree apart from where they were written, functions compared by source. */
function sameContent(a: unknown, b: unknown): boolean {
	const text = (v: unknown) =>
		JSON.stringify(v, (key, inner) => (key === 'line' ? undefined : typeof inner === 'function' ? String(inner) : inner));
	return text(a) === text(b);
}

/** Validate and normalise an evening module's default export. */
export function compileEvening(value: unknown, options: CompileOptions = {}): CompileResult {
	const compiler = new Compiler(options);
	const script = compiler.evening(value);
	return { script, findings: compiler.findings };
}

/** A calm scene as a look, the way a pause or hold names one. */
export function sceneLook(id: string): LookSpec | null {
	const scene = AMBIENT_SCENES.find((s) => s.id === id);
	if (!scene) return null;
	const layers: LookSpec['layers'] = {};
	for (const [role, layer] of Object.entries(scene.layers) as [LayerRole, LayerSpec][]) {
		layers[role] = {
			effect: layer.effect,
			opacity: layer.opacity ?? DEFAULT_OPACITY[role],
			...(layer.params ? { params: { ...layer.params } } : {})
		};
	}
	return { layers };
}
