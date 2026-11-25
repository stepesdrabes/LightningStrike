<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		title,
		action,
		children
	}: {
		title: string;
		/** Something at the heading's right, such as an add button. */
		action?: Snippet;
		children: Snippet;
	} = $props();
</script>

<section>
	<header>
		<h3>{title}</h3>
		{#if action}{@render action()}{/if}
	</header>
	{@render children()}
</section>

<style>
	section {
		display: flex;
		flex-direction: column;
		gap: 9px;
		padding: 14px 16px 16px;
		border-bottom: 1px solid var(--border-soft);
	}
	section:last-child {
		border-bottom: none;
	}
	header {
		display: flex;
		align-items: center;
		gap: 8px;
		min-height: 24px;
	}
	h3 {
		flex: 1;
		font-size: 12.5px;
		font-weight: 600;
		color: var(--muted-foreground);
	}
</style>
