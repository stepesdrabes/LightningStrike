<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		label,
		note,
		children
	}: {
		label: string;
		/** A line under the control saying what the setting does, when that is not obvious. */
		note?: string;
		children: Snippet;
	} = $props();
</script>

<div class="row">
	<span class="label">{label}</span>
	<div class="control">{@render children()}</div>
	{#if note}<p class="note">{note}</p>{/if}
</div>

<style>
	.row {
		display: grid;
		grid-template-columns: 104px 1fr;
		align-items: center;
		column-gap: 12px;
		row-gap: 4px;
		min-height: var(--h-sm);
		font-size: 13px;
	}
	.label {
		color: var(--muted-foreground);
	}
	.control {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
	}
	.control > :global(.slider) {
		flex: 1;
		min-width: 0;
	}
	.control > :global(.seg) {
		flex: 1;
	}
	.note {
		grid-column: 2;
		font-size: 12px;
		line-height: 1.45;
		color: var(--subtle-foreground);
	}
</style>
