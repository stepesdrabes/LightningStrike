<script lang="ts">
	import { ledCount, type Wall } from '@mv/core';
	import { roomState, STATE_WORDS } from '$lib/controllers.ts';
	import {
		CONTRAST_MAX,
		CONTRAST_MIN,
		OFFSET_MAX_MS,
		OFFSET_MIN_MS,
		OUTPUT_BRIGHTNESS_MIN,
		OUTPUT_FPS_CHOICES
	} from '$lib/hardware.ts';
	import type { RoomsClient } from '$lib/rooms.svelte.ts';
	import type { Room, RoomOutput } from '$lib/rooms.ts';
	import { freshName, keepInside } from '$lib/roomEdit.ts';
	import Button from '$lib/ui/Button.svelte';
	import Icon from '$lib/ui/Icon.svelte';
	import NumberField from '$lib/ui/NumberField.svelte';
	import Segmented from '$lib/ui/Segmented.svelte';
	import Slider from '$lib/ui/Slider.svelte';
	import Spinner from '$lib/ui/Spinner.svelte';
	import Switch from '$lib/ui/Switch.svelte';
	import StatusDot from '../StatusDot.svelte';
	import Group from './Group.svelte';
	import InspectorHead from './InspectorHead.svelte';
	import Row from './Row.svelte';
	import TestBar from './TestBar.svelte';

	let { rooms }: { rooms: RoomsClient } = $props();

	const room = $derived(rooms.room!);
	const layout = $derived(room.layout);
	const output = $derived(room.output);
	const running = $derived(rooms.output.running);
	const health = $derived(roomState(rooms.output.controllers, running));
	const addressed = $derived(room.controllers.filter((c) => c.host).length);
	const leds = $derived(layout.lights.reduce((n, l) => n + ledCount(l), 0));
	/** Lights that play in the preview only, which is how the app first shows the Frame. */
	const previewOnly = $derived(
		room.controllers.length === 0 && layout.lights.length > 0 && layout.lights.every((l) => !l.wiring)
	);

	function startOwn() {
		void rooms.create(freshName('My room', rooms.rooms.map((r) => r.name)));
	}

	function setOutput(patch: Partial<RoomOutput>, gesture?: string) {
		rooms.edit((r) => ({ ...r, output: { ...r.output, ...patch } }), gesture);
	}

	/** A smaller room keeps its lights inside it. */
	function setSize(patch: Partial<Pick<Room['layout'], 'width' | 'depth' | 'height'>>) {
		rooms.edit((r) => {
			const next = { ...r.layout, ...patch };
			const lights = next.lights.map((l) => keepInside(l, next.width, next.depth, next.height));
			return { ...r, layout: { ...next, lights } };
		});
	}

	const FRONTS: { id: Wall; label: string }[] = [
		{ id: 'north', label: 'North' },
		{ id: 'east', label: 'East' },
		{ id: 'south', label: 'South' },
		{ id: 'west', label: 'West' }
	];
	const RATES = OUTPUT_FPS_CHOICES.map((f) => ({ id: String(f), label: String(f) }));
</script>

<InspectorHead name={room.name} ariaLabel="Room name" onrename={(name) => rooms.edit((r) => ({ ...r, name }))}>
	{#snippet mark()}<Icon name="room" size={15} />{/snippet}
</InspectorHead>

<div class="scroll">
	{#if previewOnly}
		<section class="own">
			<p class="title">Setting up your own lights?</p>
			<p>
				This room plays in the preview only. Start an empty room for your lights, so the show is
				shaped round them; this one stays in the list.
			</p>
			<Button variant="primary" onclick={startOwn}>
				<Icon name="plus" size={14} />
				Start my room
			</Button>
		</section>
	{/if}

	<section class="live" class:lit={running}>
		<div class="state">
			<StatusDot state={health} size={8} />
			<span class="word">{running ? 'Lit' : 'Not lit'}</span>
			{#if addressed > 0}
				<span class="subtle">
					<span class="mono">{addressed}</span>
					{addressed === 1 ? 'controller' : 'controllers'}, {STATE_WORDS[health].toLowerCase()}
				</span>
			{/if}
		</div>
		{#if rooms.switching}
			<Button variant="secondary" disabled>
				<Spinner size={13} accent={rooms.switching === 'on'} />
				{rooms.switching === 'on' ? 'Lighting the room' : 'Stopping'}
			</Button>
		{:else if running}
			<Button variant="secondary" onclick={() => void rooms.stop()}>
				<Icon name="power" size={14} />
				Stop the lights
			</Button>
		{:else}
			<Button variant="primary" disabled={addressed === 0} onclick={() => void rooms.start()}>
				<Icon name="power" size={14} />
				Light the room
			</Button>
		{/if}
		{#if addressed === 0}
			<p class="quiet">
				Give a controller an address, or find one on the network, and the room lights up with the show.
			</p>
		{/if}
		<label class="launch">
			<Switch
				checked={output.autoStart}
				ariaLabel="Light up when the app opens"
				onchange={(autoStart) => setOutput({ autoStart })} />
			<span>Light up when the app opens</span>
		</label>
	</section>

	<Group title="Output">
		<Row label="Level">
			<Slider
				value={output.level}
				min={OUTPUT_BRIGHTNESS_MIN}
				max={1}
				step={0.01}
				ariaLabel="How much of full output the room gets"
				oninput={(level) => setOutput({ level }, 'output-level')}
				onchange={() => rooms.settle()} />
			<span class="figure mono">{Math.round(output.level * 100)}%</span>
		</Row>
		<Row label="Punch" note="Higher sinks the mids, so a hit has more to stand out from.">
			<Slider
				value={output.punch}
				min={CONTRAST_MIN}
				max={CONTRAST_MAX}
				step={0.05}
				ariaLabel="How far the mids sit under the hits"
				oninput={(punch) => setOutput({ punch }, 'output-punch')}
				onchange={() => rooms.settle()} />
			<span class="figure mono">{output.punch.toFixed(2)}</span>
		</Row>
		<Row label="Lead" note="Runs the lights ahead of the sound, to cover the network and the controllers.">
			<Slider
				value={output.leadMs}
				min={OFFSET_MIN_MS}
				max={OFFSET_MAX_MS}
				step={5}
				ariaLabel="How far ahead of the sound the lights run"
				oninput={(leadMs) => setOutput({ leadMs }, 'output-lead')}
				onchange={() => rooms.settle()} />
			<span class="figure mono">{output.leadMs > 0 ? '+' : ''}{output.leadMs} ms</span>
		</Row>
		<Row
			label="Frame rate"
			note={output.fps > 60
				? 'At this rate one data line drives about 270 LEDs.'
				: output.fps < 60
					? 'Below the rate the shows were judged at.'
					: undefined}>
			<Segmented options={RATES} value={String(output.fps)} ariaLabel="Frames a second on the wire" onpick={(id) => setOutput({ fps: Number(id) })} />
		</Row>
	</Group>

	<Group title="Room">
		<Row label="Size">
			<div class="size">
				<NumberField value={layout.width} min={0.5} max={100} step={0.1} digits={2} unit="m" ariaLabel="Width, west to east" oncommit={(width) => setSize({ width })} />
				<NumberField value={layout.depth} min={0.5} max={100} step={0.1} digits={2} unit="m" ariaLabel="Depth, south to north" oncommit={(depth) => setSize({ depth })} />
				<NumberField value={layout.height} min={0.5} max={20} step={0.1} digits={2} unit="m" ariaLabel="Height to the ceiling" oncommit={(height) => setSize({ height })} />
			</div>
		</Row>
		<p class="legend"><span>Wide</span><span>Deep</span><span>High</span></p>
		<Row label="Front" note="The wall the show faces: where the speakers or the DJ are.">
			<Segmented options={FRONTS} value={layout.front} ariaLabel="The wall the room faces" onpick={(front) => rooms.edit((r) => ({ ...r, layout: { ...r.layout, front } }))} />
		</Row>
	</Group>

	{#if layout.lights.length > 0}
		<Group title="Test every light">
			<TestBar {rooms} lights={layout.lights.map((l) => l.id)} />
		</Group>
	{/if}

	{#if rooms.problems.length > 0}
		<Group title="Needs attention">
			{#each rooms.problems as problem (problem)}
				<p class="warn"><Icon name="alert" size={13} />{problem}</p>
			{/each}
		</Group>
	{/if}
</div>

<footer>
	<span><span class="mono">{layout.lights.length}</span> {layout.lights.length === 1 ? 'light' : 'lights'}</span>
	<span><span class="mono">{leds}</span> LEDs</span>
	<span><span class="mono">{room.controllers.length}</span> {room.controllers.length === 1 ? 'controller' : 'controllers'}</span>
</footer>

<style>
	.scroll {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
	}
	.own {
		display: flex;
		flex-direction: column;
		gap: 8px;
		margin: 12px 12px 0;
		padding: 14px;
		border-radius: var(--radius-md);
		background: var(--card-raised);
		border: 1px solid var(--border);
		font-size: 12.5px;
		line-height: 1.5;
		color: var(--muted-foreground);
	}
	.own .title {
		font-size: 13px;
		font-weight: 600;
		color: var(--foreground);
	}
	.own > :global(.btn) {
		align-self: flex-start;
		margin-top: 4px;
	}
	.live {
		display: flex;
		flex-direction: column;
		gap: 12px;
		padding: 14px 16px 16px;
		border-bottom: 1px solid var(--border-soft);
		transition: background-color 0.25s ease;
	}
	.live.lit {
		background: color-mix(in srgb, var(--live) 7%, transparent);
	}
	.state {
		display: flex;
		align-items: center;
		gap: 8px;
		font-size: 13px;
		color: var(--muted-foreground);
	}
	.word {
		font-weight: 600;
		color: var(--foreground);
	}
	.live > :global(.btn) {
		width: 100%;
	}
	.launch {
		display: flex;
		align-items: center;
		gap: 10px;
		font-size: 13px;
		color: var(--muted-foreground);
		cursor: pointer;
	}
	.figure {
		width: 52px;
		flex: none;
		text-align: right;
		color: var(--subtle-foreground);
	}
	.size {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 6px;
		width: 100%;
	}
	.legend {
		display: grid;
		grid-template-columns: repeat(3, 1fr);
		gap: 6px;
		margin: -4px 0 2px 116px;
		font-size: 11.5px;
		color: var(--subtle-foreground);
	}
	.legend span {
		padding-left: 10px;
	}
	.quiet {
		font-size: 12.5px;
		line-height: 1.5;
		color: var(--subtle-foreground);
	}
	.warn {
		display: flex;
		align-items: flex-start;
		gap: 8px;
		padding: 8px 10px;
		border-radius: var(--radius-md);
		background: #fbbf2414;
		font-size: 12.5px;
		line-height: 1.45;
		color: var(--warn);
	}
	.warn :global(.lucide-icon) {
		margin-top: 2px;
		flex: none;
	}
	footer {
		display: flex;
		gap: 14px;
		flex: none;
		padding: 10px 16px;
		border-top: 1px solid var(--border);
		font-size: 12px;
		color: var(--subtle-foreground);
	}
</style>
