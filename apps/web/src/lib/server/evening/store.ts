import { watch, type FSWatcher } from 'node:fs';
import { mkdir, readdir, readFile, rename, writeFile } from 'node:fs/promises';
import { randomBytes } from 'node:crypto';
import { basename, dirname, join, resolve } from 'node:path';
import { CACHE_DIR, EVENING_DIR, preparedNarration, readLibrary } from '@mv/analysis';
import type { EveningScript, Finding } from '@mv/core';
import { EMPTY_MEMORY, planEvening, renamedSegments, type Plan, type PlanMemory, type Progress } from '$lib/evening/plan.ts';
import { bailQueue, reconcileQueue, type TrackFacts } from '$lib/evening/reconcile.ts';
import { IDLE_VIEW, type EveningStatus, type EveningView, type RowLightingView } from '$lib/evening/view.ts';
import { EMPTY_QUEUE, currentItem, jumpTo, playNext, type QueueItem, type QueueState } from '$lib/queueModel.ts';
import { narrationDetached } from '../ingestDetached.ts';
import { prepareTrack, runner } from '../ingestRunner.ts';
import { queue } from '../queueStore.ts';
import { eveningGate } from './gate.ts';
import { libraryTracks } from './library.ts';
import { loadEvening } from './loader.ts';

const EVENING_FILE = join(CACHE_DIR, 'evening.json');
const RECENT = 8;
/** Projections drift with the clock; this keeps the rail's times honest between events. */
const TICK_MS = 20_000;
const SAVE_PROGRESS_MS = 5_000;
/** A song that played this long counts as heard, so fill never picks it again tonight. */
const HEARD_SECONDS = 30;
/** Rows starting within this many seconds are prepared during a running evening. */
const PREPARE_AHEAD = 25 * 60;
/** Going back within this many seconds of a segment's start goes to the previous segment. */
const BACK_GRACE = 10;

interface Persisted {
	version: 1;
	file: string | null;
	recent: string[];
	status: EveningStatus;
	run: string | null;
	/** The last compile that worked, so a running evening survives a broken edit or restart. */
	script: EveningScript | null;
	memory: PlanMemory;
	setAside: { items: QueueItem[]; currentKey: string | null } | null;
	hold: { key: string; since: number } | null;
	/** The current timed row's end on the real clock, and what it has left while paused, seconds. */
	timed: { key: string; endsAt: number; left?: number } | null;
	progress: Progress | null;
	clockOffset: number;
	startedAt: number | null;
	bailed: boolean;
}

const EMPTY: Persisted = {
	version: 1,
	file: null,
	recent: [],
	status: 'idle',
	run: null,
	script: null,
	memory: EMPTY_MEMORY,
	setAside: null,
	hold: null,
	timed: null,
	progress: null,
	clockOffset: 0,
	startedAt: null,
	bailed: false
};

type Listener = (view: EveningView) => void;

class EveningStore {
	private data: Persisted = { ...EMPTY };
	private loaded: Promise<void> | null = null;
	/** The first load of the evening file after boot, which the first plan waits on. */
	private initial: Promise<void> = Promise.resolve();
	private findings: Finding[] = [];
	private rejected = false;
	private loading = false;
	private plan: Plan | null = null;
	private preview: Plan | null = null;
	private readonly listeners = new Set<Listener>();
	private watcher: FSWatcher | null = null;
	private reloadTimer: NodeJS.Timeout | null = null;
	private timedTimer: NodeJS.Timeout | null = null;
	private tickTimer: NodeJS.Timeout | null = null;
	private replanning: Promise<void> | null = null;
	private replanAgain = false;
	private replanTimer: NodeJS.Timeout | null = null;
	private lastCurrent: string | null = null;
	private lastShape = '';
	private cue: EveningView['cue'] = null;
	private cueToken = 0;
	private savedProgressAt = 0;
	private narrations: Record<string, number> = {};
	private facts = new Map<string, ReturnType<TrackFacts>>();
	private heat = new Map<string, number>();
	private prepare: EveningView['prepare'] = { running: false, total: 0, done: 0, failed: 0, current: null };
	private writing: Promise<void> = Promise.resolve();

	ready(): Promise<void> {
		this.loaded ??= this.boot();
		return this.loaded;
	}

	private get live(): boolean {
		return this.data.status === 'running' || this.data.status === 'rehearsal';
	}

	/** The evening's clock: the wall clock, or a rehearsal's own. */
	now(): number {
		return Date.now() + (this.data.status === 'rehearsal' ? this.data.clockOffset : 0);
	}

	private async boot(): Promise<void> {
		try {
			const raw = JSON.parse(await readFile(EVENING_FILE, 'utf8')) as Persisted;
			if (raw.version === 1) this.data = { ...EMPTY, ...raw };
		} catch {
			// No evening yet.
		}
		const state = await queue.ready();
		this.lastCurrent = state.currentKey;
		this.lastShape = shapeOf(state);
		queue.subscribe((s) => this.onQueue(s));

		if (this.data.file) this.watch(this.data.file);
		if (this.live) {
			// Back after a restart: the row that was playing comes back where it was, paused.
			const current = currentItem(state);
			const progress = this.data.progress;
			if (current && progress && progress.key === current.key && (current.kind ?? 'song') !== 'hold') {
				this.setCue(current.key, Math.max(0, progress.position - 5), true);
			}
			if (this.data.timed && this.data.timed.key === current?.key) {
				// A timed row comes back paused with everything else, keeping what it had left.
				const left =
					progress && progress.key === current.key
						? Math.max(1, current.duration - Math.max(0, progress.position - 5))
						: Math.max(1, (this.data.timed.endsAt - Date.now()) / 1000);
				this.data.timed = { key: current.key, endsAt: Date.now() + left * 1000, left };
			}
			eveningGate.active = true;
			this.startTick();
		}
		// Awaited, not merely started: ready() is what the first view waits on, and an idle rail
		// has to list the folder's evenings so opening one never needs a typed path.
		await this.scanFolder();
		this.initial = this.data.file ? this.reload(true) : this.replan();
	}

	view(): EveningView {
		const plan = this.live ? this.plan : this.preview;
		const script = this.data.script;
		const files = this.listFiles();
		const past = this.past(plan);
		const played = new Set(past.map((r) => r.key));
		return {
			...IDLE_VIEW,
			status: this.data.status,
			file: this.data.file,
			files,
			name: script?.name ?? null,
			loading: this.loading,
			findings: [...this.findings, ...(plan?.findings ?? [])],
			rejected: this.rejected,
			segments: plan?.segments ?? [],
			rows: (plan?.rows ?? []).filter((r) => !played.has(r.key)).map((r) => ({
				key: r.key,
				kind: r.kind,
				segment: r.tag?.segment ?? '',
				role: r.tag?.role ?? 'request',
				title: r.title,
				artist: r.artist,
				duration: r.duration,
				startAt: r.startAt,
				endAt: r.endAt,
				ready: r.ready,
				...(r.addedBy ? { addedBy: r.addedBy } : {}),
				...(r.heat !== undefined ? { heat: r.heat } : {})
			})),
			past,
			now: this.now(),
			clockOffset: this.data.status === 'rehearsal' ? this.data.clockOffset : 0,
			span: this.span(),
			hold: this.data.hold,
			holdsAfter: this.data.memory.holds.map((h) => h.after),
			endsAt: plan?.endsAt ?? null,
			waiting: plan?.waiting.length ?? 0,
			setAside: this.data.setAside?.items.length ?? 0,
			cue: this.cue,
			prepare: this.prepare,
			bailed: this.data.bailed
		};
	}

	/** Rows of this run before the current one, timed back from where the current row began. */
	private past(plan: Plan | null): EveningView['past'] {
		const run = this.data.run;
		if (!run || this.data.status === 'loaded' || this.data.status === 'idle') return [];
		const state = queue.snapshot;
		const at = state.items.findIndex((i) => i.key === state.currentKey);
		const before = (at === -1 ? state.items : state.items.slice(0, at)).filter((i) => i.evening?.run === run);
		let t = plan?.rows[0]?.startAt ?? this.now();
		const out: EveningView['past'] = [];
		for (let i = before.length - 1; i >= 0; i--) {
			const item = before[i];
			const endAt = t;
			t -= item.duration * 1000;
			const heat = item.trackId ? this.heat.get(item.trackId) : undefined;
			out.unshift({
				key: item.key,
				kind: item.kind ?? 'song',
				segment: item.evening!.segment,
				role: item.evening!.role,
				title: item.title,
				artist: item.uploader,
				duration: item.duration,
				startAt: t,
				endAt,
				ready: item.status === 'ready',
				...(item.addedBy ? { addedBy: item.addedBy } : {}),
				...(heat !== undefined ? { heat } : {})
			});
		}
		return out;
	}

	private fileList: string[] = [];

	private listFiles(): string[] {
		return [...new Set([...this.data.recent, ...this.fileList])];
	}

	private async scanFolder(): Promise<void> {
		try {
			const names = await readdir(EVENING_DIR);
			this.fileList = names
				.filter((n) => /\.(m?ts)$/.test(n) && !n.endsWith('.d.ts'))
				.map((n) => join(EVENING_DIR, n));
		} catch {
			this.fileList = [];
		}
	}

	subscribe(listener: Listener): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private publish(): void {
		const view = this.view();
		for (const listener of this.listeners) listener(view);
	}

	private persist(): void {
		const snapshot = JSON.stringify(this.data);
		this.writing = this.writing
			.then(async () => {
				await mkdir(CACHE_DIR, { recursive: true });
				const tmp = `${EVENING_FILE}.${process.pid}.tmp`;
				await writeFile(tmp, snapshot);
				await rename(tmp, EVENING_FILE);
			})
			.catch(() => {
				// An evening that cannot be saved still runs; only a restart would lose its place.
			});
	}

	private setCue(key: string, position: number, paused: boolean): void {
		this.cue = { key, position, paused, token: ++this.cueToken };
	}

	// ---- Files ------------------------------------------------------------------------------

	async open(file: string): Promise<void> {
		await this.ready();
		const path = resolve(file.trim());
		if (this.live && path !== this.data.file) throw new Error('End the evening before opening another file.');
		this.data.file = path;
		this.data.recent = [path, ...this.data.recent.filter((f) => f !== path)].slice(0, RECENT);
		if (!this.live) this.data.status = 'loaded';
		this.watch(path);
		await this.reload(false);
	}

	async close(): Promise<void> {
		await this.ready();
		if (this.live) throw new Error('End the evening before closing its file.');
		this.watcher?.close();
		this.watcher = null;
		this.data = { ...EMPTY, recent: this.data.recent, setAside: this.data.setAside };
		this.findings = [];
		this.preview = null;
		this.plan = null;
		await this.scanFolder();
		this.persist();
		this.publish();
	}

	private watch(path: string): void {
		this.watcher?.close();
		this.watcher = null;
		try {
			// Watch the folder: editors replace files on save, which a file watcher loses.
			this.watcher = watch(dirname(path), (_event, name) => {
				if (name && !String(name).endsWith('.ts') && !String(name).endsWith('.mts')) return;
				if (this.reloadTimer) clearTimeout(this.reloadTimer);
				this.reloadTimer = setTimeout(() => void this.reload(false), 400);
			});
			this.watcher.on('error', () => {
				this.watcher?.close();
				this.watcher = null;
			});
		} catch {
			// A file on a volume that cannot be watched still loads; Reload picks up edits.
		}
	}

	async reload(booting = false): Promise<void> {
		const file = this.data.file;
		if (!file) return;
		this.loading = true;
		this.publish();
		await this.scanFolder();
		const result = await loadEvening(file);
		this.loading = false;
		const broken = !result.script || result.findings.some((f) => f.severity === 'error');
		if (this.live && broken && this.data.script) {
			// Keep running what worked; say what the edit got wrong.
			this.findings = [
				{ severity: 'warning', message: 'The file has errors, so the evening keeps running its last good version.' },
				...result.findings
			];
			this.rejected = true;
		} else {
			this.findings = result.findings;
			this.rejected = false;
			if (result.script && this.live && this.data.script) {
				// Rows already queued keep the ids their segments had; the plan follows the rename.
				const renamed = renamedSegments(this.data.script, result.script, this.data.memory.renamed);
				if (Object.keys(renamed).length > 0) this.data.memory = { ...this.data.memory, renamed };
			}
			if (result.script) this.data.script = result.script;
			else if (!this.live) this.data.script = null;
		}
		if (!booting || !this.live) this.persist();
		await this.readNarrations();
		await this.replan();
	}

	private async readNarrations(): Promise<void> {
		const script = this.data.script;
		const out: Record<string, number> = {};
		for (const segment of script?.segments ?? []) {
			if (segment.kind !== 'narration') continue;
			const measured = await preparedNarration(segment.audio).catch(() => null);
			if (measured) out[segment.audio] = measured.duration;
		}
		this.narrations = out;
	}

	// ---- Planning ---------------------------------------------------------------------------

	private scheduleReplan(delay = 250): void {
		if (this.replanTimer) clearTimeout(this.replanTimer);
		this.replanTimer = setTimeout(() => void this.replan(), delay);
	}

	async replan(): Promise<void> {
		if (this.replanning) {
			this.replanAgain = true;
			return this.replanning;
		}
		this.replanning = this.replanOnce().finally(() => {
			this.replanning = null;
			if (this.replanAgain) {
				this.replanAgain = false;
				void this.replan();
			}
		});
		return this.replanning;
	}

	private async replanOnce(): Promise<void> {
		const script = this.data.script;
		if (!script) {
			this.plan = null;
			this.preview = null;
			this.publish();
			return;
		}
		// The queue's runner prepares a narration shortly before it plays; its length arrives here.
		if (script.segments.some((s) => s.kind === 'narration' && this.narrations[s.audio] === undefined)) {
			await this.readNarrations();
		}
		const entries = await readLibrary();
		const library = await libraryTracks(entries);
		this.heat = new Map(library.map((t) => [t.id, script.heat[t.id] ?? t.heat]));
		this.facts = new Map(
			entries.map((e) => [
				e.id,
				{
					authored: e.analysed && e.current ? e.authored : 'none',
					...(e.genreFamily ? { genre: e.genreFamily } : {}),
					loungeOnly: e.gridTrust?.trusted === false && !e.gridTrustOverride,
					...(e.gridTrust?.reasons.length ? { trustNote: e.gridTrust.reasons.join('; ') } : {}),
					...(e.thumbnail ? { thumbnail: e.thumbnail } : {})
				}
			])
		);
		const now = this.now();
		const offsetMinutes = new Date(now).getTimezoneOffset();
		const base = {
			script,
			library,
			now,
			offsetMinutes,
			narrations: this.narrations
		};

		if (this.live && this.data.run) {
			const state = await queue.ready();
			const plan = planEvening({
				...base,
				run: this.data.run,
				queue: state,
				running: true,
				progress: this.data.progress,
				hold: this.data.hold,
				timedEndsAt: this.timedEnd(),
				memory: this.data.memory
			});
			this.plan = plan;
			this.data.memory = plan.memory;
			// A wait ends on its anchor, which moves as the rows before it do.
			const head = plan.rows[0];
			const timed = this.data.timed;
			if (timed && timed.left === undefined && head?.key === timed.key && head.tag?.role === 'wait') {
				const endsAt = Date.now() + (head.endAt - now);
				if (Math.abs(endsAt - timed.endsAt) > 1000) {
					this.data.timed = { key: timed.key, endsAt };
					this.armTimed();
				}
			}
			const run = this.data.run;
			await queue.transform((s) => reconcileQueue(s, plan, run, (id) => this.facts.get(id) ?? null, Date.now()));
			eveningGate.ahead = plan.rows
				.filter((r) => r.startAt - now < PREPARE_AHEAD * 1000)
				.map((r) => r.key);
			void runner.pump();
			this.checkEnded(await queue.ready());
		} else {
			this.preview = planEvening({
				...base,
				run: 'preview',
				queue: EMPTY_QUEUE,
				running: false,
				progress: null,
				hold: null,
				timedEndsAt: null,
				memory: { ...EMPTY_MEMORY, picks: this.preview?.memory.picks ?? {} }
			});
			this.plan = null;
		}
		this.publish();
	}

	/** The whole evening from its start, which a rehearsal seeks along. */
	private span(): EveningView['span'] {
		const plan = this.live ? this.plan : this.preview;
		if (!plan || plan.rows.length === 0) return null;
		const start = this.data.startedAt ?? plan.rows[0].startAt;
		const end = plan.endsAt ?? plan.rows[plan.rows.length - 1].endAt;
		return { start: Math.min(start, plan.rows[0].startAt), end };
	}

	// ---- Queue events -----------------------------------------------------------------------

	private onQueue(state: QueueState): void {
		if (!this.live) return;
		const current = currentItem(state);
		const moved = (current?.key ?? null) !== this.lastCurrent;
		const shape = shapeOf(state);
		const reshaped = shape !== this.lastShape;
		this.lastShape = shape;
		if (moved) {
			this.lastCurrent = current?.key ?? null;
			this.enter(current);
			this.persist();
			void this.replan();
		} else if (reshaped) {
			this.scheduleReplan();
		}
	}

	/** A row became current: holds wait, timed rows get their end, songs clear both. */
	private enter(row: QueueItem | null): void {
		const kind = row?.kind ?? 'song';
		this.data.progress = null;
		if (this.timedTimer) clearTimeout(this.timedTimer);
		this.timedTimer = null;
		if (!row || row.evening?.run !== this.data.run) {
			this.data.hold = null;
			this.data.timed = null;
			return;
		}
		if (kind === 'hold') {
			this.data.hold = { key: row.key, since: this.now() };
			this.data.timed = null;
		} else if (kind === 'pause' || kind === 'moment' || kind === 'sting') {
			this.data.hold = null;
			this.data.timed = { key: row.key, endsAt: Date.now() + row.duration * 1000 };
			this.armTimed();
		} else {
			this.data.hold = null;
			this.data.timed = null;
		}
	}

	/** Where the current timed row ends on the evening's clock, which a rehearsal offsets. */
	private timedEnd(): number | null {
		const timed = this.data.timed;
		if (!timed) return null;
		return this.now() + (timed.left !== undefined ? timed.left * 1000 : timed.endsAt - Date.now());
	}

	/** Timed rows end on the server's clock too, so a hidden or closed tab cannot stall the night. */
	private armTimed(): void {
		if (this.timedTimer) clearTimeout(this.timedTimer);
		const timed = this.data.timed;
		if (!timed || timed.left !== undefined) return;
		const key = timed.key;
		this.timedTimer = setTimeout(() => void this.advance(key), Math.max(0, timed.endsAt - Date.now()) + 750);
	}

	private checkEnded(state: QueueState): void {
		if (!this.live || !this.data.run) return;
		const run = this.data.run;
		const current = currentItem(state);
		const at = state.items.findIndex((i) => i.key === state.currentKey);
		const ahead = state.items.slice(at + 1).some((i) => i.evening?.run === run);
		const onEvening = current?.evening?.run === run;
		const open = this.data.script?.segments.some((s) => s.kind === 'block' && s.open);
		if (!onEvening && !ahead && !open && state.items.some((i) => i.evening?.run === run)) {
			this.data.status = 'ended';
			eveningGate.active = false;
			eveningGate.ahead = [];
			this.stopTick();
			this.persist();
		}
	}

	private startTick(): void {
		this.stopTick();
		this.tickTimer = setInterval(() => void this.replan(), TICK_MS);
	}

	private stopTick(): void {
		if (this.tickTimer) clearInterval(this.tickTimer);
		this.tickTimer = null;
	}

	// ---- Actions ----------------------------------------------------------------------------

	async start(mode: 'running' | 'rehearsal'): Promise<void> {
		await this.ready();
		const script = this.data.script;
		if (!script) throw new Error('Open an evening file first.');
		if (this.live) throw new Error('The evening is already running.');
		const state = await queue.ready();
		if (!this.data.setAside) this.data.setAside = { items: state.items, currentKey: state.currentKey };
		this.data.run = randomBytes(3).toString('hex');
		const picks = this.preview?.memory.picks ?? {};
		this.data.memory = { ...EMPTY_MEMORY, picks };
		this.data.hold = null;
		this.data.timed = null;
		this.data.progress = null;
		this.data.bailed = false;
		this.data.clockOffset = 0;
		if (mode === 'rehearsal') this.data.clockOffset = this.rehearsalStart(script) - Date.now();
		this.data.status = mode;
		this.data.startedAt = this.now();
		this.cue = null;

		const now = this.now();
		const plan = planEvening({
			script,
			run: this.data.run,
			library: await libraryTracks(),
			queue: EMPTY_QUEUE,
			now,
			offsetMinutes: new Date(now).getTimezoneOffset(),
			running: false,
			progress: null,
			hold: null,
			timedEndsAt: null,
			memory: { ...EMPTY_MEMORY, picks },
			narrations: this.narrations
		});
		this.data.memory = plan.memory;
		const run = this.data.run;
		const items = reconcileQueue(EMPTY_QUEUE, plan, run, (id) => this.facts.get(id) ?? null, Date.now()).items;
		eveningGate.active = true;
		this.lastCurrent = null;
		await queue.replace(items, items[0]?.key ?? null);
		this.startTick();
		this.persist();
		await this.replan();
	}

	/** A rehearsal's clock starts shortly before the first time the file names. */
	private rehearsalStart(script: EveningScript): number {
		const first = script.segments[0];
		const clock = first?.kind === 'hold' ? first.expectAt : (first?.at ?? first?.notBefore);
		if (!clock) return Date.now();
		const preview = this.preview?.rows.find((r) => r.tag?.segment === first.id);
		const anchor = preview && first.kind === 'hold' ? preview.endAt : preview?.startAt;
		return anchor ? anchor - 60_000 : Date.now();
	}

	async go(): Promise<void> {
		await this.ready();
		const state = await queue.ready();
		const current = currentItem(state);
		if (!current || current.kind !== 'hold') throw new Error('Nothing is holding.');
		this.data.memory = { ...this.data.memory, holds: this.data.memory.holds.filter((h) => h.key !== current.key) };
		this.data.hold = null;
		await queue.advanceFrom(current.key);
	}

	/** Hold once the current segment ends; a second press takes the hold back. */
	async holdAfter(): Promise<void> {
		await this.ready();
		if (!this.live || !this.data.run) throw new Error('No evening is running.');
		const state = await queue.ready();
		const segment = currentItem(state)?.evening?.segment;
		if (!segment) throw new Error('The current row is not part of the evening.');
		const existing = this.data.memory.holds.find((h) => h.after === segment);
		const holds = existing
			? this.data.memory.holds.filter((h) => h !== existing)
			: [...this.data.memory.holds, { after: segment, key: `ev${this.data.run}:hold:${randomBytes(3).toString('hex')}` }];
		this.data.memory = { ...this.data.memory, holds };
		this.persist();
		await this.replan();
	}

	async skip(direction: 1 | -1): Promise<void> {
		await this.ready();
		if (!this.live || !this.data.run) throw new Error('No evening is running.');
		const run = this.data.run;
		const state = await queue.ready();
		const at = state.items.findIndex((i) => i.key === state.currentKey);
		const current = state.items[at];
		const segment = current?.evening?.segment;
		const ours = (i: QueueItem) => i.evening?.run === run;
		if (direction === 1) {
			// A hold the host asked for after this segment still waits for Go.
			const hostHold = (i: QueueItem) => this.data.memory.holds.some((h) => h.key === i.key);
			const target = state.items.slice(at + 1).find((i) => !ours(i) || i.evening!.segment !== segment || hostHold(i));
			if (!target) throw new Error('This is the last segment.');
			await this.jump(target.key, false);
			return;
		}
		const first = state.items.findIndex((i) => ours(i) && i.evening!.segment === segment);
		const into = this.data.progress?.key === current?.key ? this.data.progress.position : 0;
		if (first !== -1 && first === at && into > BACK_GRACE && current.kind !== 'hold') {
			this.restart(current);
			return;
		}
		if (first !== -1 && first < at) {
			await this.jump(state.items[first].key);
			return;
		}
		const before = state.items.slice(0, first === -1 ? at : first).filter(ours);
		const previous = before[before.length - 1]?.evening?.segment;
		const start = state.items.findIndex((i) => ours(i) && i.evening!.segment === previous);
		if (start === -1) {
			if (first !== -1) await this.jump(state.items[first].key);
			return;
		}
		await this.jump(state.items[start].key);
	}

	/** Whether an evening owns the queue right now. */
	get running(): boolean {
		return this.live;
	}

	/** A row the host removed stays removed: the plan must not bring it back. */
	async forget(key: string): Promise<void> {
		await this.ready();
		if (!this.live || !this.data.run) return;
		const item = queue.snapshot.items.find((i) => i.key === key);
		if (!item) return;
		this.data.memory = {
			...this.data.memory,
			skipped: [...this.data.memory.skipped, key],
			used: item.trackId ? [...this.data.memory.used, item.trackId] : this.data.memory.used,
			holds: this.data.memory.holds.filter((h) => h.key !== key)
		};
		this.persist();
	}

	/**
	 * Jump to a row. Forward to an evening row skips the rows passed for the night; a request or a
	 * song the host picked plays now instead, and the evening carries on after it, unless the jump
	 * is a skip. Back brings the rows in between back.
	 */
	async jump(key: string, interject = true): Promise<void> {
		await this.ready();
		const state = await queue.ready();
		const from = state.items.findIndex((i) => i.key === state.currentKey);
		const to = state.items.findIndex((i) => i.key === key);
		if (to === -1) throw new Error('No such row.');
		const run = this.data.run;
		const ours = (i: QueueItem) => i.evening?.run === run;
		if (this.live && run && to > from) {
			const target = state.items[to];
			if (interject && (!ours(target) || target.evening!.role === 'request')) {
				await queue.transform((s) => jumpTo(playNext(s, key), key));
				return;
			}
			const left = new Set(state.items.slice(from, to).map((i) => i.key));
			this.data.memory = { ...this.data.memory, holds: this.data.memory.holds.filter((h) => !left.has(h.key)) };
			if (this.data.status === 'running') {
				const passed = state.items.slice(from + 1, to).filter(ours);
				const heard = this.heardCurrent(state);
				this.data.memory = {
					...this.data.memory,
					skipped: [...this.data.memory.skipped, ...passed.map((i) => i.key)],
					used: [...this.data.memory.used, ...passed.filter((i) => i.trackId).map((i) => i.trackId!), ...(heard ? [heard] : [])]
				};
			}
		} else if (this.live && run && to < from) {
			const back = state.items.slice(to, from + 1).filter(ours);
			const keys = new Set(back.map((i) => i.key));
			const tracks = new Set(back.flatMap((i) => (i.trackId ? [i.trackId] : [])));
			this.data.memory = {
				...this.data.memory,
				skipped: this.data.memory.skipped.filter((k) => !keys.has(k)),
				used: this.data.memory.used.filter((id) => !tracks.has(id))
			};
		}
		await queue.jump(key);
	}

	/** Play the current row again from its start. */
	private restart(row: QueueItem): void {
		this.setCue(row.key, 0, false);
		if (this.data.timed?.key === row.key) {
			this.data.timed = { key: row.key, endsAt: Date.now() + row.duration * 1000 };
			this.armTimed();
		}
		this.data.progress = { key: row.key, position: 0, at: this.now(), playing: true };
		this.persist();
		void this.replan();
	}

	private heardCurrent(state: QueueState): string | null {
		const current = currentItem(state);
		const progress = this.data.progress;
		if (!current?.trackId || !progress || progress.key !== current.key) return null;
		return progress.position >= HEARD_SECONDS ? current.trackId : null;
	}

	/** Rehearsal: move the evening's clock and the queue to a moment on the timeline. */
	async seek(time: number): Promise<void> {
		await this.ready();
		if (this.data.status !== 'rehearsal') throw new Error('Seeking is for rehearsals.');
		const plan = this.plan;
		const state = await queue.ready();
		const timeline = this.timeline();
		const row = timeline.find((r) => time >= r.startAt && time < r.endAt) ?? timeline[timeline.length - 1];
		if (!row || !plan) return;
		const inQueue = state.items.some((i) => i.key === row.key);
		if (!inQueue) return;
		const position = Math.max(0, (time - row.startAt) / 1000);
		this.data.clockOffset += time - this.now();
		if (row.key !== state.currentKey) await queue.jump(row.key);
		if (row.kind === 'song' || row.kind === 'narration') {
			this.setCue(row.key, position, false);
		} else if (row.kind !== 'hold') {
			this.data.timed = { key: row.key, endsAt: Date.now() + Math.max(1, row.duration - position) * 1000 };
			this.armTimed();
			this.setCue(row.key, position, false);
		}
		this.data.progress = { key: row.key, position, at: this.now(), playing: true };
		this.persist();
		await this.replan();
	}

	/** Every row of the rehearsal where the rail draws it: the past timed back, the rest as planned. */
	private timeline(): { key: string; kind: string; startAt: number; endAt: number; duration: number }[] {
		return [...this.past(this.plan), ...(this.plan?.rows ?? [])].map((r) => ({
			key: r.key,
			kind: r.kind,
			startAt: r.startAt,
			endAt: r.endAt,
			duration: r.duration
		}));
	}

	/** Leave the evening but keep the music: songs and requests stay as a plain queue. */
	async bail(): Promise<void> {
		await this.ready();
		if (!this.live) throw new Error('No evening is running.');
		this.data.status = 'ended';
		this.data.bailed = true;
		this.data.hold = null;
		this.data.timed = null;
		if (this.timedTimer) clearTimeout(this.timedTimer);
		eveningGate.active = false;
		eveningGate.ahead = [];
		this.stopTick();
		await queue.transform(bailQueue);
		this.persist();
		await this.replan();
	}

	/** End a rehearsal or an evening and bring back the queue set aside when it started. */
	async end(): Promise<void> {
		await this.ready();
		const aside = this.data.setAside;
		this.data.status = this.data.script ? 'loaded' : 'idle';
		this.data.run = null;
		this.data.hold = null;
		this.data.timed = null;
		this.data.progress = null;
		this.data.clockOffset = 0;
		this.data.startedAt = null;
		this.data.bailed = false;
		this.data.memory = EMPTY_MEMORY;
		if (this.timedTimer) clearTimeout(this.timedTimer);
		eveningGate.active = false;
		eveningGate.ahead = [];
		this.stopTick();
		if (aside) {
			this.data.setAside = null;
			await queue.replace(aside.items, aside.currentKey);
			if (aside.currentKey) this.setCue(aside.currentKey, 0, true);
		}
		this.persist();
		await this.replan();
	}

	/** After an evening ends or bails: the playing song stays, the set-aside queue follows it. */
	async restoreQueue(): Promise<void> {
		await this.ready();
		const aside = this.data.setAside;
		if (!aside) throw new Error('No queue was set aside.');
		if (this.live) throw new Error('End the evening first.');
		const state = await queue.ready();
		const current = currentItem(state);
		const playing = current && (current.kind ?? 'song') === 'song' ? [current] : [];
		const items = [...playing, ...aside.items.filter((i) => i.key !== current?.key)];
		this.data.setAside = null;
		await queue.replace(items, playing[0]?.key ?? aside.currentKey);
		this.persist();
		this.publish();
	}

	/** The browser's position in the current row, every few seconds. */
	progress(key: string, position: number, playing: boolean): void {
		if (!this.live) return;
		const state = queue.snapshot;
		if (state.currentKey !== key || !Number.isFinite(position)) return;
		const at = this.now();
		// A start or stop moves every projected time after this row, so the rail hears of it now.
		const toggled = this.data.progress?.key === key && this.data.progress.playing !== playing;
		this.data.progress = { key, position: Math.max(0, position), at, playing };
		const current = currentItem(state);
		if (current?.trackId && position >= HEARD_SECONDS && !this.data.memory.used.includes(current.trackId)) {
			this.data.memory = { ...this.data.memory, used: [...this.data.memory.used, current.trackId] };
		}
		const timed = this.data.timed;
		if (timed && timed.key === key && current) {
			// A paused timed row waits with the browser, keeping what it has left; a playing one follows its clock.
			const left = Math.max(0, current.duration - position);
			this.data.timed = { key, endsAt: Date.now() + left * 1000, ...(playing ? {} : { left }) };
			if (playing) this.armTimed();
			else if (this.timedTimer) clearTimeout(this.timedTimer);
		}
		if (Date.now() - this.savedProgressAt > SAVE_PROGRESS_MS) {
			this.savedProgressAt = Date.now();
			this.persist();
		}
		if (toggled) void this.replan();
	}

	/** A row finished, reported by the browser or a timed row's clock. */
	async advance(key: string): Promise<void> {
		await this.ready();
		const state = await queue.ready();
		if (state.currentKey !== key) return;
		const current = currentItem(state);
		if (current?.kind === 'hold') return;
		await queue.advanceFrom(key);
	}

	/** Measure a narration file now, so the evening knows its length. */
	private async prepareNarrations(): Promise<number> {
		let failed = 0;
		for (const segment of this.data.script?.segments ?? []) {
			if (segment.kind !== 'narration' || this.narrations[segment.audio] !== undefined) continue;
			this.prepare = { ...this.prepare, current: basename(segment.audio) };
			this.publish();
			try {
				const measured = await narrationDetached(segment.audio);
				this.narrations[segment.audio] = measured.duration;
			} catch {
				failed++;
			}
			this.prepare = { ...this.prepare, done: this.prepare.done + 1 };
		}
		return failed;
	}

	/** Prepare every song and narration the evening plans, one at a time, before the night. */
	async prepareAll(): Promise<void> {
		await this.ready();
		if (this.prepare.running) return;
		const plan = this.live ? this.plan : this.preview;
		if (!plan) throw new Error('Open an evening file first.');
		const songs = plan.rows.filter((r) => r.kind === 'song' && !r.ready && r.trackId);
		const narrations = (this.data.script?.segments ?? []).filter((s) => s.kind === 'narration' && this.narrations[s.audio] === undefined).length;
		this.prepare = { running: true, total: songs.length + narrations, done: 0, failed: 0, current: null };
		this.publish();
		let failed = await this.prepareNarrations();
		for (const row of songs) {
			this.prepare = { ...this.prepare, current: row.title };
			this.publish();
			try {
				await prepareTrack({ source: row.source, trackId: row.trackId, thumbnail: row.thumbnail }, () => {});
			} catch {
				failed++;
			}
			this.prepare = { ...this.prepare, done: this.prepare.done + 1, failed };
			this.publish();
		}
		this.prepare = { ...this.prepare, running: false, current: null, failed };
		await this.replan();
	}

	/** A row's lighting as soon as the store knows the row, waiting on a replan only when it does not yet. */
	async lightingSoon(key: string): Promise<RowLightingView | null> {
		await this.ready();
		await this.initial;
		const known = this.lighting(key);
		if (known) return known;
		await this.settled();
		return this.lighting(key);
	}

	/** Resolves once no replan is in flight, so a row asked for right after a jump is known. */
	async settled(): Promise<void> {
		await this.ready();
		await this.initial;
		while (this.replanning) await this.replanning;
	}

	/** What a player needs to light one evening row. */
	lighting(key: string): RowLightingView | null {
		const plan = this.live ? this.plan : this.preview;
		const row = plan?.rows.find((r) => r.key === key);
		if (!row) return null;
		return { key: row.key, kind: row.kind, title: row.title, light: row.light, plan: row.lighting };
	}

	/** The audio file a narration row plays. */
	narrationAudio(key: string): string | null {
		const plan = this.live ? this.plan : this.preview;
		const row = plan?.rows.find((r) => r.key === key);
		return row?.kind === 'narration' ? row.source : null;
	}
}

/** The queue's rows and their readiness, which is what changes a plan; messages do not. */
function shapeOf(state: QueueState): string {
	return state.items.map((i) => `${i.key}:${i.status === 'ready' || i.status === 'error' ? i.status : 'p'}`).join('|');
}

export const evening = new EveningStore();
