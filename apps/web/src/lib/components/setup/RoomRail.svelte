<script lang="ts">
	import { ledCount, type Light } from '@mv/core';
	import { STATE_WORDS, type Found } from '$lib/controllers.ts';
	import { menu, type MenuItem } from '$lib/menu.svelte.ts';
	import type { RoomsClient } from '$lib/rooms.svelte.ts';
	import { CONTROLLER_KINDS, freshId, newLight, type Controller, type ControllerKind, type LightShape } from '$lib/rooms.ts';
	import {
		foundIn,
		freshName,
		lightFor,
		waitingFor,
		withController,
		withLight,
		withoutController,
		withoutLight
	} from '$lib/roomEdit.ts';
	import type { PlanView } from '$lib/plan.ts';
	import { extentOf, spansOf } from '$lib/wiring.ts';
	import Button from '$lib/ui/Button.svelte';
	import Dialog from '$lib/ui/Dialog.svelte';
	import Icon from '$lib/ui/Icon.svelte';
	import Spinner from '$lib/ui/Spinner.svelte';
	import StatusDot from '../StatusDot.svelte';
	import { glyphOf, wiredTo } from './labels.ts';

	let {
		rooms,
		view = 'top',
		localNetworkHint = false,
		ondraw,
		onclose
	}: {
		rooms: RoomsClient;
		/** Where the plan is looking, so a new light goes on the wall in view. */
		view?: PlanView;
		/** macOS asks before an app may look round the local network; say so when nothing answers. */
		localNetworkHint?: boolean;
		ondraw: () => void;
		onclose: () => void;
	} = $props();

	const room = $derived(rooms.room);
	const lights = $derived(room?.layout.lights ?? []);
	const controllers = $derived(room?.controllers ?? []);
	const statuses = $derived(new Map(rooms.output.controllers.map((s) => [s.id, s])));
	const selectedId = $derived(rooms.selection?.id ?? null);

	let importer: HTMLInputElement | undefined = $state();
	let deleting = $state(false);

	const SHAPES: { id: LightShape; label: string; note: string }[] = [
		{ id: 'strip', label: 'Strip', note: 'a straight run' },
		{ id: 'loop', label: 'Loop', note: 'round the ceiling' },
		{ id: 'ring', label: 'Ring', note: 'a circle of LEDs' },
		{ id: 'matrix', label: 'Panel', note: 'a grid' },
		{ id: 'lamp', label: 'Lamp', note: 'one glowing light' }
	];

	function openRoomMenu(e: MouseEvent) {
		const others = rooms.rooms.length > 1;
		menu.show(
			e.currentTarget as HTMLElement,
			() => [
				{
					label: 'Rooms',
					value: rooms.state?.active,
					items: rooms.rooms.map((r) => ({ id: `room:${r.id}`, label: r.name }))
				},
				{
					items: [
						{ id: 'new', label: 'New room' },
						{ id: 'copy', label: 'Duplicate this room' },
						{ id: 'frame', label: 'New room from the Frame' },
						{ id: 'import', label: 'Import a room' },
						{ id: 'export', label: 'Export this room' },
						{ id: 'delete', label: 'Delete this room', disabled: !others, title: others ? undefined : 'The last room stays' }
					]
				}
			],
			(_group, id) => {
				menu.close();
				if (id.startsWith('room:')) void rooms.activate(id.slice(5));
				else if (id === 'new') void rooms.create(freshName('New room', rooms.rooms.map((r) => r.name)));
				else if (id === 'copy' && room) void rooms.create(freshName(`${room.name} copy`, rooms.rooms.map((r) => r.name)), room.id);
				else if (id === 'frame') void rooms.create(freshName('The Frame', rooms.rooms.map((r) => r.name)), 'frame');
				else if (id === 'import') importer?.click();
				else if (id === 'export') rooms.export();
				else if (id === 'delete') deleting = true;
			}
		);
	}

	function openAddLight(e: MouseEvent) {
		menu.show(
			e.currentTarget as HTMLElement,
			() => [
				{ items: [{ id: 'draw', label: 'Draw a strip', note: 'on the plan' }] },
				{ items: SHAPES }
			],
			(_group, id) => {
				menu.close();
				if (id === 'draw') ondraw();
				else addLight(id as LightShape);
			}
		);
	}

	function addLight(shape: LightShape) {
		if (!room) return;
		const draft = newLight(shape, room.layout, freshId(shape, lights.map((l) => l.id)), view === 'top' ? null : view);
		const light = { ...draft, name: freshName(draft.name, lights.map((l) => l.name)) };
		rooms.edit((r) => withLight(r, light));
		rooms.select({ kind: 'light', id: light.id });
	}

	function openAddController(e: MouseEvent) {
		menu.show(
			e.currentTarget as HTMLElement,
			() => [
				{
					items: (Object.keys(CONTROLLER_KINDS) as ControllerKind[]).map((kind) => ({
						id: kind,
						label: CONTROLLER_KINDS[kind].name
					}))
				}
			],
			(_group, id) => {
				menu.close();
				addController(id as ControllerKind);
			}
		);
	}

	function addController(kind: ControllerKind, found?: Found) {
		if (!room) return;
		const base = found?.name || CONTROLLER_KINDS[kind].name;
		const controller: Controller = {
			id: freshId(base, controllers.map((c) => c.id)),
			name: freshName(base, controllers.map((c) => c.name)),
			kind,
			host: found?.host ?? '',
			...(kind === 'sacn' ? { universe: 1 } : kind === 'artnet' ? { universe: found?.universe ?? 0 } : {}),
			...(found?.mac ? { mac: found.mac } : {})
		};
		const light = found
			? lightFor(found, room.layout, freshId(base, lights.map((l) => l.id)), freshName(base, lights.map((l) => l.name)))
			: null;
		rooms.edit((r) => {
			const next = withController(r, controller);
			return light ? withLight(next, { ...light, wiring: { controller: controller.id, start: 0 } }) : next;
		});
		rooms.select(light ? { kind: 'light', id: light.id } : { kind: 'controller', id: controller.id });
	}

	/** An existing controller takes the address a found one answered from. */
	function useFound(found: Found, controller: Controller) {
		rooms.edit((r) =>
			withController(r, {
				...controller,
				host: found.host,
				...(found.mac ? { mac: found.mac } : {}),
				...(controller.kind === 'artnet' && found.universe !== undefined ? { universe: found.universe } : {})
			})
		);
		rooms.select({ kind: 'controller', id: controller.id });
	}


	/** Lights nothing drives yet, as the app first shows the Frame. */
	const previewOnly = $derived(
		controllers.length === 0 && lights.length > 0 && lights.every((l) => !l.wiring)
	);

	async function adopt(e: MouseEvent, found: Found) {
		if (!room) return;
		if (previewOnly) {
			const items: MenuItem[] = [
				{ id: 'own', label: 'Start a room with it', note: 'shaped round it' },
				{ id: 'here', label: `Add it to ${room.name}` }
			];
			menu.show(e.currentTarget as HTMLElement, () => [{ items }], async (_group, id) => {
				menu.close();
				if (id === 'own') await rooms.create(freshName(found.name || 'My room', rooms.rooms.map((r) => r.name)));
				addController(found.kind, found);
			});
			return;
		}
		const waiting = waitingFor(room, found);
		if (waiting.length === 0) {
			addController(found.kind, found);
			return;
		}
		const items: MenuItem[] = [
			...waiting.map((c) => ({ id: c.id, label: `For ${c.name}` })),
			{ id: '', label: 'As a new controller' }
		];
		menu.show(e.currentTarget as HTMLElement, () => [{ items }], (_group, id) => {
			menu.close();
			const target = waiting.find((c) => c.id === id);
			if (target) useFound(found, target);
			else addController(found.kind, found);
		});
	}

	function removeLight(light: Light) {
		rooms.edit((r) => withoutLight(r, light.id));
		if (selectedId === light.id) rooms.select(null);
	}

	function removeController(controller: Controller) {
		rooms.edit((r) => withoutController(r, controller.id));
		if (selectedId === controller.id) rooms.select(null);
	}

	function lightLeds(light: Light): string {
		return light.kind === 'lamp' ? (light.mode === 'summary' ? '' : '1') : String(ledCount(light));
	}

	async function onimport(e: Event) {
		const input = e.currentTarget as HTMLInputElement;
		const file = input.files?.[0];
		input.value = '';
		if (file) await rooms.importFile(file);
	}
</script>

<aside class="floats">
	<header>
		<button class="switcher" aria-haspopup="menu" title="Switch, add or share rooms" onclick={openRoomMenu}>
			<Icon name="room" size={15} />
			<span class="name truncate">{room?.name ?? 'Room'}</span>
			<Icon name="chevronDown" size={13} />
		</button>
		<Button variant="ghost" size="sm" title="Back to the show (Esc)" onclick={onclose}>Done</Button>
	</header>

	<div class="scroll">
		<section>
			<div class="head">
				<h3>Lights</h3>
				{#if lights.length > 0}<span class="count mono">{lights.length}</span>{/if}
				<Button variant="ghost" size="icon-sm" title="Add a light" ariaLabel="Add a light" onclick={openAddLight}>
					<Icon name="plus" size={15} />
				</Button>
			</div>
			{#each lights as light (light.id)}
				<div
					class="row"
					class:selected={selectedId === light.id}
					class:hovered={rooms.hovered === light.id}
					role="listitem"
					onpointerenter={() => (rooms.hovered = light.id)}
					onpointerleave={() => (rooms.hovered = null)}>
					<button class="hit" onclick={() => rooms.select({ kind: 'light', id: light.id })}>
						<span class="glyph"><Icon name={glyphOf(light)} size={14} /></span>
						<span class="text">
							<span class="title truncate">{light.name}</span>
							<span class="sub truncate" class:unwired={!light.wiring}>{room ? wiredTo(light, room) : ''}</span>
						</span>
					</button>
					<span class="right">
						<span class="figure mono">{lightLeds(light)}</span>
						<span class="tools">
							<Button
								variant="ghost"
								size="icon-sm"
								title="Pulse it, to find it in the room"
								ariaLabel="Find {light.name}"
								onclick={() => rooms.startTest('identify', [light.id])}>
								<Icon name="bolt" size={13} />
							</Button>
							<Button variant="ghost" size="icon-sm" title="Remove" ariaLabel="Remove {light.name}" onclick={() => removeLight(light)}>
								<Icon name="x" size={13} />
							</Button>
						</span>
					</span>
				</div>
			{:else}
				<div class="empty">
					<p>No lights in this room yet.</p>
					<div class="actions">
						<Button size="sm" variant="secondary" onclick={ondraw}>
							<Icon name="strip" size={14} />
							Draw a strip
						</Button>
						<Button size="sm" variant="ghost" onclick={openAddLight}>More shapes</Button>
					</div>
				</div>
			{/each}
		</section>

		<section>
			<div class="head">
				<h3>Controllers</h3>
				{#if controllers.length > 0}<span class="count mono">{controllers.length}</span>{/if}
				<Button variant="ghost" size="icon-sm" title="Add a controller by hand" ariaLabel="Add a controller" onclick={openAddController}>
					<Icon name="plus" size={15} />
				</Button>
			</div>
			{#each controllers as controller (controller.id)}
				{@const status = statuses.get(controller.id)}
				{@const sent = room ? extentOf(spansOf(room, controller.id)) : 0}
				<div
					class="row"
					class:selected={selectedId === controller.id}
					role="listitem"
					onpointerenter={() => (rooms.hovered = controller.id)}
					onpointerleave={() => (rooms.hovered = null)}>
					<button class="hit" onclick={() => rooms.select({ kind: 'controller', id: controller.id })}>
						<span class="glyph"><StatusDot state={status?.state ?? 'unconfigured'} /></span>
						<span class="text">
							<span class="title truncate">{controller.name}</span>
							<span class="sub truncate">
								{#if controller.host}
									<span class="mono">{controller.host}</span>
									{#if status && status.state !== 'online'}· {STATE_WORDS[status.state]}{/if}
								{:else}
									{CONTROLLER_KINDS[controller.kind].name}, no address yet
								{/if}
							</span>
						</span>
					</button>
					<span class="right">
						<span class="figure mono" title="Pixels this room sends it">{sent || ''}</span>
						<span class="tools">
							<Button
								variant="ghost"
								size="icon-sm"
								title="Remove, keeping its lights in the preview"
								ariaLabel="Remove {controller.name}"
								onclick={() => removeController(controller)}>
								<Icon name="x" size={13} />
							</Button>
						</span>
					</span>
				</div>
			{:else}
				<p class="quiet">Nothing sends to this room's lights yet, so they play in the preview only.</p>
			{/each}
		</section>

		<section class="network">
			<div class="head">
				<h3>On this network</h3>
				<Button
					variant="outline"
					size="sm"
					disabled={rooms.discovery.running}
					title="Listen for WLED, Art-Net and LightningStrike controllers"
					onclick={() => void rooms.discover()}>
					{#if rooms.discovery.running}<Spinner size={12} />{:else}<Icon name="find" size={13} />{/if}
					{rooms.discovery.running ? 'Looking' : rooms.discovery.searched ? 'Look again' : 'Find controllers'}
				</Button>
			</div>
			{#each rooms.discovery.found as found (found.host)}
				{@const here = room ? foundIn(room, found) : undefined}
				<div class="row found">
					<span class="glyph"><Icon name="controller" size={14} /></span>
					<span class="text">
						<span class="title truncate">{found.name}</span>
						<span class="sub truncate">
							{CONTROLLER_KINDS[found.kind].name} · <span class="mono">{found.host}</span>
							{#if found.pixels}· <span class="mono">{found.pixels}</span> px{/if}
						</span>
					</span>
					<span class="right">
						{#if here}
							<button class="link" onclick={() => rooms.select({ kind: 'controller', id: here.id })}>In this room</button>
						{:else}
							<Button variant="secondary" size="sm" onclick={(e) => adopt(e, found)}>
								{room && waitingFor(room, found).length > 0 ? 'Use' : 'Add'}
							</Button>
						{/if}
					</span>
				</div>
			{:else}
				{#if rooms.discovery.searched && !rooms.discovery.running}
					<p class="quiet">
						Nothing answered. WLED and LightningStrike boards answer on their own; add other controllers
						by their address.
						{#if localNetworkHint}
							If you expected one, allow LightningStrike under Local Network in System Settings, Privacy
							and Security.
						{/if}
					</p>
				{:else if !rooms.discovery.running}
					<p class="quiet">Finds WLED, Art-Net and LightningStrike controllers on the networks this machine is on.</p>
				{/if}
			{/each}
		</section>
	</div>

	{#if rooms.failure}
		<p class="failure"><Icon name="alert" size={13} />{rooms.failure}</p>
	{/if}
</aside>

<input class="file" type="file" accept=".json,application/json" bind:this={importer} onchange={onimport} />

<Dialog open={deleting} onclose={() => (deleting = false)} labelledBy="delete-room" width="min(400px, calc(100vw - 32px))">
	<div class="confirm">
		<h2 id="delete-room">Delete {room?.name}?</h2>
		<p>Its lights, controllers and output settings go with it. Export it first to keep a copy.</p>
		<div class="confirm-actions">
			<Button variant="ghost" onclick={() => (deleting = false)}>Cancel</Button>
			<Button
				variant="danger"
				onclick={() => {
					deleting = false;
					if (room) void rooms.remove(room.id);
				}}>Delete room</Button>
		</div>
	</div>
</Dialog>

<style>
	aside {
		width: var(--rail-left);
		flex: none;
		display: flex;
		flex-direction: column;
		min-height: 0;
		background: var(--panel);
		backdrop-filter: var(--panel-blur);
		border-right: 1px solid var(--border);
	}
	header {
		display: flex;
		align-items: center;
		gap: 6px;
		height: 46px;
		flex: none;
		padding: 0 8px 0 8px;
		border-bottom: 1px solid var(--border);
	}
	.switcher {
		display: flex;
		align-items: center;
		gap: 8px;
		flex: 1;
		min-width: 0;
		height: 32px;
		padding: 0 8px;
		border-radius: var(--radius-md);
		font-size: 13.5px;
		font-weight: 600;
		text-align: left;
		color: var(--foreground);
	}
	.switcher:hover {
		background: var(--muted);
	}
	.switcher :global(.lucide-icon) {
		color: var(--subtle-foreground);
	}
	.name {
		flex: 1;
	}

	.scroll {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		padding: 4px 6px 12px;
	}
	section {
		padding: 8px 0 6px;
	}
	section + section {
		border-top: 1px solid var(--border-soft);
	}
	.head {
		display: flex;
		align-items: center;
		gap: 8px;
		height: 32px;
		padding: 0 4px 0 10px;
	}
	h3 {
		font-size: 12.5px;
		font-weight: 600;
		color: var(--muted-foreground);
	}
	.count {
		font-size: 11.5px;
		color: var(--subtle-foreground);
	}
	.head > :global(.btn:last-child) {
		margin-left: auto;
	}

	.row {
		position: relative;
		display: flex;
		align-items: center;
		border-radius: var(--radius-md);
		transition: background-color 0.12s ease;
	}
	.row:hover,
	.row.hovered {
		background: var(--muted);
	}
	.row.selected {
		background: var(--card-raised);
		box-shadow: inset 0 0 0 1px var(--border);
	}
	.row.found {
		gap: 10px;
		padding: 6px 6px 6px 10px;
	}
	.hit {
		display: flex;
		align-items: center;
		gap: 10px;
		flex: 1;
		min-width: 0;
		padding: 7px 8px 7px 10px;
		text-align: left;
	}
	.glyph {
		display: grid;
		place-items: center;
		width: 26px;
		height: 26px;
		flex: none;
		border-radius: var(--radius-sm);
		background: var(--muted);
		color: var(--muted-foreground);
	}
	.row.selected .glyph {
		background: #ffffff14;
		color: var(--foreground);
	}
	.text {
		display: flex;
		flex-direction: column;
		gap: 1px;
		min-width: 0;
	}
	.title {
		font-size: 13px;
		font-weight: 500;
	}
	.sub {
		font-size: 12px;
		color: var(--subtle-foreground);
	}
	.sub .mono {
		font-size: 11.5px;
	}
	.sub.unwired {
		font-style: italic;
	}
	.right {
		display: flex;
		align-items: center;
		gap: 4px;
		padding-right: 6px;
		flex: none;
	}
	.figure {
		font-size: 11.5px;
		color: var(--subtle-foreground);
	}
	.tools {
		display: none;
		gap: 1px;
	}
	.row:hover .tools {
		display: flex;
	}
	.row:hover .figure {
		display: none;
	}

	.empty {
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding: 8px 10px 6px;
		font-size: 13px;
		color: var(--subtle-foreground);
	}
	.actions {
		display: flex;
		gap: 6px;
	}
	.quiet {
		padding: 4px 10px 6px;
		font-size: 12.5px;
		line-height: 1.5;
		color: var(--subtle-foreground);
	}
	.link {
		font-size: 12px;
		color: var(--subtle-foreground);
	}
	.link:hover {
		color: var(--foreground);
	}

	.failure {
		display: flex;
		align-items: flex-start;
		gap: 8px;
		flex: none;
		margin: 0;
		padding: 10px 14px;
		border-top: 1px solid var(--border);
		font-size: 12.5px;
		line-height: 1.45;
		color: var(--bad);
	}
	.failure :global(.lucide-icon) {
		margin-top: 2px;
	}

	.file {
		display: none;
	}
	.confirm {
		display: flex;
		flex-direction: column;
		gap: 12px;
		padding: 20px 22px;
	}
	.confirm h2 {
		font-size: 15px;
		font-weight: 600;
	}
	.confirm p {
		font-size: 13px;
		line-height: 1.6;
		color: var(--muted-foreground);
	}
	.confirm-actions {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
		margin-top: 4px;
	}
</style>
