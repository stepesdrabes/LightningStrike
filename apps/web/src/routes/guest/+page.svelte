<script lang="ts">
	import { goto } from '$app/navigation';
	import { GuestQueue, loadGuest, type Guest } from '$lib/guest.svelte.ts';
	import { currentItem } from '$lib/queueModel.ts';
	import { clock } from '$lib/format.ts';
	import type { SearchResult } from '$lib/types.ts';
	import Icon from '$lib/ui/Icon.svelte';
	import Spinner from '$lib/ui/Spinner.svelte';

	const queue = new GuestQueue();

	let guest = $state<Guest | null>(null);
	let query = $state('');
	let results = $state<SearchResult[]>([]);
	let searching = $state(false);
	let adding = $state<string | null>(null);
	let added = $state<string | null>(null);

	const now = $derived(currentItem(queue.state));
	const upNext = $derived(
		queue.state.items.slice(queue.state.items.findIndex((i) => i.key === now?.key) + 1)
	);
	const mine = $derived(guest?.name ?? '');

	$effect(() => {
		const known = loadGuest();
		if (!known) {
			void goto('/join');
			return;
		}
		guest = known;
		queue.connect();
		return () => queue.dispose();
	});

	// Debounce and abort stale searches so late results cannot replace a newer query.
	$effect(() => {
		const q = query.trim();
		if (q.length < 2) {
			results = [];
			searching = false;
			return;
		}
		const controller = new AbortController();
		const timer = setTimeout(async () => {
			searching = true;
			try {
				const res = await fetch(`/api/search?q=${encodeURIComponent(q)}`, {
					signal: controller.signal
				});
				if (res.ok) results = ((await res.json()) as { results: SearchResult[] }).results;
			} catch {
				// An aborted search is a superseded keystroke, not a failure.
			} finally {
				if (!controller.signal.aborted) searching = false;
			}
		}, 350);
		return () => {
			clearTimeout(timer);
			controller.abort();
		};
	});

	async function add(result: SearchResult) {
		if (!guest || adding) return;
		adding = result.id;
		const ok = await queue.add(guest, {
			source: result.webpageUrl,
			trackId: result.id,
			title: result.title,
			uploader: result.artist,
			thumbnail: result.thumbnail,
			duration: result.duration
		});
		adding = null;
		if (!ok) return;
		added = result.id;
		query = '';
		results = [];
		setTimeout(() => (added = null), 2400);
	}
</script>

<svelte:head><title>LightningStrike</title></svelte:head>

<div class="phone">
	<header>
		<span class="bolt"><Icon name="bolt" size={13} fill /></span>
		<span class="who truncate">{mine}</span>
	</header>

	<div class="search">
		<Icon name="search" size={17} />
		<input
			bind:value={query}
			type="search"
			placeholder="Search for a track"
			enterkeyhint="search"
			autocapitalize="none"
			autocomplete="off" />
		{#if searching}<Spinner size={15} />{/if}
	</div>

	<div class="scroll">
		{#if queue.failure}
			<p class="notice bad"><Icon name="alert" size={15} />{queue.failure}</p>
		{/if}

		{#if added}
			<p class="notice ok"><Icon name="check" size={15} />Added to the queue.</p>
		{/if}

		{#if results.length > 0}
			{#each results as result (result.id)}
				<button class="row" onclick={() => add(result)} disabled={adding !== null}>
					<img src={result.thumbnail} alt="" loading="lazy" />
					<span class="text">
						<span class="title truncate">{result.title}</span>
						<span class="sub truncate">{result.artist}</span>
					</span>
					{#if adding === result.id}
						<Spinner size={16} />
					{:else}
						<span class="add"><Icon name="plus" size={17} /></span>
					{/if}
				</button>
			{/each}
		{:else}
			{#if now}
				<h2>Playing</h2>
				<div class="row playing">
					{#if now.thumbnail}<img src={now.thumbnail} alt="" />{/if}
					<span class="text">
						<span class="title truncate">{now.title}</span>
						<span class="sub truncate">{now.uploader}</span>
					</span>
					<span class="bars"><i></i><i></i><i></i></span>
				</div>
			{/if}

			<h2>{upNext.length > 0 ? 'Up next' : 'Nothing queued yet'}</h2>
			{#each upNext as item (item.key)}
				<div class="row">
					{#if item.thumbnail}<img src={item.thumbnail} alt="" loading="lazy" />{/if}
					<span class="text">
						<span class="title truncate">{item.title}</span>
						<span class="sub truncate">
							{item.addedBy ? item.addedBy : item.uploader}
							{#if item.duration > 0}
								<span class="sep">·</span>{clock(item.duration)}
							{/if}
						</span>
					</span>
					{#if item.addedBy === mine && mine}
						{@const me = guest}
						<button
							class="take-back"
							aria-label="Take back"
							onclick={() => me && queue.remove(me, item.key)}>
							<Icon name="x" size={16} />
						</button>
					{/if}
				</div>
			{/each}
		{/if}
	</div>
</div>

<style>
	.phone {
		display: flex;
		flex-direction: column;
		height: 100svh;
	}
	header {
		display: flex;
		align-items: center;
		gap: 10px;
		flex: none;
		padding: calc(12px + env(safe-area-inset-top)) 16px 12px;
	}
	.bolt {
		display: grid;
		place-items: center;
		width: 26px;
		height: 26px;
		border-radius: 8px;
		background: var(--foreground);
		color: var(--primary-foreground);
		flex: none;
	}
	.who {
		font-size: 14px;
		font-weight: 600;
	}

	.search {
		position: relative;
		display: flex;
		align-items: center;
		gap: 11px;
		flex: none;
		margin: 0 16px 12px;
		padding: 0 14px;
		height: 50px;
		border-radius: var(--radius-md);
		background: var(--card-raised);
		border: 1px solid var(--border);
		color: var(--subtle-foreground);
	}
	.search input {
		flex: 1;
		min-width: 0;
		background: none;
		border: none;
		outline: none;
		color: var(--foreground);
		/* 16px or larger, or iOS zooms the page when the field takes focus. */
		font-size: 16px;
	}

	.scroll {
		flex: 1;
		overflow-y: auto;
		padding: 0 12px calc(24px + env(safe-area-inset-bottom));
		-webkit-overflow-scrolling: touch;
	}

	h2 {
		padding: 14px 4px 8px;
		font-size: 13px;
		font-weight: 500;
		color: var(--subtle-foreground);
	}

	.row {
		display: flex;
		align-items: center;
		gap: 12px;
		width: 100%;
		padding: 8px 4px;
		text-align: left;
		color: var(--foreground);
	}
	.row:disabled {
		opacity: 0.5;
	}
	.row img {
		width: 52px;
		height: 52px;
		flex: none;
		border-radius: var(--radius-sm);
		object-fit: cover;
		background: var(--muted);
	}
	.text {
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 0;
		flex: 1;
	}
	.title {
		font-size: 14.5px;
		font-weight: 500;
	}
	.sub {
		font-size: 13px;
		color: var(--muted-foreground);
	}
	.sep {
		opacity: 0.4;
		padding: 0 3px;
	}
	.add,
	.take-back {
		display: grid;
		place-items: center;
		width: 36px;
		height: 36px;
		flex: none;
		border-radius: 50%;
		background: var(--muted);
		color: var(--muted-foreground);
	}

	/* Three bars, the same signal the desktop queue uses for the row making the sound. */
	.bars {
		display: flex;
		align-items: flex-end;
		gap: 2px;
		height: 14px;
		flex: none;
	}
	.bars i {
		width: 3px;
		background: var(--ok);
		border-radius: 1px;
		animation: bounce 0.9s ease-in-out infinite;
	}
	.bars i:nth-child(1) {
		height: 60%;
	}
	.bars i:nth-child(2) {
		height: 100%;
		animation-delay: 0.18s;
	}
	.bars i:nth-child(3) {
		height: 45%;
		animation-delay: 0.36s;
	}
	@keyframes bounce {
		50% {
			height: 25%;
		}
	}

	.notice {
		display: flex;
		align-items: center;
		gap: 9px;
		margin: 8px 4px;
		padding: 11px 13px;
		border-radius: var(--radius-md);
		font-size: 13.5px;
	}
	.notice.bad {
		background: #f871711a;
		color: var(--bad);
	}
	.notice.ok {
		background: #4ade801a;
		color: var(--ok);
	}
</style>
