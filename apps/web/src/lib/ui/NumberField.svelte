<script lang="ts">
	let {
		value,
		min = -Infinity,
		max = Infinity,
		step = 1,
		digits = 0,
		unit = '',
		ariaLabel,
		disabled = false,
		oncommit
	}: {
		value: number;
		min?: number;
		max?: number;
		/** Arrow keys move by this, and by ten times it with Shift held. */
		step?: number;
		/** Decimal places shown. */
		digits?: number;
		unit?: string;
		ariaLabel: string;
		disabled?: boolean;
		oncommit: (value: number) => void;
	} = $props();

	let text = $state('');
	let focused = $state(false);

	const shown = $derived(value.toFixed(digits));

	// Follow the value unless someone is typing over it.
	$effect(() => {
		if (!focused) text = shown;
	});

	function clamp(v: number): number {
		return Math.min(max, Math.max(min, v));
	}

	function commit() {
		const parsed = Number(text.replace(',', '.').trim());
		if (!Number.isFinite(parsed) || text.trim() === '') {
			text = shown;
			return;
		}
		const next = Number(clamp(parsed).toFixed(digits));
		text = next.toFixed(digits);
		if (next !== Number(shown)) oncommit(next);
	}

	function onkeydown(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			commit();
			(e.currentTarget as HTMLInputElement).select();
		} else if (e.key === 'Escape') {
			text = shown;
			(e.currentTarget as HTMLInputElement).blur();
		} else if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
			e.preventDefault();
			const by = (e.key === 'ArrowUp' ? 1 : -1) * step * (e.shiftKey ? 10 : 1);
			const base = Number(text.replace(',', '.'));
			const next = Number(clamp((Number.isFinite(base) ? base : value) + by).toFixed(digits));
			text = next.toFixed(digits);
			oncommit(next);
		}
		// The page's own shortcuts are for the room, not for someone typing a number.
		e.stopPropagation();
	}
</script>

<label class="field" class:disabled>
	<input
		type="text"
		inputmode="decimal"
		spellcheck="false"
		autocomplete="off"
		aria-label={ariaLabel}
		{disabled}
		bind:value={text}
		onfocus={(e) => {
			focused = true;
			e.currentTarget.select();
		}}
		onblur={() => {
			focused = false;
			commit();
		}}
		{onkeydown} />
	{#if unit}<span class="unit">{unit}</span>{/if}
</label>

<style>
	.field {
		display: flex;
		align-items: center;
		gap: 4px;
		min-width: 0;
		height: var(--h-sm);
		padding: 0 9px;
		background: var(--card-raised);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		transition:
			border-color 0.13s ease,
			background-color 0.13s ease;
	}
	.field:hover:not(.disabled) {
		border-color: #33333c;
	}
	.field:focus-within {
		border-color: var(--ring);
		background: var(--popover);
	}
	.field.disabled {
		opacity: 0.45;
	}
	input {
		flex: 1;
		min-width: 0;
		width: 100%;
		padding: 0;
		border: none;
		background: none;
		outline: none;
		color: var(--foreground);
		font-family: var(--mono);
		font-variant-numeric: tabular-nums;
		font-size: 12.5px;
	}
	.unit {
		flex: none;
		font-size: 12px;
		color: var(--subtle-foreground);
	}
</style>
