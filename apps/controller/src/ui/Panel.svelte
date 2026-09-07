<script lang="ts">
	import type { Snippet } from 'svelte';
	import Icon from './Icon.svelte';
	import type { IconName } from '../lib/icons.ts';

	let {
		icon,
		label,
		value,
		children
	}: {
		icon?: IconName;
		label?: string;
		/** Monospace, on the right: only ever a number or a code that changes in place. */
		value?: string;
		children: Snippet;
	} = $props();
</script>

<section>
	{#if label}
		<header>
			<span class="label">
				{#if icon}<Icon name={icon} size={15} />{/if}
				{label}
			</span>
			{#if value}<span class="value">{value}</span>{/if}
		</header>
	{/if}
	{@render children()}
</section>

<style>
	section {
		background: var(--card);
		border: 1px solid var(--border-soft);
		border-radius: var(--radius);
		padding: 14px;
	}

	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		margin-bottom: 12px;
	}

	.label {
		display: flex;
		align-items: center;
		gap: 7px;
		color: var(--muted-foreground);
		font-size: 13px;
	}

	.value {
		font-family: var(--mono);
		font-size: 12px;
		color: var(--subtle-foreground);
		font-variant-numeric: tabular-nums;
	}
</style>
