<script lang="ts">
	import type { Viz } from '$lib/viz.svelte.ts';

	let { viz }: { viz: Viz | null } = $props();

	let canvas: HTMLCanvasElement | undefined = $state();
	let host: HTMLDivElement | undefined = $state();

	/**
	 * Render exact wire bytes, including gamma and dither, for comparison with the 3D
	 * presentation.
	 */
	$effect(() => {
		const el = canvas;
		const box = host;
		if (!el || !box || !viz) return;

		const geometry = viz.geometry;
		const strips = geometry.strips;
		const maxCount = Math.max(...strips.map((s) => s.count));

		// One texel per LED, smoothed to show strip diffusion.
		const src = document.createElement('canvas');
		src.width = maxCount;
		src.height = strips.length;
		const srcCtx = src.getContext('2d', { alpha: false });
		const ctx = el.getContext('2d', { alpha: false });
		if (!srcCtx || !ctx) return;

		const image = srcCtx.createImageData(maxCount, strips.length);
		image.data.fill(255);

		let raf = 0;
		let width = 0;
		let height = 0;

		const resize = () => {
			const rect = box.getBoundingClientRect();
			const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
			width = Math.max(1, Math.round(rect.width * dpr));
			height = Math.max(1, Math.round(rect.height * dpr));
			if (el.width !== width || el.height !== height) {
				el.width = width;
				el.height = height;
			}
		};

		const observer = new ResizeObserver(resize);
		observer.observe(box);
		resize();

		const draw = () => {
			raf = requestAnimationFrame(draw);
			const bytes = viz.director.bytes;
			const data = image.data;

			for (let s = 0; s < strips.length; s++) {
				const strip = strips[s];
				const row = s * maxCount * 4;
				for (let k = 0; k < maxCount; k++) {
					const o = row + k * 4;
					if (k < strip.count) {
						const from = (strip.offset + k) * 3;
						data[o] = bytes[from];
						data[o + 1] = bytes[from + 1];
						data[o + 2] = bytes[from + 2];
					} else {
						// Fill unequal strip tails grey to distinguish their ends from unlit LEDs.
						data[o] = 13;
						data[o + 1] = 13;
						data[o + 2] = 16;
					}
					data[o + 3] = 255;
				}
			}
			srcCtx.putImageData(image, 0, 0);

			ctx.fillStyle = '#08080c';
			ctx.fillRect(0, 0, width, height);
			ctx.imageSmoothingEnabled = true;
			ctx.imageSmoothingQuality = 'high';

			const rowH = height / strips.length;
			const gap = Math.max(1, rowH * 0.22);
			for (let s = 0; s < strips.length; s++) {
				const strip = strips[s];
				const y = s * rowH;
				const w = (width * strip.count) / maxCount;
				ctx.drawImage(src, 0, s, strip.count, 1, 0, y, w, rowH - gap);
				if (w < width) {
					ctx.fillStyle = '#121218';
					ctx.fillRect(w, y, width - w, rowH - gap);
				}
			}
		};

		raf = requestAnimationFrame(draw);
		return () => {
			cancelAnimationFrame(raf);
			observer.disconnect();
		};
	});

	const names = $derived(viz ? viz.geometry.strips.map((s) => s.name) : []);
</script>

<div class="bands">
	<div class="names mono">
		{#each names as name (name)}
			<span>{name}</span>
		{/each}
	</div>
	<div class="canvas-box" bind:this={host}>
		<canvas bind:this={canvas}></canvas>
	</div>
</div>

<style>
	.bands {
		display: flex;
		align-items: stretch;
		gap: 10px;
		padding: 12px 14px 8px;
	}
	.names {
		display: flex;
		flex-direction: column;
		justify-content: space-between;
		width: 58px;
		flex: none;
		padding: 1px 0 6px;
		font-size: 10.5px;
		color: var(--subtle-foreground);
		line-height: 1;
	}
	.canvas-box {
		flex: 1;
		min-width: 0;
		height: 58px;
	}
	canvas {
		display: block;
		width: 100%;
		height: 100%;
		border-radius: var(--radius-sm);
	}
</style>
