<script lang="ts">
	import type { LinkState } from '$lib/hardware.ts';

	let { state }: { state: LinkState } = $props();
	const width = 168;

	/**
	 * Match firmware heartbeat_task: solid while connecting, brief one-second heartbeat when
	 * online.
	 */
	const led = $derived(
		state === 'searching'
			? 'solid'
			: state === 'unconfigured' || state === 'offline'
				? 'dark'
				: 'blinking'
	);
</script>

<!-- Pico W top view at 51 x 21 mm proportions, with twenty pads per side. -->
<svg viewBox="0 0 204 84" {width} height={width * (84 / 204)} role="img" aria-label="Raspberry Pi Pico W">
	<rect x="6" y="1" width="192" height="82" rx="9" fill="#0e4a2c" />
	<rect x="6" y="1" width="192" height="82" rx="9" fill="none" stroke="#1c6b41" stroke-width="1" />

	<!-- Castellated pads, twenty a side. -->
	{#each Array.from({ length: 20 }) as _, i (i)}
		{@const x = 14 + i * 9.3}
		<rect x={x} y="0" width="5.4" height="7" rx="1.6" fill="#c9a54e" />
		<rect x={x} y="77" width="5.4" height="7" rx="1.6" fill="#c9a54e" />
	{/each}

	<!-- Micro USB, left edge. -->
	<rect x="0" y="27" width="14" height="30" rx="2.5" fill="#b6bcc4" />
	<rect x="3" y="32" width="8" height="20" rx="1.5" fill="#6f757c" />

	<!-- BOOTSEL. -->
	<rect x="24" y="9" width="15" height="12" rx="2" fill="#d8dade" />
	<rect x="26.5" y="11.5" width="10" height="7" rx="1" fill="#8f959c" />

	<!-- RP2040. -->
	<rect x="78" y="26" width="34" height="34" rx="3" fill="#15171b" />
	<circle cx="84" cy="32" r="1.7" fill="#3b4048" />
	<rect x="90" y="38" width="14" height="3" rx="1.5" fill="#2b3038" />
	<rect x="90" y="44" width="9" height="3" rx="1.5" fill="#2b3038" />

	<!-- Flash. -->
	<rect x="122" y="32" width="18" height="22" rx="2" fill="#15171b" />

	<!-- CYW43439 shield can. -->
	<rect x="150" y="22" width="30" height="42" rx="2.5" fill="#aeb4bb" />
	<rect x="153" y="25" width="24" height="36" rx="1.5" fill="none" stroke="#8d949c" stroke-width="0.8" />

	<!-- Meandered PCB antenna, right edge. -->
	<path
		d="M186 30 h9 v6 h-9 v6 h9 v6 h-9 v6 h9"
		fill="none"
		stroke="#c9a54e"
		stroke-width="2.4"
		stroke-linecap="square" />

	<!-- CYW43 owns the onboard LED, so it cannot report before WiFi starts. -->
	<circle class="led {led}" cx="146" cy="16" r="3.4" />

	<!-- Debug pads. -->
	{#each Array.from({ length: 3 }) as _, i (i)}
		<rect x={96 + i * 9} y="68" width="5" height="5" rx="1.2" fill="#c9a54e" />
	{/each}
</svg>

<style>
	svg {
		display: block;
		filter: drop-shadow(0 3px 10px #00000073);
	}
	.led {
		fill: #2a3a30;
	}
	.led.solid {
		fill: #6ee7a0;
	}
	.led.blinking {
		fill: #6ee7a0;
		animation: heartbeat 1s steps(1, end) infinite;
	}
	/* 60 ms on, 940 off, which is what heartbeat_task actually does. */
	@keyframes heartbeat {
		0%,
		6% {
			fill: #6ee7a0;
		}
		6.01%,
		100% {
			fill: #2a3a30;
		}
	}
</style>
