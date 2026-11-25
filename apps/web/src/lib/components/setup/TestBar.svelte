<script lang="ts">
	import type { LightTestKind } from '@mv/core';
	import type { RoomsClient } from '$lib/rooms.svelte.ts';

	let { rooms, lights }: { rooms: RoomsClient; lights: string[] } = $props();

	const TESTS: { id: LightTestKind; label: string; note: string }[] = [
		{ id: 'identify', label: 'Find', note: 'It pulses while every other light goes dark.' },
		{ id: 'walk', label: 'Walk', note: 'A dot runs from the first LED, held green, to the last, held red.' },
		{
			id: 'colours',
			label: 'Colours',
			note: 'Red, green, blue, then white. Any other order means the controller has the colour order wrong.'
		}
	];

	const active = $derived.by(() => {
		const test = rooms.test;
		if (!test || test.lights.length !== lights.length) return null;
		return lights.every((id) => test.lights.includes(id)) ? test.kind : null;
	});
	const note = $derived(
		TESTS.find((t) => t.id === active)?.note ??
			'Shows in the preview, and on the lights themselves while the room is lit.'
	);
</script>

<div class="tests" role="group" aria-label="Test patterns">
	{#each TESTS as test (test.id)}
		<button
			class:on={active === test.id}
			aria-pressed={active === test.id}
			disabled={lights.length === 0}
			onclick={() => (active === test.id ? rooms.stopTest() : rooms.startTest(test.id, lights))}>
			{#if active === test.id}<i></i>{/if}
			{test.label}
		</button>
	{/each}
</div>
<p class="note">{note}</p>

<style>
	.tests {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 6px;
	}
	button {
		display: inline-flex;
		align-items: center;
		justify-content: center;
		gap: 7px;
		height: var(--h-sm);
		border-radius: var(--radius-md);
		border: 1px solid var(--border);
		background: var(--card-raised);
		font-size: 12.5px;
		font-weight: 500;
		color: var(--muted-foreground);
		transition:
			background-color 0.13s ease,
			border-color 0.13s ease,
			color 0.13s ease;
	}
	button:hover:not(:disabled) {
		background: var(--muted);
		color: var(--foreground);
	}
	button:disabled {
		opacity: 0.45;
	}
	/* A test is the room doing something now, so it takes the live accent. */
	button.on {
		background: color-mix(in srgb, var(--live) 16%, transparent);
		border-color: color-mix(in srgb, var(--live) 45%, transparent);
		color: var(--live);
	}
	i {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: currentColor;
		animation: pulse 1.2s ease-in-out infinite;
	}
	@keyframes pulse {
		50% {
			opacity: 0.3;
		}
	}
	.note {
		font-size: 12px;
		line-height: 1.45;
		color: var(--subtle-foreground);
	}
</style>
