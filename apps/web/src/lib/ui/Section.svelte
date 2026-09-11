<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		title,
		children
	}: {
		title: string;
		children: Snippet;
	} = $props();
</script>

<section>
	<header><h2>{title}</h2></header>
	{@render children()}
</section>

<style>
	section {
		padding: 16px;
		border-bottom: 1px solid var(--border-soft);
	}
	section:last-child {
		border-bottom: none;
	}
	header {
		display: flex;
		align-items: center;
		gap: 10px;
		margin-bottom: 10px;
	}
	h2 {
		font-size: 13px;
		font-weight: 600;
		color: var(--foreground);
		letter-spacing: -0.005em;
	}
</style>
