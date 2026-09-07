<script lang="ts">
	let {
		value,
		min = 0,
		max = 255,
		disabled = false,
		oninput
	}: {
		value: number;
		min?: number;
		max?: number;
		disabled?: boolean;
		oninput: (value: number) => void;
	} = $props();

	const pct = $derived(((value - min) / (max - min)) * 100);
</script>

<input
	type="range"
	{min}
	{max}
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

	/* Chrome and Safari will not accept a selector list that mentions the other engine's
	   pseudo-element, so the two tracks and the two thumbs are written out separately. */
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
