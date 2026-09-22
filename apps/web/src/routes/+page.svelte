<script lang="ts">
	import type { LightPart, RoomModel, RoomSync, Show, TrackAnalysis, TrackContext } from '@mv/core';
	import { OPEN_LENGTH, roomModel, tempoSegments } from '@mv/core';
	import { Viz, type Readout } from '$lib/viz.svelte.ts';
	import { every } from '$lib/ticker.ts';
	import { createArrangementEditor } from '$lib/arrangement.svelte.ts';
	import { QueueClient } from '$lib/queue.svelte.ts';
	import { EveningClient } from '$lib/evening.svelte.ts';
	import { rowBundle } from '$lib/evening/bundle.ts';
	import { ROW_LABEL } from '$lib/evening/format.ts';
	import { RoomsClient } from '$lib/rooms.svelte.ts';
	import type { PlanView } from '$lib/plan.ts';
	import { installHint, readShell } from '$lib/shell.svelte.ts';
	import { DEFAULT_AMBIENT, type AmbientSettings } from '@mv/core';
	import { indexOfKey, nextItem, type QueueItem, type RowKind } from '$lib/queueModel.ts';
	import type { RowLightingView } from '$lib/evening/view.ts';
	import { FULL_WINDOW, type TimeWindow } from '$lib/timeline.ts';
	import { libraryToCandidate, type Candidate } from '$lib/search.svelte.ts';
	import type {
		Judgement,
		JudgementPatch,
		LibraryEntry,
		LoadState,
		SearchResult,
		Settings,
		SettingsPatch,
		TrackMeta
	} from '$lib/types.ts';
	import Backdrop from '$components/Backdrop.svelte';
	import EveningRail from '$components/EveningRail.svelte';
	import JudgePanel from '$components/JudgePanel.svelte';
	import LibraryModal from '$components/LibraryModal.svelte';
	import LoungeModal from '$components/LoungeModal.svelte';
	import Menu from '$lib/ui/Menu.svelte';
	import { menu } from '$lib/menu.svelte.ts';
	import PlayerBar from '$components/PlayerBar.svelte';
	import QueuePanel from '$components/QueuePanel.svelte';
	import InviteModal from '$components/InviteModal.svelte';
	import SearchModal from '$components/SearchModal.svelte';
	import Stage from '$components/Stage.svelte';
	import TimelineDrawer from '$components/TimelineDrawer.svelte';
	import TopBar from '$components/TopBar.svelte';
	import FloorPlan from '$components/setup/FloorPlan.svelte';
	import Inspector from '$components/setup/Inspector.svelte';
	import RoomRail from '$components/setup/RoomRail.svelte';

	let viz: Viz | null = $state(null);
	const queue = new QueueClient();
	const evening = new EveningClient();
	const rooms = new RoomsClient();

	let readout = $state<Readout>({
		fps: 0,
		position: 0,
		duration: 0,
		playing: false,
		bar: 0,
		section: 'intro',
		resting: false,
		scene: '',
		roomBase: 'transparent',
		roomAccent: 'transparent'
	});

	let analysis = $state<TrackAnalysis | null>(null);
	let context = $state<TrackContext | null>(null);
	let show = $state<Show | null>(null);
	let meta = $state<TrackMeta | null>(null);
	let trackId = $state<string | null>(null);
	/** The queue row the player has loaded, which is the one whose end it reports. */
	let loadedKey = $state<string | null>(null);
	let rowKind = $state<RowKind>('song');
	let rowCalm = $state(false);
	let load = $state<LoadState>({ phase: 'idle', message: '' });
	let library = $state<LibraryEntry[]>([]);
	let settings = $state<Settings>({
		hasDeepseekKey: false,
		authorBackend: 'claude',
		authorModel: 'claude-opus-5',
		authorEffort: 'high',
		// Use the server catalogue once settings arrive; do not guess model choices.
		authorModels: [],
		autopilot: false,
		lounge: false,
		rest: true,
		ambient: { ...DEFAULT_AMBIENT }
	});

	let suggestions = $state<SearchResult[]>([]);
	/** Where the rail's window into them starts. */
	let shown = $state(0);
	let searchOpen = $state(false);
	let searchSeed = $state('');
	/** Share the timeline window with the scrubber outside the drawer's mount lifetime. */
	let laneView = $state<TimeWindow>(FULL_WINDOW);
	let setupOpen = $state(false);
	let planView = $state<PlanView>('top');
	let plan: FloorPlan | undefined = $state();
	let libraryOpen = $state(false);
	let loungeOpen = $state(false);
	let judgeOpen = $state(false);
	/** By track id. Loaded once when the panel first opens; writes go through saveJudgement. */
	let judgements = $state<Record<string, Judgement>>({});
	let judgementsLoaded = false;
	/** Tempo-change candidates, seconds; only the listener decides whether they start a new song. */
	const tempoChanges = $derived(
		analysis ? tempoSegments(analysis.tempo).slice(1).map((s) => Math.round(s.start * 10) / 10) : []
	);

	const arrangement = createArrangementEditor({
		get trackId() { return trackId; },
		get meta() { return meta; },
		get judgements() { return judgements; },
		get viz() { return viz; },
		get show() { return show; },
		set show(value) { show = value; },
		get analysis() { return analysis; },
		set analysis(value) { analysis = value; },
		loadJudgements,
		saveJudgement,
		openTimeline() { timelineOpen = true; },
		note
	});
	const movements = $derived(arrangement.movements);
	const movementVetoes = $derived(arrangement.movementVetoes);
	const sectionEditing = $derived(arrangement.sectionEditing);
	const sectionDraft = $derived(arrangement.sectionDraft);
	const previewShow = $derived(arrangement.previewShow);
	const {
		armSectionEdit,
		saveSections,
		saveMovements,
		vetoMovement,
		liftVeto,
		undoMapEdit,
		discardSections,
		togglePreview
	} = arrangement;
	/** Analysis movement seams; the initial span is not a seam. */
	const detectedMovements = $derived(
		(analysis?.movements ?? []).slice(1).map((m) => ({ t: m.startTime, source: m.source, note: m.note }))
	);

	// Read once: the shell injects it before any of this runs and never changes it.
	const shell = readShell();
	let leftOpen = $state(true);
	let rightOpen = $state(true);
	let timelineOpen = $state(false);

	let volume = $state(0.8);
	let relevelling = $state(false);
	let rerolling = $state(false);

	// The server owns the room and whether it is lit; this only ever reads them.
	const outputRunning = $derived(rooms.output.running);

	const current = $derived(queue.current);
	const currentIndex = $derived(indexOfKey(queue.state, queue.state.currentKey));
	const hasPrev = $derived(currentIndex > 0);
	const hasNext = $derived(currentIndex >= 0 && currentIndex < queue.items.length - 1);

	const busy = $derived(current !== null && current.status !== 'ready' && current.status !== 'error');
	const busyLabel = $derived(current?.message ?? 'Working');
	const failure = $derived(
		shell.missingTools.length > 0
			? `${shell.missingTools.join(', ')} not found. ${installHint(shell.platform, shell.missingTools)}`
			: load.phase === 'error'
				? load.message
				: current?.status === 'error'
					? current.message
					: ''
	);

	/** Reset track-local zoom when collapsing the drawer. */
	function toggleTimeline() {
		timelineOpen = !timelineOpen;
		if (!timelineOpen) laneView = FULL_WINDOW;
	}

	function note(line: string) {
		console.info(line);
	}

	function setPhase(phase: LoadState['phase'], message: string) {
		load = { phase, message };
	}

	function postJson(url: string, body: unknown) {
		return fetch(url, {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(body)
		});
	}

	async function refreshLibrary() {
		try {
			const res = await fetch('/api/library');
			if (res.ok) library = ((await res.json()) as { entries: LibraryEntry[] }).entries;
		} catch {
			// A missing library only costs the palette its first group.
		}
	}

	async function refreshSettings() {
		try {
			const res = await fetch('/api/settings');
			if (res.ok) settings = (await res.json()) as Settings;
		} catch {
			// Loopback only, so a failure here means a guest page, where authoring is not offered.
		}
	}

	/** Persisted, because which model to spend is a decision that outlives one track. */
	async function patchSettings(patch: SettingsPatch) {
		const res = await fetch('/api/settings', {
			method: 'PUT',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify(patch)
		});
		if (res.ok) settings = (await res.json()) as Settings;
		else note(`settings: ${await res.text()}`);
	}

	/** Refresh blended radio suggestions when the set list changes. */
	// Fetch extra suggestions so rotating the visible four requires no request.
	const SUGGESTION_ROWS = 4;

	async function refreshSuggestions() {
		try {
			const res = await fetch('/api/radio?limit=16');
			suggestions = res.ok ? ((await res.json()) as { results: SearchResult[] }).results : [];
		} catch {
			suggestions = [];
		}
		shown = 0;
	}

	function toggleAutopilot(on: boolean) {
		settings = { ...settings, autopilot: on };
		void patchSettings({ autopilot: on });
		note(on ? 'the radio will keep the queue full' : 'radio off');
	}

	/** Queue a run of what follows one track, which is what "more like this" asks for. */
	async function startRadio(seedId: string, label: string) {
		note(`finding tracks like ${label}`);
		const res = await fetch(`/api/radio?seed=${encodeURIComponent(seedId)}&limit=12`);
		if (!res.ok) {
			note(`radio: ${await res.text()}`);
			return;
		}
		const { results } = (await res.json()) as { results: SearchResult[] };
		if (results.length === 0) {
			note('nothing new to add');
			return;
		}
		await queue.add(results.map(toNewItem));
		note(`queued ${results.length} like ${label}`);
	}

	/** Ids the queue is holding, which are the ones the library must not offer to delete. */
	const queuedIds = $derived(
		new Set(queue.items.map((i) => i.trackId).filter((id): id is string => id !== null))
	);

	/** Cached tracks use pick() to share queueing side effects with search results. */
	function fromLibrary(entry: LibraryEntry, how: 'queue' | 'now') {
		return pick(libraryToCandidate(entry), how);
	}

	async function loadJudgements() {
		if (judgementsLoaded) return;
		const res = await fetch('/api/judge');
		if (!res.ok) return;
		const data = (await res.json()) as { judgements: Judgement[] };
		judgements = Object.fromEntries(data.judgements.map((j) => [j.trackId, j]));
		judgementsLoaded = true;
	}

	async function toggleJudge(open: boolean) {
		judgeOpen = open;
		if (open) await loadJudgements();
	}

	async function saveJudgement(j: JudgementPatch) {
		// Patch only this writer's fields; merging against a stale client snapshot loses concurrent
		// edits.
		judgements = {
			...judgements,
			[j.trackId]: { ...(judgements[j.trackId] ?? ({} as Judgement)), ...j }
		};
		try {
			const res = await fetch('/api/judge', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ judgement: j })
			});
			// A save that failed silently leaves the panel showing a verdict nothing stored.
			if (!res.ok) note(`ERROR the judgement did not save: ${res.status} ${await res.text()}`);
		} catch (e) {
			note(`ERROR the judgement did not save: ${(e as Error).message}`);
		}
	}

	// Reset after the new track owns the stage, without restoring the old preview.
	$effect(() => {
		void trackId;
		arrangement.reset();
	});

	/** Visit unjudged analysed tracks oldest first for stable corpus review order. */
	function nextUnjudged() {
		const candidates = library
			.filter((e) => e.analysed && !judgements[e.id])
			.sort((a, b) => a.updatedAt - b.updatedAt);
		const target = candidates.find((e) => e.id !== trackId) ?? candidates[0];
		if (target) void fromLibrary(target, 'now');
	}

	async function forget(entry: LibraryEntry) {
		const res = await fetch(`/api/library/${encodeURIComponent(entry.id)}`, { method: 'DELETE' });
		if (!res.ok) {
			note(`ERROR ${await res.text()}`);
			return;
		}
		note(`deleted ${entry.title}`);
		await refreshLibrary();
	}

	/** Four at a time, wrapping, so the button always has somewhere to go. */
	const suggestionWindow = $derived(
		suggestions.length === 0
			? []
			: Array.from(
					{ length: Math.min(SUGGESTION_ROWS, suggestions.length) },
					(_, i) => suggestions[(shown + i) % suggestions.length]
				)
	);

	function shuffleSuggestions() {
		if (suggestions.length === 0) return;
		shown = (shown + SUGGESTION_ROWS) % suggestions.length;
	}

	async function addSuggestion(song: SearchResult) {
		await queue.add([toNewItem(song)]);
		note(`queued ${song.title}`);
		// Remove only the picked suggestion so remaining choices do not shift.
		suggestions = suggestions.filter((s) => s.id !== song.id);
	}

	function toNewItem(song: SearchResult) {
		return {
			source: song.webpageUrl,
			trackId: song.id,
			title: song.title,
			uploader: song.artist,
			thumbnail: song.thumbnail,
			duration: song.duration
		};
	}

	function toggleLounge(on: boolean) {
		settings = { ...settings, lounge: on };
		void patchSettings({ lounge: on });
		note(on ? 'calm scenes are lighting the room' : 'back to the show');
	}

	function toggleRest(on: boolean) {
		settings = { ...settings, rest: on };
		void patchSettings({ rest: on });
	}

	/** Apply ambient colour each frame during drag; persist on release. */
	function moveAmbient(next: AmbientSettings) {
		settings = { ...settings, ambient: next };
	}

	function saveAmbient(next: AmbientSettings) {
		moveAmbient(next);
		void patchSettings({
			ambientColour: next.source,
			ambientHue: next.hue,
			ambientSat: next.sat,
			ambientDrift: next.drift,
			ambientDwell: next.dwell
		});
	}

	$effect(() => {
		const v = new Viz();
		v.onReadout = (r) => (readout = r);
		// The queue decides what comes next, not this tab: a skip from anywhere lands the same way.
		v.onEnded = advance;
		v.onHandover = handover;
		v.start();
		viz = v;
		queue.connect();
		evening.connect();
		rooms.connect();
		void refreshLibrary();
		void refreshSettings();
		return () => {
			v.dispose();
			queue.dispose();
			evening.dispose();
			rooms.dispose();
		};
	});

	// Derive a stable queue signature so ingest SSE updates do not refetch unchanged radio
	// suggestions.
	const setList = $derived(queue.items.map((i) => i.trackId).join());
	$effect(() => {
		void setList;
		void refreshSuggestions();
	});

	$effect(() => {
		viz?.setVolume(volume);
	});

	// Push settings into the unproxied renderer. Untrusted grids force lounge without changing the
	// switch.
	$effect(() => {
		const v = viz;
		if (!v) return;
		v.lounge = settings.lounge || (current?.loungeOnly ?? false) || rowCalm;
		v.rest = settings.rest;
		v.ambient = settings.ambient;
	});

	// The cover, for a room following a track the engine has not composed a show for yet.
	$effect(() => {
		if (viz) viz.artHue = meta?.artHue ?? null;
	});

	/** The preview's own model of the room that plays, for what `auto` came to. */
	let model = $state.raw<RoomModel | null>(null);
	const parts = $derived(new Map<string, LightPart>((model?.pixels ?? []).map((p) => [p.light.id, p.part])));

	/** Rebuilt at most this often while a light is dragged, and once more where it lands. */
	const REBUILD_MS = 80;
	let shownLayout = '';
	let rebuiltAt = 0;
	let rebuild: ReturnType<typeof setTimeout> | null = null;

	// The preview follows the room as it is edited, not only as it is saved.
	$effect(() => {
		const v = viz;
		const layout = rooms.room?.layout;
		if (!v || !layout) return;
		const key = JSON.stringify(layout);
		if (key === shownLayout) return;
		const apply = () => {
			rebuild = null;
			rebuiltAt = performance.now();
			shownLayout = key;
			const next = roomModel(layout);
			v.useRoom(next);
			model = next;
		};
		if (rebuild) clearTimeout(rebuild);
		const wait = REBUILD_MS - (performance.now() - rebuiltAt);
		if (wait <= 0) apply();
		else rebuild = setTimeout(apply, wait);
	});

	$effect(() => {
		const v = viz;
		const test = rooms.test;
		if (!v) return;
		if (test) v.startTest(test.kind, test.lights);
		else v.stopTest();
	});

	/**
	 * The light to point out in the preview: the one under the pointer, else the one selected. A
	 * test pattern says which light it is by itself.
	 */
	const highlighted = $derived.by(() => {
		if (!setupOpen || rooms.test) return null;
		const hovered = rooms.hovered;
		if (hovered && rooms.room?.layout.lights.some((l) => l.id === hovered)) return hovered;
		return rooms.selection?.kind === 'light' ? rooms.selection.id : null;
	});

	function toggleSetup(open = !setupOpen) {
		setupOpen = open;
		if (!open) {
			rooms.stopTest();
			rooms.select(null);
			rooms.settle();
		}
	}

	/** The plan's share of the centre column, kept between visits. */
	let planShare = $state(readShare());

	function readShare(): number {
		try {
			const stored = Number(localStorage.getItem('setup-plan-share'));
			return stored >= 0.25 && stored <= 0.8 ? stored : 0.56;
		} catch {
			return 0.56;
		}
	}

	function resizePlan(e: PointerEvent) {
		const handle = e.currentTarget as HTMLElement;
		const column = handle.parentElement!.getBoundingClientRect();
		handle.setPointerCapture(e.pointerId);
		const move = (ev: PointerEvent) => {
			planShare = Math.min(0.8, Math.max(0.25, (ev.clientY - column.top) / column.height));
		};
		const up = () => {
			handle.removeEventListener('pointermove', move);
			handle.removeEventListener('pointerup', up);
			try {
				localStorage.setItem('setup-plan-share', planShare.toFixed(3));
			} catch {
				// A browser that keeps nothing starts from the default next time.
			}
		};
		handle.addEventListener('pointermove', move);
		handle.addEventListener('pointerup', up);
	}

	/**
	 * A tab that starts leading the hardware adopts what the hardware is doing first, so a
	 * fresh page, or one coming back from the background where it stopped rendering, cannot
	 * drag the room back to its own stale state.
	 */
	async function adoptRoom(v: Viz) {
		try {
			const res = await fetch('/api/output');
			if (!res.ok) return;
			const status = (await res.json()) as { running: boolean; decisions?: RoomSync };
			if (status.running && status.decisions) v.follow(status.decisions);
		} catch {
			// The next sync carries on regardless.
		}
	}

	/** Tell the hardware where playback is now, rather than at the next tick. */
	let syncOutput: (() => void) | null = null;

	// Sync heard audio every 500 ms; the server extrapolates. Read plain Viz fields so 20 Hz readout
	// updates cannot restart the interval. The timer lives in a worker so a hidden tab keeps the
	// hardware informed; its decisions carry their age, so a tab that has stopped rendering
	// stops leading.
	$effect(() => {
		const v = viz;
		if (!outputRunning || !v) return;
		void adoptRoom(v);
		const send = () =>
			postJson('/api/output', {
				action: 'sync',
				position: v.heardPosition,
				playing: v.isPlaying,
				...(loadedKey ? { key: loadedKey } : {}),
				decisions: v.roomSync(),
				age: v.roomAge
			}).catch(() => {});
		void send();
		syncOutput = send;
		const stop = every(500, send);
		const onVisible = () => {
			if (document.visibilityState === 'visible') void adoptRoom(v);
		};
		document.addEventListener('visibilitychange', onVisible);
		return () => {
			stop();
			syncOutput = null;
			document.removeEventListener('visibilitychange', onVisible);
		};
	});

	/**
	 * Follow the server's ready current row. Key plain rows by track ID so metadata updates do not
	 * reload audio; an evening row is its own identity, since its lighting belongs to the row.
	 */
	let loadedTrackId = $state<string | null>(null);
	/** The row a skip has already been spent on, so a dead track is stepped over once. */
	let skippedKey = $state<string | null>(null);
	$effect(() => {
		const item = current;
		if (!viz) return;

		// After playback starts, skip unloadable rows once each. Preserve failed selections on initial
		// load so the host can retry them.
		if (loadedTrackId !== null && item && item.status === 'error' && item.key !== skippedKey) {
			skippedKey = item.key;
			void queue.next(item.key);
			return;
		}

		// The row this tab has already moved on from stays behind until the queue catches up.
		if (leaving !== null) {
			if (item?.key === leaving) return;
			leaving = null;
		}

		// Clearing the queue leaves loaded audio playing and available for authoring.
		if (!item || item.status !== 'ready') return;
		const identity = item.evening ? `row:${item.key}` : item.trackId;
		if (!identity) return;
		// The song already playing under another row, or its evening row untagged by a bail, carries on.
		if (identity === loadedTrackId || (!item.evening && item.key === loadedKey && item.trackId === trackId)) {
			loadedTrackId = identity;
			loadedKey = item.key;
			return;
		}

		loadedTrackId = identity;
		if (item.evening) void openRow(item);
		else void openTrack(item.trackId!, item.key);
	});

	/** A cue from the evening waiting for this row: resume after a restart, a seek, an ended rehearsal. */
	let handledCue = 0;
	function cueFor(key: string) {
		const cue = evening.view.cue;
		if (!cue || cue.key !== key || cue.token === handledCue) return null;
		handledCue = cue.token;
		return cue;
	}

	async function start(v: Viz, key: string) {
		const cue = cueFor(key);
		if (cue && cue.position > 0) v.seek(cue.position);
		if (!cue?.paused) await v.play();
	}

	// A cue for the row that is already loaded applies at once.
	$effect(() => {
		const cue = evening.view.cue;
		const v = viz;
		if (!cue || !v || cue.key !== loadedKey || cue.token === handledCue) return;
		handledCue = cue.token;
		v.seek(cue.position);
		if (cue.paused) v.pause();
		else void v.play();
	});

	// The evening remembers where each row got to, so a restart can come back to it. A start or
	// stop is reported at once: a paused timed row must not run out on the server meanwhile.
	const playingNow = $derived(readout.playing);
	const eveningLive = $derived(evening.live);
	$effect(() => {
		const v = viz;
		const key = loadedKey;
		if (!v || !eveningLive || !key) return;
		void playingNow;
		evening.progress(key, v.position, v.isPlaying);
		return every(5000, () => evening.progress(key, v.position, v.isPlaying));
	});

	type TrackBundle = { analysis: TrackAnalysis; show: Show | null; meta: TrackMeta | null; context: TrackContext | null };

	/** Everything one evening row needs before it can play, fetched and decoded. */
	interface RowLoad {
		key: string;
		lighting: RowLightingView;
		data: TrackBundle | null;
		buffer: AudioBuffer | null;
	}

	async function fetchRow(v: Viz, key: string): Promise<RowLoad> {
		const lighting = await evening.lighting(key);
		const plan = lighting.plan;
		let bytes: ArrayBuffer | null = null;
		let data: TrackBundle | null = null;
		if (plan.kind === 'song') {
			const [bundleRes, audioRes] = await Promise.all([
				fetch(`/api/track/${plan.trackId}/bundle`),
				fetch(`/api/track/${plan.trackId}/audio`)
			]);
			if (!bundleRes.ok) throw new Error((await bundleRes.text()).slice(0, 300));
			if (!audioRes.ok) throw new Error('audio not cached');
			data = (await bundleRes.json()) as TrackBundle;
			bytes = await audioRes.arrayBuffer();
		} else if (plan.kind === 'narration') {
			const audioRes = await fetch(`/api/evening/row/${encodeURIComponent(key)}/audio`);
			if (!audioRes.ok) throw new Error((await audioRes.text()).slice(0, 300));
			bytes = await audioRes.arrayBuffer();
		}
		return { key, lighting, data, buffer: bytes ? await v.decode(bytes) : null };
	}

	/** The next evening row, fetched and decoded while this one plays, so a cut into it lands on time. */
	let ahead: { key: string; load: Promise<RowLoad | null> } | null = null;
	const upcoming = $derived(queue.state.currentKey ? nextItem(queue.state) : null);
	$effect(() => {
		const v = viz;
		const next = upcoming;
		if (!v) return;
		// The row after this one changed, or left the evening: whatever was loaded or planned for it goes.
		if (ahead && (ahead.key !== next?.key || !next?.evening)) {
			ahead = null;
			v.clearCrossfade();
		}
		if (!next?.evening || next.status !== 'ready' || ahead) return;
		ahead = { key: next.key, load: fetchRow(v, next.key).catch(() => null) };
		void planCrossfade(v);
	});

	/** When the next row crossfades in, hand its audio to the player once both rows are loaded. */
	async function planCrossfade(v: Viz) {
		const pending = ahead;
		const current = loadedKey;
		if (!pending || !current) return;
		const row = await pending.load;
		const plan = row?.lighting.plan;
		if (!row?.buffer || plan?.kind !== 'song' || !plan.crossfade || plan.fade) return;
		// Both rows must still be what they were: this one an evening song playing, that one next.
		const playing = queue.state.items.find((i) => i.key === current);
		if (ahead !== pending || loadedKey !== current || queue.state.currentKey !== current || !playing?.evening || rowKind !== 'song') return;
		v.planCrossfade(row.buffer, plan.crossfade);
	}

	/** The next row's audio took over in a crossfade: the queue and the lights follow it. */
	function handover() {
		const from = loadedKey;
		const next = upcoming;
		if (!from) return;
		if (!next?.evening) {
			void queue.next(from);
			return;
		}
		void queue.next(from);
		leaving = from;
		loadedTrackId = `row:${next.key}`;
		// The audio already belongs to the next row, and so does every position reported from now.
		loadedKey = next.key;
		void openRow(next, true);
	}

	/** The preloaded row, if what the evening now plans for it still matches. */
	async function takeAhead(key: string): Promise<RowLoad | null> {
		if (ahead?.key !== key) return null;
		const loaded = await ahead.load;
		if (!loaded) return null;
		const lighting = await evening.lighting(key);
		if (JSON.stringify(lighting) === JSON.stringify(loaded.lighting)) return loaded;
		const was = loaded.lighting.plan;
		const now = lighting.plan;
		const sameAudio = now.kind === 'silent' ? was.kind === 'silent' : now.kind === 'song' && was.kind === 'song' && now.trackId === was.trackId;
		return sameAudio ? { ...loaded, lighting } : null;
	}

	/**
	 * A row ended: tell the queue, and when the next evening row is already loaded, start it now
	 * rather than after the queue's answer comes back.
	 */
	function advance() {
		const from = loadedKey;
		const next = upcoming;
		void queue.next(from ?? undefined);
		if (!from || queue.state.currentKey !== from || !next?.evening || next.status !== 'ready' || ahead?.key !== next.key) return;
		leaving = from;
		loadedTrackId = `row:${next.key}`;
		void openRow(next);
	}

	/** Bumped by every open, so a slow load never lands after a newer one. */
	let opening = 0;
	/** The row this tab ended and moved past before the queue said so. */
	let leaving: string | null = null;

	/** `adopted`: the row's audio already plays, handed over by a crossfade. */
	async function openRow(item: QueueItem, adopted = false) {
		if (!viz) return;
		const v = viz;
		const token = ++opening;
		setPhase('analysing', 'Loading');
		try {
			const row = (await takeAhead(item.key)) ?? (await fetchRow(v, item.key));
			const plan = row.lighting.plan;
			const bundle = rowBundle(item.key, plan, row.data, row.lighting.measured ?? null);
			if (!bundle) throw new Error('this row has nothing to play');
			if (token !== opening) return;

			if (!adopted) {
				v.clearShow();
				if (row.buffer) v.useBuffer(row.buffer, plan.kind === 'song' ? plan.fade : undefined, plan.kind === 'narration' ? plan.volume : 1);
				else v.loadSilence(plan.kind === 'silent' ? (plan.length ?? OPEN_LENGTH) : 0);
			}
			loadedKey = item.key;
			rowKind = item.kind ?? 'song';
			rowCalm = bundle.lounge;
			trackId = plan.kind === 'song' ? plan.trackId : null;
			analysis = bundle.analysis;
			context = row.data?.context ?? null;
			meta = row.data?.meta ?? {
				id: item.key,
				title: row.lighting.title,
				uploader: ROW_LABEL[rowKind],
				thumbnail: '',
				webpageUrl: '',
				source: ''
			};
			show = bundle.show;
			if (bundle.show) v.loadShow(bundle.analysis, bundle.show, row.lighting.light);
			setPhase('ready', '');
			if (!adopted) await start(v, item.key);
			// The output renderer follows the queue to evening rows itself; it only needs the position.
			syncOutput?.();
			void planCrossfade(v);
		} catch (e) {
			if (token !== opening) return;
			setPhase('error', (e as Error).message);
			note(`ERROR ${(e as Error).message}`);
		}
	}

	async function openTrack(id: string, key: string) {
		if (!viz) return;
		const token = ++opening;
		show = null;
		analysis = null;
		context = null;
		setPhase('analysing', 'Loading');

		try {
			const [bundleRes, audioRes] = await Promise.all([
				fetch(`/api/track/${id}/bundle`),
				fetch(`/api/track/${id}/audio`)
			]);
			if (!bundleRes.ok) throw new Error((await bundleRes.text()).slice(0, 300));
			if (!audioRes.ok) throw new Error('audio not cached');

			const bundle = (await bundleRes.json()) as {
				analysis: TrackAnalysis;
				show: Show | null;
				meta: TrackMeta | null;
				context: TrackContext | null;
			};
			const audio = await audioRes.arrayBuffer();
			if (token !== opening) return;

			// The outgoing show runs until its replacement is in hand; the room then holds its
			// last look through the decode and dissolves into the new opening.
			viz.clearShow();
			viz.pause();
			const buffer = await viz.decode(audio);
			if (token !== opening) return;
			viz.useBuffer(buffer);
			trackId = id;
			loadedKey = key;
			rowKind = 'song';
			rowCalm = false;
			analysis = bundle.analysis;
			meta = bundle.meta;
			context = bundle.context;

			if (bundle.show) {
				show = bundle.show;
				viz.loadShow(bundle.analysis, bundle.show);
				note(`${bundle.meta?.title ?? id}: ${bundle.show.cues.length} cues, ${bundle.show.hits.length} hits`);
			} else {
				note(`${id}: analysed, no show yet`);
			}

			setPhase('ready', '');
			// Wait for decoding before starting playback.
			await start(viz, key);
		} catch (e) {
			setPhase('error', (e as Error).message);
			note(`ERROR ${(e as Error).message}`);
		}
	}

	/** The room reads the show from disk again, after it was rerolled or re-read. */
	function reloadOutput() {
		if (outputRunning) void postJson('/api/output', { action: 'reload' }).catch(() => {});
	}

	function openSearch(seed: string) {
		searchSeed = seed;
		searchOpen = true;
	}

	async function pick(candidate: Candidate, how: 'queue' | 'now' | 'next') {
		const wasEmpty = queue.items.length === 0;
		const after = await queue.add([
			{
				source: candidate.source,
				trackId: candidate.origin === 'link' ? null : candidate.id,
				title: candidate.origin === 'link' ? candidate.source : candidate.title,
				uploader: candidate.artist,
				thumbnail: candidate.thumbnail,
				duration: candidate.duration,
				authored: candidate.authored
			}
		]);
		note(`queued ${candidate.title}`);
		void refreshLibrary();

		if (how === 'queue' || wasEmpty) return;
		// Read added rows from this reply, not a queue changed concurrently by guests or radio.
		const added = after?.items[after.items.length - 1];
		if (!added) return;
		if (how === 'now') await queue.jump(added.key);
		else await queue.playNext(added.key);
	}

	/** Recompose after changing the grid; rescaling leaves bar-addressed cues on the wrong music. */
	async function relevel(level: number) {
		const source = meta?.source;
		if (!source || relevelling || !viz) return;
		relevelling = true;
		setPhase('analysing', 'Re-reading the grid');
		try {
			const res = await postJson('/api/ingest', { source, metricalLevel: level });
			if (!res.ok) throw new Error((await res.text()).slice(0, 300));
			const data = (await res.json()) as {
				id: string;
				analysis: TrackAnalysis;
				meta: TrackMeta;
				show: Show | null;
			};
			analysis = data.analysis;
			meta = data.meta;
			show = data.show;
			if (data.show) viz.loadShow(data.analysis, data.show);
			note(`re-read at ${data.analysis.tempo.bpm} bpm`);
			setPhase('ready', '');
			reloadOutput();
		} catch (e) {
			setPhase('error', (e as Error).message);
		} finally {
			relevelling = false;
		}
	}

	async function reroll() {
		if (!trackId || !viz || rerolling) return;
		rerolling = true;
		try {
			const res = await postJson(`/api/track/${trackId}/show`, {});
			if (!res.ok) throw new Error((await res.text()).slice(0, 300));
			const data = (await res.json()) as { show: Show };
			show = data.show;
			viz.loadShow(analysis!, data.show);
			note(`rerolled: ${data.show.cues.length} cues, seed ${data.show.seed}`);
			reloadOutput();
			void refreshLibrary();
		} catch (e) {
			note(`ERROR ${(e as Error).message}`);
		} finally {
			rerolling = false;
		}
	}

	/** Previous seeks to the prior section, then the prior track near the beginning. */
	// Use the audio clock; background tabs stop publishing readouts while audio continues.
	function prev() {
		const v = viz;
		if (!v || !analysis || v.position < 3) {
			void queue.prev();
			return;
		}
		const now = v.position;
		const bounds = analysis.sections.map((s) => s.startTime);
		v.seek([...bounds].reverse().find((t) => t < now - 2) ?? 0);
	}

	function next() {
		const v = viz;
		if (!v || !analysis) {
			void queue.next();
			return;
		}
		const now = v.position;
		const target = analysis.sections.map((s) => s.startTime).find((t) => t > now + 0.05);
		if (target === undefined) void queue.next();
		else v.seek(target);
	}

	function onKey(e: KeyboardEvent) {
		if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
			e.preventDefault();
			openSearch('');
			return;
		}
		if (searchOpen) return;
		if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
		// A menu or a dialog takes its own keys, Escape first of all.
		if (menu.open || document.querySelector('[aria-modal="true"]')) return;

		if (setupOpen) {
			if (plan?.key(e)) {
				e.preventDefault();
				return;
			}
			if (e.key === 'Escape') {
				toggleSetup(false);
				return;
			}
		}

		if (e.code === 'Space') {
			e.preventDefault();
			void viz?.toggle();
		} else if (e.code === 'ArrowLeft' && viz) {
			viz.seek(Math.max(0, viz.position - (e.shiftKey ? 30 : 5)));
		} else if (e.code === 'ArrowRight' && viz) {
			viz.seek(Math.min(viz.duration, viz.position + (e.shiftKey ? 30 : 5)));
		} else if (e.key === '[') {
			leftOpen = !leftOpen;
		} else if (e.key === ']') {
			rightOpen = !rightOpen;
		} else if (e.key.toLowerCase() === 'l') {
			toggleLounge(!settings.lounge);
		} else if (e.key.toLowerCase() === 'j' && !setupOpen) {
			void toggleJudge(!judgeOpen);
		}
	}
</script>

<svelte:window onkeydown={onKey} />

<Backdrop thumbnail={meta?.thumbnail ?? ''} />

<div class="shell">
	<TopBar
		{busy}
		{busyLabel}
		{failure}
		{rooms}
		{setupOpen}
		cached={library.length}
		onsearch={openSearch}
		onlibrary={() => (libraryOpen = true)}
		onsetup={() => toggleSetup()}
		ontoggleLeft={() => (leftOpen = !leftOpen)}
		ontoggleRight={() => (rightOpen = !rightOpen)} />

	<div class="body">
		{#if setupOpen}
			{#if leftOpen}
				<RoomRail
					{rooms}
					view={planView}
					localNetworkHint={shell.desktop && shell.platform === 'macos'}
					ondraw={() => plan?.startDrawing()}
					onclose={() => toggleSetup(false)} />
			{/if}
		{:else if leftOpen}
			<QueuePanel
				items={queue.items}
				currentKey={queue.state.currentKey}
				playing={readout.playing}
				onjump={(k) => void queue.jump(k)}
				onremove={(k) => void queue.remove(k)}
				onplayNext={(k) => void queue.playNext(k)}
				onmove={(k, to) => void queue.move(k, to)}
				onretry={(k) => void queue.retry(k)}
				onclear={() => void queue.clear(true)}
				onsearch={() => openSearch('')}
				autopilot={settings.autopilot}
				suggestions={evening.live ? [] : suggestionWindow}
				segmentStarts={Object.fromEntries(evening.view.segments.map((s) => [s.id, s.startAt]))}
				eveningLive={evening.live}
				onshuffle={shuffleSuggestions}
				onautopilot={toggleAutopilot}
				onradio={(item) => void startRadio(item.trackId ?? '', item.title)}
				onsuggestion={(song) => void addSuggestion(song)}
				onrunShow={(k) => void queue.runShow(k)} />
		{/if}

		<div class="centre">
			{#if setupOpen}
				<div class="plan-slot" style:height={`${planShare * 100}%`}>
					<FloorPlan bind:this={plan} {rooms} bind:view={planView} />
				</div>
				<div
					class="splitter floats"
					role="separator"
					aria-orientation="horizontal"
					aria-label="Drag to share the space between the plan and the preview"
					onpointerdown={resizePlan}>
				</div>
			{/if}
			<Stage
				{viz}
				{readout}
				{load}
				hasShow={!!show}
				queued={queue.items.length}
				lounge={settings.lounge}
				layout={rooms.room?.layout ?? null}
				highlight={highlighted}
				setup={setupOpen}
				onlounge={() => (loungeOpen = true)} />
		</div>

		{#if setupOpen}
			{#if rightOpen}<Inspector {rooms} {parts} />{/if}
		{:else if judgeOpen}
			<JudgePanel
				{trackId}
				title={meta?.title ?? ''}
				analysisHash={analysis?.hash ?? null}
				tempoChanges={tempoChanges}
				showSeed={show?.seed ?? null}
				authoredBy={show?.authoredBy ?? null}
				position={readout.position}
				bar={readout.bar}
				judgement={trackId ? (judgements[trackId] ?? null) : null}
				judged={Object.keys(judgements).length}
				total={library.filter((e) => e.analysed).length}
				{movements}
				detected={detectedMovements}
				vetoes={movementVetoes}
				editingSections={sectionEditing}
				previewingArrangement={previewShow !== null}
				onsave={(j) => void saveJudgement(j)}
				onnext={nextUnjudged}
				onseek={(t) => viz?.seek(t)}
				onmovements={saveMovements}
				onveto={vetoMovement}
				onunveto={liftVeto}
				oneditsections={(on) => void armSectionEdit(on)}
				ondiscardsections={discardSections}
				onpreviewarrangement={(on) => void togglePreview(on)}
				onclose={() => (judgeOpen = false)} />
		{:else if rightOpen}
			<EveningRail
				{evening}
				{current}
				{readout}
				{analysis}
				{context}
				{show}
				trustNote={current?.loungeOnly ? (current.trustNote ?? 'no reason recorded') : null}
				onrelevel={relevel}
				onreroll={reroll}
				{relevelling}
				{rerolling} />
		{/if}
	</div>

	<PlayerBar
		{meta}
		{analysis}
		{show}
		{readout}
		bind:volume
		{timelineOpen}
		view={laneView}
		queued={queue.items.length}
		{hasPrev}
		{hasNext}
		kind={rowKind}
		ongo={() => void evening.go()}
		ontoggle={() => void viz?.toggle()}
		onseek={(t) => viz?.seek(t)}
		onprev={prev}
		onnext={next}
		onsearch={() => openSearch('')}
		ontimeline={toggleTimeline} />

	{#if timelineOpen}
		<TimelineDrawer
			{viz}
			{analysis}
			{show}
			position={readout.position}
			duration={readout.duration}
			bind:view={laneView}
			onseek={(t) => viz?.seek(t)}
			editing={sectionEditing}
			sections={sectionDraft}
			{movements}
			detected={detectedMovements}
			onsections={saveSections}
			onmovements={saveMovements}
			onveto={vetoMovement}
			onundo={undoMapEdit} />
	{/if}
</div>

<SearchModal
	bind:open={searchOpen}
	bind:query={searchSeed}
	{library}
	{suggestions}
	evening={evening.live}
	onpick={pick} />

<InviteModal />

<LibraryModal
	open={libraryOpen}
	{library}
	queued={queuedIds}
	onclose={() => (libraryOpen = false)}
	onplay={(e) => void fromLibrary(e, 'now')}
	onqueue={(e) => void fromLibrary(e, 'queue')}
	onradio={(e) => void startRadio(e.id, e.title)}
	ondelete={forget} />

<!-- All at the page root: a panel that blurs its backdrop cannot contain a fixed-position child. -->
<Menu />

<LoungeModal
	open={loungeOpen}
	lounge={settings.lounge}
	rest={settings.rest}
	ambient={settings.ambient}
	resting={readout.resting}
	scene={readout.scene}
	roomBase={readout.roomBase}
	roomAccent={readout.roomAccent}
	onclose={() => (loungeOpen = false)}
	onlounge={toggleLounge}
	onrest={toggleRest}
	onambient={moveAmbient}
	onambientdone={saveAmbient}
	onnextscene={() => viz?.nextScene()} />

<style>
	/* Share the root stacking context so the room layer remains below the panels. */
	.shell {
		display: flex;
		flex-direction: column;
		height: 100vh;
	}
	.body {
		display: flex;
		flex: 1;
		min-height: 0;
	}
	.centre {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-width: 0;
		min-height: 0;
	}
	.plan-slot {
		position: relative;
		z-index: 2;
		flex: none;
		min-height: 0;
	}
	.plan-slot > :global(.plan) {
		height: 100%;
	}
	/* A hairline to grab between the plan and the preview. */
	.splitter {
		flex: none;
		height: 7px;
		margin: -4px 0 -3px;
		cursor: row-resize;
		touch-action: none;
	}
	.splitter:hover {
		background: linear-gradient(transparent 3px, var(--ring) 3px, var(--ring) 4px, transparent 4px);
	}
</style>
