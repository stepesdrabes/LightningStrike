<script lang="ts">
	import type { Span } from '$lib/wiring.ts';

	let {
		spans,
		capacity = null,
		capacityLabel = '',
		selected = null,
		onselect
	}: {
		spans: readonly Span[];
		/** Pixels the device says it drives, marked on the bar when known. */
		capacity?: number | null;
		capacityLabel?: string;
		selected?: string | null;
		onselect: (lightId: string) => void;
	} = $props();

	const end = $derived(spans.reduce((n, s) => Math.max(n, s.from + s.count), 0));
	const total = $derived(Math.max(1, end, capacity ?? 0));
	const overlapping = $derived(
		new Set(
			spans
				.filter((a, i) => spans.some((b, j) => i !== j && a.from < b.from + b.count && b.from < a.from + a.count))
				.map((s) => s.light.id)
		)
	);

	function pct(n: number): string {
		return `${(n / total) * 100}%`;
	}
</script>

<div class="bar" role="list">
	{#each spans as span (span.light.id)}
		<button
			class="span"
			class:overlap={overlapping.has(span.light.id)}
			class:selected={selected === span.light.id}
			style:left={pct(span.from)}
			style:width={pct(span.count)}
			title="{span.light.name}: {span.count === 1 ? `pixel ${span.from}` : `pixels ${span.from} to ${span.from + span.count - 1}`}"
			aria-label={span.light.name}
			onclick={() => onselect(span.light.id)}></button>
	{/each}
	{#if capacity}
		<span class="capacity" style:left={pct(capacity)} title={capacityLabel}></span>
	{/if}
</div>
<div class="scale">
	<span class="mono">0</span>
	{#if capacity && capacity !== end}<span class="cap-label">{capacityLabel}</span>{/if}
	<span class="mono">{total}</span>
</div>

<style>
	.bar {
		position: relative;
		height: 22px;
		border-radius: var(--radius-sm);
		background: var(--muted);
		box-shadow: inset 0 0 0 1px var(--border-soft);
		overflow: hidden;
	}
	.span {
		position: absolute;
		top: 3px;
		bottom: 3px;
		min-width: 3px;
		border-radius: 3px;
		background: #71717a;
		box-shadow: inset -1px 0 0 #09090b;
		transition: background-color 0.12s ease;
	}
	.span:hover {
		background: #a1a1aa;
	}
	.span.selected {
		background: var(--foreground);
	}
	.span.overlap {
		background: var(--warn);
	}
	.capacity {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 2px;
		margin-left: -1px;
		background: var(--muted-foreground);
	}
	.scale {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 8px;
		font-size: 11.5px;
		color: var(--subtle-foreground);
	}
	.scale .mono {
		font-size: 11px;
	}
	.cap-label {
		flex: 1;
		text-align: center;
	}
</style>
