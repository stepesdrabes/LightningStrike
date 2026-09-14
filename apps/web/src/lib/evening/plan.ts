import type {
	BlockSpec,
	ClockSpec,
	EveningScript,
	FillSpec,
	Finding,
	GeneratedEffect,
	LookSpec,
	PauseSpec,
	RowPlan,
	SegmentKind,
	SegmentSpec,
	ShowPalette,
	SongSpec,
	SourceLine,
	StepSpec,
	StingSpec
} from '@mv/core';
import { DEFAULT_CLOCK, clockOnNight, parseClock, sceneLook } from '@mv/core';
import { signatureOf, type EveningTag, type QueueItem, type QueueState, type RowKind, type RowRole } from '../queueModel.ts';
import { matchSong, songKeysOf, type LibraryTrack } from './library.ts';

/** The director's dissolve for a new track, used unless the file says otherwise. */
export const DEFAULT_LIGHT = 1.5;
/** Seconds between rows while the next one loads, when they do not crossfade. */
const LOAD_GAP = 0.5;
/** Rows starting this soon keep their place, so preparation and the rail stay still. */
export const FREEZE_AHEAD = 8 * 60;
/** An early arrival shorter than this starts early rather than waiting. */
const MIN_WAIT = 20;
/** Lateness under this is on time. */
const LATE_GRACE = 60;
/** A fill change must gain at least this many seconds against its target. */
const GAIN_MIN = 30;
/** Songs by one artist stay at least this many songs apart when fill can manage it. */
const ARTIST_GAP = 2;
/** An open final block keeps this much music planned ahead. */
const OPEN_HORIZON = 60 * 60;
const UNKNOWN_SONG = 210;

const FALLBACK_PALETTE: ShowPalette = { name: 'copper', base: 24, accent: 200, third: 320, sat: 0.94, shade: 0.12 };
const DARK: LookSpec = { layers: { bed: { effect: 'blackout', opacity: 1 } } };

export interface Progress {
	key: string;
	/** Seconds into the row. */
	position: number;
	/** When it was reported, epoch ms. */
	at: number;
	playing: boolean;
}

export interface PlanMemory {
	/** Fill picks by `segment:item`, in order. Sticky: kept unless no longer eligible. */
	picks: Record<string, string[]>;
	/** Request row keys placed by `segment:item`, in order. */
	placed: Record<string, string[]>;
	/** Row keys the host skipped before they played. */
	skipped: string[];
	/** Track ids that played or were skipped, never picked again tonight. */
	used: string[];
	/** Holds the host asked for after a segment, with their row keys. */
	holds: { after: string; key: string }[];
	/** Segment ids an edit renamed while the evening ran, old to new. */
	renamed?: Record<string, string>;
}

export const EMPTY_MEMORY: PlanMemory = { picks: {}, placed: {}, skipped: [], used: [], holds: [] };

export interface PlanInput {
	script: EveningScript;
	run: string;
	library: readonly LibraryTrack[];
	queue: QueueState;
	/** The evening's now, epoch ms: the wall clock, or a rehearsal's. */
	now: number;
	/** What `Date.getTimezoneOffset` gives on the night. */
	offsetMinutes: number;
	/** Whether the queue holds this evening's rows. */
	running: boolean;
	progress: Progress | null;
	/** The hold row waiting for Go, and since when. */
	hold: { key: string; since: number } | null;
	/** When the current timed row ends. */
	timedEndsAt: number | null;
	memory: PlanMemory;
	/** Prepared narration audio by path: its length in seconds. */
	narrations?: Readonly<Record<string, number>>;
}

export interface PlannedRow {
	key: string;
	kind: RowKind;
	/** Null for a row the host played next by hand, which stays out of the evening's segments. */
	tag: EveningTag | null;
	trackId: string | null;
	title: string;
	artist: string;
	thumbnail: string;
	source: string;
	/** Seconds; for a hold, the time it is expected to wait. */
	duration: number;
	startAt: number;
	endAt: number;
	/** Dissolve into this row, seconds; 0 cuts. */
	light: number;
	lighting: RowPlan;
	ready: boolean;
	frozen: boolean;
	addedBy?: string;
	/** Songs: cross-track heat, 1 to 5, for the rail's outline of the night. */
	heat?: number;
}

export interface SegmentProjection {
	id: string;
	name: string;
	kind: SegmentKind;
	startAt: number;
	endAt: number;
	songs: number;
	state: 'done' | 'current' | 'upcoming';
	anchor?: { kind: 'at' | 'notBefore'; clock: string; time: number; late: number };
	open: boolean;
	line?: SourceLine;
}

export interface Plan {
	rows: PlannedRow[];
	segments: SegmentProjection[];
	findings: Finding[];
	memory: PlanMemory;
	/** When the last row ends; null for an open final block. */
	endsAt: number | null;
	/** Requests waiting for a slot, in the order they would be placed. */
	waiting: string[];
}

interface Atom {
	key: string;
	kind: RowKind;
	segmentIndex: number;
	segment: SegmentSpec;
	slot: string;
	role: RowRole;
	trackId: string | null;
	title: string;
	artist: string;
	thumbnail: string;
	source: string;
	duration: number;
	/** Holds: how long they are expected to wait from their start, or when they end. */
	expect?: { seconds?: number; clock?: string };
	light: number;
	crossfade: number;
	lighting: RowPlan;
	ready: boolean;
	addedBy?: string;
	heat?: number;
	/** A fill slot with a length target, which is what anchors may grow or shrink. */
	elastic?: string;
	/** A committed row's own tag, when the script no longer places it; null when no evening did. */
	tag?: EveningTag | null;
	startAt: number;
	endAt: number;
	frozen: boolean;
}

function watchUrl(id: string): string {
	return `https://music.youtube.com/watch?v=${id}`;
}

function fnv(text: string): number {
	let h = 0x811c9dc5;
	for (let i = 0; i < text.length; i++) {
		h ^= text.charCodeAt(i);
		h = Math.imul(h, 0x01000193) >>> 0;
	}
	return h / 4294967296;
}

function artistKey(artist: string): string {
	return signatureOf(artist, '').replace(/:$/, '');
}

class Planner {
	private readonly input: PlanInput;
	private readonly script: EveningScript;
	private readonly findings: Finding[] = [];
	private readonly memory: PlanMemory;
	private readonly byId: Map<string, LibraryTrack>;
	private readonly effects: Map<string, GeneratedEffect>;
	private readonly stings: Map<string, StingSpec>;
	/** Track ids placed so far in this expansion. */
	private readonly taken = new Set<string>();
	/** Songs the script names anywhere, which no fill may take first. */
	private readonly named = new Set<string>();
	/** Song keys of the named songs, so a fill never picks another upload of one. */
	private readonly namedSongs = new Set<string>();
	private readonly songKeys = new Map<string, string[]>();
	private readonly used: Set<string>;
	private readonly skipped: Set<string>;
	/** Requests in the order they would be placed, and whether each has been. */
	private readonly pool: QueueItem[];
	private readonly pooled = new Set<string>();
	/** Queue rows kept as they are, from the current row on: see `commit`. */
	private readonly committed: QueueItem[] = [];
	private readonly committedKeys = new Set<string>();
	private readonly committedTracks = new Set<string>();
	/** Songs the host played by hand tonight, which fills do not choose again. */
	private readonly byHand = new Set<string>();
	/** Rows before the current one, and their songs: played or passed over. */
	private readonly history = new Set<string>();
	private readonly historyTracks = new Set<string>();
	/** The segment the evening has reached: fills before it take no new requests. */
	private reached = -1;
	private currentAt = -1;
	/** Songs the host removed, as `segment|track`, so an edit that moves them does not bring them back. */
	private readonly removed = new Set<string>();

	constructor(input: PlanInput) {
		this.input = input;
		this.script = input.script;
		this.memory = {
			picks: { ...input.memory.picks },
			placed: {},
			skipped: [...input.memory.skipped],
			used: [...input.memory.used],
			holds: [...input.memory.holds],
			...(input.memory.renamed ? { renamed: { ...input.memory.renamed } } : {})
		};
		this.byId = new Map(input.library.map((t) => [t.id, t]));
		this.effects = new Map(input.script.effects.map((e) => [e.id, e]));
		this.stings = new Map(input.script.stings.map((s) => [s.id, s]));
		this.used = new Set(input.memory.used);
		this.skipped = new Set(input.memory.skipped.flatMap((k) => [k, this.renamedKey(k)]));
		for (const key of this.skipped) {
			const parts = key.split(':');
			if (parts.length === 4) this.removed.add(`${parts[1]}|${parts[3]}`);
		}
		this.pool = input.running ? requestPool(input.queue, input.run) : [];
		this.commit();
	}

	private key(segment: string, slot: string, trackId?: string | null): string {
		return `ev${this.input.run}:${segment}:${slot}${trackId ? `:${trackId}` : ''}`;
	}

	/** The id a segment goes by now, after renames while the evening ran. */
	private segmentOf(id: string): string {
		const renamed = this.input.memory.renamed ?? {};
		let out = id;
		for (let n = 0; n < 16 && renamed[out] !== undefined; n++) out = renamed[out];
		return out;
	}

	/** A row key with its segment as it is called now. */
	private renamedKey(key: string): string {
		const parts = key.split(':');
		if (parts.length < 3 || parts[0] !== `ev${this.input.run}`) return key;
		parts[1] = this.segmentOf(parts[1]);
		return parts.join(':');
	}

	/** A fill slot's picks, under the name its segment had when they were made. */
	private picksOf(segment: string, itemIndex: number): string[] {
		const own = this.input.memory.picks[`${segment}:${itemIndex}`];
		if (own) return own;
		const renamed = Object.entries(this.input.memory.picks).find(([slot]) => {
			const [id, item] = slot.split(':');
			return item === String(itemIndex) && this.segmentOf(id) === segment;
		});
		return renamed?.[1] ?? [];
	}

	private find(severity: Finding['severity'], message: string, segment?: SegmentSpec, line?: SourceLine): void {
		const at = line ?? segment?.line;
		if (this.findings.some((f) => f.message === message && f.segment === segment?.id)) return;
		this.findings.push({ severity, message, ...(segment ? { segment: segment.id } : {}), ...(at ? { line: at } : {}) });
	}

	run(): Plan {
		const atoms = this.expand();
		const placed = this.place(atoms);
		this.time(placed);
		this.anchor(placed);
		this.readiness(placed);
		const rows = placed.map((a) => this.row(a));
		const segments = this.projections(placed);
		const last = rows[rows.length - 1];
		const open = this.script.segments.some((s) => s.kind === 'block' && s.open);
		const planned = new Set(rows.map((r) => r.key));
		return {
			rows,
			segments,
			findings: this.findings,
			memory: this.memory,
			endsAt: open || !last ? null : last.endAt,
			waiting: this.pool.filter((r) => !planned.has(r.key)).map((r) => r.key)
		};
	}

	// ---- Expansion: every row the script asks for, in order ---------------------------------

	private expand(): Atom[] {
		for (const segment of this.script.segments) {
			const items = segment.kind === 'block' ? segment.items : segment.kind === 'pause' ? segment.music : [];
			for (const item of items) {
				if (item.kind !== 'song') continue;
				const match = matchSong(this.input.library, item.title, item.by, item.id);
				if (match.kind === 'found') this.named.add(match.track.id);
				else if (item.id) this.named.add(item.id);
				for (const key of songKeysOf(item.title)) this.namedSongs.add(key);
				if (match.kind === 'found') for (const key of this.keysOf(match.track)) this.namedSongs.add(key);
			}
		}
		const atoms: Atom[] = [];
		let previous: Atom | null = null;
		this.script.segments.forEach((segment, index) => {
			const start = atoms.length;
			const entry = segment.enter;
			const sting = entry?.sting ? this.stings.get(entry.sting) : undefined;
			const gap = entry?.gap ?? sting?.length ?? 0;
			if (gap > 0) atoms.push(this.stingAtom(segment, index, sting, gap));

			switch (segment.kind) {
				case 'block':
					this.blockAtoms(segment, index, atoms);
					break;
				case 'pause':
					this.pauseAtoms(segment, index, atoms);
					break;
				case 'hold':
					atoms.push(this.silentAtom(segment, index, 'hold', 'h', 'hold', 0, segment.look, segment.expect !== undefined || segment.expectAt ? { seconds: segment.expect, clock: segment.expectAt } : { seconds: 0 }));
					break;
				case 'moment':
					atoms.push(this.momentAtom(segment, index));
					break;
				case 'narration':
					atoms.push(this.narrationAtom(segment, index));
					break;
			}
			// A row the host removed stays removed, whatever its kind.
			for (let i = atoms.length - 1; i >= start; i--) {
				if (this.skipped.has(atoms[i].key) && !this.committedKeys.has(atoms[i].key)) atoms.splice(i, 1);
			}

			// Hand over into the segment's first content row.
			const afterSting = gap > 0 && atoms[start]?.kind === 'sting';
			const first = atoms[afterSting ? start + 1 : start];
			if (first) {
				const crossfade = entry?.crossfade ?? 0;
				first.crossfade = !afterSting && crossfade > 0 && first.kind === 'song' && previous?.kind === 'song' ? crossfade : 0;
				// The lights cross over with the music unless the file says otherwise.
				first.light = entry?.light ?? (afterSting ? 0 : first.crossfade > 0 ? first.crossfade : DEFAULT_LIGHT);
				if (entry?.hit && first.lighting.kind === 'song') first.lighting = { ...first.lighting, hit: entry.hit };
			}
			// A hold already passed, by Go, a skip or a jump, is not waited on again.
			const hostHolds = this.memory.holds.filter((h) => this.segmentOf(h.after) === segment.id && !this.history.has(h.key) && !this.skipped.has(h.key));
			hostHolds.forEach((h, k) => {
				const look = sceneLook('resting') ?? DARK;
				const atom = this.silentAtom(segment, index, 'hold', `hold${k}`, 'hold', 0, look, { seconds: 0 });
				atom.key = h.key;
				atoms.push(atom);
			});
			previous = atoms[atoms.length - 1] ?? previous;
		});
		return atoms;
	}

	private base(segment: SegmentSpec, index: number, kind: RowKind, slot: string, role: RowRole): Omit<Atom, 'lighting' | 'duration'> {
		return {
			key: this.key(segment.id, slot),
			kind,
			segmentIndex: index,
			segment,
			slot,
			role,
			trackId: null,
			title: segment.name,
			artist: '',
			thumbnail: '',
			source: '',
			light: DEFAULT_LIGHT,
			crossfade: 0,
			ready: true,
			startAt: 0,
			endAt: 0,
			frozen: false
		};
	}

	private palette(...candidates: (ShowPalette | undefined)[]): ShowPalette {
		return candidates.find((p) => p !== undefined) ?? this.script.palette ?? FALLBACK_PALETTE;
	}

	private effectsOf(looks: (LookSpec | undefined)[]): GeneratedEffect[] {
		const ids = new Set<string>();
		for (const look of looks) {
			if (!look) continue;
			for (const layer of Object.values(look.layers)) if (layer && this.effects.has(layer.effect)) ids.add(layer.effect);
		}
		return [...ids].map((id) => this.effects.get(id)!);
	}

	private silentAtom(
		segment: SegmentSpec,
		index: number,
		kind: RowKind,
		slot: string,
		role: RowRole,
		duration: number,
		look: LookSpec,
		expect?: Atom['expect']
	): Atom {
		const clock: ClockSpec = { bpm: 40, beatsPerBar: 4, pulse: 'none' };
		return {
			...this.base(segment, index, kind, slot, role),
			duration,
			...(expect ? { expect } : {}),
			lighting: {
				kind: 'silent',
				title: segment.name,
				length: kind === 'hold' ? null : duration,
				clock,
				timeline: [{ at: 0, look }],
				palette: this.palette(look.palette),
				calm: true,
				effects: this.effectsOf([look])
			}
		};
	}

	private stingAtom(segment: SegmentSpec, index: number, sting: StingSpec | undefined, gap: number): Atom {
		const timeline: StepSpec[] = sting?.timeline ?? [{ at: 0, section: 'void', look: DARK }];
		return {
			...this.base(segment, index, 'sting', 's', 'sting'),
			title: sting?.name ?? 'Silence',
			duration: gap,
			light: 0,
			lighting: {
				kind: 'silent',
				title: sting?.name ?? 'Silence',
				length: gap,
				clock: sting?.clock ?? DEFAULT_CLOCK,
				timeline,
				palette: this.palette(sting?.palette),
				calm: false,
				effects: this.effectsOf(timeline.map((s) => s.look))
			}
		};
	}

	private momentAtom(segment: Extract<SegmentSpec, { kind: 'moment' }>, index: number): Atom {
		return {
			...this.base(segment, index, 'moment', 'x', 'moment'),
			duration: segment.length,
			lighting: {
				kind: 'silent',
				title: segment.name,
				length: segment.length,
				clock: segment.clock,
				timeline: segment.timeline,
				palette: this.palette(segment.palette),
				calm: false,
				effects: this.effectsOf(segment.timeline.map((s) => s.look))
			}
		};
	}

	private narrationAtom(segment: Extract<SegmentSpec, { kind: 'narration' }>, index: number): Atom {
		const length = this.input.narrations?.[segment.audio];
		if (length === undefined) this.find('warning', 'This narration is not prepared yet; Prepare reads its audio.', segment);
		return {
			...this.base(segment, index, 'narration', 'v', 'narration'),
			source: segment.audio,
			duration: length ?? 0,
			ready: length !== undefined,
			lighting: {
				kind: 'narration',
				title: segment.name,
				length: length ?? 0,
				clock: segment.clock,
				timeline: segment.timeline,
				palette: this.palette(segment.palette),
				volume: segment.volume,
				end: segment.end,
				effects: this.effectsOf(segment.timeline.map((s) => s.look))
			}
		};
	}

	private songAtom(
		segment: SegmentSpec,
		index: number,
		slot: string,
		role: RowRole,
		track: LibraryTrack | { id: string; title: string; artist: string },
		lighting: SongSpec['lighting'] | 'calm',
		spec?: SongSpec,
		calm = lighting === 'calm'
	): Atom {
		const known = 'duration' in track ? track : null;
		const look = typeof lighting === 'object' ? lighting : undefined;
		const overlays = spec?.overlays ?? [];
		const palette = segment.kind === 'block' ? segment.palette : undefined;
		return {
			...this.base(segment, index, 'song', slot, role),
			key: this.key(segment.id, slot.replace(/\.\d+$/, ''), track.id),
			trackId: track.id,
			title: known?.title ?? track.title,
			artist: known?.artist ?? track.artist,
			thumbnail: known?.thumbnail ?? '',
			source: known?.source || watchUrl(track.id),
			duration: known && known.duration > 0 ? known.duration : UNKNOWN_SONG,
			ready: known?.ready ?? false,
			...(known ? { heat: this.script.heat[track.id] ?? known.heat } : {}),
			lighting: {
				kind: 'song',
				trackId: track.id,
				calm: calm || (known?.loungeOnly ?? false),
				...(look ? { look } : {}),
				...(palette ? { palette } : {}),
				overlays,
				...(spec?.hit ? { hit: spec.hit } : {}),
				effects: this.effectsOf([look, ...overlays.map((o) => o.look)])
			}
		};
	}

	private resolveNamed(spec: SongSpec, segment: SegmentSpec): LibraryTrack | { id: string; title: string; artist: string } | null {
		const match = matchSong(this.input.library, spec.title, spec.by, spec.id);
		if (match.kind === 'found') return match.track;
		if (match.kind === 'ambiguous') {
			const names = match.tracks.slice(0, 3).map((t) => `${t.artist} - ${t.title} (${t.id})`).join('; ');
			this.find('error', `"${spec.title}" matches more than one song: ${names}. Add by or id.`, segment, spec.line);
			return match.tracks[0];
		}
		if (spec.id) {
			this.find('warning', `"${spec.title}" is not in the library yet; Prepare fetches it.`, segment, spec.line);
			return { id: spec.id, title: spec.title, artist: spec.by ?? '' };
		}
		this.find('error', `"${spec.title}" is not in the library. Check the title, or add its id.`, segment, spec.line);
		return null;
	}

	private blockAtoms(segment: BlockSpec, index: number, atoms: Atom[]): void {
		const start = atoms.length;
		segment.items.forEach((item, itemIndex) => {
			if (item.kind === 'song') {
				const track = this.resolveNamed(item, segment);
				if (!track || this.removed.has(`${segment.id}|${track.id}`)) return;
				if (this.taken.has(track.id)) {
					this.find('warning', `"${item.title}" is already in the evening; it plays once.`, segment, item.line);
					return;
				}
				this.taken.add(track.id);
				atoms.push(this.songAtom(segment, index, `i${itemIndex}`, 'named', track, item.lighting ?? segment.lighting, item));
			} else {
				this.fillAtoms(segment, index, itemIndex, item, atoms, segment.lighting);
			}
		});
		// Between songs inside the block.
		for (let i = start + 1; i < atoms.length; i++) {
			atoms[i].crossfade = segment.between.crossfade ?? 0;
			atoms[i].light = segment.between.light ?? (atoms[i].crossfade > 0 ? atoms[i].crossfade : DEFAULT_LIGHT);
		}
	}

	private pauseAtoms(segment: Extract<SegmentSpec, { kind: 'pause' }>, index: number, atoms: Atom[]): void {
		if (segment.music.length === 0) {
			atoms.push(this.silentAtom(segment, index, 'pause', 'p', 'pause', segment.length ?? 0, segment.look ?? sceneLook('resting') ?? DARK));
			return;
		}
		const start = atoms.length;
		segment.music.forEach((item, itemIndex) => {
			if (item.kind === 'song') {
				const track = this.resolveNamed(item, segment);
				if (!track || this.taken.has(track.id) || this.removed.has(`${segment.id}|${track.id}`)) return;
				this.taken.add(track.id);
				atoms.push(this.songAtom(segment, index, `m${itemIndex}`, 'music', track, segment.look ?? 'calm', item, true));
			} else {
				this.fillAtoms(segment, index, itemIndex, { ...item, lighting: undefined }, atoms, segment.look ?? 'calm', 'm');
			}
		});
		for (let i = start + 1; i < atoms.length; i++) atoms[i].light = DEFAULT_LIGHT;
	}

	/**
	 * Songs chosen by criteria, sticky across replans, rising or falling over the slot. Rows of the
	 * slot that played or are playing count toward its count or length; rows the queue committed
	 * to come first, then new requests, then library songs.
	 */
	private fillAtoms(
		segment: SegmentSpec,
		index: number,
		itemIndex: number,
		spec: FillSpec,
		atoms: Atom[],
		blockLighting: BlockSpec['lighting'] | 'calm',
		prefix = 'i'
	): void {
		const { queue, run } = this.input;
		const slotKey = `${segment.id}:${itemIndex}`;
		const base = `${prefix}${itemIndex}`;
		const lighting = spec.lighting ?? (blockLighting === 'calm' ? 'calm' : blockLighting);
		const role: RowRole = prefix === 'm' ? 'music' : 'fill';
		const calm = role === 'music' || lighting === 'calm';
		// An open block's last fill keeps choosing songs about an hour ahead, past its count or length.
		const openEnded = segment.kind === 'block' && segment.open && lastFill(segment.items) === itemIndex;
		const target = openEnded ? null : (spec.count ?? null);
		const lengthTarget = openEnded ? null : (spec.length ?? null);
		const picked: Atom[] = [];

		const inSlot = (i: QueueItem) =>
			i.evening?.run === run && this.segmentOf(i.evening.segment) === segment.id && i.evening.slot.replace(/\.\d+$/, '') === base;
		const spent = queue.items.slice(0, this.currentAt + 1).filter((i) => inSlot(i) && (i.kind ?? 'song') === 'song');
		const spentSeconds = spent.reduce((sum, i) => sum + (i.duration || UNKNOWN_SONG), 0);
		const spentTracks = new Set(spent.flatMap((i) => (i.trackId ? [i.trackId] : [])));
		const count = () => spent.length + picked.length;
		const fixed = new Set<string>();

		const request = (item: QueueItem) => {
			this.pooled.add(item.key);
			this.taken.add(item.trackId!);
			const known = this.byId.get(item.trackId!);
			const atom = this.songAtom(segment, index, `${base}.${count()}`, 'request', known ?? { id: item.trackId!, title: item.title, artist: item.uploader }, lighting, undefined, calm);
			atom.key = item.key;
			atom.addedBy = item.addedBy;
			if (!known) {
				atom.duration = item.duration || UNKNOWN_SONG;
				atom.thumbnail = item.thumbnail;
				atom.source = item.source;
				atom.ready = item.status === 'ready';
			}
			picked.push(atom);
			return atom;
		};
		const push = (track: LibraryTrack) => {
			this.taken.add(track.id);
			const atom = this.songAtom(segment, index, `${base}.${count()}`, role, track, lighting, undefined, calm);
			picked.push(atom);
			return atom;
		};

		for (const item of this.committed) {
			if (item.key === queue.currentKey || !inSlot(item) || !item.trackId || this.taken.has(item.trackId)) continue;
			if (item.evening!.role === 'request') fixed.add(request(item).key);
			else {
				const track = this.byId.get(item.trackId);
				if (track) fixed.add(push(track).key);
			}
		}

		// New requests, when the slot drains them and the evening has not passed it.
		if (spec.from !== 'library' && index >= this.reached) {
			for (const item of this.pool) {
				if (this.committedKeys.has(item.key) || this.pooled.has(item.key) || !item.trackId || this.taken.has(item.trackId)) continue;
				// A song the evening names plays in its own place; a request placed in another slot stays there.
				if (this.named.has(item.trackId) || this.committedTracks.has(item.trackId)) continue;
				if (item.evening?.run === run && !inSlot(item)) continue;
				if (target !== null && count() >= target) break;
				if (lengthTarget !== null && spentSeconds + total(picked) + (item.duration || UNKNOWN_SONG) > lengthTarget + LATE_GRACE) continue;
				request(item);
			}
		}
		const placed = picked.filter((a) => a.role === 'request').map((a) => a.key);
		if (placed.length > 0) this.memory.placed[slotKey] = placed;
		if (spec.from === 'requests') {
			atoms.push(...picked);
			return;
		}

		const candidates = this.candidates(spec);
		const sticky = this.picksOf(segment.id, itemIndex).filter((id) => {
			const track = this.byId.get(id);
			if (!track || spentTracks.has(id) || this.taken.has(id) || this.named.has(id) || this.byHand.has(id) || this.skipped.has(this.key(segment.id, base, id))) return false;
			return candidates.some((c) => c.id === id) || this.used.has(id);
		});
		const choose = (position: number, size: number): LibraryTrack | null => {
			const recent = [...atoms, ...picked].slice(-ARTIST_GAP).map((a) => artistKey(a.artist));
			const pool = candidates.filter((c) => this.fresh(c));
			if (pool.length === 0) return null;
			const spaced = pool.filter((c) => !recent.includes(artistKey(c.artist)));
			const from = spaced.length > 0 ? spaced : pool;
			const [lo, hi] = spec.where.heat ?? [1, 5];
			const u = size <= 1 ? 0.5 : position / (size - 1);
			const want =
				spec.order === 'rising' ? lo + (hi - lo) * u : spec.order === 'falling' ? hi - (hi - lo) * u : (lo + hi) / 2;
			const score = (t: LibraryTrack) =>
				(spec.order === 'shuffle' ? 0 : Math.abs(t.heat - want)) +
				(t.ready ? 0 : 0.6) +
				0.08 * fnv(`${this.script.name}|${slotKey}|${t.id}`);
			return from.reduce((best, t) => (score(t) < score(best) ? t : best), from[0]);
		};

		const typical = median(candidates.map((c) => c.duration || UNKNOWN_SONG));
		const estimate =
			target ??
			(lengthTarget !== null
				? Math.max(1, Math.round(lengthTarget / typical))
				: openEnded
					? spent.length + Math.max(spec.count ?? 1, Math.round(OPEN_HORIZON / typical))
					: 1);
		for (const id of sticky) {
			if (target !== null && count() >= target) break;
			push(this.byId.get(id)!);
		}
		while (count() < estimate) {
			const next = choose(count(), estimate);
			if (!next) break;
			push(next);
		}
		if (lengthTarget !== null) {
			this.fitLength(picked, lengthTarget - spentSeconds, fixed, () => choose(count(), count() + 1), push);
		}

		if (target !== null && count() < target) {
			this.find('error', `A fill here needs ${target} songs and only ${count()} match its criteria.`, segment, spec.line);
		}
		if (candidates.length === 0 && spec.from === 'library') {
			this.find('error', 'Nothing in the library matches this fill.', segment, spec.line);
		}
		for (const atom of picked) if (lengthTarget !== null && atom.role !== 'request') atom.elastic = slotKey;
		const library = (list: { trackId: string | null }[]) => list.flatMap((a) => (a.trackId ? [a.trackId] : []));
		this.memory.picks[slotKey] = [
			...new Set([
				...library(spent.filter((i) => i.evening!.role !== 'request')),
				...library(picked.filter((a) => a.role !== 'request'))
			])
		];
		atoms.push(...picked);
	}

	/** Add or remove tail picks while the change beats the hysteresis; committed picks stay. */
	private fitLength(
		picked: Atom[],
		target: number,
		fixed: ReadonlySet<string>,
		next: () => LibraryTrack | null,
		push: (t: LibraryTrack) => void
	): void {
		for (let guard = 0; guard < 64; guard++) {
			const err = total(picked) - target;
			const tail = picked[picked.length - 1];
			const removable = tail && tail.role !== 'request' && !fixed.has(tail.key);
			const removeGain = removable ? Math.abs(err) - Math.abs(err - tail.duration) : -Infinity;
			if (err > 0 && removeGain >= Math.max(GAIN_MIN, 0.2 * (tail?.duration ?? 0))) {
				picked.pop();
				this.taken.delete(tail.trackId!);
				continue;
			}
			if (err < 0) {
				const candidate = next();
				if (!candidate) break;
				const d = candidate.duration || UNKNOWN_SONG;
				const addGain = Math.abs(err) - Math.abs(err + d);
				if (addGain >= Math.max(GAIN_MIN, 0.2 * d)) {
					push(candidate);
					continue;
				}
			}
			break;
		}
	}

	private keysOf(track: LibraryTrack): string[] {
		let keys = this.songKeys.get(track.id);
		if (!keys) {
			keys = songKeysOf(track.title);
			this.songKeys.set(track.id, keys);
		}
		return keys;
	}

	/** Whether a fill may still choose this track: not placed, played or named, under any upload. */
	private fresh(candidate: LibraryTrack): boolean {
		if (this.taken.has(candidate.id) || this.used.has(candidate.id) || this.named.has(candidate.id) || this.byHand.has(candidate.id)) return false;
		const keys = this.keysOf(candidate);
		if (keys.some((k) => this.namedSongs.has(k))) return false;
		for (const id of [...this.taken, ...this.used]) {
			const other = this.byId.get(id);
			if (other && this.keysOf(other).some((k) => keys.includes(k))) return false;
		}
		return true;
	}

	private candidates(spec: FillSpec): LibraryTrack[] {
		const w = spec.where;
		const exclude = new Set(w.exclude ?? []);
		const artists = w.artists?.map(artistKey);
		const heatFor = (t: LibraryTrack) => this.script.heat[t.id] ?? t.heat;
		const out = this.input.library
			.map((t) => (this.script.heat[t.id] !== undefined ? { ...t, heat: heatFor(t) } : t))
			.filter((t) => {
				if (exclude.has(t.id)) return false;
				if (t.loungeOnly && spec.lighting !== 'calm') return false;
				if (w.families && (!t.genre || !w.families.includes(t.genre))) return false;
				if (w.heat && (t.heat < w.heat[0] || t.heat > w.heat[1])) return false;
				if (w.bpm && (t.bpm === null || t.bpm < w.bpm[0] || t.bpm > w.bpm[1])) return false;
				const minutes = (t.duration || UNKNOWN_SONG) / 60;
				if (w.minutes && (minutes < w.minutes[0] || minutes > w.minutes[1])) return false;
				if (artists && !artists.includes(artistKey(t.artist))) return false;
				return true;
			})
			.sort((a, b) => a.id.localeCompare(b.id));
		return out;
	}

	// ---- The queue's committed rows ---------------------------------------------------------

	/**
	 * What the queue has committed to: the current row, rows played next by hand, and the
	 * evening's rows starting within the horizon. Known before expansion, so fills leave committed
	 * requests where they are.
	 */
	private commit(): void {
		const { queue, running, run, progress } = this.input;
		if (!running) return;
		const at = queue.items.findIndex((i) => i.key === queue.currentKey);
		if (at === -1) return;
		this.currentAt = at;
		const segmentIndex = new Map(this.script.segments.map((s, i) => [s.id, i]));
		for (const item of queue.items.slice(0, at)) {
			this.history.add(item.key);
			this.history.add(this.renamedKey(item.key));
			if (item.trackId) this.historyTracks.add(item.trackId);
			if (item.trackId && item.evening?.run !== run) this.byHand.add(item.trackId);
		}
		for (const item of queue.items.slice(0, at + 1)) {
			const tag = item.evening;
			if (tag?.run === run && tag.role !== 'request') this.reached = segmentIndex.get(this.segmentOf(tag.segment)) ?? this.reached;
		}
		let t = this.input.now;
		let interjecting = true;
		for (let i = at; i < queue.items.length; i++) {
			const item = queue.items[i];
			if (i > at && this.skipped.has(item.key)) continue;
			// A hold the host asked for and has since let go of is not waited on twice.
			if (i > at && item.evening?.slot.startsWith('hold') && !this.memory.holds.some((h) => h.key === item.key)) continue;
			const ours = item.evening?.run === run;
			// Rows played next by hand sit straight after the current row and keep their place.
			if (i > at && !ours && !interjecting) break;
			if (i > at && ours) interjecting = false;
			if (i > at + 1 && ours && t > this.input.now + FREEZE_AHEAD * 1000) break;
			// A song already coming up, played by hand or requested again, is not committed to twice.
			if (i > at && item.trackId && this.committedTracks.has(item.trackId)) continue;
			this.committed.push(item);
			this.committedKeys.add(item.key);
			this.committedKeys.add(this.renamedKey(item.key));
			if (item.trackId) this.committedTracks.add(item.trackId);
			if (item.trackId && !ours) this.byHand.add(item.trackId);
			const length = item.duration || ((item.kind ?? 'song') === 'hold' ? 0 : UNKNOWN_SONG);
			const into = i === at && progress?.key === item.key ? progress.position : 0;
			t += Math.max(0, length - into) * 1000;
		}
	}

	/** Keep what the queue has committed to, then every row of the script still to come. */
	private place(atoms: Atom[]): Atom[] {
		if (this.committed.length === 0) return atoms;
		const { queue } = this.input;
		const segmentIndex = new Map(this.script.segments.map((s, i) => [s.id, i]));
		const byKey = new Map(atoms.map((a) => [a.key, a]));
		// An edit that renames a block or reorders its songs changes their keys, not the songs.
		const byTrack = new Map<string, Atom>();
		for (const a of atoms) if (a.kind === 'song' && a.role !== 'request' && a.trackId && !byTrack.has(a.trackId)) byTrack.set(a.trackId, a);

		const frozen: Atom[] = [];
		for (const item of this.committed) {
			const ours = item.evening?.run === this.input.run;
			const same = byKey.get(item.key) ?? byKey.get(this.renamedKey(item.key)) ?? (ours && item.trackId ? byTrack.get(item.trackId) : undefined);
			const atom = same ? { ...same, key: item.key } : this.fromQueue(item, segmentIndex);
			if (!atom) break;
			atom.frozen = true;
			frozen.push(atom);
		}
		// A hold the host asked for still lands between its segment and the next, even where the
		// rows after it are already committed to.
		for (const hold of atoms.filter((a) => a.role === 'hold' && this.memory.holds.some((h) => h.key === a.key))) {
			if (frozen.some((f) => f.key === hold.key)) continue;
			const before = frozen.findIndex((f, i) => i > 0 && f.segmentIndex > hold.segmentIndex);
			if (before === -1) continue;
			frozen.splice(before, 0, { ...hold, frozen: true });
		}

		const frozenKeys = new Set(frozen.flatMap((a) => [a.key, this.renamedKey(a.key)]));
		const frozenTracks = new Set(frozen.flatMap((a) => (a.kind === 'song' && a.trackId ? [a.trackId] : [])));
		const upcoming = new Set(queue.items.slice(this.currentAt + 1).flatMap((i) => [i.key, this.renamedKey(i.key)]));
		const out = [...frozen];
		for (const atom of atoms) {
			if (frozenKeys.has(atom.key) || this.history.has(atom.key)) continue;
			if (atom.kind === 'song' && atom.trackId && (frozenTracks.has(atom.trackId) || this.historyTracks.has(atom.trackId))) continue;
			// A segment the evening has passed keeps only the rows the queue still holds for it.
			if (atom.segmentIndex < this.reached && !upcoming.has(atom.key)) continue;
			let at = out.length;
			// A new row or a request plays in its own segment, ahead of later segments' committed rows.
			if (atom.role === 'request' || !upcoming.has(atom.key)) {
				while (at > 0 && out[at - 1].frozen && out[at - 1].segmentIndex > atom.segmentIndex) at--;
			}
			out.splice(at, 0, atom);
		}
		return out;
	}

	/** A queue row the script no longer produces, kept as it is because it is frozen. */
	private fromQueue(item: QueueItem, segmentIndex: Map<string, number>): Atom | null {
		const tag = item.evening?.run === this.input.run ? item.evening : undefined;
		const index = tag ? (segmentIndex.get(this.segmentOf(tag.segment)) ?? -1) : -1;
		const segment = index >= 0 ? this.script.segments[index] : this.script.segments[0];
		if (!segment) return null;
		const kind = item.kind ?? 'song';
		const look = (segment.kind === 'pause' && index >= 0 ? segment.look : undefined) ?? sceneLook('resting') ?? DARK;
		const lighting: RowPlan =
			kind === 'song' && item.trackId
				? { kind: 'song', trackId: item.trackId, calm: tag?.role === 'music', overlays: [], effects: [] }
				: {
						kind: 'silent',
						title: tag?.name ?? item.title,
						length: kind === 'hold' || tag?.role === 'wait' ? null : item.duration,
						clock: DEFAULT_CLOCK,
						timeline: [{ at: 0, look }],
						palette: this.palette(),
						calm: true,
						effects: []
					};
		return {
			key: item.key,
			kind,
			segmentIndex: index,
			segment,
			slot: tag?.slot ?? 'r',
			role: tag?.role ?? 'request',
			trackId: item.trackId,
			title: item.title,
			artist: item.uploader,
			thumbnail: item.thumbnail,
			source: item.source,
			duration: item.duration || (kind === 'hold' ? 0 : UNKNOWN_SONG),
			light: DEFAULT_LIGHT,
			crossfade: 0,
			lighting,
			ready: item.status === 'ready',
			...(item.addedBy ? { addedBy: item.addedBy } : {}),
			...(index >= 0 ? {} : { tag: tag ?? null }),
			startAt: 0,
			endAt: 0,
			frozen: true
		};
	}

	// ---- Time -------------------------------------------------------------------------------

	private time(atoms: Atom[]): void {
		const { now, progress, hold, timedEndsAt, running, queue } = this.input;
		let t = now;
		atoms.forEach((atom, i) => {
			const isCurrent = running && i === 0 && atom.key === queue.currentKey;
			// A pause until a clock time keeps the length it started with.
			if (isCurrent && untilPause(atom)) this.lasts(atom, queue.items.find((q) => q.key === atom.key)?.duration ?? atom.duration);
			if (i > 0) {
				const previous = atoms[i - 1];
				const overlap = atom.crossfade > 0 && previous.kind === 'song' && atom.kind === 'song' ? atom.crossfade : 0;
				const gap = previous.kind === 'song' && atom.kind === 'song' && overlap === 0 ? LOAD_GAP : 0;
				t = previous.endAt + (gap - overlap) * 1000;
			}
			if (isCurrent) {
				if (atom.kind === 'hold') {
					const since = hold?.key === atom.key ? hold.since : now;
					atom.startAt = since;
					atom.endAt = Math.max(now, this.holdEnd(atom, since));
				} else if (timedEndsAt !== null && atom.kind !== 'song' && atom.kind !== 'narration') {
					atom.startAt = timedEndsAt - atom.duration * 1000;
					atom.endAt = timedEndsAt;
				} else {
					const position =
						progress && progress.key === atom.key
							? progress.position + (progress.playing ? Math.max(0, now - progress.at) / 1000 : 0)
							: 0;
					atom.startAt = now - position * 1000;
					atom.endAt = atom.startAt + atom.duration * 1000;
					if (atom.endAt < now) atom.endAt = now;
				}
				return;
			}
			atom.startAt = t;
			if (atom.kind === 'hold') atom.endAt = Math.max(t, this.holdEnd(atom, t));
			else if (untilPause(atom)) {
				atom.endAt = Math.max(t, this.clock((atom.segment as PauseSpec).until!));
				this.lasts(atom, (atom.endAt - t) / 1000);
			} else atom.endAt = t + atom.duration * 1000;
		});
		this.fitPauses(atoms);
	}

	/** A row's length, and its silent lighting's with it. */
	private lasts(atom: Atom, seconds: number): void {
		atom.duration = seconds;
		if (atom.lighting.kind === 'silent' && atom.lighting.length !== null) atom.lighting = { ...atom.lighting, length: seconds };
	}

	private holdEnd(atom: Atom, start: number): number {
		if (atom.expect?.clock) return this.clock(atom.expect.clock);
		return start + (atom.expect?.seconds ?? 0) * 1000;
	}

	private clock(value: string): number {
		return clockOnNight(parseClock(value) ?? 0, this.input.now, this.input.offsetMinutes);
	}

	/** Pause music fills its length: the crossing song fades out, a short tail stays calm. */
	private fitPauses(atoms: Atom[]): void {
		const { queue } = this.input;
		const fitted = new Set<SegmentSpec>();
		for (let i = 0; i < atoms.length; i++) {
			const segment = atoms[i].segment;
			if (segment.kind !== 'pause' || segment.music.length === 0 || atoms[i].segmentIndex < 0 || fitted.has(segment)) continue;
			fitted.add(segment);
			// The pause's own music and calm tail; a hold the host asked for after it is not the pause.
			const music = atoms.filter((a) => a.segment === segment && a.segmentIndex >= 0 && a.kind === 'song');
			const tail = atoms.find((a) => a.segment === segment && a.segmentIndex >= 0 && a.role === 'tail');
			const first = music[0] ?? tail;
			if (!first) continue;
			const start = first.startAt - (first.key === queue.currentKey ? this.playedIn(segment.id) : 0) * 1000;
			const end = segment.until
				? this.clock(segment.until)
				: segment.length !== undefined
					? start + segment.length * 1000
					: null;
			if (end === null) continue;
			let cut = false;
			for (const member of music) {
				if (cut) {
					if (member.key !== queue.currentKey) atoms.splice(atoms.indexOf(member), 1);
					continue;
				}
				if (member.endAt > end) {
					const at = Math.max(0, (end - member.startAt) / 1000);
					if (member.lighting.kind === 'song' && at > 0) {
						member.lighting = { ...member.lighting, fade: { at, seconds: Math.min(segment.fadeOut, at) } };
						member.duration = at;
						member.endAt = end;
					} else if (member.key !== queue.currentKey) {
						atoms.splice(atoms.indexOf(member), 1);
					}
					cut = true;
				}
			}
			const lastMusic = [...atoms].reverse().find((a) => a.segment === segment && a.segmentIndex >= 0 && a.kind === 'song');
			const from = lastMusic?.endAt ?? start;
			if (tail && tail.key !== queue.currentKey) {
				// The calm tail the queue already holds is resized, never doubled.
				if (cut || end - from <= 5000) atoms.splice(atoms.indexOf(tail), 1);
				else {
					tail.startAt = from;
					tail.endAt = end;
					this.lasts(tail, (end - from) / 1000);
				}
			} else if (!tail && !cut && end - from > 5000 && !this.skipped.has(this.key(segment.id, 't'))) {
				const added = this.silentAtom(segment, first.segmentIndex, 'pause', 't', 'tail', (end - from) / 1000, segment.look ?? sceneLook('resting') ?? DARK);
				added.startAt = from;
				added.endAt = end;
				atoms.splice(lastMusic ? atoms.indexOf(lastMusic) + 1 : atoms.indexOf(first), 0, added);
			}
			const resumeAt = atoms.indexOf(first);
			this.reflow(atoms, resumeAt === -1 ? 1 : resumeAt + 1);
		}
	}

	/** Seconds this segment's rows already played, straight before the current row. */
	private playedIn(segment: string): number {
		const { queue, run } = this.input;
		const at = queue.items.findIndex((i) => i.key === queue.currentKey);
		let seconds = 0;
		for (let i = at - 1; i >= 0; i--) {
			const tag = queue.items[i].evening;
			if (tag?.run !== run || this.segmentOf(tag.segment) !== segment) break;
			seconds += queue.items[i].duration;
		}
		return seconds;
	}

	/** Recompute starts from `from` on, after a row changed length. */
	private reflow(atoms: Atom[], from: number): void {
		for (let i = Math.max(1, from); i < atoms.length; i++) {
			const atom = atoms[i];
			if (atom.frozen && i === 0) continue;
			const previous = atoms[i - 1];
			const overlap = atom.crossfade > 0 && previous.kind === 'song' && atom.kind === 'song' ? atom.crossfade : 0;
			const gap = previous.kind === 'song' && atom.kind === 'song' && overlap === 0 ? LOAD_GAP : 0;
			const start = previous.endAt + (gap - overlap) * 1000;
			if (atom.kind === 'hold') {
				atom.startAt = start;
				atom.endAt = Math.max(start, this.holdEnd(atom, start));
			} else if (untilPause(atom)) {
				atom.startAt = start;
				atom.endAt = Math.max(start, this.clock((atom.segment as PauseSpec).until!));
				this.lasts(atom, (atom.endAt - start) / 1000);
			} else {
				atom.startAt = start;
				atom.endAt = start + atom.duration * 1000;
			}
		}
	}

	// ---- Anchors ----------------------------------------------------------------------------

	private anchor(atoms: Atom[]): void {
		let spanStart = 0;
		this.script.segments.forEach((segment, index) => {
			const clock = segment.at ?? segment.notBefore;
			if (!clock) return;
			const first = atoms.findIndex((a) => a.segmentIndex === index);
			if (first === -1) return;
			const target = this.clock(clock);
			if (atoms[first].frozen) {
				// A wait already committed to still ends on the anchor, in the room it waits in.
				if (atoms[first].role === 'wait') this.settleWait(atoms, first, target);
				spanStart = atoms.findIndex((a) => a.segmentIndex === index);
				return;
			}
			let delta = (target - atoms[first].startAt) / 1000;

			// Elastic fills in the span, the one nearest the anchor first.
			const elastic = [...new Set(atoms.slice(spanStart, first).filter((a) => a.elastic && !a.frozen).map((a) => a.elastic!))].reverse();
			for (const slotKey of elastic) {
				if (Math.abs(delta) < GAIN_MIN) break;
				delta = this.stretch(atoms, slotKey, delta, segment.at !== undefined);
			}
			const firstNow = atoms.findIndex((a) => a.segmentIndex === index);
			delta = (target - atoms[firstNow].startAt) / 1000;
			if (delta >= MIN_WAIT && !this.skipped.has(this.key(segment.id, 'w'))) {
				const wait = this.silentAtom(segment, index, 'pause', 'w', 'wait', delta, this.waitLook(atoms, firstNow));
				// The anchor ends a wait, on the server's clock; the page does not run it out by itself.
				if (wait.lighting.kind === 'silent') wait.lighting = { ...wait.lighting, length: null };
				wait.light = DEFAULT_LIGHT;
				atoms.splice(firstNow, 0, wait);
				this.reflow(atoms, firstNow);
			} else if (delta < -LATE_GRACE && segment.at !== undefined) {
				const minutes = Math.round(-delta / 60);
				this.find('warning', `"${segment.name}" is projected ${minutes} min after ${clock}.`, segment);
			}
			spanStart = atoms.findIndex((a) => a.segmentIndex === index);
		});
	}

	/** Keep a committed wait ending on its anchor, lit as the room before it. */
	private settleWait(atoms: Atom[], at: number, target: number): void {
		const wait = atoms[at];
		const current = this.input.running && wait.key === this.input.queue.currentKey;
		if (!current && target - wait.startAt < 1000) {
			atoms.splice(at, 1);
		} else {
			wait.endAt = Math.max(wait.startAt, target);
			wait.duration = (wait.endAt - wait.startAt) / 1000;
			const look = this.waitLook(atoms, at);
			if (wait.lighting.kind === 'silent') {
				wait.lighting = { ...wait.lighting, length: null, timeline: [{ at: 0, look }], palette: this.palette(look.palette), effects: this.effectsOf([look]) };
			}
		}
		this.reflow(atoms, at);
	}

	/** Grow or shrink one fill slot toward `delta` seconds; returns what is left. */
	private stretch(atoms: Atom[], slotKey: string, delta: number, mayShrink: boolean): number {
		const members = atoms.filter((a) => a.elastic === slotKey);
		if (members.length === 0) return delta;
		let rest = delta;
		if (rest < 0 && mayShrink) {
			for (let i = members.length - 1; i >= 0 && rest < -GAIN_MIN; i--) {
				const member = members[i];
				if (member.frozen) break;
				const gain = Math.abs(rest) - Math.abs(rest + member.duration);
				if (gain < Math.max(GAIN_MIN, 0.2 * member.duration)) break;
				const at = atoms.indexOf(member);
				atoms.splice(at, 1);
				this.taken.delete(member.trackId!);
				rest += member.duration;
				this.reflow(atoms, at);
			}
		} else if (rest > 0) {
			const [segment, item] = slotKey.split(':');
			const spec = this.script.segments.find((s) => s.id === segment);
			const fill = spec?.kind === 'block' ? spec.items[Number(item)] : spec?.kind === 'pause' ? spec.music[Number(item)] : undefined;
			if (!spec || !fill || fill.kind !== 'fill') return rest;
			const candidates = this.candidates(fill).filter((c) => this.fresh(c));
			for (const candidate of candidates.sort((a, b) => Math.abs(rest - a.duration) - Math.abs(rest - b.duration))) {
				if (rest < GAIN_MIN) break;
				const d = candidate.duration || UNKNOWN_SONG;
				if (Math.abs(rest) - Math.abs(rest - d) < Math.max(GAIN_MIN, 0.2 * d)) continue;
				const last = members[members.length - 1];
				const at = atoms.indexOf(last) + 1;
				const pick = members.length;
				const atom = this.songAtom(spec, last.segmentIndex, `i${item}.${pick}`, 'fill', candidate, last.lighting.kind === 'song' && last.lighting.calm ? 'calm' : fill.lighting);
				atom.elastic = slotKey;
				atom.light = last.light;
				atoms.splice(at, 0, atom);
				members.push(atom);
				this.taken.add(candidate.id);
				this.memory.picks[slotKey] = [...(this.memory.picks[slotKey] ?? []), candidate.id];
				rest -= d;
				this.reflow(atoms, at);
			}
		}
		if (rest !== delta) this.memory.picks[slotKey] = atoms.filter((a) => a.elastic === slotKey).map((a) => a.trackId!);
		return rest;
	}

	/** Waiting in the look the room was already in: the previous calm row's, else resting. */
	private waitLook(atoms: Atom[], before: number): LookSpec {
		for (let i = before - 1; i >= 0; i--) {
			const plan = atoms[i].lighting;
			if (plan.kind === 'silent' && plan.calm) return plan.timeline[0]?.look ?? sceneLook('resting') ?? DARK;
			if (plan.kind === 'song') break;
		}
		return sceneLook('resting') ?? DARK;
	}

	// ---- Output -----------------------------------------------------------------------------

	private readiness(atoms: Atom[]): void {
		const unprepared = atoms.filter((a) => a.kind === 'song' && !a.ready && !a.frozen);
		if (unprepared.length > 0) {
			this.findings.push({
				severity: 'warning',
				message: `${unprepared.length} ${unprepared.length === 1 ? 'song is' : 'songs are'} not prepared yet.`
			});
		}
		const last = atoms[atoms.length - 1];
		for (const atom of atoms) {
			if (atom === last) continue;
			if (atom.kind === 'hold' && atom.expect?.seconds === 0 && !atom.expect.clock && atom.role === 'hold' && atom.slot === 'h') {
				this.find('info', `"${atom.segment.name}" has no expected length, so the times after it assume Go at once.`, atom.segment);
			}
		}
	}

	private row(a: Atom): PlannedRow {
		return {
			key: a.key,
			kind: a.kind,
			tag: a.tag !== undefined ? a.tag : { run: this.input.run, segment: a.segment.id, name: a.segment.name, slot: a.slot, role: a.role },
			trackId: a.trackId,
			title: a.title,
			artist: a.artist,
			thumbnail: a.thumbnail,
			source: a.source,
			duration: a.duration,
			startAt: a.startAt,
			endAt: a.endAt,
			light: a.light,
			lighting: a.crossfade > 0 && a.lighting.kind === 'song' ? { ...a.lighting, crossfade: a.crossfade } : a.lighting,
			ready: a.ready,
			frozen: a.frozen,
			...(a.addedBy ? { addedBy: a.addedBy } : {}),
			...(a.heat !== undefined ? { heat: a.heat } : {})
		};
	}

	private projections(atoms: Atom[]): SegmentProjection[] {
		const { queue, running } = this.input;
		const current = running ? atoms.find((a) => a.key === queue.currentKey) : undefined;
		const currentSegment = current && current.segmentIndex >= 0 && current.role !== 'request' ? current.segmentIndex : -1;
		let playedThrough = -1;
		if (running) {
			const at = queue.items.findIndex((i) => i.key === queue.currentKey);
			const ids = this.script.segments.map((s) => s.id);
			for (const item of queue.items.slice(0, at === -1 ? queue.items.length : at)) {
				if (item.evening?.run === this.input.run) playedThrough = Math.max(playedThrough, ids.indexOf(item.evening.segment));
			}
		}
		return this.script.segments.map((segment, index) => {
			const members = atoms.filter((a) => a.segmentIndex === index);
			const clock = segment.at ?? segment.notBefore;
			const startAt = members[0]?.startAt ?? this.input.now;
			const state: SegmentProjection['state'] =
				index === currentSegment
					? 'current'
					: index < currentSegment || (currentSegment === -1 && index <= playedThrough) || (index < playedThrough)
						? 'done'
						: 'upcoming';
			return {
				id: segment.id,
				name: segment.name,
				kind: segment.kind,
				startAt,
				endAt: members[members.length - 1]?.endAt ?? startAt,
				songs: members.filter((a) => a.kind === 'song').length,
				state,
				...(clock
					? {
							anchor: {
								kind: segment.at ? ('at' as const) : ('notBefore' as const),
								clock,
								time: this.clock(clock),
								late: Math.round((startAt - this.clock(clock)) / 1000)
							}
						}
					: {}),
				open: segment.kind === 'block' && segment.open,
				...(segment.line ? { line: segment.line } : {})
			};
		});
	}
}

function untilPause(atom: Atom): boolean {
	return atom.kind === 'pause' && atom.role === 'pause' && atom.segment.kind === 'pause' && atom.segment.until !== undefined;
}

/** The index of a block's last fill, or -1. */
function lastFill(items: BlockSpec['items']): number {
	for (let i = items.length - 1; i >= 0; i--) if (items[i].kind === 'fill') return i;
	return -1;
}

function total(atoms: Atom[]): number {
	return atoms.reduce((sum, a) => sum + a.duration, 0);
}

function median(values: number[]): number {
	if (values.length === 0) return UNKNOWN_SONG;
	const sorted = [...values].sort((a, b) => a - b);
	return sorted[Math.floor(sorted.length / 2)];
}

/** Rows after the current one that no evening placed: requests, in turn across guests. */
export function requestPool(queue: QueueState, run: string): QueueItem[] {
	const at = queue.items.findIndex((i) => i.key === queue.currentKey);
	const waiting = queue.items
		.slice(at + 1)
		.filter((i) => (i.evening === undefined || (i.evening.run === run && i.evening.role === 'request')) && (i.kind ?? 'song') === 'song' && i.status !== 'error');
	const served = new Map<string, number>();
	const turn = waiting.map((item) => {
		const guest = item.addedBy ?? '';
		const n = served.get(guest) ?? 0;
		served.set(guest, n + 1);
		return { item, n };
	});
	return turn.sort((a, b) => a.n - b.n || a.item.addedAt - b.item.addedAt || a.item.key.localeCompare(b.item.key)).map((x) => x.item);
}

/**
 * Segments an edit renamed, old id to new: the same kind in the same place, the old id gone and
 * the new one new. Earlier renames follow along.
 */
export function renamedSegments(
	before: EveningScript,
	after: EveningScript,
	known: Readonly<Record<string, string>> = {}
): Record<string, string> {
	const oldIds = new Set(before.segments.map((s) => s.id));
	const newIds = new Set(after.segments.map((s) => s.id));
	const out: Record<string, string> = { ...known };
	before.segments.forEach((segment, i) => {
		const now = after.segments[i];
		if (!now || now.id === segment.id || now.kind !== segment.kind || newIds.has(segment.id) || oldIds.has(now.id)) return;
		for (const [from, to] of Object.entries(out)) if (to === segment.id) out[from] = now.id;
		out[segment.id] = now.id;
	});
	for (const [from, to] of Object.entries(out)) if (from === to) delete out[from];
	return out;
}

export function planEvening(input: PlanInput): Plan {
	return new Planner(input).run();
}

