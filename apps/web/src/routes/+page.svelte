<script lang="ts">
	import type { Show, TrackAnalysis, TrackContext } from '@mv/core';
	import { barAtTime, barTimeAt, tempoSegments } from '@mv/core';
	import { Viz, type Readout } from '$lib/viz.svelte.ts';
	import { QueueClient } from '$lib/queue.svelte.ts';
	import { HardwareClient } from '$lib/hardware.svelte.ts';
	import { installHint, readShell } from '$lib/shell.svelte.ts';
	import { DEFAULT_AMBIENT, GAMMA, MASTER, type AmbientSettings } from '@mv/core';
	import { indexOfKey } from '$lib/queueModel.ts';
	import { DEFAULT_OUTPUT_FPS, type WireProtocol } from '$lib/hardware.ts';
	import { FULL_WINDOW, type TimeWindow } from '$lib/timeline.ts';
	import { libraryToCandidate, type Candidate } from '$lib/search.svelte.ts';
	import type {
		AuthorEffort,
		AuthorEvent,
		JudgedSection,
		Judgement,
		JudgementPatch,
		LibraryEntry,
		LoadState,
		SearchResult,
		Settings,
		SettingsPatch,
		Step,
		TrackMeta
	} from '$lib/types.ts';
	import Backdrop from '$components/Backdrop.svelte';
	import HardwareModal from '$components/HardwareModal.svelte';
	import Inspector from '$components/Inspector.svelte';
	import JudgePanel from '$components/JudgePanel.svelte';
	import LibraryModal from '$components/LibraryModal.svelte';
	import LoungeModal from '$components/LoungeModal.svelte';
	import Menu from '$lib/ui/Menu.svelte';
	import PlayerBar from '$components/PlayerBar.svelte';
	import QueuePanel from '$components/QueuePanel.svelte';
	import RoomModal from '$components/RoomModal.svelte';
	import SearchModal from '$components/SearchModal.svelte';
	import Stage from '$components/Stage.svelte';
	import TimelineDrawer from '$components/TimelineDrawer.svelte';
	import TopBar from '$components/TopBar.svelte';

	let viz: Viz | null = $state(null);
	const queue = new QueueClient();
	const hardware = new HardwareClient();

	let readout = $state<Readout>({
		fps: 0,
		position: 0,
		duration: 0,
		playing: false,
		bar: 0,
		section: 'intro',
		energy: 0,
		bpm: 0,
		cueBar: -1,
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
	let load = $state<LoadState>({ phase: 'idle', message: '', progress: null });
	let log = $state<string[]>([]);
	let steps = $state<Step[]>([]);
	let warnings = $state<string[]>([]);
	let library = $state<LibraryEntry[]>([]);
	let settings = $state<Settings>({
		hasDeepseekKey: false,
		authorBackend: 'claude',
		authorModel: 'claude-opus-5',
		authorEffort: 'high',
		// Empty until the settings arrive, which is what the menu has to survive rather than a
		// guess at the catalogue that could disagree with the server's.
		authorModels: [],
		outputOffsetMs: 0,
		outputFps: DEFAULT_OUTPUT_FPS,
		outputBrightness: MASTER,
		outputContrast: GAMMA,
		outputLampBrightness: MASTER,
		outputProtocol: 'ddp',
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
	/**
	 * The slice of the track the timeline lanes are showing.
	 *
	 * Held here rather than in the drawer because two things read it - the lanes and the
	 * scrubber's bracket - and because the drawer unmounts when it closes, which would otherwise
	 * throw the zoom away every time somebody glanced at the room.
	 */
	let laneView = $state<TimeWindow>(FULL_WINDOW);
	let hardwareOpen = $state(false);
	let libraryOpen = $state(false);
	let loungeOpen = $state(false);
	let judgeOpen = $state(false);
	/** By track id. Loaded once when the panel first opens; writes go through saveJudgement. */
	let judgements = $state<Record<string, Judgement>>({});
	let judgementsLoaded = false;
	/**
	 * Seconds where the grid's own bar lengths change - the judge panel offers these as
	 * movement candidates. A measurement of the bar table, not a guess about structure:
	 * whether a tempo change is a new song is the listener's call, so nothing acts on them.
	 */
	const tempoChanges = $derived(
		analysis ? tempoSegments(analysis.tempo).slice(1).map((s) => Math.round(s.start * 10) / 10) : []
	);

	/**
	 * Where a new song starts inside this one, read straight off the saved judgement.
	 *
	 * Two surfaces edit this list - the panel's chips and the section lane's dividers - so it
	 * is held in one place and derived rather than drafted. A local copy per surface is how a
	 * mark removed in the lane comes back from the panel's next save.
	 */
	const movements = $derived(trackId ? (judgements[trackId]?.movements ?? []) : []);
	/** Seconds near which the owner refused a movement the analyser found; remembered like a mark. */
	const movementVetoes = $derived(trackId ? (judgements[trackId]?.movementVetoes ?? []) : []);
	/**
	 * Where the analysis says the songs change - its own findings and the marks it has heard -
	 * as the panel and the lane show them. The first span starts the track and is not a seam.
	 */
	const detectedMovements = $derived(
		(analysis?.movements ?? []).slice(1).map((m) => ({ t: m.startTime, source: m.source, note: m.note }))
	);

	/** Hand-drawn section editing: the drawer's section lane grows handles while armed. */
	let sectionEditing = $state(false);
	let sectionDraft = $state<JudgedSection[] | null>(null);
	/**
	 * One step back through the hand map, held here because the page owns the draft: the lane
	 * asks for it and this decides what the step was. Section edits and movement marks share
	 * the stack, so undo walks back through the gestures in the order they were made.
	 */
	type MapEdit = { sections: JudgedSection[] } | { movements: number[] };
	let undoStack: MapEdit[] = [];
	/** The show composed from the hand-drawn map while previewing it; null otherwise. */
	let previewShow = $state<Show | null>(null);
	/** Where the real show waits while the preview is on stage. Not reactive: only restore reads it. */
	let shelvedShow: Show | null = null;
	/** And the real analysis, whose section table the preview replaces for as long as it runs. */
	let shelvedAnalysis: TrackAnalysis | null = null;
	let previewFetching = false;
	/** A draft that arrived while a compose was in flight, so the last edit always wins. */
	let previewPending = false;

	// Read once: the shell injects it before any of this runs and never changes it.
	const shell = readShell();
	let leftOpen = $state(true);
	let rightOpen = $state(true);
	let timelineOpen = $state(false);

	let volume = $state(0.8);
	let relevelling = $state(false);
	let rerolling = $state(false);

	// Deliberately not `$state`: the sync effect below reads it, and a reactive read there would
	// re-subscribe on every step of the trim, tearing down the interval it just built. The slider
	// displays `settings.outputOffsetMs`; this is the copy the wire is driven from.
	let wireOffsetMs = 0;

	// The server owns the address and whether it is streaming; this only ever reads them.
	const ddpHost = $derived(hardware.status.host);
	const ddpRunning = $derived(hardware.status.streaming);

	const current = $derived(queue.current);
	const currentIndex = $derived(indexOfKey(queue.state, queue.state.currentKey));
	const hasPrev = $derived(currentIndex > 0);
	const hasNext = $derived(currentIndex >= 0 && currentIndex < queue.items.length - 1);

	const busy = $derived(
		load.phase === 'authoring' ||
			(current !== null && current.status !== 'ready' && current.status !== 'error')
	);
	const busyLabel = $derived(
		load.phase === 'authoring' ? load.message : (current?.message ?? 'Working')
	);
	const failure = $derived(
		shell.missingTools.length > 0
			? `${shell.missingTools.join(', ')} not found. ${installHint(shell.platform, shell.missingTools)}`
			: load.phase === 'error'
				? load.message
				: current?.status === 'error'
					? current.message
					: ''
	);

	/**
	 * Closing the drawer throws the zoom away.
	 *
	 * The window outlives the drawer's markup on purpose - the scrubber draws it too - but it is a
	 * place in one track rather than a setting, and coming back to a collapsed player still framed
	 * on eight bars of a song that has since changed is a state nobody asked to be in.
	 */
	function toggleTimeline() {
		timelineOpen = !timelineOpen;
		if (!timelineOpen) laneView = FULL_WINDOW;
	}

	function note(line: string) {
		log = [...log.slice(-400), line];
	}

	function setPhase(phase: LoadState['phase'], message: string, progress: number | null = null) {
		load = { phase, message, progress };
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
			if (res.ok) {
				settings = (await res.json()) as Settings;
				wireOffsetMs = settings.outputOffsetMs;
			}
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

	function chooseModel(authorModel: string) {
		const backend =
			settings.authorModels.find((m) => m.id === authorModel)?.backend ?? settings.authorBackend;
		settings = { ...settings, authorModel, authorBackend: backend };
		void patchSettings({ authorModel });
	}

	function chooseEffort(authorEffort: AuthorEffort) {
		settings = { ...settings, authorEffort };
		void patchSettings({ authorEffort });
	}

	function saveDeepseekKey(key: string) {
		void patchSettings({ deepseekApiKey: key });
	}

	/**
	 * What YouTube Music would play after what is already queued.
	 *
	 * Refreshed whenever the set list changes, because the point of the blend is that it drifts
	 * with the night rather than orbiting whatever seeded it first.
	 */
	// More are fetched than the rail shows, so offering a different four is a step through what
	// was already asked for rather than another round trip.
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

	/**
	 * Queue something already in the cache.
	 *
	 * Through the same path as a palette pick, because a cached row and a catalogue hit differ
	 * only in whether anything has to be fetched - and `pick` is where the after-effects live.
	 */
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
		// A PATCH: whatever this writer owns, and nothing else. The server merges it over the
		// file. The client used to merge instead, against a `judgements` map loaded once per
		// page - which is how a redrawn map was reverted by a later star, and how a section
		// save could blank a rating given in another tab.
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

	/**
	 * The draft the editor starts from: the saved hand-drawn map, else the analysis as-is.
	 *
	 * Taken exactly as saved. An earlier version snapped it onto bar lines on the way in, so
	 * that the lane matched what the engine would round to - which silently destroyed every
	 * boundary the owner had placed between bar lines on purpose, the moment the editor was
	 * re-armed. A hand map is a record of what was heard; it is the arrangement's job to
	 * round, not the editor's job to forget.
	 */
	function seedSections(): JudgedSection[] | null {
		const saved = trackId ? judgements[trackId]?.sections : null;
		if (saved?.length) return saved.map((s) => ({ ...s }));
		return seedFromAnalysis();
	}

	async function armSectionEdit(on: boolean) {
		undoStack = [];
		if (!on) {
			sectionEditing = false;
			sectionDraft = null;
			return;
		}
		await loadJudgements();
		sectionDraft = seedSections();
		if (!sectionDraft) return;
		sectionEditing = true;
		timelineOpen = true;
	}

	function applySections(list: JudgedSection[]) {
		if (!trackId) return;
		sectionDraft = list;
		// The preview follows the hand drawing it, rather than freezing at whatever the map
		// said when the button was pressed.
		if (previewShow) void stagePreview(false);
		// The map and the grid it was drawn against; the panel's fields are none of the
		// editor's business and are left to the file.
		void saveJudgement({
			trackId,
			title: meta?.title ?? judgements[trackId]?.title ?? '',
			sections: list,
			analysisHash: analysis?.hash ?? null,
			showSeed: show?.seed ?? null,
			authoredBy: show?.authoredBy ?? null
		});
	}

	function saveSections(list: JudgedSection[]) {
		if (sectionDraft) {
			undoStack = [...undoStack.slice(-49), { sections: $state.snapshot(sectionDraft) }];
		}
		applySections(list);
	}

	/** Movement marks, written by whichever surface the owner reached for. */
	function applyMovements(list: number[]) {
		if (!trackId) return;
		void saveJudgement({
			trackId,
			title: meta?.title ?? judgements[trackId]?.title ?? '',
			movements: list
		});
	}

	function saveMovements(list: number[]) {
		undoStack = [...undoStack.slice(-49), { movements: [...movements] }];
		applyMovements(list);
	}

	/**
	 * A detected movement the owner refuses. Written beside the marks rather than as a
	 * deletion, because there is nothing to delete: the analysis will find the same seam
	 * again on its next run unless told not to, and the stamp on the cached blob carries the
	 * refusal so the next play hears it.
	 */
	function vetoMovement(t: number) {
		if (!trackId) return;
		if (movementVetoes.some((x) => Math.abs(x - t) < 0.5)) return;
		void saveJudgement({
			trackId,
			title: meta?.title ?? judgements[trackId]?.title ?? '',
			movementVetoes: [...movementVetoes, Math.round(t * 10) / 10].sort((a, b) => a - b)
		});
	}

	function liftVeto(t: number) {
		if (!trackId) return;
		void saveJudgement({
			trackId,
			title: meta?.title ?? judgements[trackId]?.title ?? '',
			movementVetoes: movementVetoes.filter((x) => Math.abs(x - t) >= 0.5)
		});
	}

	function undoMapEdit() {
		const last = undoStack.at(-1);
		if (!last) return;
		undoStack = undoStack.slice(0, -1);
		if ('sections' in last) applySections(last.sections);
		else applyMovements(last.movements);
	}

	function discardSections() {
		if (!trackId) return;
		// The preview's toggle lives on the hand-drawn row, which a discard removes; left
		// armed it would play a show whose map no longer exists, with no way back.
		void togglePreview(false);
		if (judgements[trackId]) void saveJudgement({ trackId, sections: null });
		sectionDraft = sectionEditing ? seedFromAnalysis() : null;
	}

	function seedFromAnalysis(): JudgedSection[] | null {
		if (!analysis) return null;
		return analysis.sections.map((s) => ({
			kind: s.kind,
			startTime: s.startTime,
			endTime: s.endTime,
			startBar: s.startBar,
			endBar: s.endBar
		}));
	}

	/**
	 * Hear the show the hand-drawn map would produce. The server composes it from the
	 * judgement's sections and nothing is written, so arming swaps the show on stage and
	 * disarming puts the cached one back; the viz applies either mid-play, the same way a
	 * reroll does.
	 */
	async function togglePreview(on: boolean) {
		if (!viz) return;
		if (!on) {
			if (!previewShow) return;
			// Two cases, and only the first is ours to undo: either the preview is still the
			// show on stage, and the shelf belongs back; or something else replaced it while
			// previewing - a reroll, a re-analysis, the agent - and that show owns the stage
			// now, so restoring would clobber it and the shelf is simply dropped.
			if (show === previewShow) {
				show = shelvedShow;
				if (shelvedAnalysis) analysis = shelvedAnalysis;
				if (show && analysis) viz.loadShow(analysis, show);
				else viz.clearShow();
			}
			previewShow = null;
			shelvedShow = null;
			shelvedAnalysis = null;
			return;
		}
		if (previewShow) return;
		await stagePreview(true);
	}

	/**
	 * Compose the map as it stands and put it on stage.
	 *
	 * Run again after every edit while the preview is up: a preview of the map as it was a
	 * gesture ago is not a preview of anything, and the room is the only place the change can
	 * actually be judged. The shelf is taken on the FIRST staging only - re-staging must never
	 * shelve the preview it is replacing, or the real show is lost behind it.
	 */
	async function stagePreview(first: boolean) {
		if (!trackId || !analysis || !viz) return;
		// A burst of nudges outruns the round trip. Rather than dropping the ones that arrive
		// mid-flight - which would leave the room showing an arrangement nobody is drawing any
		// more - the last draft is remembered and composed as soon as the wire is free.
		if (previewFetching) {
			previewPending = true;
			return;
		}
		previewFetching = true;
		try {
			while (true) {
				previewPending = false;
				const res = await fetch(`/api/track/${trackId}/preview-arrangement`, {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					// The draft while the editor is armed, so this hears the edit that is on
					// screen rather than the last one saved. Without a draft the server falls
					// back to the saved map.
					body: JSON.stringify({ sections: sectionDraft ?? undefined })
				});
				if (!res.ok) throw new Error((await res.text()).slice(0, 300));
				const data = (await res.json()) as { show: Show; analysis: TrackAnalysis };
				if (first && !previewShow) {
					shelvedShow = show;
					shelvedAnalysis = analysis;
				}
				show = data.show;
				// Read the staged value BACK rather than remembering the same raw object:
				// `$state` wraps a plain object in a proxy per variable, so two variables
				// assigned one object hold two different proxies and the check in
				// `togglePreview` could never hold. That is what stranded the preview on stage
				// with the toggle reset - "only the Preview remained there". Assigning an
				// already-proxied value hands over that same proxy.
				previewShow = show;
				// The map's own section table goes on stage with it, so the strip, the scrubber
				// and the inspector describe the arrangement being previewed rather than the
				// one it replaced. Restored intact when the preview comes off.
				analysis = data.analysis;
				viz.loadShow(data.analysis, data.show);
				// A section starts on a bar line or not at all, so a boundary placed between
				// two of them is rounded onto the nearer one. Say so, with the worst offender:
				// silent rounding is what made the preview look like it was ignoring the map.
				const drawn = sectionDraft ?? judgements[trackId]?.sections ?? [];
				let moved = 0;
				let worst = 0;
				for (let i = 0; i < Math.min(drawn.length, data.analysis.sections.length); i++) {
					const by = Math.abs(data.analysis.sections[i].startTime - drawn[i].startTime);
					if (by > 0.05) {
						moved++;
						worst = Math.max(worst, by);
					}
				}
				const rounded =
					moved > 0
						? ` - ${moved} boundary${moved === 1 ? '' : 's'} rounded onto a bar line, ` +
							`up to ${worst.toFixed(2)}s`
						: '';
				// Every gesture would otherwise write a line of its own; while editing, only a
				// rounding is worth saying, because that is the one thing the lane cannot show.
				if (first) {
					note(
						`previewing the hand-drawn arrangement: ${data.show.cues.length} cues, ` +
							`${data.analysis.sections.length} sections${rounded}`
					);
				} else if (rounded) {
					note(`preview recomposed${rounded}`);
				}
				if (!previewPending) break;
			}
		} catch (e) {
			note(`ERROR ${(e as Error).message}`);
		} finally {
			previewFetching = false;
		}
	}

	// A hand-drawn map belongs to one track; the mode does not survive a track change.
	// Neither does the preview: the incoming track's own show is already on stage, so only
	// the bookkeeping is dropped here.
	$effect(() => {
		void trackId;
		sectionEditing = false;
		sectionDraft = null;
		undoStack = [];
		previewShow = null;
		shelvedShow = null;
		// The incoming track's own analysis is already being loaded; dropping the shelf here
		// only stops a later toggle-off restoring the previous track's table over it.
		shelvedAnalysis = null;
	});

	/**
	 * The next analysed library track without a verdict, oldest first, so working the corpus
	 * front to back visits every track once and the order is stable across sessions.
	 */
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
		// Dropped from the list rather than refetched, so the other three do not move under the
		// hand that was about to pick one of them.
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

	/** Dragging: the running stream takes it on its next sync, half a second at the worst. */
	function moveOffset(ms: number) {
		wireOffsetMs = ms;
		settings = { ...settings, outputOffsetMs: ms };
	}

	/** Released. One write, rather than one per step of the drag. */
	function saveOffset(ms: number) {
		moveOffset(ms);
		void patchSettings({ outputOffsetMs: ms });
	}

	/** The server re-arms its own render clock; a running stream does not need restarting. */
	function chooseFps(outputFps: number) {
		settings = { ...settings, outputFps };
		void patchSettings({ outputFps });
	}

	/**
	 * The output stage: what reaches the strips and the lamp, and nothing else.
	 *
	 * These deliberately do not touch the browser's own renderer, so the 3D room keeps showing the
	 * show rather than the installation's dimmer. Moving one only tracks the slider's own readout
	 * until it is released; the release writes, and the server's renderer picks it up there.
	 */
	function moveBrightness(outputBrightness: number) {
		settings = { ...settings, outputBrightness };
	}

	function saveBrightness(outputBrightness: number) {
		moveBrightness(outputBrightness);
		void patchSettings({ outputBrightness });
	}

	function moveContrast(outputContrast: number) {
		settings = { ...settings, outputContrast };
	}

	function saveContrast(outputContrast: number) {
		moveContrast(outputContrast);
		void patchSettings({ outputContrast });
	}

	function moveLampBrightness(outputLampBrightness: number) {
		settings = { ...settings, outputLampBrightness };
	}

	function saveLampBrightness(outputLampBrightness: number) {
		moveLampBrightness(outputLampBrightness);
		void patchSettings({ outputLampBrightness });
	}

	function chooseProtocol(outputProtocol: WireProtocol) {
		settings = { ...settings, outputProtocol };
		void patchSettings({ outputProtocol });
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

	/**
	 * Dragging a colour. The room takes it on its next frame; the disk waits for the release, the
	 * same way the hardware trim does.
	 */
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
		v.onEnded = () => void queue.next();
		v.start();
		viz = v;
		queue.connect();
		hardware.connect();
		void refreshLibrary();
		void refreshSettings();
		return () => {
			v.dispose();
			queue.dispose();
			hardware.dispose();
		};
	});

	// Seeded from the whole set list, so what is offered drifts with the night.
	//
	// Through a `$derived` rather than read straight from the effect: the queue object is
	// replaced wholesale on every stream message, which is about eight times per track while
	// one is being prepared, and an effect reading it re-runs on all of them. The derived
	// string only notifies when it actually differs, so this is one request per real change.
	const setList = $derived(queue.items.map((i) => i.trackId).join());
	$effect(() => {
		void setList;
		void refreshSuggestions();
	});

	$effect(() => {
		viz?.setVolume(volume);
	});

	// What the room is asked to be. The renderer holds these as plain fields rather than reactive
	// ones, so this effect is the whole of the wiring: whenever the stored settings change, they
	// are pushed once and then read every frame from there. A track whose grid the analyser lost
	// runs in lounge whatever the switch says; the switch still reads as the user left it.
	$effect(() => {
		const v = viz;
		if (!v) return;
		v.lounge = settings.lounge || (current?.loungeOnly ?? false);
		v.rest = settings.rest;
		v.ambient = settings.ambient;
	});

	// The cover, for a room following a track the engine has not composed a show for yet.
	$effect(() => {
		if (viz) viz.artHue = meta?.artHue ?? null;
	});

	// Keep the hardware clock aligned with the audio that is actually playing. Half a second
	// is plenty: the server extrapolates between syncs from its own monotonic clock.
	//
	// `heardPosition`, not `position`: the preview already subtracts the output latency so it
	// lines up with what reaches the ear, and sending the raw audio clock instead put the room
	// that far ahead of both. Read off the viz rather than the readout for the same reason it
	// is not read from anywhere else here - the readout is a `$state` object republished at
	// 20 Hz, and touching it inside this effect re-subscribed that often, which cleared the
	// interval before it could ever fire and turned two posts a second into twenty.
	$effect(() => {
		const v = viz;
		if (!ddpRunning || !v) return;
		const send = () =>
			postJson('/api/output', {
				action: 'sync',
				position: v.heardPosition,
				playing: v.isPlaying,
				offsetMs: wireOffsetMs
			}).catch(() => {});
		void send();
		const timer = setInterval(send, 500);
		return () => clearInterval(timer);
	});

	/**
	 * Follow the server's idea of what is playing.
	 *
	 * The queue is server state so that a phone in the room can change it, which means this
	 * tab is a follower: it reacts to the current row becoming ready rather than deciding
	 * anything. Keyed on the track id so a row being re-titled mid-download does not reload
	 * audio that is already decoded.
	 */
	let loadedTrackId = $state<string | null>(null);
	/** The row a skip has already been spent on, so a dead track is stepped over once. */
	let skippedKey = $state<string | null>(null);
	$effect(() => {
		const item = current;
		if (!viz) return;

		// A track that will not load is the end of the night if nothing steps over it: only
		// `onEnded` advances the queue, and a row that never plays never ends. Once per row, so
		// a queue of failures walks to the end and stops there rather than looping.
		//
		// Only once something has played, though. On a fresh start the selection is where the
		// last session left it, and stepping off it before anyone has pressed anything would
		// move the queue under the user for a track they can see has failed and may want to
		// retry.
		if (loadedTrackId !== null && item && item.status === 'error' && item.key !== skippedKey) {
			skippedKey = item.key;
			void queue.next();
			return;
		}

		// An emptied queue leaves the room running. Stopping the music because somebody cleared
		// a list would be the one thing a room full of people would not forgive, and the loaded
		// track stays addressable so it can still be handed to Claude.
		if (!item || item.status !== 'ready' || !item.trackId) return;
		if (item.trackId === loadedTrackId) return;

		loadedTrackId = item.trackId;
		void openTrack(item.trackId);
	});

	async function openTrack(id: string) {
		if (!viz) return;
		warnings = [];
		steps = [];
		show = null;
		analysis = null;
		context = null;
		viz.clearShow();
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

			await viz.loadAudio(await audioRes.arrayBuffer());
			trackId = id;
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
			// Starting here rather than on the queue event: a track that is not decoded yet
			// cannot play, and asking it to would just silently do nothing.
			await viz.play();
			if (ddpRunning) void startOutput(id);
		} catch (e) {
			setPhase('error', (e as Error).message);
			note(`ERROR ${(e as Error).message}`);
		}
	}

	/** Several comma-separated boards split the fixture between them. */
	function hosts(source: string): string[] {
		return source
			.split(',')
			.map((h) => h.trim())
			.filter(Boolean);
	}

	/**
	 * Point the server's own renderer at a track.
	 *
	 * Also how a changed show reaches the strips: the output reads the show from disk when it
	 * starts and never again, so rerolling or authoring one while streaming leaves the room
	 * playing the composition it was handed.
	 */
	function startOutput(id: string | null, to = ddpHost) {
		return postJson('/api/output', {
			action: 'start',
			// Absent rather than null: with no track the server starts the loop bare and the room
			// takes the resting scenes, which is what somebody connecting before the music wants.
			...(id ? { trackId: id } : {}),
			hosts: hosts(to),
			offsetMs: wireOffsetMs
		});
	}

	/**
	 * Point the room at a board and start driving it.
	 *
	 * The address comes from the press rather than from the status, because storing it is a round
	 * trip and the stream would otherwise start against whichever board was configured before.
	 */
	async function connectOutput(host: string) {
		if (hosts(host).length === 0) return;
		if (host !== ddpHost) await hardware.setHost('frame', host);
		const res = await startOutput(trackId, host);
		if (!res.ok) {
			note(`ERROR ${await res.text()}`);
			return;
		}
		note(trackId ? `DDP output to ${host}` : `DDP output to ${host}, resting`);
	}

	async function disconnectOutput() {
		await postJson('/api/output', { action: 'stop' });
		note('DDP output stopped');
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
		// From the reply rather than the live queue, which anyone else may have appended to in
		// between - and does, once the radio is topping it up.
		const added = after?.items[after.items.length - 1];
		if (!added) return;
		if (how === 'now') await queue.jump(added.key);
		else await queue.playNext(added.key);
	}

	/**
	 * Re-read the track at a different metrical level.
	 *
	 * The whole show is re-composed rather than rescaled, because every cue is addressed by bar
	 * and the bars have moved: a rescaled show would point the entire night at the wrong music.
	 */
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
		} catch (e) {
			setPhase('error', (e as Error).message);
		} finally {
			relevelling = false;
		}
	}

	/**
	 * Compose the same track again with a different roll.
	 *
	 * The engine composes in about a millisecond, so this is a parameter and a button rather
	 * than a feature: the show that comes back is the same composer's work under a different
	 * seed, not a different composer.
	 */
	async function reroll() {
		if (!trackId || !viz || rerolling) return;
		rerolling = true;
		try {
			const res = await postJson(`/api/track/${trackId}/show`, {});
			if (!res.ok) throw new Error((await res.text()).slice(0, 300));
			const data = (await res.json()) as { show: Show };
			show = data.show;
			viz.loadShow(analysis!, data.show);
			warnings = [];
			note(`rerolled: ${data.show.cues.length} cues, seed ${data.show.seed}`);
			if (ddpRunning) void startOutput(trackId);
			void refreshLibrary();
		} catch (e) {
			note(`ERROR ${(e as Error).message}`);
		} finally {
			rerolling = false;
		}
	}

	function author() {
		if (!trackId || !analysis || !viz) return;
		warnings = [];
		steps = [];
		setPhase('authoring', 'Starting');
		note('authoring started');

		let seq = 0;
		const nextId = () => `s${seq++}`;

		function push(step: Omit<Step, 'id'>) {
			steps = [...steps, { ...step, id: nextId() }];
		}

		function settle(state: Step['state'], result?: string) {
			// Close the most recent pending step. Tool results arrive in order, so the newest
			// pending step is always the one they belong to.
			for (let i = steps.length - 1; i >= 0; i--) {
				if (steps[i].state !== 'pending') continue;
				steps[i] = { ...steps[i], state, result };
				steps = [...steps];
				return;
			}
		}

		function handle(e: AuthorEvent) {
			switch (e.type) {
				case 'phase':
					settle('done');
					push({ kind: 'phase', label: e.label, state: 'done' });
					setPhase('authoring', e.label);
					note(`== ${e.label}`);
					break;

				case 'tool':
					push({ kind: 'tool', label: e.name, detail: e.detail, state: 'pending' });
					setPhase('authoring', `${e.name}${e.detail ? ` ${e.detail}` : ''}`);
					note(`-> ${e.name} ${e.detail}`);
					break;

				case 'result':
					settle(e.ok ? 'done' : 'failed', e.summary);
					note(`   ${e.ok ? '' : 'FAILED '}${e.summary}`);
					break;

				case 'thinking': {
					const text = e.text.replace(/\s+/g, ' ').trim();
					if (text.length < 12) break;
					settle('done');
					push({ kind: 'think', label: text.slice(0, 200), state: 'done' });
					note(text.slice(0, 400));
					break;
				}

				case 'analysis':
					push({ kind: 'note', label: `Tempo corrected: ${e.reason}`, state: 'done' });
					analysis = e.analysis as TrackAnalysis;
					note(`** grid corrected: ${e.reason}`);
					break;

				case 'brief':
					push({ kind: 'note', label: 'Design brief written', state: 'done' });
					break;

				case 'note':
					note(e.text);
					break;
			}
		}

		// The choice travels with the request rather than being read from disk at the far end: the
		// menu writes it optimistically, and a press landing before that PUT would otherwise spend
		// the previous model.
		const es = new EventSource(
			`/api/author?id=${encodeURIComponent(trackId)}` +
				`&model=${encodeURIComponent(settings.authorModel)}` +
				`&effort=${encodeURIComponent(settings.authorEffort)}`
		);

		es.addEventListener('event', (ev) => handle(JSON.parse((ev as MessageEvent).data) as AuthorEvent));

		es.addEventListener('failed', (ev) => {
			const message = String(JSON.parse((ev as MessageEvent).data));
			settle('failed');
			setPhase('error', message.slice(0, 300));
			note(`ERROR ${message}`);
			es.close();
		});

		// EventSource fires a bare `error` with no data when the stream simply closes.
		es.addEventListener('error', (ev) => {
			if ((ev as MessageEvent).data) return;
			if (load.phase === 'authoring') {
				setPhase('error', 'the authoring stream closed unexpectedly');
				settle('failed');
			}
			es.close();
		});

		es.addEventListener('done', (ev) => {
			const data = JSON.parse((ev as MessageEvent).data) as {
				show: Show;
				analysis: TrackAnalysis;
				brief: string;
				warnings: string[];
			};
			settle('done');
			analysis = data.analysis;
			show = data.show;
			warnings = data.warnings;
			viz!.loadShow(data.analysis, data.show);
			push({
				kind: 'phase',
				label: `Show ready: ${data.show.cues.length} cues, ${data.show.hits.length} hits`,
				state: 'done'
			});
			note(`show ready: ${data.show.cues.length} cues, ${data.show.generatedEffects.length} generated`);
			setPhase('ready', '');
			// The server's renderer read the old show off disk when it started and will not look
			// again, so without this the strips keep playing the draft the agent just replaced.
			if (ddpRunning && trackId) void startOutput(trackId);
			void refreshLibrary();
			es.close();
		});
	}

	/**
	 * Previous means the previous section until the track is barely started, then the previous
	 * track. Same gesture as every player: what it does depends on where you are in the song.
	 */
	// The audio clock, not the readout: the readout is published at 20 Hz and stops entirely
	// while the tab is in the background, where the audio keeps playing regardless.
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
		} else if (e.key.toLowerCase() === 'j') {
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
		hardware={hardware.status}
		{leftOpen}
		{rightOpen}
		cached={library.length}
		onsearch={openSearch}
		onlibrary={() => (libraryOpen = true)}
		onhardware={() => (hardwareOpen = true)}
		ontoggleLeft={() => (leftOpen = !leftOpen)}
		ontoggleRight={() => (rightOpen = !rightOpen)} />

	<div class="body">
		{#if leftOpen}
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
				suggestions={suggestionWindow}
				onshuffle={shuffleSuggestions}
				onautopilot={toggleAutopilot}
				onradio={(item) => void startRadio(item.trackId ?? '', item.title)}
				onsuggestion={(song) => void addSuggestion(song)}
				onrunShow={(k) => void queue.runShow(k)} />
		{/if}

		<Stage
			{viz}
			{readout}
			{load}
			{steps}
			hasShow={!!show}
			queued={queue.items.length}
			lounge={settings.lounge}
			onlounge={() => (loungeOpen = true)} />

		{#if judgeOpen}
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
			<Inspector
				{analysis}
				{context}
				{show}
				{readout}
				{log}
				{steps}
				{warnings}
				trustNote={current?.loungeOnly ? (current.trustNote ?? 'no reason recorded') : null}
				{settings}
				canAuthor={!!analysis}
				authoring={load.phase === 'authoring'}
				onauthor={author}
				onmodel={chooseModel}
				oneffort={chooseEffort}
				onkey={saveDeepseekKey}
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
	onpick={pick} />

<RoomModal />

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

<HardwareModal
	open={hardwareOpen}
	statuses={hardware.statuses}
	onclose={() => (hardwareOpen = false)}
	offsetMs={settings.outputOffsetMs}
	fps={settings.outputFps}
	brightness={settings.outputBrightness}
	contrast={settings.outputContrast}
	lampBrightness={settings.outputLampBrightness}
	protocol={settings.outputProtocol}
	onhost={(role, h) => void hardware.setHost(role, h)}
	onregion={(r) => void hardware.setRegion(r)}
	onfps={chooseFps}
	onbrightness={moveBrightness}
	onbrightnessdone={saveBrightness}
	oncontrast={moveContrast}
	oncontrastdone={saveContrast}
	onlampbrightness={moveLampBrightness}
	onlampbrightnessdone={saveLampBrightness}
	onprotocol={chooseProtocol}
	onoffset={moveOffset}
	onoffsetdone={saveOffset}
	onconnect={(h) => void connectOutput(h)}
	ondisconnect={() => void disconnectOutput()} />

<style>
	/* No z-index of its own: the room layer inside it has to stay under the panels, which is
	   only possible while they all share the root stacking context. */
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
</style>
