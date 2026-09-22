<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		name,
		ariaLabel,
		onrename,
		mark,
		actions
	}: {
		name: string;
		ariaLabel: string;
		onrename: (name: string) => void;
		/** What sits before the name: a glyph or a status dot. */
		mark: Snippet;
		actions?: Snippet;
	} = $props();

	let text = $state('');
	let editing = $state(false);

	$effect(() => {
		if (!editing) text = name;
	});

	function commit() {
		editing = false;
		const next = text.trim().slice(0, 60);
		if (next && next !== name) onrename(next);
		else text = name;
	}
</script>

<header>
	<span class="mark">{@render mark()}</span>
	<input
		class="name"
		type="text"
		spellcheck="false"
		autocomplete="off"
		aria-label={ariaLabel}
		bind:value={text}
		onfocus={() => (editing = true)}
		onblur={commit}
		onkeydown={(e) => {
			e.stopPropagation();
			if (e.key === 'Enter') e.currentTarget.blur();
			else if (e.key === 'Escape') {
				text = name;
				editing = false;
				e.currentTarget.blur();
			}
		}} />
	{#if actions}{@render actions()}{/if}
</header>

<style>
	header {
		display: flex;
		align-items: center;
		gap: 8px;
		height: 46px;
		flex: none;
		padding: 0 8px 0 12px;
		border-bottom: 1px solid var(--border);
	}
	.mark {
		display: grid;
		place-items: center;
		width: 26px;
		height: 26px;
		flex: none;
		border-radius: var(--radius-sm);
		background: var(--muted);
		color: var(--muted-foreground);
	}
	.name {
		flex: 1;
		min-width: 0;
		height: 30px;
		padding: 0 8px;
		margin-left: -2px;
		border: 1px solid transparent;
		border-radius: var(--radius-sm);
		background: none;
		font-size: 14px;
		font-weight: 600;
		letter-spacing: -0.005em;
		color: var(--foreground);
		text-overflow: ellipsis;
		transition:
			border-color 0.13s ease,
			background-color 0.13s ease;
	}
	.name:hover {
		border-color: var(--border);
	}
	.name:focus {
		outline: none;
		border-color: var(--ring);
		background: var(--popover);
	}
</style>
