<script lang="ts">
	import { RoomRenderer, type CameraView } from '@mv/preview3d';
	import type { Readout, Viz } from '$lib/viz.svelte.ts';
	import type { LoadState, Step } from '$lib/types.ts';
	import Activity from './Activity.svelte';
	import Icon from '$lib/ui/Icon.svelte';
	import Segmented from '$lib/ui/Segmented.svelte';
	import Spinner from '$lib/ui/Spinner.svelte';

	let {
		viz,
		readout,
		load,
		steps,
		hasShow,
		queued = 0,
		lounge = false,
		onlounge
	}: {
		viz: Viz | null;
		readout: Readout;
		load: LoadState;
		steps: Step[];
		hasShow: boolean;
		queued?: number;
		lounge?: boolean;
		onlounge: () => void;
	} = $props();

	/** Limit bloom so bright cues glow without hiding the difference between strips and halos. */
	const MAX_BLOOM = 3.2;

	let renderer: RoomRenderer | null = $state(null);
	let view = $state<CameraView>('orbit');

	let layer: HTMLDivElement | undefined = $state();
	let column: HTMLDivElement | undefined = $state();

	// Attach to the canvas so control updates cannot rebuild its WebGL context.
	function mount(canvas: HTMLCanvasElement) {
		const v = viz;
		if (!v) return;
		const r = new RoomRenderer(canvas, v.geometry, { spec: v.spec });

		r.bloomIntensity = MAX_BLOOM;
		renderer = r;
		v.roomRenderer = r;

		return () => {
			v.roomRenderer = null;
			renderer = null;
			r.dispose();
		};
	}

	/**
	 * Watch both canvas and open column: rail/drawer changes require reframing without a window
	 * resize.
	 */
	$effect(() => {
		const r = renderer;
		const canvas = layer;
		const frame = column;
		if (!r || !canvas || !frame) return;

		const apply = () => {
			const c = canvas.getBoundingClientRect();
			const f = frame.getBoundingClientRect();
			r.resize(c.width, c.height, {
				x: f.left - c.left,
				y: f.top - c.top,
				width: f.width,
				height: f.height
			});
		};

		const ro = new ResizeObserver(apply);
		ro.observe(canvas);
		ro.observe(frame);
		apply();
		return () => ro.disconnect();
	});

	$effect(() => {
		if (renderer) renderer.setView(view);
	});

	const busy = $derived(load.phase !== 'idle' && load.phase !== 'ready' && load.phase !== 'error');
	const VIEWS: { id: CameraView; label: string }[] = [
		{ id: 'orbit', label: 'Orbit' },
		{ id: 'top', label: 'Top' },
		{ id: 'front', label: 'Front' }
	];
</script>

<div class="room-layer" bind:this={layer}><canvas {@attach mount}></canvas></div>

<div class="stage floats" bind:this={column}>
	<div class="overlay top">
		<Segmented options={VIEWS} bind:value={view} variant="glass" ariaLabel="Camera" />

		<span class="spacer"></span>

		<!-- The room label also names resting scenes when no track is playing. -->
		<button
			class="lounge"
			class:on={lounge || readout.resting}
			onclick={onlounge}
			title={lounge
				? 'Calm scenes are lighting the room'
				: readout.resting
					? 'The room is resting'
					: 'Lounge, and how the room rests'}>
			<Icon name="lounge" size={14} />
			<span>{readout.resting && readout.scene ? readout.scene : 'Lounge'}</span>
		</button>
	</div>

	<div class="overlay bottom">
		<span class="mono subtle">
			{viz
				? `${viz.geometry.count} px · ${viz.spec.fixture.width}x${viz.spec.fixture.depth} m frame`
				: ''}
		</span>
		<span class="spacer"></span>
		<span class="mono subtle">{readout.fps} fps</span>
	</div>

	{#if !hasShow}
		<div class="empty">
			{#if busy}
				<Spinner size={26} accent />
				<h1>{load.message}</h1>
				{#if load.phase === 'authoring'}
					{#if steps.length > 0}
						<div class="live"><Activity {steps} compact /></div>
					{:else}
						<p>Claude is researching the track.</p>
					{/if}
				{/if}
			{:else if readout.duration > 0}
				<h1>Track ready</h1>
			{:else if queued > 0}
				<h1>Preparing the queue</h1>
			{:else if readout.resting}
				<Icon name="lounge" size={26} />
				<h1>The room is resting</h1>
				<p>{readout.scene}. Search for a track and it will hand over.</p>
			{:else}
				<Icon name="radio" size={26} />
				<h1>The room is dark</h1>
				<p>Search for a track to light it.</p>
			{/if}
		</div>
	{/if}
</div>

<style>
	/* Reserve framing space and anchor controls; the canvas fills the window beneath it. */
	.stage {
		position: relative;
		flex: 1;
		min-width: 0;
		min-height: 0;
		/* Pass room drags to the canvas; controls opt back into pointer events. */
		pointer-events: none;
	}
	canvas {
		display: block;
		width: 100%;
		height: 100%;
	}

	.overlay {
		position: absolute;
		left: 0;
		right: 0;
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 12px 14px;
		pointer-events: none;
	}
	.overlay.top {
		top: 0;
	}
	.overlay.bottom {
		bottom: 0;
	}
	/*
	 * Use :global for child-component roots, which lack this component's scope class and would
	 * inherit pointer-events: none.
	 */
	.overlay > :global(*) {
		pointer-events: auto;
	}
	.spacer {
		flex: 1;
		pointer-events: none;
	}

	/* The same floating tray as the view presets, as one pill rather than a row of them. */
	.lounge {
		display: flex;
		align-items: center;
		gap: 7px;
		height: 32px;
		padding: 0 12px;
		border-radius: var(--radius-md);
		background: #0d0d10cc;
		backdrop-filter: blur(10px);
		border: 1px solid #ffffff14;
		font-size: 12.5px;
		font-weight: 500;
		color: var(--muted-foreground);
		transition:
			background-color 0.25s ease,
			border-color 0.25s ease,
			color 0.25s ease;
	}
	.lounge:hover {
		color: var(--foreground);
		border-color: #ffffff2b;
	}
	/* Accent follows the room's actual lounge/rest state, not the requested switch state. */
	.lounge.on {
		background: color-mix(in srgb, var(--live) 20%, #0d0d10cc);
		border-color: color-mix(in srgb, var(--live) 45%, transparent);
		color: var(--live);
	}

	.empty {
		position: absolute;
		inset: 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		justify-content: center;
		gap: 12px;
		text-align: center;
		padding: 24px;
		pointer-events: none;
		color: var(--subtle-foreground);
	}
	.empty h1 {
		font-size: 20px;
		font-weight: 600;
		letter-spacing: -0.015em;
		color: var(--foreground);
	}
	.empty p {
		max-width: 360px;
		font-size: 13.5px;
		color: var(--muted-foreground);
	}
	.live {
		width: min(560px, 90%);
		margin-top: 2px;
		text-align: left;
	}
</style>
