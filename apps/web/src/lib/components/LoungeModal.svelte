<script lang="ts">
	import type { AmbientSettings, ColourSource } from '@mv/core';
	import {
		COLOUR_SOURCES,
		DRIFT_MAX,
		DRIFT_MIN,
		DWELL_MAX,
		DWELL_MIN,
		HUE_MAX,
		HUE_MIN,
		SAT_MAX,
		SAT_MIN,
		hueTrack
	} from '$lib/ambient.ts';
	import Dialog from '$lib/ui/Dialog.svelte';
	import Button from '$lib/ui/Button.svelte';
	import Icon from '$lib/ui/Icon.svelte';
	import Segmented from '$lib/ui/Segmented.svelte';
	import Slider from '$lib/ui/Slider.svelte';
	import Switch from '$lib/ui/Switch.svelte';

	let {
		open = false,
		lounge = false,
		rest = true,
		ambient,
		resting = false,
		scene = '',
		roomBase = 'transparent',
		roomAccent = 'transparent',
		onclose,
		onlounge,
		onrest,
		onambient,
		onambientdone,
		onnextscene
	}: {
		open?: boolean;
		lounge?: boolean;
		rest?: boolean;
		ambient: AmbientSettings;
		/** Whether the room has actually handed over, rather than been asked to. */
		resting?: boolean;
		scene?: string;
		/** What the room has landed on, as CSS. */
		roomBase?: string;
		roomAccent?: string;
		onclose: () => void;
		onlounge: (on: boolean) => void;
		onrest: (on: boolean) => void;
		/** While a slider is being dragged. The room follows on the next frame. */
		onambient: (s: AmbientSettings) => void;
		/** On release, which is the only point worth writing to disk. */
		onambientdone: (s: AmbientSettings) => void;
		onnextscene: () => void;
	} = $props();

	const track = $derived(hueTrack(ambient.sat));
	const picked = $derived(ambient.source === 'fixed' || ambient.source === 'drift');

	function set(patch: Partial<AmbientSettings>) {
		onambient({ ...ambient, ...patch });
	}
	function save(patch: Partial<AmbientSettings>) {
		onambientdone({ ...ambient, ...patch });
	}
	function source(id: ColourSource) {
		// Not a drag, so there is nothing to hold back: the room and the disk both take it at once.
		onambientdone({ ...ambient, source: id });
	}

	function minutes(seconds: number): string {
		return seconds < 90 ? `${Math.round(seconds)} s` : `${Math.round(seconds / 60)} min`;
	}
</script>

<Dialog
	{open}
	{onclose}
	veil="light"
	width="min(520px, calc(100vw - 32px))"
	labelledBy="lounge-title">
	<header>
		<span class="lamp" class:live={resting}><Icon name="lounge" size={16} /></span>
		<h2 id="lounge-title">Lounge</h2>
		<span class="now">{resting ? scene : 'The show'}</span>
	</header>

	<div class="row" class:lit={lounge}>
		<span class="head">Calm scenes while a track plays</span>
		<Switch checked={lounge} ariaLabel="Calm scenes while a track plays" onchange={onlounge} />
	</div>

	<section>
		<h3>Colour</h3>
		<Segmented
			options={COLOUR_SOURCES}
			value={ambient.source}
			ariaLabel="Where the room's colour comes from"
			onpick={source} />

		{#if picked}
			<div class="line">
				<span class="swatch" style:background={roomBase}></span>
				<Slider
					value={ambient.hue}
					min={HUE_MIN}
					max={HUE_MAX}
					step={1}
					{track}
					ariaLabel="The colour the room rests in"
					oninput={(v) => set({ hue: v })}
					onchange={(v) => save({ hue: v })} />
				<span class="figure mono">{Math.round(ambient.hue)}&deg;</span>
			</div>
			<div class="line">
				<span class="name">Depth</span>
				<Slider
					value={ambient.sat}
					min={SAT_MIN}
					max={SAT_MAX}
					step={0.01}
					ariaLabel="How saturated the room's colour is"
					oninput={(v) => set({ sat: v })}
					onchange={(v) => save({ sat: v })} />
				<span class="figure mono">{Math.round(ambient.sat * 100)}%</span>
			</div>
		{:else}
			<div class="line">
				<span class="swatch" style:background={roomBase}></span>
				<span class="swatch" style:background={roomAccent}></span>
			</div>
		{/if}

		{#if ambient.source === 'drift'}
			<div class="line">
				<span class="name">Speed</span>
				<Slider
					value={ambient.drift}
					min={DRIFT_MIN}
					max={DRIFT_MAX}
					step={0.5}
					ariaLabel="How fast the colour walks round the wheel"
					oninput={(v) => set({ drift: v })}
					onchange={(v) => save({ drift: v })} />
				<span class="figure mono">
					{ambient.drift < 0.5 ? 'held' : `${minutes(21600 / ambient.drift)}/lap`}
				</span>
			</div>
		{/if}
	</section>

	<!-- Fixture brightness belongs to the hardware panel. -->

	<section>
		<h3>Scene</h3>
		<div class="line">
			<span class="scene">{scene}</span>
			<Button variant="outline" size="sm" onclick={onnextscene}>
				<Icon name="shuffle" size={13} />
				Next
			</Button>
		</div>
		<div class="line">
			<span class="name">Changes every</span>
			<Slider
				value={ambient.dwell}
				min={DWELL_MIN}
				max={DWELL_MAX}
				step={5}
				ariaLabel="How long a scene holds before the next one"
				oninput={(v) => set({ dwell: v })}
				onchange={(v) => save({ dwell: v })} />
			<span class="figure mono">{minutes(ambient.dwell)}</span>
		</div>
	</section>

	<section class="last">
		<div class="line">
			<span class="head">Rest when nothing is playing</span>
			<Switch checked={rest} ariaLabel="Rest when nothing is playing" onchange={onrest} />
		</div>
	</section>
</Dialog>

<style>
	header {
		display: flex;
		align-items: center;
		gap: 9px;
		flex: none;
		padding: 14px 16px;
		border-bottom: 1px solid var(--border);
	}
	h2 {
		font-size: 14px;
		font-weight: 600;
		letter-spacing: -0.005em;
	}
	/* Accent means the room has actually entered lounge/rest, after transition or grace time. */
	.lamp {
		display: grid;
		place-items: center;
		width: 26px;
		height: 26px;
		flex: none;
		border-radius: var(--radius-sm);
		background: var(--muted);
		color: var(--subtle-foreground);
		transition:
			background-color 0.4s ease,
			color 0.4s ease;
	}
	.lamp.live {
		background: color-mix(in srgb, var(--live) 20%, transparent);
		color: var(--live);
	}
	.now {
		margin-left: auto;
		font-size: 12.5px;
		color: var(--muted-foreground);
	}

	.row {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 13px 16px;
		border-bottom: 1px solid var(--border);
		transition: background-color 0.25s ease;
	}
	.row.lit {
		background: color-mix(in srgb, var(--live) 9%, transparent);
	}

	.head {
		flex: 1;
		min-width: 0;
		font-size: 13.5px;
		font-weight: 600;
		color: var(--foreground);
	}
	section {
		padding: 13px 16px;
		border-bottom: 1px solid var(--border-soft);
	}
	section.last {
		border-bottom: none;
	}
	h3 {
		margin-bottom: 9px;
		font-size: 12.5px;
		font-weight: 600;
		color: var(--muted-foreground);
	}

	.line {
		display: flex;
		align-items: center;
		gap: 11px;
		margin-top: 9px;
		font-size: 13px;
		color: var(--muted-foreground);
	}
	.line :global(.slider) {
		flex: 1;
		min-width: 0;
	}
	.name {
		width: 96px;
		flex: none;
	}
	.figure {
		/* Fixed, so digits changing under the thumb do not shove the slider around. */
		width: 62px;
		flex: none;
		text-align: right;
		font-size: 12px;
		color: var(--subtle-foreground);
	}
	.scene {
		flex: 1;
		color: var(--foreground);
	}

	.swatch {
		width: 34px;
		height: 22px;
		flex: none;
		border-radius: var(--radius-sm);
		box-shadow: inset 0 0 0 1px #ffffff1f;
	}
</style>
