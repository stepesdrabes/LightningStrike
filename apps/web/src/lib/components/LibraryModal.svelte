<script lang="ts">
	import type { LibraryEntry } from '$lib/types.ts';
	import { filterLibrary } from '$lib/search.svelte.ts';
	import { clock } from '$lib/format.ts';
	import Dialog from '$lib/ui/Dialog.svelte';
	import Badge from '$lib/ui/Badge.svelte';
	import Button from '$lib/ui/Button.svelte';
	import Icon from '$lib/ui/Icon.svelte';
	import Spinner from '$lib/ui/Spinner.svelte';

	let {
		open = false,
		library,
		/** Track ids already in the queue, which are the ones that must not be deleted. */
		queued = new Set<string>(),
		onclose,
		onplay,
		onqueue,
		onradio,
		ondelete
	}: {
		open?: boolean;
		library: LibraryEntry[];
		queued?: Set<string>;
		onclose: () => void;
		onplay: (entry: LibraryEntry) => void;
		onqueue: (entry: LibraryEntry) => void;
		onradio: (entry: LibraryEntry) => void;
		ondelete: (entry: LibraryEntry) => Promise<void>;
	} = $props();

	let query = $state('');
	let confirming = $state<string | null>(null);
	let deleting = $state<string | null>(null);

	// Everything, not the palette's shortlist: this is the place to look at the whole cache.
	const shown = $derived(filterLibrary(library, query, library.length));

	// Reading the disk is the ingest's job, so this reports what the ingest already recorded.
	const hours = $derived(library.reduce((s, e) => s + (e.duration ?? 0), 0) / 3600);

	// Reset dialog-local state on reopen; only its contents unmount.
	function close() {
		query = '';
		confirming = null;
		onclose();
	}

	async function remove(entry: LibraryEntry) {
		deleting = entry.id;
		try {
			await ondelete(entry);
		} finally {
			deleting = null;
			confirming = null;
		}
	}
</script>

<Dialog {open} onclose={close} width="min(760px, calc(100vw - 32px))" labelledBy="library-title">
	<header>
		<Icon name="listMusic" size={16} />
		<h2 id="library-title">Library</h2>
		<span class="count mono subtle">
			{library.length}
			{#if hours >= 0.1}<span class="sep">·</span>{hours.toFixed(1)} h{/if}
		</span>
	</header>

	<div class="find">
		<Icon name="search" size={15} />
		<input
			type="text"
			placeholder="Filter"
			spellcheck="false"
			autocomplete="off"
			bind:value={query} />
	</div>

	<div class="list">
		{#each shown as entry (entry.id)}
			<div class="row" class:danger={confirming === entry.id}>
				<span class="art">
					{#if entry.thumbnail}
						<img src={entry.thumbnail} alt="" loading="lazy" />
					{:else}
						<Icon name="music" size={16} />
					{/if}
				</span>

				<span class="text">
					<span class="title truncate">{entry.title}</span>
					<span class="sub truncate muted">{entry.uploader}</span>
				</span>

				{#if entry.genreFamily}
					<Badge variant="muted" title="How the room lights this">{entry.genreFamily}</Badge>
				{/if}
				{#if entry.authored === 'claude' || entry.authored === 'deepseek'}
					<Badge
						variant="live"
						title="{entry.authored === 'claude' ? 'Claude' : 'DeepSeek'} designed this show">
						<Icon name="sparkles" size={11} />
					</Badge>
				{/if}
				{#if !entry.analysed}
					<Badge variant="outline" title="Downloaded, not analysed">Raw</Badge>
				{:else if !entry.current}

					<Badge variant="warn" title="Cached against an older analysis; queueing it re-prepares">
						Stale
					</Badge>
				{/if}
				{#if entry.duration}
					<span class="mono subtle len">{clock(entry.duration)}</span>
				{/if}

				{#if confirming === entry.id}

					<span class="ask">Delete the download and its analysis?</span>
					<Button size="sm" variant="ghost" onclick={() => (confirming = null)}>Keep</Button>
					<Button size="sm" variant="danger" onclick={() => remove(entry)}>
						{#if deleting === entry.id}<Spinner size={12} />{/if}
						Delete
					</Button>
				{:else}
					<span class="tools">
						<Button
							size="icon-sm"
							variant="ghost"
							title="Play now"
							ariaLabel="Play now"
							onclick={() => onplay(entry)}>
							<Icon name="play" size={14} fill />
						</Button>
						<Button
							size="icon-sm"
							variant="ghost"
							title="Add to the queue"
							ariaLabel="Add to the queue"
							onclick={() => onqueue(entry)}>
							<Icon name="plus" size={14} />
						</Button>
						<Button
							size="icon-sm"
							variant="ghost"
							title="Start a radio from this"
							ariaLabel="Start a radio from this"
							onclick={() => onradio(entry)}>
							<Icon name="radio" size={14} />
						</Button>
						<Button
							size="icon-sm"
							variant="ghost"
							disabled={queued.has(entry.id)}
							title={queued.has(entry.id) ? 'It is in the queue' : 'Delete from the cache'}
							ariaLabel="Delete from the cache"
							onclick={() => (confirming = entry.id)}>
							<Icon name="trash" size={14} />
						</Button>
					</span>
				{/if}
			</div>
		{/each}

		{#if shown.length === 0}
			<p class="notice muted">
				{library.length === 0 ? 'Nothing downloaded yet.' : 'Nothing matches.'}
			</p>
		{/if}
	</div>
</Dialog>

<style>
	header {
		display: flex;
		align-items: center;
		gap: 9px;
		padding: 14px 16px;
		border-bottom: 1px solid var(--border);
		color: var(--muted-foreground);
	}
	h2 {
		font-size: 14px;
		font-weight: 600;
		color: var(--foreground);
	}
	.count {
		margin-left: auto;
		font-size: 12px;
	}
	.sep {
		opacity: 0.4;
		margin: 0 5px;
	}

	.find {
		position: relative;
		display: flex;
		align-items: center;
		gap: 9px;
		padding: 10px 16px;
		border-bottom: 1px solid var(--border-soft);
		color: var(--subtle-foreground);
	}
	.find input {
		flex: 1;
		min-width: 0;
		background: none;
		border: none;
		outline: none;
		font: inherit;
		font-size: 13.5px;
		color: var(--foreground);
	}
	.find input::placeholder {
		color: var(--subtle-foreground);
	}

	.list {
		flex: 1;
		overflow-y: auto;
		padding: 6px;
		min-height: 0;
	}
	.row {
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		padding: 6px 8px;
		border-radius: var(--radius-md);
		text-align: left;
	}
	.row:hover {
		background: var(--hover);
	}
	.row.danger {
		background: color-mix(in srgb, var(--bad) 12%, transparent);
	}
	.art {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 34px;
		height: 34px;
		flex: none;
		border-radius: var(--radius-sm);
		overflow: hidden;
		background: var(--muted);
		color: var(--subtle-foreground);
	}
	.art img {
		width: 100%;
		height: 100%;
		object-fit: cover;
	}
	.text {
		display: flex;
		flex-direction: column;
		flex: 1;
		min-width: 0;
	}
	.title {
		font-size: 13.5px;
		color: var(--foreground);
	}
	.sub {
		font-size: 12px;
	}
	.len {
		font-size: 12px;
	}
	.ask {
		font-size: 12.5px;
		color: var(--muted-foreground);
	}

	/* Show row tools on hover or focus so keyboard users can reach them. */
	.tools {
		display: flex;
		gap: 2px;
		opacity: 0;
	}
	.row:hover .tools,
	.tools:focus-within {
		opacity: 1;
	}

	.notice {
		padding: 22px 16px;
		text-align: center;
		font-size: 13px;
	}
</style>
