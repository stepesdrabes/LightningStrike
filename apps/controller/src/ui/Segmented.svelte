<script lang="ts" generics="T extends string">
	import Icon from './Icon.svelte';
	import type { IconName } from '../lib/icons.ts';

	let {
		options,
		selected,
		disabled = false,
		onpick
	}: {
		options: readonly { value: T; label: string; icon?: IconName }[];
		selected: T | undefined;
		disabled?: boolean;
		onpick: (value: T) => void;
	} = $props();
</script>

<div class="row">
	{#each options as option (option.value)}
		<button
			type="button"
			{disabled}
			aria-pressed={option.value === selected}
			onclick={() => onpick(option.value)}
		>
			{#if option.icon}<Icon name={option.icon} size={15} />{/if}
			{option.label}
		</button>
	{/each}
</div>

<style>
	.row {
		display: flex;
		gap: 6px;
	}

	button {
		flex: 1;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 6px;
		min-height: var(--h);
		padding: 0 10px;
		font-size: 14px;
		color: var(--muted-foreground);
		background: var(--raised);
		border: 1px solid transparent;
		border-radius: var(--radius-sm);
		transition:
			background 120ms,
			color 120ms;
	}

	button[aria-pressed='true'] {
		color: var(--primary-foreground);
		background: var(--primary);
	}

	button:disabled {
		opacity: 0.4;
	}

	@media (hover: hover) {
		button:not(:disabled):not([aria-pressed='true']):hover {
			background: var(--hover);
			color: var(--foreground);
		}
	}
</style>
