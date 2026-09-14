<script lang="ts">
	import type { EveningRowView } from '$lib/evening/view.ts';
	import { clockTime } from '$lib/evening/format.ts';

	let {
		rows,
		now,
		seekable = false,
		onseek
	}: {
		rows: EveningRowView[];
		/** The evening's clock, epoch ms. */
		now: number;
		/** A rehearsal can be moved to any moment of the night. */
		seekable?: boolean;
		onseek?: (time: number) => void;
	} = $props();

	const HEIGHT = 40;

	const start = $derived(rows.length > 0 ? rows[0].startAt : now);
	const end = $derived(rows.length > 0 ? Math.max(rows[rows.length - 1].endAt, start + 60_000) : now + 60_000);
	const span = $derived(Math.max(1, end - start));
	const nowAt = $derived(Math.max(0, Math.min(1, (now - start) / span)));

	let hover = $state<number | null>(null);
	let el: HTMLDivElement | undefined = $state();

	function fraction(e: PointerEvent | MouseEvent): number {
		if (!el) return 0;
		const rect = el.getBoundingClientRect();
		return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
	}

	/** How tall a row stands: songs by heat, calm music low, silent rows as a floor. */
	function height(row: EveningRowView): number {
		if (row.kind === 'song') {
			if (row.role === 'music') return 7;
			return 10 + ((row.heat ?? 3) - 1) * 7.5;
		}
		if (row.kind === 'narration') return 12;
		return 3;
	}
</script>

{#snippet picture()}
	<svg viewBox="0 0 1000 {HEIGHT}" preserveAspectRatio="none" aria-hidden="true">
		{#each rows as row (row.key)}
			{@const x = ((row.startAt - start) / span) * 1000}
			{@const w = Math.max(1.2, ((row.endAt - row.startAt) / span) * 1000 - 1.2)}
			{@const h = height(row)}
			<rect
				x={x.toFixed(2)}
				y={HEIGHT - h}
				width={w.toFixed(2)}
				height={h}
				rx="1"
				class:past={row.endAt <= now}
				class:silent={row.kind !== 'song' && row.kind !== 'narration'} />
		{/each}
	</svg>
	<span class="now" style:left="{(nowAt * 100).toFixed(3)}%"></span>
	{#if hover !== null}
		<span class="hover" style:left="{(hover * 100).toFixed(3)}%">
			<span class="mono">{clockTime(start + hover * span)}</span>
		</span>
	{/if}
{/snippet}

{#if seekable}
	<div
		class="strip seekable"
		bind:this={el}
		role="slider"
		aria-label="Move the rehearsal to a moment of the evening"
		aria-valuemin={0}
		aria-valuemax={100}
		aria-valuenow={Math.round(nowAt * 100)}
		tabindex="0"
		onpointermove={(e) => (hover = fraction(e))}
		onpointerleave={() => (hover = null)}
		onclick={(e) => onseek?.(start + fraction(e) * span)}
		onkeydown={(e) => {
			const step = e.shiftKey ? 5 * 60_000 : 60_000;
			if (e.key === 'ArrowRight') onseek?.(Math.min(end, now + step));
			else if (e.key === 'ArrowLeft') onseek?.(Math.max(start, now - step));
		}}>
		{@render picture()}
	</div>
{:else}
	<div class="strip" role="img" aria-label="The evening at a glance">
		{@render picture()}
	</div>
{/if}
<div class="axis">
	<span class="mono">{clockTime(start)}</span>
	<span class="mono">{clockTime(end)}</span>
</div>

<style>
	.strip {
		position: relative;
		height: 40px;
		border-bottom: 1px solid var(--border);
	}
	.strip.seekable {
		cursor: pointer;
	}
	svg {
		display: block;
		width: 100%;
		height: 100%;
	}
	rect {
		fill: #3f3f46;
	}
	rect.silent {
		fill: #2a2a31;
	}
	rect.past {
		fill: #71717a;
	}
	rect.past.silent {
		fill: #52525b;
	}
	.now {
		position: absolute;
		top: -3px;
		bottom: -1px;
		width: 2px;
		margin-left: -1px;
		border-radius: 1px;
		background: var(--live);
		pointer-events: none;
	}
	.hover {
		position: absolute;
		top: -22px;
		transform: translateX(-50%);
		padding: 1px 6px;
		border-radius: 4px;
		background: var(--popover);
		border: 1px solid var(--border);
		color: var(--foreground);
		pointer-events: none;
		white-space: nowrap;
	}
	.hover .mono {
		font-size: 11px;
	}
	.axis {
		display: flex;
		justify-content: space-between;
		margin-top: 4px;
		color: var(--subtle-foreground);
	}
	.axis .mono {
		font-size: 11px;
	}
</style>
