<script lang="ts">
	import type { LibraryEntry, SearchResult } from '$lib/types.ts';
	import {
		asDirectLink,
		filterLibrary,
		indexLibrary,
		libraryToCandidate,
		resultToCandidate,
		suggestionToCandidate,
		type Candidate
	} from '$lib/search.svelte.ts';
	import { clock } from '$lib/format.ts';
	import Dialog from '$lib/ui/Dialog.svelte';
	import Icon from '$lib/ui/Icon.svelte';
	import Badge from '$lib/ui/Badge.svelte';
	import Spinner from '$lib/ui/Spinner.svelte';

	let {
		open = $bindable(false),
		query = $bindable(''),
		library = [],
		suggestions = [],
		onpick
	}: {
		open?: boolean;
		query?: string;
		library?: LibraryEntry[];
		suggestions?: SearchResult[];
		onpick: (candidate: Candidate, how: 'queue' | 'now' | 'next') => void;
	} = $props();

	let results = $state<SearchResult[]>([]);
	let searching = $state(false);
	let failure = $state('');
	let cursor = $state(0);
	let input: HTMLInputElement | undefined = $state();
	let listEl: HTMLDivElement | undefined = $state();

	const link = $derived(asDirectLink(query));
	const libraryHits = $derived(link ? [] : filterLibrary(library, query));
	/** Nothing has been typed yet, so the palette is somewhere to browse rather than to search. */
	const idle = $derived(!link && query.trim().length < 2);
	const known = $derived(indexLibrary(library));
	const candidates = $derived<Candidate[]>([
		...(link ? [link] : []),
		...libraryHits.map(libraryToCandidate),
		...results.map((r) => resultToCandidate(r, known)),
		...(idle ? suggestions.map((s) => suggestionToCandidate(s, known)) : [])
	]);

	// The first row of each group, so the heading can be drawn in the flat list.
	const firstSong = $derived(candidates.findIndex((c) => c.origin === 'song'));
	const firstLibrary = $derived(candidates.findIndex((c) => c.origin === 'library'));
	const firstRadio = $derived(candidates.findIndex((c) => c.origin === 'radio'));

	function subtitleFor(c: Candidate): string {
		if (c.origin === 'link') return c.source;
		// A single's album is its own title, and printing both says the same thing twice.
		if (c.album && c.album !== c.title) return `${c.artist} · ${c.album}`;
		return c.artist;
	}

	$effect(() => {
		if (open) input?.focus();
	});

	$effect(() => {
		// Reset the highlight so Enter cannot select a different row after a query change.
		void query;
		cursor = 0;
	});

	/** Debounce searches and abort stale requests so late results cannot overwrite a newer query. */
	$effect(() => {
		const q = query.trim();
		if (!open || q.length < 2 || link) {
			results = [];
			searching = false;
			return;
		}

		const controller = new AbortController();
		const timer = setTimeout(async () => {
			searching = true;
			failure = '';
			try {
				const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, {
					signal: controller.signal
				});
				if (!res.ok) throw new Error((await res.text()).slice(0, 200));
				results = ((await res.json()) as { results: SearchResult[] }).results;
			} catch (e) {
				if (controller.signal.aborted) return;
				results = [];
				failure = (e as Error).message;
			} finally {
				if (!controller.signal.aborted) searching = false;
			}
		}, 350);

		return () => {
			clearTimeout(timer);
			controller.abort();
		};
	});

	function pick(candidate: Candidate, how: 'queue' | 'now' | 'next') {
		onpick(candidate, how);
		open = false;
		query = '';
	}

	function move(delta: number) {
		if (candidates.length === 0) return;
		cursor = Math.max(0, Math.min(candidates.length - 1, cursor + delta));
		listEl?.querySelectorAll('.row')[cursor]?.scrollIntoView({ block: 'nearest' });
	}

	function onkeydown(e: KeyboardEvent) {
		if (e.key === 'ArrowDown') {
			e.preventDefault();
			move(1);
		} else if (e.key === 'ArrowUp') {
			e.preventDefault();
			move(-1);
		} else if (e.key === 'Enter') {
			const chosen = candidates[cursor];
			if (!chosen) return;
			e.preventDefault();
			pick(chosen, e.metaKey || e.ctrlKey ? 'now' : e.altKey ? 'next' : 'queue');
		}
	}
</script>

<Dialog {open} onclose={() => (open = false)} labelledBy="search-input">
	<div class="field">
		<Icon name="search" size={17} />
		<input
			id="search-input"
			bind:this={input}
			bind:value={query}
			type="text"
			placeholder="Search for a song, or paste a link"
			autocomplete="off"
			spellcheck="false"
			{onkeydown} />
		{#if searching}<Spinner size={15} />{/if}
	</div>

	<div class="list" bind:this={listEl}>
		{#if failure}
			<p class="notice bad"><Icon name="alert" size={15} />{failure}</p>
		{/if}

		{#each candidates as candidate, i (candidate.origin + candidate.id)}
			{#if i === firstLibrary && firstLibrary !== -1}
				<p class="group">In your library</p>
			{/if}
			{#if i === firstSong && firstSong !== -1}
				<p class="group">Songs</p>
			{/if}
			{#if i === firstRadio && firstRadio !== -1}
				<p class="group">More like what is queued</p>
			{/if}

			<button
				class="row"
				class:active={cursor === i}
				onmouseenter={() => (cursor = i)}
				onclick={(e) => pick(candidate, e.metaKey || e.ctrlKey ? 'now' : 'queue')}>
				<span class="art">
					{#if candidate.thumbnail}
						<img src={candidate.thumbnail} alt="" loading="lazy" />
					{:else}
						<Icon name={candidate.origin === 'link' ? 'link' : 'music'} size={16} />
					{/if}
				</span>

				<span class="text">
					<span class="title truncate">
						{candidate.origin === 'link' ? 'Load this link' : candidate.title}
					</span>
					<span class="sub truncate muted">{subtitleFor(candidate)}</span>
				</span>

				{#if candidate.genre}
					<Badge variant="muted" title="How the room lights this">{candidate.genre}</Badge>
				{/if}

				{#if candidate.authored === 'claude' || candidate.authored === 'deepseek'}
					<Badge
						variant="live"
						title="{candidate.authored === 'claude' ? 'Claude' : 'DeepSeek'} designed this show">
						<Icon name="sparkles" size={11} />
					</Badge>
				{/if}


				{#if candidate.cached}
					<Badge variant="outline" title="Already downloaded and analysed">Ready</Badge>
				{/if}

				{#if candidate.duration > 0}
					<span class="mono subtle">{clock(candidate.duration)}</span>
				{/if}
			</button>
		{/each}

		{#if candidates.length === 0 && !searching}
			<p class="notice muted">
				{idle ? 'Type to search.' : 'Nothing found.'}
			</p>
		{/if}
	</div>

	<div class="footer">
		<span><kbd>↑</kbd><kbd>↓</kbd> move</span>
		<span><kbd>↵</kbd> add to queue</span>
		<span><kbd>⌘</kbd><kbd>↵</kbd> play now</span>
		<span><kbd>⌥</kbd><kbd>↵</kbd> play next</span>
		<span class="right"><kbd>esc</kbd> close</span>
	</div>
</Dialog>

<style>
	.field {
		display: flex;
		align-items: center;
		gap: 11px;
		padding: 0 16px;
		height: 54px;
		flex: none;
		border-bottom: 1px solid var(--border);
		color: var(--subtle-foreground);
	}
	.field input {
		flex: 1;
		min-width: 0;
		background: none;
		border: none;
		outline: none;
		color: var(--foreground);
		font-size: 15px;
	}
	.field input::placeholder {
		color: var(--subtle-foreground);
	}

	.list {
		flex: 1;
		overflow-y: auto;
		padding: 6px;
		min-height: 0;
	}
	.group {
		padding: 10px 10px 5px;
		font-size: 12px;
		font-weight: 500;
		color: var(--subtle-foreground);
	}

	.row {
		display: flex;
		align-items: center;
		gap: 11px;
		width: 100%;
		padding: 7px 10px;
		border-radius: var(--radius-md);
		text-align: left;
		color: var(--foreground);
	}
	.row.active {
		background: var(--hover);
	}
	.art {
		width: 44px;
		height: 44px;
		flex: none;
		display: grid;
		place-items: center;
		border-radius: var(--radius-sm);
		background: var(--muted);
		color: var(--subtle-foreground);
		overflow: hidden;
	}
	.art img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}
	.text {
		display: flex;
		flex-direction: column;
		min-width: 0;
		flex: 1;
		gap: 1px;
	}
	.title {
		font-size: 13.5px;
		font-weight: 500;
	}
	.sub {
		font-size: 12.5px;
	}

	.notice {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 18px 12px;
		font-size: 13px;
	}
	.notice.bad {
		color: var(--bad);
	}

	.footer {
		display: flex;
		align-items: center;
		gap: 14px;
		flex: none;
		padding: 0 14px;
		height: 38px;
		border-top: 1px solid var(--border);
		background: var(--card);
		font-size: 12px;
		color: var(--subtle-foreground);
	}
	.footer .right {
		margin-left: auto;
	}
	kbd {
		display: inline-block;
		min-width: 17px;
		padding: 1px 4px;
		margin-right: 3px;
		border: 1px solid var(--border);
		border-radius: 4px;
		background: var(--muted);
		font-family: var(--sans);
		font-size: 11px;
		text-align: center;
		color: var(--muted-foreground);
	}
</style>
