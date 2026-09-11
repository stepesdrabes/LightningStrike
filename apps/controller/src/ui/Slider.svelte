<script lang="ts">
	let {
		value,
		disabled = false,
		oninput
	}: {
		value: number;
		disabled?: boolean;
		oninput: (value: number) => void;
	} = $props();

	const pct = $derived((value / 255) * 100);
</script>

<input
	type="range"
	min={0}
	max={255}
	{value}
	{disabled}
	style:--pct="{pct}%"
	aria-label="brightness"
	oninput={(e) => oninput(e.currentTarget.valueAsNumber)}
/>

<style>
	input {
		-webkit-appearance: none;
		appearance: none;
		display: block;
		width: 100%;
		height: 28px;
		background: transparent;
		cursor: pointer;
	}

	input:disabled {
		cursor: default;
		opacity: 0.4;
	}

	/* Separate pseudo-element selectors: each browser rejects the other engine's selector. */
	input::-webkit-slider-runnable-track {
		height: 6px;
		border-radius: 999px;
		background: linear-gradient(90deg, var(--primary) var(--pct), var(--raised) var(--pct));
	}

	input::-moz-range-track {
		height: 6px;
		border-radius: 999px;
		background: linear-gradient(90deg, var(--primary) var(--pct), var(--raised) var(--pct));
	}

	input::-webkit-slider-thumb {
		-webkit-appearance: none;
		appearance: none;
		width: 22px;
		height: 22px;
		margin-top: -8px;
		border-radius: 50%;
		background: var(--primary);
		box-shadow: 0 1px 4px #0009;
	}

	input::-moz-range-thumb {
		width: 22px;
		height: 22px;
		border: none;
		border-radius: 50%;
		background: var(--primary);
		box-shadow: 0 1px 4px #0009;
	}
</style>
