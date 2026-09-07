<script lang="ts">
	import Icon from './Icon.svelte';

	/**
	 * Eleven colours worth having on a wall, warm first, plus the picker: twelve tiles fill the
	 * six-column grid exactly, and a thirteenth would sit alone on a row of its own.
	 */
	const PRESETS: readonly string[] = [
		'#ffd6aa',
		'#ffffff',
		'#ff9d4d',
		'#ff5a1f',
		'#ff1f1f',
		'#ff2fa0',
		'#8a3dff',
		'#2a4bff',
		'#14d8e0',
		'#35e08a',
		'#ffd83d'
	];

	let {
		colour,
		disabled = false,
		onpick
	}: { colour: string; disabled?: boolean; onpick: (hex: string) => void } = $props();

	const current = $derived(colour.toLowerCase());
</script>

<div class="grid">
	{#each PRESETS as hex (hex)}
		<button
			type="button"
			{disabled}
			class="swatch"
			style:background={hex}
			style:color={hex === '#ffffff' || hex === '#ffd6aa' || hex === '#ffd83d'
				? '#0a0a0b'
				: '#fafafa'}
			aria-label={hex}
			aria-pressed={hex === current}
			onclick={() => onpick(hex)}
		>
			{#if hex === current}<Icon name="check" size={16} />{/if}
		</button>
	{/each}

	<label class="swatch custom" class:on={!PRESETS.includes(current)}>
		<input
			type="color"
			value={current}
			{disabled}
			aria-label="any other colour"
			oninput={(e) => onpick(e.currentTarget.value.toLowerCase())}
		/>
		<Icon name="palette" size={16} />
	</label>
</div>

<style>
	.grid {
		display: grid;
		grid-template-columns: repeat(6, 1fr);
		gap: 7px;
	}

	.swatch {
		display: flex;
		align-items: center;
		justify-content: center;
		aspect-ratio: 1;
		border-radius: 9px;
		/* Against near-black, a white rim is what gives a dark swatch an edge at all. */
		box-shadow: inset 0 0 0 1px #ffffff1f;
		transition: transform 120ms;
	}

	.swatch:active:not(:disabled) {
		transform: scale(0.94);
	}

	.swatch:disabled {
		opacity: 0.4;
	}

	.custom {
		position: relative;
		background: var(--raised);
		color: var(--muted-foreground);
		cursor: pointer;
	}

	.custom.on {
		color: var(--foreground);
		box-shadow:
			inset 0 0 0 1px #ffffff1f,
			0 0 0 2px var(--background),
			0 0 0 4px var(--primary);
	}

	/* The native colour well is the whole tile; the icon on top is what is actually seen. */
	.custom input {
		position: absolute;
		inset: 0;
		width: 100%;
		height: 100%;
		opacity: 0;
		cursor: pointer;
	}
</style>
