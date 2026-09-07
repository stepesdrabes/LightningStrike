<script lang="ts">
	import { ICONS, type IconName } from '../lib/icons.ts';

	let { name, size = 18, spin = false }: { name: IconName; size?: number; spin?: boolean } =
		$props();
</script>

<svg
	width={size}
	height={size}
	viewBox="0 0 24 24"
	fill="none"
	stroke="currentColor"
	stroke-width="2"
	stroke-linecap="round"
	stroke-linejoin="round"
	class:spin
	aria-hidden="true"
>
	<!-- Compile-time constants from lib/icons.ts, never anything that came off the network. -->
	{@html ICONS[name]}
</svg>

<style>
	svg {
		display: block;
		flex: none;
	}

	.spin {
		animation: spin 900ms linear infinite;
	}

	@keyframes spin {
		to {
			transform: rotate(360deg);
		}
	}

	@media (prefers-reduced-motion: reduce) {
		.spin {
			animation-duration: 2400ms;
		}
	}
</style>
