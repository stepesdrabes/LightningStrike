<script lang="ts">
	import type { LightPart } from '@mv/core';
	import type { RoomsClient } from '$lib/rooms.svelte.ts';
	import ControllerInspector from './ControllerInspector.svelte';
	import LightInspector from './LightInspector.svelte';
	import RoomInspector from './RoomInspector.svelte';

	let {
		rooms,
		parts
	}: {
		rooms: RoomsClient;
		/** What each light turned out to be to the show, by id. */
		parts: ReadonlyMap<string, LightPart>;
	} = $props();

	const selection = $derived(rooms.selection);
	const light = $derived(
		selection?.kind === 'light' ? (rooms.room?.layout.lights.find((l) => l.id === selection.id) ?? null) : null
	);
	const controller = $derived(
		selection?.kind === 'controller' ? (rooms.room?.controllers.find((c) => c.id === selection.id) ?? null) : null
	);
</script>

<aside class="floats">
	{#if rooms.room}
		{#if light}
			<LightInspector {rooms} {light} part={parts.get(light.id) ?? null} />
		{:else if controller}
			<ControllerInspector
				{rooms}
				{controller}
				status={rooms.output.controllers.find((s) => s.id === controller.id) ?? null} />
		{:else}
			<RoomInspector {rooms} />
		{/if}
	{/if}
</aside>

<style>
	aside {
		width: var(--rail-right);
		flex: none;
		display: flex;
		flex-direction: column;
		min-height: 0;
		background: var(--panel);
		backdrop-filter: var(--panel-blur);
		border-left: 1px solid var(--border);
	}
</style>
