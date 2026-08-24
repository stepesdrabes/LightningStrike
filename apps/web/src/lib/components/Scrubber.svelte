<script lang="ts">
	import { barTimeAt, bpmAt, type Show, type TrackAnalysis, barAtTime } from '@mv/core';
	import { clock, titleCase } from '$lib/format.ts';
	import { FULL_WINDOW, isFullWindow, type TimeWindow } from '$lib/timeline.ts';

	let {
		analysis,
		show,
		position,
		duration,
		view = FULL_WINDOW,
		onseek
	}: {
		analysis: TrackAnalysis | null;
		show: Show | null;
		position: number;
		duration: number;
		/** The slice the timeline drawer is showing, drawn here so the zoom has somewhere to read. */
		view?: TimeWindow;
		onseek: (t: number) => void;
	} = $props();

	let el: HTMLDivElement | undefined = $state();
	let dragging = $state(false);
	let hoverAt = $state<number | null>(null);

	const played = $derived(duration > 0 ? Math.min(1, position / duration) : 0);

	function timeAt(e: PointerEvent | MouseEvent): number {
		if (!el) return 0;
		const rect = el.getBoundingClientRect();
		return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width)) * duration;
	}

	function down(e: PointerEvent) {
		if (duration <= 0) return;
		dragging = true;
		el?.setPointerCapture(e.pointerId);
		onseek(timeAt(e));
	}

	function move(e: PointerEvent) {
		if (duration <= 0) return;
		hoverAt = timeAt(e);
		if (dragging) onseek(hoverAt);
	}

	function up(e: PointerEvent) {
		dragging = false;
		el?.releasePointerCapture(e.pointerId);
	}

	function barAt(t: number): number {
		// Through the bar table, like every other reader of this grid. Hand-rolled against
		// the median it disagreed with the markers drawn beside it on any track that drifts,
		// and named the wrong bar entirely on one that changes tempo.
		return analysis ? Math.max(0, Math.floor(barAtTime(analysis.tempo, t))) : 0;
	}

	function sectionAt(t: number): string {
		return analysis?.sections.find((s) => t >= s.startTime && t < s.endTime)?.kind ?? '';
	}

	function span(a: number, b: number) {
		if (duration <= 0) return { left: '0%', width: '0%' };
		const l = Math.max(0, Math.min(100, (a / duration) * 100));
		const w = Math.max(0.15, Math.min(100 - l, ((b - a) / duration) * 100));
		return { left: `${l.toFixed(3)}%`, width: `${w.toFixed(3)}%` };
	}

	/**
	 * Where a new song starts inside this one. Absent on nearly every track, which is why it is
	 * drawn as the exception rather than as another lane.
	 */
	const cuts = $derived.by(() => {
		const a = analysis;
		if (!a || duration <= 0) return [];
		return (a.movements ?? [])
			.map((bar) => barTimeAt(a.tempo, bar))
			.filter((t) => t > 0 && t < duration)
			.map((t) => ({ t, left: `${((t / duration) * 100).toFixed(3)}%` }));
	});

	const hover = $derived.by(() => {
		if (hoverAt === null || duration <= 0) return null;
		const bar = barAt(hoverAt);
		return {
			left: `${((hoverAt / duration) * 100).toFixed(3)}%`,
			at: clock(hoverAt),
			kind: sectionAt(hoverAt),
			bar,
			// The tempo HERE. On a track assembled from several, the median is a tempo nothing
			// in it is played at.
			bpm: analysis ? bpmAt(analysis.tempo, bar).toFixed(0) : ''
		};
	});
</script>

<div class="scrubber" class:active={dragging}>
	<span class="t mono muted">{clock(position)}</span>

	<div
		class="track"
		bind:this={el}
		onpointerdown={down}
		onpointermove={move}
		onpointerup={up}
		onpointerleave={() => (hoverAt = null)}
		role="slider"
		tabindex="0"
		aria-label="Seek"
		aria-valuemin={0}
		aria-valuemax={Math.round(duration)}
		aria-valuenow={Math.round(position)}
		onkeydown={(e) => {
			if (e.key === 'ArrowLeft') onseek(Math.max(0, position - 5));
			if (e.key === 'ArrowRight') onseek(Math.min(duration, position + 5));
		}}>
		<div class="rail">
			<!-- The sections ARE the progress bar. There is no separate timeline to consult. -->
			<div class="sections">
				{#each analysis?.sections ?? [] as s (s.index)}
					{@const g = span(s.startTime, s.endTime)}
					<div
						class="sec"
						style:left={g.left}
						style:width={g.width}
						style:background={`var(--sec-${s.kind})`}></div>
				{/each}
			</div>

			{#each show?.hits ?? [] as h, i (i)}
				{@const t = analysis ? barTimeAt(analysis.tempo, h.bar) : 0}
				<div
					class="hit {h.kind}"
					style:left={`${duration > 0 ? ((t / duration) * 100).toFixed(3) : 0}%`}
					title={`${h.kind} at bar ${h.bar}`}></div>
			{/each}

			<div class="veil" style:left={`${(played * 100).toFixed(3)}%`}></div>

			<!-- Which slice the lanes below are showing. The scrubber itself stays whole: it is how
			     you get anywhere in the track, and a zoomed seek bar cannot reach the rest of it. -->
			{#if !isFullWindow(view)}
				<div
					class="window"
					style:left={`${(view.start * 100).toFixed(3)}%`}
					style:width={`${((view.end - view.start) * 100).toFixed(3)}%`}></div>
			{/if}

			<div class="knob" style:left={`${(played * 100).toFixed(3)}%`}></div>
		</div>

		{#each cuts as c (c.t)}
			<div class="cut" style:left={c.left}></div>
		{/each}

		{#if hover}
			<div class="tip" style:left={hover.left}>
				<span class="mono">{hover.at}</span>
				{#if hover.kind}
					<span class="sub">{titleCase(hover.kind)}</span>
				{/if}
				{#if analysis}
					<span class="sub subtle">
						bar <span class="mono">{hover.bar}</span> · <span class="mono">{hover.bpm}</span> bpm
					</span>
				{/if}
			</div>
		{/if}
	</div>

	<span class="t mono subtle">{clock(Math.max(0, duration - position))}</span>
</div>

<style>
	.scrubber {
		display: flex;
		align-items: center;
		gap: 11px;
		width: 100%;
	}
	.t {
		width: 40px;
		flex: none;
		font-size: 11.5px;
	}
	.t:last-child {
		text-align: right;
	}
	.track {
		position: relative;
		flex: 1;
		display: flex;
		flex-direction: column;
		cursor: pointer;
		touch-action: none;
	}
	.rail {
		position: relative;
		flex: none;
		height: 18px;
	}
	.sections {
		position: absolute;
		inset: 0 0;
		top: 50%;
		translate: 0 -50%;
		height: 5px;
		border-radius: 999px;
		overflow: hidden;
		background: var(--muted);
		transition: height 0.12s ease;
	}
	.track:hover .sections,
	.scrubber.active .sections {
		height: 9px;
	}
	.sec {
		position: absolute;
		top: 0;
		bottom: 0;
	}
	/* Two verses in a row are one colour, so without a seam they are one section. The rule is
	   the background rather than a line over the ribbon: a gap reads at five pixels tall. */
	.sec:not(:last-child) {
		border-right: 1px solid var(--background);
	}
	/* Dim what has not played yet, rather than drawing a fill over what has: the section
	   colours stay legible ahead of the playhead, which is the point of showing them. */
	.veil {
		position: absolute;
		top: 50%;
		translate: 0 -50%;
		right: 0;
		height: 9px;
		background: #09090bc4;
		border-radius: 0 999px 999px 0;
		pointer-events: none;
	}
	/* A bracket rather than a fill: the sections underneath are what is being framed. */
	.window {
		position: absolute;
		top: 50%;
		translate: 0 -50%;
		height: 15px;
		border: 1px solid #ffffff59;
		border-radius: 3px;
		pointer-events: none;
	}
	/* A new song inside the track: the biggest break there is, so it is the heaviest rule and
	   the only one crossing the whole scrubber. Weight and reach rather than a colour, because
	   every hue on this bar already belongs to a section. */
	.cut {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 2px;
		translate: -1px 0;
		background: var(--muted-foreground);
		pointer-events: none;
	}
	.knob {
		position: absolute;
		top: 50%;
		width: 12px;
		height: 12px;
		border-radius: 50%;
		background: #fff;
		translate: -50% -50%;
		box-shadow: 0 1px 4px #000000b3;
		opacity: 0;
		transition: opacity 0.12s ease;
		pointer-events: none;
	}
	.track:hover .knob,
	.scrubber.active .knob {
		opacity: 1;
	}
	.hit {
		position: absolute;
		top: 50%;
		width: 2px;
		height: 14px;
		border-radius: 1px;
		translate: -50% -50%;
		pointer-events: none;
		opacity: 0.85;
	}
	.hit.slam {
		background: #fff;
	}
	.hit.strobe {
		background: var(--warn);
	}
	.hit.blackout {
		background: var(--bad);
	}
	.hit.bump {
		background: var(--live);
	}
	.tip {
		position: absolute;
		bottom: calc(100% + 6px);
		translate: -50% 0;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 1px;
		padding: 5px 9px;
		background: var(--popover);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		white-space: nowrap;
		pointer-events: none;
		box-shadow: var(--shadow-md);
	}
	.tip .sub {
		font-size: 11.5px;
	}
	/* `.mono` carries its own size, which would make the digits the tallest thing in the tip. */
	.tip .sub .mono {
		font-size: inherit;
	}
</style>
