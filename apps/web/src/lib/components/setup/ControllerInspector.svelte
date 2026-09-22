<script lang="ts">
	import { STATE_WORDS, type ControllerStatus } from '$lib/controllers.ts';
	import { faultsIn, lightsRoom } from '$lib/hardware.ts';
	import { menu } from '$lib/menu.svelte.ts';
	import type { RoomsClient } from '$lib/rooms.svelte.ts';
	import { CONTROLLER_KINDS, type Controller, type ControllerKind } from '$lib/rooms.ts';
	import { wire, withController, withoutController } from '$lib/roomEdit.ts';
	import { extentOf, spansOf } from '$lib/wiring.ts';
	import Button from '$lib/ui/Button.svelte';
	import Icon from '$lib/ui/Icon.svelte';
	import NumberField from '$lib/ui/NumberField.svelte';
	import Select from '$lib/ui/Select.svelte';
	import Spinner from '$lib/ui/Spinner.svelte';
	import PicoBoard from '../PicoBoard.svelte';
	import StatusDot from '../StatusDot.svelte';
	import Group from './Group.svelte';
	import InspectorHead from './InspectorHead.svelte';
	import Row from './Row.svelte';
	import TestBar from './TestBar.svelte';
	import WiringBar from './WiringBar.svelte';

	let {
		rooms,
		controller,
		status = null
	}: {
		rooms: RoomsClient;
		controller: Controller;
		status?: ControllerStatus | null;
	} = $props();

	const room = $derived(rooms.room!);
	const spans = $derived(spansOf(room, controller.id));
	const sent = $derived(extentOf(spans));
	const health = $derived(status?.state ?? 'unconfigured');
	const unwired = $derived(room.layout.lights.filter((l) => l.wiring?.controller !== controller.id));
	const wled = $derived(status?.wled ?? null);
	const identity = $derived(status?.identity ?? null);
	const telemetry = $derived(status?.telemetry ?? null);
	const universal = $derived(controller.kind === 'sacn' || controller.kind === 'artnet');
	const capacity = $derived(wled?.leds ?? (identity?.pixels || null));

	let address = $state('');
	let typing = $state(false);
	$effect(() => {
		if (!typing) address = controller.host;
	});

	function change(next: Controller) {
		rooms.edit((r) => withController(r, next));
	}

	/** What people paste: a URL from the controller's own page, with its scheme and path. */
	function hostFrom(text: string): string {
		return text
			.trim()
			.replace(/^[a-z]+:\/\//i, '')
			.replace(/[/?#].*$/, '')
			.replace(/:\d+$/, '');
	}

	function commitAddress() {
		typing = false;
		const host = hostFrom(address);
		address = host;
		if (host !== controller.host) change({ ...controller, host });
	}

	function setKind(kind: ControllerKind) {
		const { universe: _, ...rest } = controller;
		const universe = kind === 'sacn' ? 1 : kind === 'artnet' ? 0 : undefined;
		change(universe === undefined ? { ...rest, kind } : { ...rest, kind, universe: controller.universe ?? universe });
	}

	function openMenu(e: MouseEvent) {
		menu.show(
			e.currentTarget as HTMLElement,
			() => [
				{
					items: [
						...(controller.kind === 'wled' && status?.address
							? [{ id: 'page', label: 'Open its own page', note: status.address }]
							: []),
						{ id: 'remove', label: 'Remove', note: 'keeps its lights' }
					]
				}
			],
			(_group, id) => {
				menu.close();
				if (id === 'page' && status?.address) window.open(`http://${status.address}`, '_blank', 'noopener');
				else if (id === 'remove') {
					rooms.edit((r) => withoutController(r, controller.id));
					rooms.select(null);
				}
			}
		);
	}

	function openWire(e: MouseEvent) {
		menu.show(
			e.currentTarget as HTMLElement,
			() => [
				{
					items: unwired.map((l) => ({
						id: l.id,
						label: l.name,
						note: l.wiring ? room.controllers.find((c) => c.id === l.wiring!.controller)?.name : 'not wired'
					}))
				}
			],
			(_group, id) => {
				menu.close();
				rooms.edit((r) => wire(r, id, controller.id));
			}
		);
	}

	function uptime(seconds: number): string {
		if (seconds < 60) return `${Math.floor(seconds)} s`;
		const m = Math.floor(seconds / 60);
		if (m < 60) return `${m} min`;
		return `${Math.floor(m / 60)} h ${m % 60} min`;
	}

	const KINDS = (Object.keys(CONTROLLER_KINDS) as ControllerKind[]).map((id) => ({ id, label: CONTROLLER_KINDS[id].name }));
</script>

<InspectorHead name={controller.name} ariaLabel="Controller name" onrename={(name) => change({ ...controller, name })}>
	{#snippet mark()}<StatusDot state={health} size={8} />{/snippet}
	{#snippet actions()}
		<Button variant="ghost" size="icon-sm" ariaLabel="More for this controller" title="More" onclick={openMenu}>
			<Icon name="more" size={16} />
		</Button>
	{/snippet}
</InspectorHead>

<div class="scroll">
	<div class="status" class:warn={health === 'degraded'} class:bad={health === 'offline'}>
		{#if health === 'searching'}<Spinner size={12} />{/if}
		<span class="word">{STATE_WORDS[health]}</span>
		{#if status?.address && status.address !== controller.host}<span class="mono subtle">{status.address}</span>{/if}
		{#if status?.latencyMs != null}<span class="subtle"><span class="mono">{status.latencyMs}</span> ms</span>{/if}
	</div>
	{#each status?.notes ?? [] as note (note)}
		<p class="note"><Icon name="alert" size={13} />{note}</p>
	{/each}

	<Group title="Connection">
		<Row label="Kind" note={CONTROLLER_KINDS[controller.kind].blurb}>
			<Select value={controller.kind} options={KINDS} ariaLabel="What kind of controller it is" onpick={setKind} />
		</Row>
		<Row label="Address">
			<input
				class="address"
				type="text"
				spellcheck="false"
				autocomplete="off"
				placeholder="192.168.1.40 or wled.local"
				aria-label="Its address or network name"
				bind:value={address}
				oninput={() => (typing = true)}
				onblur={commitAddress}
				onkeydown={(e) => {
					e.stopPropagation();
					if (e.key === 'Enter') e.currentTarget.blur();
					else if (e.key === 'Escape') {
						typing = false;
						address = controller.host;
						e.currentTarget.blur();
					}
				}} />
		</Row>
		{#if universal}
			<Row label="Universe" note="The first pixel goes out on this one, 170 pixels to each after it.">
				<NumberField
					value={controller.universe ?? (controller.kind === 'sacn' ? 1 : 0)}
					min={controller.kind === 'sacn' ? 1 : 0}
					max={controller.kind === 'sacn' ? 63999 : 32767}
					ariaLabel="First universe"
					oncommit={(universe) => change({ ...controller, universe })} />
			</Row>
		{/if}
	</Group>

	<Group title="Pixels">
		{#snippet action()}
			{#if unwired.length > 0}
				<Button variant="ghost" size="sm" onclick={openWire}>
					<Icon name="plus" size={13} />
					Wire a light
				</Button>
			{/if}
		{/snippet}
		{#if spans.length > 0}
			<WiringBar
				{spans}
				{capacity}
				capacityLabel={capacity ? `it drives ${capacity}` : ''}
				selected={null}
				onselect={(id) => rooms.select({ kind: 'light', id })} />
			<ul class="spans">
				{#each spans as span (span.light.id)}
					<li>
						<button onclick={() => rooms.select({ kind: 'light', id: span.light.id })}>
							<span class="truncate">{span.light.name}</span>
							<span class="mono">{span.count === 1 ? span.from : `${span.from} to ${span.from + span.count - 1}`}</span>
						</button>
					</li>
				{/each}
			</ul>
			<TestBar {rooms} lights={spans.map((s) => s.light.id)} />
		{:else}
			<p class="quiet">No lights are wired to it yet, so it is sent nothing.</p>
		{/if}
	</Group>

	{#if wled}
		<Group title="WLED">
			<dl>
				<dt>Name</dt>
				<dd>{wled.name}</dd>
				<dt>Version</dt>
				<dd><span class="mono">{wled.version}</span></dd>
				<dt>LEDs</dt>
				<dd><span class="mono">{wled.leds}</span>{wled.white ? ', with white' : ''}</dd>
				{#if wled.matrix}
					<dt>Panel</dt>
					<dd><span class="mono">{wled.matrix.width}</span> × <span class="mono">{wled.matrix.height}</span></dd>
				{/if}
				<dt>Showing</dt>
				<dd>{wled.live ? 'Frames from the network' : 'Its own effects'}</dd>
				{#if wled.signal > 0}
					<dt>Wi-Fi</dt>
					<dd><span class="mono">{wled.signal}</span>%</dd>
				{/if}
				{#if wled.milliamps > 0}
					<dt>Current</dt>
					<dd>
						<span class="mono">{wled.milliamps}</span> mA{#if wled.budget > 0}&nbsp;of <span class="mono">{wled.budget}</span>{/if}
					</dd>
				{/if}
			</dl>
		</Group>
	{:else if identity}
		<Group title="Board">
			<div class="device">
				{#if !identity.leds.includes('lamp')}<PicoBoard state={health} width={132} />{/if}
				<dl>
					<dt>Firmware</dt>
					<dd><span class="mono">{identity.firmware}</span></dd>
					<dt>Built for</dt>
					<dd><span class="mono">{identity.pixels}</span> pixels</dd>
					<dt>Output</dt>
					<dd>{lightsRoom(identity) ? identity.leds : 'Lights nothing'}</dd>
					<dt>Awake</dt>
					<dd>{uptime(identity.uptimeS)}</dd>
				</dl>
			</div>
			{#if telemetry}
				<div class="figures">
					<div><span class="value mono">{telemetry.fps.toFixed(1)}</span><span class="unit">fps</span></div>
					<div><span class="value mono">{telemetry.packetsPerSecond}</span><span class="unit">packets/s</span></div>
					<div>
						<span class="value mono" class:bad={telemetry.torn > 0}>{telemetry.torn}</span><span class="unit">torn</span>
					</div>
				</div>
				<dl>
					<dt>Frame gap</dt>
					<dd><span class="mono">{telemetry.gapMinMs.toFixed(1)}</span> to <span class="mono">{telemetry.gapMaxMs.toFixed(1)}</span> ms</dd>
					<dt>Late</dt>
					<dd><span class="mono">{telemetry.late.join(' / ')}</span> <span class="subtle">past 20 / 50 / 100 ms</span></dd>
					<dt>Rejected</dt>
					<dd><span class="mono">{telemetry.bad}</span> bad, <span class="mono">{telemetry.outOfRange}</span> out of range</dd>
				</dl>
				{#if faultsIn(telemetry).length > 0}
					<p class="note"><Icon name="alert" size={13} />{faultsIn(telemetry).join(', ')} in the last second.</p>
				{/if}
			{/if}
		</Group>
	{:else if controller.host && controller.kind !== 'wled' && controller.kind !== 'lightningstrike'}
		<Group title="Device">
			<p class="quiet">
				{CONTROLLER_KINDS[controller.kind].name} receivers do not report back, so all the app can say is that
				{sent > 0 ? `${sent} pixels go out` : 'nothing goes out yet'}. Walk and Colours show whether they land.
			</p>
		</Group>
	{/if}
</div>

<style>
	.scroll {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
	}
	.status {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 12px 16px 0;
		font-size: 13px;
		color: var(--muted-foreground);
	}
	.status .word {
		font-weight: 500;
		color: var(--foreground);
	}
	.status.warn .word {
		color: var(--warn);
	}
	.status.bad .word {
		color: var(--bad);
	}
	.note {
		display: flex;
		align-items: flex-start;
		gap: 8px;
		margin: 10px 16px 0;
		padding: 8px 10px;
		border-radius: var(--radius-md);
		background: #fbbf2414;
		font-size: 12.5px;
		line-height: 1.45;
		color: var(--warn);
	}
	.note :global(.lucide-icon) {
		margin-top: 2px;
		flex: none;
	}
	.address {
		width: 100%;
		min-width: 0;
		height: var(--h-sm);
		padding: 0 9px;
		background: var(--card-raised);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		color: var(--foreground);
		font-family: var(--mono);
		font-size: 12.5px;
	}
	.address::placeholder {
		font-family: var(--sans);
		color: var(--subtle-foreground);
	}
	.address:hover {
		border-color: #33333c;
	}
	.address:focus {
		outline: none;
		border-color: var(--ring);
		background: var(--popover);
	}
	.spans {
		list-style: none;
		margin: 0 -8px;
		padding: 0;
	}
	.spans button {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 12px;
		width: 100%;
		padding: 5px 8px;
		border-radius: var(--radius-sm);
		font-size: 13px;
		text-align: left;
		color: var(--muted-foreground);
	}
	.spans button:hover {
		background: var(--muted);
		color: var(--foreground);
	}
	.spans .mono {
		flex: none;
		color: var(--subtle-foreground);
	}
	.quiet {
		font-size: 12.5px;
		line-height: 1.5;
		color: var(--subtle-foreground);
	}
	.device {
		display: flex;
		align-items: center;
		gap: 16px;
	}
	dl {
		display: grid;
		grid-template-columns: auto 1fr;
		gap: 6px 14px;
		margin: 0;
		font-size: 13px;
		flex: 1;
	}
	dt {
		color: var(--subtle-foreground);
	}
	dd {
		margin: 0;
		color: var(--muted-foreground);
		min-width: 0;
	}
	.figures {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 8px;
	}
	.figures > div {
		display: flex;
		flex-direction: column;
		gap: 2px;
		padding: 10px 12px;
		border-radius: var(--radius-md);
		background: var(--card-raised);
		border: 1px solid var(--border-soft);
	}
	.value {
		font-size: 19px;
		font-weight: 600;
		letter-spacing: -0.02em;
		line-height: 1.1;
	}
	.value.bad {
		color: var(--bad);
	}
	.unit {
		font-size: 11.5px;
		color: var(--muted-foreground);
	}
</style>
