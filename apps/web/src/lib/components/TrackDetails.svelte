<script lang="ts">
	import type { Show, TrackAnalysis, TrackContext } from '@mv/core';
	import { hsv2rgb } from '@mv/core';
	import type { Readout } from '$lib/viz.svelte.ts';
	import { titleCase } from '$lib/format.ts';
	import Badge from '$lib/ui/Badge.svelte';
	import Button from '$lib/ui/Button.svelte';
	import Icon from '$lib/ui/Icon.svelte';
	import Spinner from '$lib/ui/Spinner.svelte';

	let {
		analysis,
		context = null,
		show,
		readout,
		trustNote = null,
		onrelevel,
		onreroll,
		relevelling = false,
		rerolling = false
	}: {
		analysis: TrackAnalysis;
		context?: TrackContext | null;
		show: Show | null;
		readout: Readout;
		/** Why the current track runs in lounge rather than its show; null when it does not. */
		trustNote?: string | null;
		onrelevel: (level: number) => void;
		onreroll: () => void;
		relevelling?: boolean;
		rerolling?: boolean;
	} = $props();

	// Rerolling an agent show would discard paid work.
	const byAgent = $derived(show !== null && !!show.authoredBy && show.authoredBy !== 'engine');
	const total = $derived(Math.max(1, analysis.bars.length));

	/** A palette hue as the fixture draws it, not as a colour picker would. */
	function swatch(hue: number): string {
		const [r, g, b] = hsv2rgb(hue / 360, 0.9, 1);
		return `rgb(${Math.round(r * 255)} ${Math.round(g * 255)} ${Math.round(b * 255)})`;
	}
</script>

<section class="track">
	<header>
		<h2>Track</h2>
		{#if context?.genreFamily}
			<Badge title="The family the show was lit as">{context.genreFamily}</Badge>
		{/if}
		<span class="spacer"></span>
		<Button
			variant="ghost"
			size="sm"
			disabled={!show || rerolling || byAgent}
			title={byAgent ? `${show?.authoredBy} wrote this show` : 'Compose this track again, differently'}
			onclick={onreroll}>
			{#if rerolling}<Spinner size={13} />{:else}<Icon name="retry" size={14} />{/if}
			Reroll
		</Button>
	</header>

	<div class="tempo">
		<span class="figure mono">{analysis.tempo.bpm}</span>
		<span class="unit">bpm</span>
		{#if analysis.tempo.ambiguous}
			{#each analysis.tempo.alternativeBpm as alt (alt)}
				<Button
					variant="outline"
					size="sm"
					disabled={relevelling}
					title="Read the whole grid again at this tempo"
					onclick={() => onrelevel(alt / analysis.tempo.bpm)}>
					{Math.round(alt)}
				</Button>
			{/each}
		{/if}
		<span class="spacer"></span>
		{#if show}
			<span class="palette" title="The show's palette">
				{#each [show.palette.base, show.palette.accent, ...(show.palette.third !== undefined ? [show.palette.third] : [])] as hue, i (i)}
					<span class="chip" style:background={swatch(hue)}></span>
				{/each}
			</span>
		{/if}
	</div>

	<p class="facts">
		{analysis.tempo.beatsPerBar}/4 · {analysis.bars.length} bars · {analysis.key.name} · {analysis.integratedLufs} LUFS
	</p>

	<div class="sections" aria-label="Arrangement">
		{#each analysis.sections as s (s.index)}
			{@const live = readout.bar >= s.startBar && readout.bar < s.endBar}
			<span
				class="section"
				class:live
				style:flex-grow={s.lengthBars / total}
				style:background={`var(--sec-${s.kind})`}
				title={`${titleCase(s.kind)}, bars ${s.startBar}-${s.endBar}`}></span>
		{/each}
	</div>

	{#if trustNote}
		<p class="note">The analyser lost this grid ({trustNote}), so calm scenes follow the track. The queue row can override it.</p>
	{/if}
</section>

<style>
	.track {
		display: flex;
		flex-direction: column;
		gap: 10px;
		padding: 16px;
	}
	header {
		display: flex;
		align-items: center;
		gap: 8px;
		height: 30px;
	}
	h2 {
		font-size: 13px;
		font-weight: 600;
	}
	.spacer {
		flex: 1;
	}
	.tempo {
		display: flex;
		align-items: baseline;
		gap: 7px;
		flex-wrap: wrap;
	}
	.figure {
		font-size: 24px;
		font-weight: 600;
		letter-spacing: -0.02em;
		line-height: 1;
		color: var(--foreground);
	}
	.unit {
		font-size: 13px;
		color: var(--muted-foreground);
	}
	.palette {
		display: flex;
		gap: 4px;
		align-self: center;
	}
	.chip {
		width: 18px;
		height: 12px;
		border-radius: 3px;
		box-shadow: inset 0 0 0 1px #ffffff1f;
	}
	.facts {
		font-size: 12px;
		color: var(--subtle-foreground);
	}
	.sections {
		display: flex;
		gap: 1px;
		height: 6px;
		border-radius: 3px;
		overflow: hidden;
	}
	.section {
		min-width: 1px;
		opacity: 0.45;
		transition: opacity 0.2s ease;
	}
	.section.live {
		opacity: 1;
	}
	.note {
		font-size: 12.5px;
		line-height: 1.55;
		color: var(--muted-foreground);
	}
</style>
