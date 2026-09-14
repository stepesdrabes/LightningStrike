<script lang="ts">
	import type { Show, TrackAnalysis } from '@mv/core';
	import { bpmAt, tempoSegments } from '@mv/core';
	import type { TrackMeta } from '$lib/types.ts';
	import type { RowKind } from '$lib/queueModel.ts';
	import { ROW_ICON } from '$lib/evening/format.ts';
	import type { Readout } from '$lib/viz.svelte.ts';
	import { titleCase } from '$lib/format.ts';
	import { FULL_WINDOW, type TimeWindow } from '$lib/timeline.ts';
	import Scrubber from './Scrubber.svelte';
	import Icon from '$lib/ui/Icon.svelte';
	import Button from '$lib/ui/Button.svelte';
	import Badge from '$lib/ui/Badge.svelte';
	import Slider from '$lib/ui/Slider.svelte';

	// Build the map per analysis; read tempo at the current bar.
	const tempoMapOf = (a: TrackAnalysis | null) => (a ? tempoSegments(a.tempo) : []);
	const clock = (t: number) => `${Math.floor(t / 60)}:${String(Math.floor(t % 60)).padStart(2, '0')}`;

	let {
		meta,
		analysis,
		show,
		readout,
		volume = $bindable(0.8),
		timelineOpen = false,
		view = FULL_WINDOW,
		queued = 0,
		hasPrev = false,
		hasNext = false,
		kind = 'song',
		ongo,
		ontoggle,
		onseek,
		onprev,
		onnext,
		onsearch,
		ontimeline
	}: {
		meta: TrackMeta | null;
		analysis: TrackAnalysis | null;
		show: Show | null;
		readout: Readout;
		volume?: number;
		timelineOpen?: boolean;
		/** What the drawer's lanes are showing, so the scrubber can bracket it. */
		view?: TimeWindow;
		/** Rows in the queue, which is what separates an empty night from one that is loading. */
		queued?: number;
		hasPrev?: boolean;
		hasNext?: boolean;
		/** What the loaded row plays; a hold waits for Go rather than playing. */
		kind?: RowKind;
		ongo?: () => void;
		ontoggle: () => void;
		onseek: (t: number) => void;
		onprev: () => void;
		onnext: () => void;
		onsearch: () => void;
		ontimeline: () => void;
	} = $props();

	const tempoMap = $derived(tempoMapOf(analysis));
	const localBpm = $derived(analysis ? bpmAt(analysis.tempo, readout?.bar ?? 0) : 0);

	const ready = $derived(readout.duration > 0);
	/** Hide empty transport controls while the full-window resting room continues. */
	const empty = $derived(!meta && queued === 0);
	let mutedAt = $state<number | null>(null);

	function toggleMute() {
		if (mutedAt === null) {
			mutedAt = volume;
			volume = 0;
		} else {
			volume = mutedAt;
			mutedAt = null;
		}
	}
</script>

{#if empty}
	<div class="player empty floats">
		<span class="mark"><Icon name="bolt" size={15} /></span>
		<span class="line">Nothing queued</span>
		<Button variant="outline" onclick={onsearch}>
			<Icon name="search" size={15} />
			Search for a track
		</Button>
	</div>
{:else}
	<div class="player floats">
		<div class="now">
			<div class="art" class:lit={readout.playing}>
				{#if meta?.thumbnail}
					<img src={meta.thumbnail} alt="" />
				{:else}
					<Icon name={ROW_ICON[kind]} size={18} />
				{/if}
			</div>
			<div class="meta">
				<!-- A null title here means a queued row is still being fetched. -->
				<span class="title truncate" title={meta?.title ?? ''}>{meta?.title ?? 'Preparing'}</span>
				<span class="sub truncate muted">
					{#if meta}
						{meta.uploader}
						{#if analysis && (kind === 'song' || kind === 'narration')}
							<span class="dot">·</span>
							<!-- Show local tempo across movements rather than the track median. -->
							<span class="mono">{localBpm.toFixed(0)}</span> bpm
							{#if tempoMap.length > 1}
								<span class="dot">·</span>
								<span
									class="subtle"
									title={tempoMap.map((x) => `${x.bpm.toFixed(0)} bpm from ${clock(x.start)}`).join('\n')}>
									{tempoMap.length} tempi
								</span>
							{/if}
						{/if}
					{/if}
				</span>
			</div>
		</div>

		<div class="controls">
			{#if kind === 'hold'}
				<div class="buttons">
					<button class="go" onclick={ongo} aria-label="Go">
						<Icon name="play" size={15} fill strokeWidth={1.5} />
						Go
					</button>
				</div>
				<p class="waiting">The evening waits here until you press Go.</p>
			{:else}
			<div class="buttons">
				<button
					class="step"
					onclick={onprev}
					disabled={!ready && !hasPrev}
					title="Previous"
					aria-label="Previous">
					<Icon name="skipBack" size={17} fill />
				</button>

				<button class="play" onclick={ontoggle} disabled={!ready} aria-label="Play or pause">
					<Icon name={readout.playing ? 'pause' : 'play'} size={16} fill strokeWidth={1.5} />
				</button>

				<button
					class="step"
					onclick={onnext}
					disabled={!ready && !hasNext}
					title="Next"
					aria-label="Next">
					<Icon name="skipForward" size={17} fill />
				</button>
			</div>

			<Scrubber
				{analysis}
				{show}
				position={readout.position}
				duration={readout.duration}
				{view}
				{onseek} />
			{/if}
		</div>

		<div class="right">
			{#if ready && kind !== 'hold'}
				<Badge colour={`var(--sec-${readout.section})`}>{titleCase(readout.section)}</Badge>
				<span class="mono subtle bar">bar {readout.bar}</span>
			{/if}

			<button class="vol-btn" onclick={toggleMute} aria-label="Mute">
				<Icon name={volume === 0 ? 'volumeOff' : 'volume'} size={16} />
			</button>
			<Slider bind:value={volume} ariaLabel="Volume" width="84px" />

			<Button
				variant={timelineOpen ? 'secondary' : 'ghost'}
				size="icon"
				title="Timeline"
				ariaLabel="Toggle the timeline"
				onclick={ontimeline}>
				<Icon name={timelineOpen ? 'chevronDown' : 'chevronUp'} size={17} />
			</Button>
		</div>
	</div>
{/if}

<style>
	.player {
		display: grid;
		grid-template-columns: minmax(180px, 1fr) minmax(360px, 2.2fr) minmax(180px, 1fr);
		align-items: center;
		gap: 20px;
		flex: none;
		padding: 12px 14px;
		background: var(--panel);
		backdrop-filter: var(--panel-blur);
		border-top: 1px solid var(--border);
	}
	/* One row, centred, and shorter than the bar it replaces: there is less to say. */
	.player.empty {
		display: flex;
		justify-content: center;
		align-items: center;
		gap: 12px;
		padding: 10px 14px;
	}
	.mark {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 26px;
		height: 26px;
		border-radius: var(--radius-sm);
		background: var(--primary);
		color: var(--primary-foreground);
	}
	.line {
		font-size: 13.5px;
		color: var(--muted-foreground);
	}

	.now {
		display: flex;
		align-items: center;
		gap: 12px;
		min-width: 0;
	}
	.art {
		width: 54px;
		height: 54px;
		flex: none;
		display: grid;
		place-items: center;
		border-radius: var(--radius-md);
		overflow: hidden;
		background: var(--muted);
		color: var(--subtle-foreground);
		box-shadow:
			0 2px 12px #00000073,
			inset 0 0 0 1px #ffffff14;
		transition: box-shadow 0.3s ease;
	}
	/* Only while it is actually making sound, so the glow means something. */
	.art.lit {
		box-shadow:
			0 4px 20px #000000a6,
			inset 0 0 0 1px #ffffff2b;
	}
	.art img {
		width: 100%;
		height: 100%;
		object-fit: cover;
		display: block;
	}
	.meta {
		display: flex;
		flex-direction: column;
		min-width: 0;
		gap: 2px;
	}
	.title {
		font-size: 13.5px;
		font-weight: 600;
		letter-spacing: -0.005em;
	}
	.sub {
		font-size: 12.5px;
	}
	.dot {
		opacity: 0.4;
		padding: 0 1px;
	}

	.controls {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 6px;
		min-width: 0;
	}
	.buttons {
		display: flex;
		align-items: center;
		gap: 6px;
	}
	.step {
		display: grid;
		place-items: center;
		width: 34px;
		height: 34px;
		border-radius: 50%;
		color: var(--muted-foreground);
		transition:
			color 0.12s ease,
			background-color 0.12s ease,
			transform 0.08s ease;
	}
	.step:hover:not(:disabled) {
		color: var(--foreground);
		background: #ffffff12;
	}
	.step:active:not(:disabled) {
		transform: scale(0.9);
	}
	.step:disabled {
		opacity: 0.3;
	}
	.play {
		width: var(--h-lg);
		height: var(--h-lg);
		margin: 0 6px;
		border-radius: 50%;
		background: var(--primary);
		color: var(--primary-foreground);
		display: grid;
		place-items: center;
		box-shadow: 0 2px 10px #00000059;
		transition:
			transform 0.12s cubic-bezier(0.16, 1, 0.3, 1),
			background-color 0.12s ease;
	}
	.play:hover:not(:disabled) {
		background: #fff;
		transform: scale(1.07);
	}
	.play:active:not(:disabled) {
		transform: scale(0.95);
	}
	.go {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		height: var(--h-lg);
		padding: 0 22px;
		border-radius: 999px;
		background: var(--primary);
		color: var(--primary-foreground);
		font-size: 14px;
		font-weight: 600;
		box-shadow: 0 2px 10px #00000059;
		transition:
			transform 0.12s cubic-bezier(0.16, 1, 0.3, 1),
			background-color 0.12s ease;
	}
	.go:hover {
		background: #fff;
		transform: scale(1.04);
	}
	.go:active {
		transform: scale(0.97);
	}
	.waiting {
		font-size: 12px;
		color: var(--subtle-foreground);
	}
	.play:disabled {
		background: var(--muted);
		color: var(--subtle-foreground);
		box-shadow: none;
	}

	.right {
		display: flex;
		align-items: center;
		justify-content: flex-end;
		gap: 10px;
		min-width: 0;
	}
	.bar {
		font-size: 11.5px;
	}
	.vol-btn {
		display: grid;
		place-items: center;
		width: 26px;
		height: 26px;
		color: var(--muted-foreground);
		transition: color 0.12s ease;
	}
	.vol-btn:hover {
		color: var(--foreground);
	}
</style>
