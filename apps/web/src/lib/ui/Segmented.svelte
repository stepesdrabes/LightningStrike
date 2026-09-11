<script lang="ts" generics="T extends string">
	/** The glass variant floats over live light and needs stronger blur and borders. */
	let {
		options,
		value = $bindable(),
		variant = 'inset',
		ariaLabel,
		onpick
	}: {
		options: readonly { id: T; label: string; title?: string; disabled?: boolean }[];
		value: T;
		variant?: 'inset' | 'glass';
		ariaLabel: string;
		onpick?: (id: T) => void;
	} = $props();

	function choose(id: T) {
		value = id;
		onpick?.(id);
	}
</script>

<div class="seg {variant}" role="group" aria-label={ariaLabel}>
	{#each options as option (option.id)}
		<button
			class:on={value === option.id}
			disabled={option.disabled}
			title={option.title}
			aria-pressed={value === option.id}
			onclick={() => choose(option.id)}>
			{option.label}
		</button>
	{/each}
</div>

<style>
	.seg {
		display: flex;
		align-items: center;
		gap: 2px;
	}
	button {
		flex: 1;
		white-space: nowrap;
		font-weight: 500;
		color: var(--subtle-foreground);
		transition:
			background-color 0.13s ease,
			color 0.13s ease;
	}
	button:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}
	button:hover:not(.on):not(:disabled) {
		color: var(--muted-foreground);
	}

	.inset {
		padding: 2px;
		border-radius: var(--radius-md);
		background: var(--muted);
	}
	.inset button {
		padding: 5px 11px;
		border-radius: calc(var(--radius-md) - 3px);
		font-size: 12px;
	}
	.inset button.on {
		background: var(--card-raised);
		color: var(--foreground);
	}

	.glass {
		padding: 3px;
		border-radius: var(--radius-md);
		background: #0d0d10cc;
		backdrop-filter: blur(10px);
		border: 1px solid #ffffff14;
	}
	.glass button {
		flex: none;
		height: 26px;
		padding: 0 11px;
		border-radius: var(--radius-sm);
		font-size: 12.5px;
		color: var(--muted-foreground);
	}
	.glass button:hover:not(.on):not(:disabled) {
		color: var(--foreground);
	}
	.glass button.on {
		background: #ffffff17;
		color: var(--foreground);
	}
</style>
