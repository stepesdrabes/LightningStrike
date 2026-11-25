<script lang="ts">
	import {
		MAX_RUN,
		ledCount,
		type Corner,
		type LampLight,
		type Light,
		type LightPart,
		type LightRole,
		type MatrixLight,
		type Mount,
		type PathLight,
		type RingLight
	} from '@mv/core';
	import { OUTPUT_BRIGHTNESS_MIN } from '$lib/hardware.ts';
	import { menu } from '$lib/menu.svelte.ts';
	import type { RoomsClient } from '$lib/rooms.svelte.ts';
	import {
		keepInside,
		nextFreePixel,
		refit,
		remount,
		round,
		runLength,
		setClosed,
		wire,
		withCopy,
		withLight,
		withoutLight
	} from '$lib/roomEdit.ts';
	import { pixelsOf, wiringProblems } from '$lib/wiring.ts';
	import Button from '$lib/ui/Button.svelte';
	import Icon from '$lib/ui/Icon.svelte';
	import NumberField from '$lib/ui/NumberField.svelte';
	import Segmented from '$lib/ui/Segmented.svelte';
	import Select from '$lib/ui/Select.svelte';
	import Slider from '$lib/ui/Slider.svelte';
	import Switch from '$lib/ui/Switch.svelte';
	import Group from './Group.svelte';
	import InspectorHead from './InspectorHead.svelte';
	import Row from './Row.svelte';
	import TestBar from './TestBar.svelte';
	import { glyphOf, metres, MOUNTS, PARTS } from './labels.ts';

	let {
		rooms,
		light,
		part = null
	}: {
		rooms: RoomsClient;
		light: Light;
		/** What `auto` came to in the preview's room, once it has caught up. */
		part?: LightPart | null;
	} = $props();

	const room = $derived(rooms.room!);
	const layout = $derived(room.layout);

	function change(next: Light, gesture?: string) {
		rooms.edit((r) => withLight(r, next), gesture);
	}

	/** Moves keep the light inside the room, as dragging it does. */
	function reshape(next: Light) {
		change(keepInside(next, layout.width, layout.depth, layout.height));
	}

	function openMenu(e: MouseEvent) {
		menu.show(
			e.currentTarget as HTMLElement,
			() => [{ items: [{ id: 'duplicate', label: 'Duplicate', note: '⌘D' }, { id: 'remove', label: 'Remove', note: 'Delete' }] }],
			(_group, id) => {
				menu.close();
				if (id === 'duplicate') {
					const copy = withCopy(room, light.id);
					if (!copy) return;
					rooms.edit(() => copy.room);
					rooms.select({ kind: 'light', id: copy.id });
				} else {
					rooms.edit((r) => withoutLight(r, light.id));
					rooms.select(null);
				}
			}
		);
	}

	// Heights. A flat light has one; one that climbs a wall has many and is moved on the plan.
	const heights = $derived.by((): number[] => {
		switch (light.kind) {
			case 'path':
				return light.points.map((p) => p[2]);
			case 'ring':
			case 'matrix':
				return [light.centre[2]];
			case 'lamp':
				return [light.at[2]];
		}
	});
	const flat = $derived(heights.every((z) => Math.abs(z - heights[0]) < 0.0005));

	function setHeight(z: number) {
		const to = round(z);
		switch (light.kind) {
			case 'path':
				return reshape({ ...light, points: light.points.map((p) => [p[0], p[1], to] as const) });
			case 'ring':
			case 'matrix':
				return reshape({ ...light, centre: [light.centre[0], light.centre[1], to] });
			case 'lamp':
				return reshape({ ...light, at: [light.at[0], light.at[1], to] });
		}
	}

	function setCount(path: PathLight, run: number, count: number) {
		change({ ...path, counts: path.counts.map((c, i) => (i === run ? count : c)) });
	}

	const CORNERS: { id: Corner; label: string }[] = [
		{ id: 'top-left', label: 'Top left' },
		{ id: 'top-right', label: 'Top right' },
		{ id: 'bottom-left', label: 'Bottom left' },
		{ id: 'bottom-right', label: 'Bottom right' }
	];

	const effective = $derived<LightPart | null>(
		light.kind === 'lamp' ? null : light.role === 'auto' ? part : light.role
	);
	const roles = $derived(
		(['auto', 'ring', 'spine', 'field'] as LightRole[]).map((id) => ({
			id,
			label: id === 'auto' ? (part ? `Auto, ${PARTS[part].label.toLowerCase()}` : 'Auto') : PARTS[id].label
		}))
	);

	const controllerOptions = $derived([
		{ id: '', label: 'Not wired' },
		...room.controllers.map((c) => ({ id: c.id, label: c.name }))
	]);
	const pixels = $derived(pixelsOf(light));
	const clash = $derived(wiringProblems(room).filter((p) => p.includes(`"${light.name}"`)));
	const summary = $derived(light.kind === 'lamp' && light.mode === 'summary');

	function setStart(start: number) {
		if (!light.wiring) return;
		change({ ...light, wiring: { ...light.wiring, start } });
	}

	function setReversed(reversed: boolean) {
		if (!light.wiring) return;
		const { reversed: _, ...rest } = light.wiring;
		change({ ...light, wiring: reversed ? { ...rest, reversed: true } : rest });
	}

	function setLevel(level: number, gesture?: string) {
		const { level: _, ...rest } = light;
		change(level >= 0.995 ? (rest as Light) : ({ ...light, level: round(level) } as Light), gesture);
	}
</script>

<InspectorHead name={light.name} ariaLabel="Light name" onrename={(name) => change({ ...light, name })}>
	{#snippet mark()}<Icon name={glyphOf(light)} size={15} />{/snippet}
	{#snippet actions()}
		<Button variant="ghost" size="icon-sm" ariaLabel="More for this light" title="Duplicate or remove" onclick={openMenu}>
			<Icon name="more" size={16} />
		</Button>
	{/snippet}
</InspectorHead>

<div class="scroll">
	<Group title="Test">
		<TestBar {rooms} lights={[light.id]} />
	</Group>

	<Group title={light.kind === 'lamp' ? 'Lamp' : 'Shape'}>
		{#if light.kind === 'path'}
			{@const path = light as PathLight}
			<div class="runs">
				{#each path.counts as count, r (r)}
					<div class="run">
						<span class="index">Run {r + 1}</span>
						<NumberField
							value={count}
							min={1}
							max={MAX_RUN}
							unit="LEDs"
							ariaLabel="LEDs on run {r + 1}"
							oncommit={(v) => setCount(path, r, v)} />
						<span class="length mono">{metres(runLength(path, r))}</span>
					</div>
				{/each}
			</div>
			<Row label="Density" note="Moving a point gives its runs the LEDs their new length holds.">
				<NumberField
					value={path.density}
					min={1}
					max={1000}
					unit="LEDs/m"
					ariaLabel="LEDs per metre"
					oncommit={(density) => change(refit({ ...path, density }))} />
			</Row>
			<Row label="Loop">
				<Switch
					checked={path.closed}
					ariaLabel="The strip runs back to where it starts"
					onchange={(closed) => change(setClosed(path, closed))} />
				<span class="aside">{path.closed ? 'Runs back to its start' : path.points.length < 3 ? 'Needs three points' : 'Open ends'}</span>
			</Row>
		{:else if light.kind === 'ring'}
			{@const ring = light as RingLight}
			<Row label="Radius">
				<NumberField value={ring.radius} min={0.01} max={50} step={0.01} digits={2} unit="m" ariaLabel="Radius" oncommit={(radius) => reshape({ ...ring, radius })} />
			</Row>
			<Row label="LEDs">
				<NumberField value={ring.count} min={1} max={MAX_RUN} ariaLabel="LEDs round the ring" oncommit={(count) => change({ ...ring, count })} />
			</Row>
			<Row label="First LED" note="Degrees clockwise from north on the plan, or from the top on a wall.">
				<NumberField value={ring.startAngle} min={0} max={359} unit="°" ariaLabel="Where the first LED sits" oncommit={(startAngle) => change({ ...ring, startAngle })} />
			</Row>
			<Row label="Direction">
				<Segmented
					options={[
						{ id: 'cw', label: 'Clockwise' },
						{ id: 'ccw', label: 'Anticlockwise' }
					]}
					value={ring.clockwise ? 'cw' : 'ccw'}
					ariaLabel="Which way the LEDs run"
					onpick={(id) => change({ ...ring, clockwise: id === 'cw' })} />
			</Row>
		{:else if light.kind === 'matrix'}
			{@const panel = light as MatrixLight}
			<Row label="Size">
				<NumberField value={panel.width} min={0} max={50} step={0.01} digits={2} unit="m" ariaLabel="Width" oncommit={(width) => reshape({ ...panel, width })} />
				<span class="by">×</span>
				<NumberField value={panel.height} min={0} max={50} step={0.01} digits={2} unit="m" ariaLabel="Height" oncommit={(height) => reshape({ ...panel, height })} />
			</Row>
			<Row label="LEDs">
				<NumberField value={panel.columns} min={1} max={256} ariaLabel="Columns" oncommit={(columns) => change({ ...panel, columns })} />
				<span class="by">×</span>
				<NumberField value={panel.rows} min={1} max={256} ariaLabel="Rows" oncommit={(rows) => change({ ...panel, rows })} />
			</Row>
			<Row
				label="Data enters"
				note={panel.mount === 'ceiling' || panel.mount === 'floor' ? 'As seen on the plan, north at the top.' : 'As seen from inside the room.'}>
				<div class="corners" role="radiogroup" aria-label="The corner the data enters at">
					{#each CORNERS as corner (corner.id)}
						<button
							class:on={panel.first === corner.id}
							role="radio"
							aria-checked={panel.first === corner.id}
							title={corner.label}
							aria-label={corner.label}
							onclick={() => change({ ...panel, first: corner.id })}></button>
					{/each}
				</div>
				<span class="aside">{CORNERS.find((c) => c.id === panel.first)?.label}</span>
			</Row>
			<Row label="Lines run">
				<Segmented
					options={[
						{ id: 'rows', label: 'Across' },
						{ id: 'columns', label: 'Down' }
					]}
					value={panel.horizontal ? 'rows' : 'columns'}
					ariaLabel="Which way each line of LEDs runs"
					onpick={(id) => change({ ...panel, horizontal: id === 'rows' })} />
			</Row>
			<Row label="Zigzag">
				<Switch checked={panel.serpentine} ariaLabel="Every other line runs back" onchange={(serpentine) => change({ ...panel, serpentine })} />
				<span class="aside">{panel.serpentine ? 'Every other line runs back' : 'Every line starts at the same side'}</span>
			</Row>
		{:else}
			{@const lamp = light as LampLight}
			<Row label="Glows with" note={lamp.mode === 'summary' ? 'The whole show, reduced to one colour, as the Bounce Lamp does.' : 'One pixel of the show, where it stands.'}>
				<Segmented
					options={[
						{ id: 'summary', label: 'The room' },
						{ id: 'pixel', label: 'Its own pixel' }
					]}
					value={lamp.mode}
					ariaLabel="What the lamp shows"
					onpick={(mode) => change({ ...lamp, mode })} />
			</Row>
			<Row label="Size">
				<NumberField value={lamp.height} min={0} max={10} step={0.05} digits={2} unit="m tall" ariaLabel="Height of the glow" oncommit={(height) => change({ ...lamp, height })} />
				<NumberField value={lamp.diameter} min={0.01} max={5} step={0.005} digits={3} unit="m wide" ariaLabel="Width of the glow" oncommit={(diameter) => change({ ...lamp, diameter })} />
			</Row>
		{/if}

		{#if light.kind !== 'lamp'}
			<Row label="Mounted on">
				<Select
					value={light.mount}
					options={MOUNTS}
					ariaLabel="Where the light is fixed"
					onpick={(mount: Mount) => change(remount(light, mount, layout))} />
			</Row>
		{/if}
		<Row label={light.kind === 'lamp' ? 'Stands at' : 'Height'}>
			{#if flat}
				<NumberField value={heights[0]} min={0} max={layout.height} step={0.05} digits={2} unit="m" ariaLabel="Height above the floor" oncommit={setHeight} />
			{:else}
				<span class="aside">From <span class="mono">{metres(Math.min(...heights))}</span> to <span class="mono">{metres(Math.max(...heights))}</span>; move its points on a wall</span>
			{/if}
		</Row>
	</Group>

	<Group title="In the show">
		{#if light.kind !== 'lamp'}
			<Row label="Part" note={effective ? PARTS[effective].note : undefined}>
				<Select value={light.role} options={roles} ariaLabel="What the light is to the show" onpick={(role) => change({ ...light, role })} />
			</Row>
		{/if}
		<Row label="Level">
			<Slider
				value={light.level ?? 1}
				min={OUTPUT_BRIGHTNESS_MIN}
				max={1}
				step={0.01}
				ariaLabel="How bright this light is against the rest"
				oninput={(v) => setLevel(v, `level-${light.id}`)}
				onchange={() => rooms.settle()} />
			<span class="figure mono">{Math.round((light.level ?? 1) * 100)}%</span>
		</Row>
	</Group>

	<Group title="Wiring">
		<Row label="Controller">
			<Select
				value={light.wiring?.controller ?? ''}
				options={controllerOptions}
				ariaLabel="The controller that drives it"
				onpick={(id) => rooms.edit((r) => wire(r, light.id, id || null))} />
		</Row>
		{#if light.wiring}
			{@const wiring = light.wiring}
			<Row label={pixels === 1 ? 'Pixel' : 'First pixel'} note={pixels === 1 ? undefined : `Pixels ${wiring.start} to ${wiring.start + pixels - 1} of the controller.`}>
				<NumberField value={wiring.start} min={0} max={65535} ariaLabel="The controller pixel its first LED is" oncommit={setStart} />
				{#if clash.length > 0}
					<Button variant="outline" size="sm" onclick={() => setStart(nextFreePixel(room, wiring.controller, light.id))}>After the others</Button>
				{/if}
			</Row>
			{#if !summary && ledCount(light) > 1}
				<Row label="Data enters" note="The dot on the plan marks where; Walk shows it on the light.">
					<Segmented
						options={[
							{ id: 'start', label: 'At the start' },
							{ id: 'end', label: 'At the end' }
						]}
						value={wiring.reversed ? 'end' : 'start'}
						ariaLabel="Which end the data enters at"
						onpick={(id) => setReversed(id === 'end')} />
				</Row>
			{/if}
			{#each clash as problem (problem)}
				<p class="warn"><Icon name="alert" size={13} />{problem}</p>
			{/each}
		{:else if room.controllers.length === 0}
			<p class="quiet">It plays in the preview. Add a controller to light it for real.</p>
		{/if}
	</Group>
</div>

<style>
	.scroll {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
	}
	.runs {
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.run {
		display: grid;
		grid-template-columns: 104px 1fr 62px;
		align-items: center;
		column-gap: 12px;
		font-size: 13px;
	}
	.index {
		color: var(--muted-foreground);
	}
	.length {
		text-align: right;
		color: var(--subtle-foreground);
	}
	.by {
		flex: none;
		color: var(--subtle-foreground);
	}
	.aside {
		font-size: 12.5px;
		color: var(--subtle-foreground);
		min-width: 0;
	}
	.figure {
		width: 40px;
		flex: none;
		text-align: right;
		color: var(--subtle-foreground);
	}
	.corners {
		display: grid;
		grid-template-columns: repeat(2, 12px);
		gap: 3px;
		flex: none;
		padding: 5px;
		border-radius: var(--radius-sm);
		background: var(--muted);
	}
	.corners button {
		width: 12px;
		height: 12px;
		border-radius: 3px;
		background: #3f3f47;
	}
	.corners button:hover {
		background: #71717a;
	}
	.corners button.on {
		background: var(--foreground);
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
	.quiet {
		font-size: 12.5px;
		line-height: 1.5;
		color: var(--subtle-foreground);
	}
</style>
