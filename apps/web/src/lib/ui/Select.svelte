<script lang="ts" generics="T extends string">
	import { menu, type MenuItem } from '$lib/menu.svelte.ts';
	import Icon from './Icon.svelte';

	let {
		value,
		options,
		ariaLabel,
		disabled = false,
		onpick
	}: {
		value: T;
		options: readonly (MenuItem & { id: T })[];
		ariaLabel: string;
		disabled?: boolean;
		onpick: (id: T) => void;
	} = $props();

	const chosen = $derived(options.find((o) => o.id === value));

	function open(e: MouseEvent) {
		menu.show(
			e.currentTarget as HTMLElement,
			() => [{ value, items: [...options] }],
			(_group, id) => {
				menu.close();
				if (id !== value) onpick(id as T);
			}
		);
	}
</script>

<button class="select" type="button" aria-label={ariaLabel} aria-haspopup="menu" {disabled} onclick={open}>
	<span class="truncate">{chosen?.label ?? ''}</span>
	<Icon name="chevronDown" size={13} />
</button>

<style>
	.select {
		display: flex;
		align-items: center;
		gap: 6px;
		width: 100%;
		min-width: 0;
		height: var(--h-sm);
		padding: 0 8px 0 10px;
		background: var(--card-raised);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		font-size: 12.5px;
		text-align: left;
		color: var(--foreground);
		transition:
			border-color 0.13s ease,
			background-color 0.13s ease;
	}
	.select span {
		flex: 1;
	}
	.select :global(.lucide-icon) {
		color: var(--subtle-foreground);
	}
	.select:hover:not(:disabled) {
		border-color: #33333c;
		background: var(--muted);
	}
	.select:disabled {
		opacity: 0.45;
	}
</style>
