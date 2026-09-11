<script lang="ts">
	import { encode } from 'uqr';

	let {
		value,
		size = 160,
		fluid = false
	}: {
		value: string;
		size?: number;
		/** Fill the width available instead of taking a fixed one, staying square. */
		fluid?: boolean;
	} = $props();

	/** Two quiet modules scan reliably on a lit screen. */
	const quiet = 2;
	const code = $derived(encode(value, { ecc: 'M' }));
	const span = $derived(code.size + quiet * 2);

	/** Combine QR modules into one SVG path to avoid hundreds of DOM elements. */
	const path = $derived(
		code.data
			.flatMap((row, y) =>
				row.map((on, x) => (on ? `M${x + quiet} ${y + quiet}h1v1h-1z` : ''))
			)
			.join('')
	);
</script>

<svg
	viewBox={`0 0 ${span} ${span}`}
	class:fluid
	width={fluid ? undefined : size}
	height={fluid ? undefined : size}
	shape-rendering="crispEdges"
	role="img"
	aria-label="Scan to join the room">
	<rect width={span} height={span} fill="#09090b" />
	<path d={path} fill="#fafafa" />
</svg>

<style>
	svg {
		display: block;
		border-radius: var(--radius-sm);
	}
	.fluid {
		width: 100%;
		height: auto;
	}
</style>
