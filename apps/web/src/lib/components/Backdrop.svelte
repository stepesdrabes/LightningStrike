<script lang="ts">
	let { thumbnail = '' }: { thumbnail?: string } = $props();
</script>

<!-- Blur artwork into ambient colour; key by URL to cross-fade track changes. -->
<div class="backdrop" aria-hidden="true">
	{#key thumbnail}
		{#if thumbnail}
			<img src={thumbnail} alt="" />
		{/if}
	{/key}
</div>

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		z-index: 0;
		overflow: hidden;
		pointer-events: none;
		background: var(--background);
	}
	img {
		position: absolute;
		/* Overscan so the blur cannot sample transparent edges. */
		inset: -25%;
		width: 150%;
		height: 150%;
		object-fit: cover;
		/*
		 * Blur removes detail; saturation restores averaged colour. Opacity above ~0.45 competes with
		 * LEDs.
		 */
		filter: blur(90px) saturate(1.7);
		opacity: 0.4;
		animation: fade 0.6s ease-out;
	}
	@keyframes fade {
		from {
			opacity: 0;
		}
	}
</style>
