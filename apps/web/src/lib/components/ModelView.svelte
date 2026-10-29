<script lang="ts">
	import { onMount } from 'svelte';
	import { strikerView } from '$lib/striker.svelte.ts';
	import { LINGER_MS, ModelPainter, graphFacts, type Scene } from '$lib/modelView.ts';

	let {
		trackId = null,
		playing = false,
		position,
		audio
	}: {
		/** The playing song, whose recording the view replays. */
		trackId?: string | null;
		playing?: boolean;
		/** The audio clock, read every frame so the playhead never steps. */
		position: () => number;
		/** The playing song's decoded audio, drawn as the input. */
		audio: () => AudioBuffer | null;
	} = $props();

	let canvas: HTMLCanvasElement;
	let gl: HTMLCanvasElement;
	let netBox = $state({ y: 0, h: 0 });
	let note = $state<{ text: string; x: number; y: number } | null>(null);
	let tick = $state(0);

	// The store's arrays change in place; `version` says when.
	const pass = $derived.by(() => {
		void strikerView.version;
		return strikerView.pass;
	});
	const hearing = $derived.by(() => {
		void strikerView.version;
		return strikerView.hearing;
	});
	const facts = $derived(strikerView.graph ? graphFacts(strikerView.graph) : null);

	/** A pass shows while it runs and for a moment after, then the playing song returns. */
	function showsPass(now: number): boolean {
		const p = strikerView.pass;
		return !!p && p.chunks.length > 0 && (!p.end || now - p.end.at < LINGER_MS);
	}

	const live = $derived.by(() => {
		void tick;
		return !!pass && !pass.end && pass.chunks.length > 0;
	});
	const lingering = $derived.by(() => {
		void tick;
		return !!pass?.end && showsPass(performance.now());
	});
	const chunkNow = $derived(pass ? Math.min(pass.total, pass.chunks.filter((c) => c.outAt !== null).length + 1) : 0);

	$effect(() => {
		void strikerView.follow(trackId);
	});

	// A finished pass may be the playing song's: its recording exists now.
	$effect(() => {
		if (pass?.end?.ok) strikerView.refresh();
	});

	onMount(() => {
		const detach = strikerView.attach();
		const painter = new ModelPainter(canvas, gl);
		const reduce = window.matchMedia('(prefers-reduced-motion: reduce)');
		let frame = 0;
		let fadeFrom = 0;
		let wasLive = false;
		let ticked = 0;
		/** What the last still frame showed; a paused view draws only when this changes. */
		let still = '';
		let drawn = 0;

		const size = () => {
			const r = canvas.getBoundingClientRect();
			const lay = painter.resize(r.width, r.height, strikerView.graph);
			netBox = { y: lay.net.y, h: lay.net.h };
			still = '';
		};
		const observer = new ResizeObserver(size);
		observer.observe(canvas);
		size();
		let graph = strikerView.graph;

		const loop = () => {
			frame = requestAnimationFrame(loop);
			if (document.hidden) return;
			if (strikerView.graph !== graph) {
				graph = strikerView.graph;
				size();
			}
			const now = performance.now();
			const passing = showsPass(now);
			if (wasLive && !passing) fadeFrom = now;
			wasLive = passing;
			let scene: Scene;
			if (passing) {
				const p = strikerView.pass!;
				const fade = p.end ? Math.min(1, Math.max(0, (LINGER_MS - (now - p.end.at)) / 500)) : 1;
				scene = { mode: 'live', pass: p, fade };
			} else if (strikerView.hearing && strikerView.hearing.trackId === trackId) {
				scene = { mode: 'replay', hearing: strikerView.hearing.hearing, audio: audio(), position: position(), playing };
			} else {
				scene = { mode: 'idle' };
			}
			const fading = now - fadeFrom < 600;
			const opacity = String(Math.min(1, 0.35 + (now - fadeFrom) / 600));
			canvas.style.opacity = opacity;
			gl.style.opacity = opacity;
			const moving = scene.mode === 'live' || (scene.mode === 'replay' && scene.playing) || fading;
			// At rest the spindle only turns: half the frames are plenty.
			const breathing = scene.mode === 'idle' && !reduce.matches && now - drawn > 30;
			const key = `${scene.mode}:${scene.mode === 'replay' ? scene.position.toFixed(3) : ''}:${strikerView.version}`;
			if (moving || breathing || key !== still) {
				drawn = now;
				still = moving ? '' : key;
				painter.draw(scene, now, !reduce.matches);
			}
			// The header only needs to notice a pass ending, not every frame.
			if (now - ticked > 250) {
				ticked = now;
				tick = (tick + 1) % 1024;
			}
		};
		frame = requestAnimationFrame(loop);

		const hover = (e: MouseEvent) => {
			const r = canvas.getBoundingClientRect();
			const x = e.clientX - r.left;
			const y = e.clientY - r.top;
			const text = painter.describe(x, y);
			note = text ? { text, x: Math.min(x, r.width - 230), y: y + 14 } : null;
		};
		const leave = () => (note = null);
		canvas.addEventListener('mousemove', hover);
		canvas.addEventListener('mouseleave', leave);

		return () => {
			cancelAnimationFrame(frame);
			observer.disconnect();
			canvas.removeEventListener('mousemove', hover);
			canvas.removeEventListener('mouseleave', leave);
			painter.dispose();
			detach();
		};
	});
</script>

<section class="model">
	<header>
		<h2>Striker 2.0</h2>
		{#if live && pass}
			<span class="state live" title={pass.title}>
				<i></i>
				<span class="truncate">Preparing {pass.title}</span>
				{#if pass.total > 1}<span class="mono">{chunkNow}/{pass.total}</span>{/if}
			</span>
		{:else if lingering && pass?.end}
			<span class="state" class:bad={!pass.end.ok}>
				{#if pass.end.ok}Prepared in <span class="mono">{(pass.end.ms / 1000).toFixed(1)} s</span>{:else}Stopped{/if}
			</span>
		{:else if hearing && hearing.trackId === trackId}
			<span class="state">{playing ? 'Listening' : 'Paused'}</span>
		{:else if facts}
			<span class="facts truncate">{facts.parameters} parameters · {facts.attention} attention blocks</span>
		{/if}
	</header>
	<canvas class="net" bind:this={gl} style:top="{netBox.y}px" style:height="{netBox.h}px" aria-hidden="true"></canvas>
	<canvas
		class="flat"
		bind:this={canvas}
		aria-label="Striker 2.0: the audio it hears, its stages turning in 3D, and its output heads as the music plays"></canvas>
	{#if note}
		<div class="note" style:left="{note.x}px" style:top="{note.y}px">{note.text}</div>
	{/if}
</section>

<style>
	.model {
		position: relative;
		aspect-ratio: 1;
		flex: none;
		display: flex;
		flex-direction: column;
		border-bottom: 1px solid var(--border-soft);
		overflow: hidden;
	}
	header {
		position: absolute;
		inset: 0 0 auto 0;
		display: flex;
		align-items: center;
		gap: 10px;
		height: 40px;
		padding: 0 16px;
		pointer-events: none;
		z-index: 1;
	}
	h2 {
		font-size: 14px;
		font-weight: 600;
		letter-spacing: -0.005em;
		flex: none;
	}
	canvas.net {
		position: absolute;
		left: 0;
		width: 100%;
		pointer-events: none;
	}
	canvas.flat {
		position: relative;
		width: 100%;
		height: 100%;
		display: block;
		transition: opacity 0.2s;
	}
	.state {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		min-width: 0;
		height: 20px;
		margin-left: auto;
		padding: 0 8px;
		border-radius: 999px;
		background: var(--muted);
		color: var(--muted-foreground);
		font-size: 11.5px;
		font-weight: 500;
	}
	/* The model's own blue rather than the room's live orange: this view's glow is blue. */
	.state.live {
		background: #388cff24;
		color: #8ecbff;
	}
	.state.bad {
		color: var(--bad);
	}
	.state i {
		width: 6px;
		height: 6px;
		flex: none;
		border-radius: 50%;
		background: currentColor;
		animation: pulse 1.6s ease-in-out infinite;
	}
	.state .mono {
		font-size: 11px;
		flex: none;
	}
	.facts {
		margin-left: auto;
		min-width: 0;
		font-size: 11.5px;
		color: var(--subtle-foreground);
	}
	.note {
		position: absolute;
		z-index: 2;
		max-width: 230px;
		padding: 7px 9px;
		border-radius: var(--radius-md);
		background: var(--popover);
		border: 1px solid var(--border);
		box-shadow: var(--shadow-md);
		font-size: 11.5px;
		line-height: 1.4;
		color: var(--muted-foreground);
		pointer-events: none;
	}
	@keyframes pulse {
		0%,
		100% {
			opacity: 1;
		}
		50% {
			opacity: 0.35;
		}
	}
	@media (prefers-reduced-motion: reduce) {
		.state i {
			animation: none;
		}
	}
</style>
