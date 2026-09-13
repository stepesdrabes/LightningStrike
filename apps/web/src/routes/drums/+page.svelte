<script lang="ts">
	import { onMount } from 'svelte';
	import { beforeNavigate } from '$app/navigation';
	import { DrumReviewPlayer } from '$lib/drumReviewPlayer.ts';
	import { DRUM_VERDICTS, type DrumAnnotation, type DrumKind, type DrumReview,
		type DrumVerdict } from '$lib/drumReview.ts';
	import { addMissedHit, beginDrumEditor, completeDrumEditor, drumDraftKey, laneTime, readDrumDraft, writeDrumDraft,
		type DrumReviewDraft } from '$lib/drumReviewEditing.ts';

	let review = $state<DrumReview | null>(null);
	let tracks = $state<{ id: string; title: string }[]>([]);
	let trackId = $state('');
	let versions = $state<string[]>([]);
	let pinnedHash = $state('');
	let loadSequence = 0;
	let error = $state('');
	let status = $state('Choose a prepared song.');
	let loading = $state(false);
	let saving = $state(false);
	let ready = $state(false);
	let dirty = $state(false);
	let playing = $state(false);
	let position = $state(0);
	let loop = $state(true);
	let kick = $state(false);
	let snare = $state(true);
	let music = $state(0.65);
	let start = $state(0);
	let length = $state(12);
	let chosen = $state<{ kind: DrumKind; time: number; marker: boolean } | null>(null);
	let verdict = $state<DrumVerdict>('uncertain');
	let note = $state('');
	let heard = $state<number | undefined>();
	let missedKind = $state<DrumKind>('snare');
	let annotations = $state<DrumAnnotation[]>([]);
	let editorDirty = $state(false);
	let draftReady = $state(false);
	let draftSnapshot: string | null = null;
	let draftWarning = $state('');
	let staleDraft = $state<DrumReviewDraft | null>(null);
	let lastAdded = $state<string | null>(null);
	let refreshing = $state(false);
	let player: DrumReviewPlayer | null = null;
	let controller = new AbortController();
	const end = $derived(Math.min(review?.duration ?? 0, start + length));
	const words: Record<DrumVerdict, string> = { real: 'Real hit', wrong: 'Wrong click',
		missed: 'Missed hit', early: 'Click too early', late: 'Click too late', uncertain: 'Not sure' };
	const clock = (time: number) => `${Math.floor(time / 60)}:${(time % 60).toFixed(2).padStart(5, '0')}`;
	const inRange = (time: number) => time >= start && time <= end;
	const visibleNotes = $derived(annotations.filter((a) => inRange(a.time)));
	$effect(() => { if (draftReady && review && !staleDraft) persistDraft(); });
	function persistDraft(): boolean {
		if (!review || !draftReady || staleDraft) return true;
		try {
			if (!dirty && !editorDirty) {
				writeDrumDraft(localStorage, drumDraftKey(review), null, draftSnapshot);
				draftSnapshot = null; return true;
			}
			const draft: DrumReviewDraft = { trackId: review.trackId, audioHash: review.audioHash,
				analysisSha256: review.analysis.sha256, baseRevision: review.revision,
				range: { start, end }, annotations, updatedAt: Date.now(), editor: chosen ? {
					...chosen, verdict, note, heardTime: heard ?? null, dirty: editorDirty
				} : null };
			const raw = JSON.stringify(draft);
			if (!writeDrumDraft(localStorage, drumDraftKey(review), raw, draftSnapshot)) {
				draftWarning = 'Another tab has different unsaved notes. Save or export these notes before leaving.';
				return false;
			}
			draftSnapshot = raw;
			return true;
		} catch { draftWarning = 'This browser could not keep a draft. Save or export your notes before leaving.'; return false; }
	}
	function restoreDraft(draft: DrumReviewDraft) {
		annotations = draft.annotations; start = draft.range.start; length = draft.range.end - start;
		position = start; dirty = true;
		if (draft.editor) {
			chosen = { kind: draft.editor.kind, time: draft.editor.time, marker: draft.editor.marker };
			verdict = draft.editor.verdict; note = draft.editor.note;
			heard = draft.editor.heardTime ?? undefined; editorDirty = draft.editor.dirty;
		}
		status = 'Unsaved notes restored from this browser.';
	}

	beforeNavigate((event) => {
		if (!persistDraft() && (dirty || editorDirty) && !confirm('Leave without saving these notes?')) event.cancel();
	});
	function leaving(event: BeforeUnloadEvent) {
		if (!persistDraft() && (dirty || editorDirty)) { event.preventDefault(); event.returnValue = ''; }
	}
	function pause() { player?.pause(); playing = false; }
	function now() { return playing && player ? player.position : position; }
	async function load(id: string, analysis = '') {
		if (!persistDraft() && (dirty || editorDirty) && !confirm('Leave without saving these notes?')) return;
		const sequence = ++loadSequence;
		loading = true;
		draftReady = false;
		controller.abort(); const request = new AbortController(); controller = request;
		pause(); const closing = player; player = null; await closing?.close();
		if (sequence !== loadSequence) return;
		review = null; ready = false; dirty = false; chosen = null; annotations = [];
		editorDirty = false; staleDraft = null; draftWarning = ''; lastAdded = null; draftSnapshot = null;
		trackId = id; pinnedHash = analysis; error = '';
		try {
			const query = new URLSearchParams({ trackId: id }); if (analysis) query.set('analysis', analysis);
			const response = await fetch(`/api/drum-reviews?${query}`, { signal: request.signal });
			if (response.status === 403) throw new Error('Open drum listening on the host computer.');
			const data = await response.json();
			if (sequence !== loadSequence) return;
			if (!response.ok) throw new Error(data.error ?? 'Reviews are available on the host computer.');
			review = data.review; versions = data.versions ?? [];
			annotations = review!.annotations; start = review!.range.start;
			length = review!.range.end - start; position = start;
			status = review!.revision ? 'Saved notes loaded.' : 'Ready to listen.';
			try {
				const prefix = drumDraftKey(review!).slice(0, -64);
				for (let i = 0; i < localStorage.length; i++) {
					const key = localStorage.key(i);
					if (key?.startsWith(prefix) && /^[a-f0-9]{64}$/.test(key.slice(prefix.length))) versions.push(key.slice(prefix.length));
				}
				versions = [...new Set(versions)];
				const raw = localStorage.getItem(drumDraftKey(review!));
				const draft = readDrumDraft(raw, review!);
				if (draft) draftSnapshot = raw;
				else if (raw) draftWarning = 'An unreadable browser draft was preserved. Save or export new notes before leaving.';
				if (draft?.baseRevision === review!.revision) restoreDraft(draft);
				else if (draft) staleDraft = draft;
			} catch { draftWarning = 'Browser drafts are unavailable. Save your notes before leaving.'; }
			draftReady = true;
		} catch (e) { if (sequence === loadSequence && (e as Error).name !== 'AbortError') error = (e as Error).message; }
		finally { if (sequence === loadSequence) loading = false; }
	}
	async function toggle() {
		if (!review || loading) return;
		if (playing) { position = player?.position ?? position; pause(); return; }
		try {
			if (!ready) {
				loading = true; status = 'Opening the song…';
				player = new DrumReviewPlayer();
				await player.load(review, controller.signal);
				ready = true; loading = false;
			}
			player!.setClicks('kick', kick); player!.setClicks('snare', snare); player!.setMusic(music);
			await player!.play(position, { start, end }, loop);
			playing = true; status = ''; error = '';
		} catch (e) {
			if ((e as Error).name !== 'AbortError') error = (e as Error).message;
			loading = false; ready = false;
			await player?.close(); player = null;
		}
	}
	function passage(time: number, span = length) {
		if (!Number.isFinite(time) || !Number.isFinite(span) || span <= 0) return;
		if (!finishEditor()) return;
		pause(); length = Math.min(span, review?.duration ?? span);
		start = Math.max(0, Math.min((review?.duration ?? 0) - length, time));
		position = start; chosen = null; dirty = true;
	}
	function seek(time: number) {
		if (!Number.isFinite(time)) return;
		pause(); position = Math.max(0, Math.min(review?.duration ?? 0, time));
	}
	function choose(kind: DrumKind, time: number, marker = true): boolean {
		if (staleDraft || !finishEditor()) return false;
		const editor = beginDrumEditor(kind, time, marker);
		seek(time); chosen = { kind, time, marker }; verdict = editor.verdict;
		note = ''; heard = undefined; editorDirty = false; return true;
	}
	function finishEditor(): boolean { return !chosen || !editorDirty || addNote(); }
	function addNote(): boolean {
		if (!chosen || !review) return false;
		const existing = annotations.find((a) => a.kind === chosen!.kind && a.time === chosen!.time);
		try {
			annotations = completeDrumEditor(annotations, { ...chosen, verdict, note,
				heardTime: heard ?? null, dirty: editorDirty }, existing?.id ?? crypto.randomUUID(), review);
		} catch (e) { error = (e as Error).message; return false; }
		dirty = true; chosen = null; editorDirty = false; error = '';
		status = 'Note added. Draft kept in this browser.'; return true;
	}
	function markMissed(kind: DrumKind, time: number) {
		if (staleDraft || !Number.isFinite(time)) return;
		if (!finishEditor()) return;
		if (annotations.length >= 1000 && !annotations.some(a => a.kind === kind && Math.abs(a.time - time) < 0.0005)) {
			error = 'This review has reached 1,000 notes. Save or export it before continuing.'; return;
		}
		const added = addMissedHit(annotations, kind, time, crypto.randomUUID());
		annotations = added.annotations;
		if (added.added) {
			lastAdded = added.annotation.id; dirty = true;
			status = `Missed ${kind === 'snare' ? 'snare / clap' : 'kick'} added. ${annotations.length} notes. Click another gap to add more.`;
		} else status = 'This point already has a note. Click another gap to add more.';
		chosen = null; editorDirty = false;
		persistDraft();
	}
	function laneClick(event: MouseEvent, kind: DrumKind) {
		const bounds = event.currentTarget instanceof HTMLElement ? event.currentTarget.getBoundingClientRect() : null;
		const time = event.detail === 0 ? Math.max(start, Math.min(end, now())) :
			bounds ? laneTime(event.clientX, bounds.left, bounds.width, start, end) : null;
		if (time !== null) markMissed(kind, time);
	}
	function undoMark() {
		if (!lastAdded) return;
		annotations = annotations.filter((a) => a.id !== lastAdded); lastAdded = null; dirty = true;
		status = 'Last missed-hit mark removed.'; persistDraft();
	}
	function edit(a: DrumAnnotation) {
		if (!choose(a.kind, a.time, a.markerTime !== null)) return;
		verdict = a.verdict; note = a.note;
		heard = a.heardTime ?? undefined;
	}
	async function save() {
		if (!review || saving || staleDraft) return;
		if (!finishEditor()) return;
		saving = true; error = '';
		const submitted = JSON.stringify(annotations);
		const savedStart = start, savedEnd = end;
		try {
			const response = await fetch('/api/drum-reviews', { method: 'POST', headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ trackId, audioHash: review.audioHash, analysisSha256: review.analysis.sha256,
					baseRevision: review.revision, range: { start, end }, annotations }) });
			const data = await response.json();
			if (!response.ok) throw new Error(data.error ?? 'Could not save.');
			review = data.review;
			dirty = JSON.stringify(annotations) !== submitted || start !== savedStart || end !== savedEnd;
			status = dirty ? 'Saved. Newer changes still need saving.' : 'Saved.';
		} catch (e) { error = (e as Error).message; }
		finally { saving = false; }
	}
	function download(value: unknown, name: string) {
		const url = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }));
		const link = document.createElement('a'); link.href = url; link.download = name; link.click();
		setTimeout(() => URL.revokeObjectURL(url), 1000);
	}
	async function exportOld(hash: string) {
		try {
			const response = await fetch(`/api/drum-reviews?trackId=${encodeURIComponent(trackId)}&analysis=${hash}`);
			const data = await response.json(); if (!response.ok) throw new Error(data.error);
			download(data.review, `${trackId}-drums-${hash.slice(0, 8)}.json`);
		} catch (e) { error = (e as Error).message; }
	}
	function keys(event: KeyboardEvent) {
		if ((event.target as HTMLElement)?.closest('input,textarea,select') || event.ctrlKey || event.metaKey || event.altKey) return;
		if (event.code === 'Space' && !(event.target as HTMLElement)?.closest('button,a')) { event.preventDefault(); void toggle(); }
		if (event.code === 'KeyM' && review) { event.preventDefault(); markMissed(missedKind, now()); }
	}
	async function refreshSongs() {
		refreshing = true;
		try {
			const response = await fetch('/api/library');
			if (!response.ok) throw new Error('Could not load the song library.');
			const data = await response.json(); tracks = data.entries.filter((entry: { analysed: boolean }) => entry.analysed);
		} catch (e) { error = (e as Error).message; }
		finally { refreshing = false; }
	}
	onMount(() => {
		void refreshSongs();
		const query = new URL(location.href).searchParams;
		const id = query.get('trackId'); if (id) void load(id, query.get('analysis') ?? '');
		const timer = setInterval(() => {
			if (!playing || !player) return;
			position = player.position;
			if (!loop && position >= player.duration) pause();
		}, 35);
		return () => { persistDraft(); clearInterval(timer); controller.abort(); void player?.close(); };
	});
</script>

<svelte:head><title>Drum listening · LightningStrike</title></svelte:head>
<svelte:window onbeforeunload={leaving} onkeydown={keys} />

<main>
	<header><div><a href="/">← Back to LightningStrike</a><h1>Drum listening</h1>
		<p>Listen for missing hits and misplaced clicks. Your notes help improve the next analysis.</p></div>
		<div class="actions"><button disabled={!review || saving || staleDraft !== null || (!dirty && !editorDirty)} onclick={save}>{saving ? 'Saving…' : 'Save notes'}</button>
		<button disabled={!review} onclick={() => download({ ...review, range: { start, end }, annotations,
			unsaved: dirty }, `${trackId}-drum-review.json`)}>Export notes</button></div>
	</header>
	<div class="track-row"><label>Song <select value={trackId} disabled={loading || saving}
		onchange={(e) => void load(e.currentTarget.value)}><option value="">Choose a song</option>
		{#each tracks as track (track.id)}<option value={track.id}>{track.title}</option>{/each}</select></label>
		<button disabled={refreshing} onclick={refreshSongs}>{refreshing ? 'Refreshing…' : 'Refresh songs'}</button>
		<span role="status">{loading ? 'Loading…' : status}{dirty || editorDirty ? ' · Draft kept here; save to share' : ''}</span></div>
	{#if error}<p class="error" role="alert">{error}</p>{/if}
	{#if draftWarning}<p class="error" role="alert">{draftWarning}</p>{/if}
	{#if staleDraft}<section aria-label="Earlier browser draft"><p>There is an older unsaved draft in this browser. Saved notes have changed since then. Export the draft before choosing which notes to keep.</p>
		<div class="actions"><button onclick={() => download(staleDraft, `${trackId}-earlier-draft.json`)}>Export earlier draft</button>
		<button onclick={() => { if (review) writeDrumDraft(localStorage, drumDraftKey(review), null, draftSnapshot); draftSnapshot = null; staleDraft = null; }}>Use saved notes</button></div></section>{/if}
	{#if review}
		<div class="controls" aria-label="Review analysis version">
			<span>Drum analysis v{review.analysis.version} · Notes revision {review.revision} · {review.analysis.sha256.slice(0, 8)}</span>
			<button disabled={loading || saving} onclick={() => void load(trackId)}>Load latest analysis</button>
			{#if versions.length}<label>Earlier notes / drafts <select value={pinnedHash} disabled={loading || saving}
				onchange={(e) => void load(trackId, e.currentTarget.value)}><option value="">Latest analysis</option>
				{#each versions as hash}<option value={hash}>Review {hash.slice(0, 8)}</option>{/each}</select></label>{/if}
		</div>
		<section class="listen" aria-label="Song player">
			<h2>{review.title}</h2>
			<div class="overview"><span>Whole song</span><input aria-label="Choose passage in whole song" type="range"
				min="0" max={Math.max(0, review.duration - length)} step="0.1" value={start}
				oninput={(e) => passage(Number(e.currentTarget.value))} /><span>{clock(review.duration)}</span></div>
			<div class="controls"><button class="play" disabled={loading} onclick={toggle}>{playing ? 'Pause' : 'Play'}</button>
				<button disabled={loading} onclick={() => { seek(start); void toggle(); }}>Replay passage</button>
				<span class="time">{clock(position)}</span><label><input type="checkbox" bind:checked={loop} onchange={pause} /> Loop passage</label>
				<label><input type="checkbox" bind:checked={kick} onchange={(e) => player?.setClicks('kick', e.currentTarget.checked)} /> Kick clicks</label>
				<label><input type="checkbox" bind:checked={snare} onchange={(e) => player?.setClicks('snare', e.currentTarget.checked)} /> Snare / clap clicks</label>
				<label>Music <input aria-label="Music volume" type="range" min="0" max="0.8" step="0.01" bind:value={music}
					oninput={(e) => player?.setMusic(Number(e.currentTarget.value))} /></label>
			</div>
			<div class="controls"><button onclick={() => passage(start - length)}>← Previous passage</button>
				<label>Start <input type="number" min="0" max={Math.max(0, review.duration - length)} step="0.1"
					value={start.toFixed(2)} onchange={(e) => passage(Number(e.currentTarget.value))} /> s</label>
				<label>Length <select value={length} onchange={(e) => passage(start, Number(e.currentTarget.value))}>
					{#if review.duration < 8}<option value={review.duration}>Whole song</option>{/if}
					{#each [8, 12, 16, 20] as span}<option value={span}>{span} seconds</option>{/each}</select></label>
				<button onclick={() => passage(start + length)}>Next passage →</button>
			</div>
			<p class="hint">Click an empty spot in either lane to add a missed hit immediately. Click a colored marker to judge it. Space plays or pauses; M marks a missed hit at the playhead.</p>
			<div class="timeline">
				<div class="scale"><span>{clock(start)}</span><span>{clock(end)}</span></div>
				{#each ['kick', 'snare'] as kind}
					<div class="lane"><span>{kind === 'kick' ? 'Kick' : 'Snare / clap'}</span><div class="markers">
						<button class="lane-space" aria-label={`Add missed ${kind === 'kick' ? 'kick' : 'snare or clap'}: click at the hit, or press Enter at the playhead`}
							title="Click an empty spot to mark a missed hit" onclick={(e) => laneClick(e, kind as DrumKind)}></button>
						{#each review.markers[kind as DrumKind].times.filter(inRange) as time}
							<button class="marker" class:snare={kind === 'snare'} class:selected={chosen?.kind === kind && chosen?.time === time}
								style:left={`${100 * (time - start) / (end - start)}%`} title={`${kind} ${clock(time)}`}
								aria-label={`${kind} click at ${clock(time)}`} onclick={(e) => { e.stopPropagation(); choose(kind as DrumKind, time); }}></button>
						{/each}
						{#each visibleNotes.filter((a) => a.kind === kind) as a}
							<button class="note-marker" style:left={`${100 * (a.time - start) / (end - start)}%`}
								title={words[a.verdict]} aria-label={`${words[a.verdict]} at ${clock(a.time)}`} onclick={(e) => { e.stopPropagation(); edit(a); }}>◆</button>
						{/each}
						{#if inRange(position)}<i class="playhead" style:left={`${100 * (position - start) / (end - start)}%`}></i>{/if}
					</div></div>
				{/each}
				<input aria-label="Playhead in passage" type="range" min={start} max={end} step="0.005"
					value={position} oninput={(e) => seek(Number(e.currentTarget.value))} />
			</div>
			<div class="controls"><label>Missed <select bind:value={missedKind}><option value="snare">Snare / clap</option><option value="kick">Kick</option></select></label>
				<button onclick={() => markMissed(missedKind, now())}>Add missed hit at playhead</button>
				<button disabled={!lastAdded} onclick={undoMark}>Undo last mark</button>
				<strong class="count">{visibleNotes.length} notes here · {annotations.length} total</strong>
				<label>Playhead <input aria-label="Exact playhead seconds" type="number" step="0.005" min="0" max={review.duration}
					value={position.toFixed(3)} onchange={(e) => seek(Number(e.currentTarget.value))} /> s</label>
			</div>
		</section>
		<div class="review-grid">
			<section><h2>{chosen ? `${chosen.kind === 'snare' ? 'Snare / clap' : 'Kick'} at ${clock(chosen.time)}` : 'Judge a hit'}</h2>
				{#if chosen}
					<button disabled={loading} onclick={() => { seek(Math.max(start, chosen!.time - 0.8)); void toggle(); }}>Hear this hit</button>
					<div class="verdicts">{#each DRUM_VERDICTS.filter((v) => chosen?.marker ? v !== 'missed' : v === 'missed') as value}
						<button class:active={verdict === value} onclick={() => { verdict = value; editorDirty = true; }}>{words[value]}</button>{/each}</div>
					{#if verdict === 'early' || verdict === 'late'}<label>Where you hear it (optional, seconds)
						<input type="number" min="0" max={review.duration} step="0.005" bind:value={heard} oninput={() => { editorDirty = true; }} /></label>{/if}
					<label>Note <textarea rows="3" maxlength="1000" bind:value={note} oninput={() => { editorDirty = true; }} placeholder="What do you hear?"></textarea></label>
					<p class="hint">Manually placed times are approximate. Replay the passage to refine them.</p>
					<div class="actions"><button onclick={addNote}>Keep judgement</button><button onclick={() => { chosen = null; editorDirty = false; }}>Cancel edit</button></div>
				{:else}<p class="hint">Choose a marker above, or mark a missing hit at the playhead.</p>{/if}
			</section>
			<section><h2>Notes in this passage <span>{visibleNotes.length}</span></h2>
				{#each visibleNotes as a (a.id)}<div class="saved-note"><button onclick={() => edit(a)}>
					<strong>{clock(a.time)} · {a.kind === 'snare' ? 'Snare / clap' : 'Kick'} · {words[a.verdict]}</strong>
					{#if a.note}<span>{a.note}</span>{/if}</button>
					<button aria-label={`Remove note at ${clock(a.time)}`} onclick={() => {
						annotations = annotations.filter((n) => n.id !== a.id); dirty = true;
					}}>×</button></div>{/each}
				{#if !visibleNotes.length}<p class="hint">No notes here yet.</p>{/if}
				<p class="hint">{annotations.length} notes across the song. Unmarked hits remain unjudged.</p>
			</section>
		</div>
		{#if versions.some((v) => v !== review!.analysis.sha256)}<details><summary>Earlier saved reviews</summary>
			{#each versions.filter((v) => v !== review!.analysis.sha256) as hash}<button onclick={() => exportOld(hash)}>Export earlier review {hash.slice(0, 8)}</button>{/each}</details>{/if}
	{/if}
</main>

<style>
	main { max-width: 1200px; margin: 0 auto; padding: 32px 24px 72px; overflow: auto; height: 100%; }
	header,.track-row,.controls,.actions { display: flex; gap: 14px; align-items: center; flex-wrap: wrap; }
	header { justify-content: space-between; margin-bottom: 24px; }
	h1 { font-size: 28px; margin: 14px 0 6px; } h2 { font-size: 17px; margin: 0 0 18px; }
	p { color: var(--muted-foreground); line-height: 1.5; } a { color: var(--foreground); }
	section { background: var(--card); border: 1px solid var(--border); border-radius: 14px; padding: 22px; margin-top: 20px; }
	label { display: inline-flex; align-items: center; gap: 8px; font-size: 13px; }
	button,select,input[type='number'],textarea { border: 1px solid var(--border); border-radius: 7px; background: var(--muted); color: var(--foreground); padding: 9px 12px; font: inherit; }
	button { cursor: pointer; } button:hover { background: var(--hover); } button:disabled { opacity: .4; cursor: default; }
	button:focus-visible,input:focus-visible { outline: 2px solid var(--live); outline-offset: 3px; }
	input[type='number'] { width: 96px; } input[type='range'] { accent-color: var(--live); }
	.track-row select { max-width: min(65vw, 460px); }.track-row span,.hint { font-size: 12px; color: var(--muted-foreground); }
	.controls { margin-top: 18px; }.play { background: var(--foreground); color: var(--background); min-width: 85px; }
	.time { font: 19px var(--mono); min-width: 100px; }.overview { display: flex; align-items: center; gap: 16px; font-size: 12px; }.overview input { flex: 1; }
	.timeline { padding: 18px 12px; background: var(--background); border-radius: 10px; margin-top: 18px; }
	.scale { display: flex; justify-content: space-between; padding-left: 100px; font: 12px var(--mono); color: var(--muted-foreground); }
	.lane { display: flex; align-items: center; margin: 12px 0; }.lane>span { width: 100px; font-size: 12px; flex-shrink: 0; }
	.markers { position: relative; height: 62px; flex: 1; background: repeating-linear-gradient(90deg,transparent,transparent calc(10% - 1px),var(--border-soft) calc(10% - 1px),var(--border-soft) 10%); border-bottom: 1px solid var(--border); }
	.marker { position: absolute; transform: translateX(-50%); width: 10px; padding: 0; height: 28px; top: 10px; border: 0; background: #78b9db; border-radius: 3px; }
	.marker.snare { background: #e6a573; }.marker.selected { outline: 2px solid white; outline-offset: 3px; }.marker:hover { filter: brightness(1.5); }
	.lane-space { position: absolute; inset: 0; padding: 0; border: 0; border-radius: 0; background: transparent; cursor: crosshair; }
	.lane-space:hover { background: #ff6a1a0a; }.count { font-size: 12px; color: var(--ok); }
	.note-marker { position: absolute; bottom: 0; transform: translateX(-50%); padding: 0; color: var(--ok); background: transparent; border: 0; }
	.playhead { pointer-events: none; position: absolute; top: 0; bottom: 0; border-left: 1px solid white; }
	.timeline>input { width: calc(100% - 100px); margin-left: 100px; }.review-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 20px; }
	.verdicts { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 20px; }.active { border-color: var(--live); color: var(--live); }
	.review-grid label { display: flex; align-items: start; flex-direction: column; margin: 16px 0; }textarea { width: 100%; resize: vertical; }
	.saved-note { display: flex; border-top: 1px solid var(--border); padding: 9px 0; }.saved-note>button:first-child { flex: 1; text-align: left; border: 0; background: transparent; }.saved-note span { display: block; margin-top: 6px; font-size: 13px; color: var(--muted-foreground); }.saved-note strong { font-size: 12px; }
	.error { color: var(--bad); }details { margin-top: 22px; }summary { cursor: pointer; }
	@media(max-width: 740px) { main { padding: 20px 12px; }.review-grid { grid-template-columns: 1fr; }.controls { gap: 10px; }section { padding: 16px; } }
</style>
