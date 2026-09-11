<script lang="ts">
	import type { Snippet } from 'svelte';

	let {
		variant = 'muted',
		colour,
		title,
		children
	}: {
		variant?: 'muted' | 'outline' | 'live' | 'warn';
		/** Explicit background, for the section-kind chips that carry the show's own colours. */
		colour?: string;
		title?: string;
		children: Snippet;
	} = $props();
</script>

<span class="badge {variant}" style:background={colour} class:tinted={!!colour} {title}>
	{@render children()}
</span>

<style>
	.badge {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		height: 20px;
		padding: 0 8px;
		border-radius: 999px;
		border: 1px solid transparent;
		font-size: 11.5px;
		font-weight: 500;
		line-height: 1;
		white-space: nowrap;
	}
	.muted {
		background: var(--muted);
		color: var(--muted-foreground);
	}
	.outline {
		border-color: var(--border);
		color: var(--muted-foreground);
	}
	.live {
		background: #ff6a1a1f;
		color: var(--live);
	}
	.warn {
		background: #fbbf241f;
		color: var(--warn);
	}
	.tinted {
		color: #0d0d0fdb;
		font-weight: 600;
	}
</style>
