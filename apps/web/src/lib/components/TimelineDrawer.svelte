<script lang="ts">
	import type { Show, TrackAnalysis } from '@mv/core';
	import type { Viz } from '$lib/viz.svelte.ts';
	import type { JudgedSection } from '$lib/types.ts';
	import { FULL_WINDOW, type TimeWindow } from '$lib/timeline.ts';
	import LedBands from './LedBands.svelte';
	import ShowStrip from './ShowStrip.svelte';

	let {
		viz,
		analysis,
		show,
		position,
		duration,
		view = $bindable(FULL_WINDOW),
		onseek,
		editing = false,
		sections = null,
		onsections = () => {},
		movements = [],
		detected = [],
		onmovements = () => {},
		onveto = () => {},
		onundo = () => {}
	}: {
		viz: Viz | null;
		analysis: TrackAnalysis | null;
		show: Show | null;
		position: number;
		duration: number;
		view?: TimeWindow;
		onseek: (t: number) => void;
		editing?: boolean;
		sections?: JudgedSection[] | null;
		onsections?: (s: JudgedSection[]) => void;
		movements?: number[];
		/** Where the analysis says the songs change, seconds, with how it knows. */
		detected?: { t: number; source: 'auto' | 'mark'; note: string }[];
		onmovements?: (m: number[]) => void;
		onveto?: (t: number) => void;
		onundo?: () => void;
	} = $props();
</script>

<div class="drawer floats">
	<!-- LED bands use the room axis; only the timeline lanes zoom in time. -->
	<LedBands {viz} />
	<ShowStrip
		{analysis}
		{show}
		{position}
		{duration}
		bind:view
		{onseek}
		{editing}
		{sections}
		{onsections}
		{movements}
		{detected}
		{onmovements}
		{onveto}
		{onundo} />
</div>

<style>
	.drawer {
		flex: none;
		background: var(--panel);
		backdrop-filter: var(--panel-blur);
		border-top: 1px solid var(--border);
		animation: open 0.18s cubic-bezier(0.16, 1, 0.3, 1);
	}
	@keyframes open {
		from {
			opacity: 0;
			translate: 0 6px;
		}
	}
</style>
