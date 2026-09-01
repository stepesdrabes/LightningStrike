<script lang="ts">
	import { untrack } from 'svelte';
	import {
		SECTION_KINDS,
		barAtTime,
		barDurationAt,
		barTimeAt,
		tempoSegments,
		type Show,
		type TrackAnalysis
	} from '@mv/core';
	import {
		FULL_WINDOW,
		buildTimeline,
		densityColumns,
		follow,
		fractionAt,
		fractionIn,
		isFullWindow,
		panBy,
		windowSpan,
		zoomAt,
		type TimeWindow
	} from '$lib/timeline.ts';
	import { clock, titleCase } from '$lib/format.ts';
	import type { JudgedSection } from '$lib/types.ts';
	import Icon from '$lib/ui/Icon.svelte';

	let {
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
		onmovements = () => {},
		onundo = () => {}
	}: {
		analysis: TrackAnalysis | null;
		show: Show | null;
		position: number;
		duration: number;
		/** Bound, because the scrubber above draws the same range and the drawer unmounts. */
		view?: TimeWindow;
		onseek: (t: number) => void;
		/** Section editing: the lane grows handles and the draft below replaces the analysis. */
		editing?: boolean;
		/** The hand-drawn draft being edited; owned by the page, committed via onsections. */
		sections?: JudgedSection[] | null;
		onsections?: (s: JudgedSection[]) => void;
		/** Seconds where a new song starts inside this one; drawn as dividers while editing. */
		movements?: number[];
		onmovements?: (m: number[]) => void;
		/** One step back through the page's edit stack. */
		onundo?: () => void;
	} = $props();

	let host: HTMLDivElement | undefined = $state();
	let width = $state(0);
	let canvas: HTMLCanvasElement | undefined = $state();
	let tip = $state<{ x: number; title: string; lines: string[] } | null>(null);

	/** Suppresses the auto-follow for a moment after a manual pan, so a drag is not fought. */
	let heldUntil = 0;

	const timeline = $derived(buildTimeline(analysis, show, duration));
	// Read off the bar table, so it is a measurement of the grid the room is playing.
	const tempoMap = $derived(analysis ? tempoSegments(analysis.tempo) : []);

	/**
	 * Four bars, which is the closest a zoom gets.
	 *
	 * A floor in bars rather than in seconds, because the useful limit is "one phrase and its
	 * approach" on every track, and that is four seconds at 240 bpm and sixteen at 60.
	 */
	const minSpan = $derived.by(() => {
		if (!analysis || duration <= 0) return 0.02;
		const bar = analysis.tempo.beatPeriod * analysis.tempo.beatsPerBar;
		return Math.min(1, (4 * bar) / duration);
	});

	const pct = (t: number) =>
		duration > 0 ? Math.max(-20, Math.min(120, fractionIn(view, t / duration) * 100)) : 0;
	// A span that starts before the window still has to end where it does, so both ends are
	// mapped and the width taken from the difference rather than from the span's own length.
	const widthPct = (a: number, b: number) => Math.max(0.12, pct(b) - pct(a));

	function across(e: { clientX: number }): number {
		if (!host) return 0;
		const rect = host.getBoundingClientRect();
		return Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
	}

	function seekFrom(e: PointerEvent) {
		if (!host || duration <= 0) return;
		onseek(fractionAt(view, across(e)) * duration);
	}

	/**
	 * Vertical for zoom, horizontal for pan.
	 *
	 * That is what a trackpad already sends for pinch and for a two-finger swipe, and the drawer
	 * has nothing else a scroll could mean. Non-passive because zooming has to stop the gesture
	 * reaching whatever is behind it.
	 */
	function wheel(el: HTMLElement) {
		const onWheel = (e: WheelEvent) => {
			if (duration <= 0) return;
			e.preventDefault();
			heldUntil = performance.now() + 2500;
			if (!e.ctrlKey && Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
				view = panBy(view, (e.deltaX / (el.clientWidth || 1)) * windowSpan(view));
				return;
			}
			view = zoomAt(view, fractionAt(view, across(e)), Math.exp(e.deltaY * 0.004), minSpan);
		};
		el.addEventListener('wheel', onWheel, { passive: false });
		return () => el.removeEventListener('wheel', onWheel);
	}

	function reset() {
		view = FULL_WINDOW;
	}

	/**
	 * The playhead pulls the window along once it has left it, unless a pan just happened.
	 *
	 * Untracked on purpose: this runs when the playhead moves, not when the window does. Reading
	 * `view` as a dependency here would make the effect its own trigger.
	 */
	$effect(() => {
		const at = duration > 0 ? position / duration : 0;
		untrack(() => {
			if (isFullWindow(view) || performance.now() < heldUntil) return;
			view = follow(view, at);
		});
	});

	function showTip(e: PointerEvent, title: string, lines: string[]) {
		if (!host) return;
		const rect = host.getBoundingClientRect();
		tip = { x: e.clientX - rect.left, title, lines };
	}

	// ---- Section editing ------------------------------------------------------------------
	// The draft is owned by the page; a gesture works on local state for smoothness and
	// commits once on release, so each drag is one save rather than a stream of them.

	/** `live` separates a pointer drag from a keyboard nudge waiting on its commit timer. */
	let drag = $state<{ boundary: number; t: number; live: boolean } | null>(null);
	let picker = $state<{ index: number; x: number; cursor: number } | null>(null);
	let pickerEl: HTMLDivElement | undefined = $state();
	/** The boundary the arrow keys move. Follows focus, so escape and a click away clear it. */
	let selected = $state<number | null>(null);

	/**
	 * Snap to BAR lines, which is the only coordinate a section has.
	 *
	 * This used to snap to beats, on the reasoning that a hand mark should land where the
	 * hand put it. But every consumer addresses sections by whole bars - the adoption, the
	 * preview, every cue - so a boundary drawn between two bar lines is one the engine
	 * cannot keep: it rounds, and the arrangement then disagrees with the map on screen by
	 * up to half a bar. Sixteen boundaries on one judged track, six of them off a bar line,
	 * one by two whole bars. Snapping here is what makes the drawn line the heard line.
	 */
	function snapT(t: number, fine = false): number {
		const tempo = analysis?.tempo;
		if (!tempo) return t;
		const bars = barAtTime(tempo, t);
		// Shift drops to the beat grid, for the case bars cannot express: the ear hears the
		// change between two bar lines, which is a statement about the GRID rather than about
		// the section. The mark is kept where it was put; the adoption still rounds it onto a
		// bar, and the durable answer to a grid that disagrees with the ear is a movement mark
		// or a listener cut, both of which move the bar lines themselves.
		if (fine) return barTimeAt(tempo, Math.round(bars * tempo.beatsPerBar) / tempo.beatsPerBar);
		return barTimeAt(tempo, Math.round(bars));
	}

	/**
	 * A section cannot be shorter than the bar it is addressed in - the LOCAL bar, not the
	 * median one.
	 *
	 * On a track that changes tempo those differ by a factor of two, and a margin in median
	 * bars refuses a placement the grid allows: SICKO MODE's beat switch sits 1.7 s after the
	 * boundary before it while the median bar is 3.1 s, so the drag clamped past the switch
	 * and the owner reported being able to place it "only slightly after it". The keyboard
	 * nudge already reasons this way; the pointer drag did not.
	 */
	function minSpanAt(t: number, fine = false): number {
		const tempo = analysis?.tempo;
		if (!tempo) return fine ? 0.25 : 1;
		const len = barDurationAt(tempo, barAtTime(tempo, t));
		return fine ? len / Math.max(1, tempo.beatsPerBar) : len;
	}

	function timeFrom(e: { clientX: number }): number {
		return fractionAt(view, across(e)) * duration;
	}

	function withBars(s: JudgedSection): JudgedSection {
		const tempo = analysis?.tempo;
		// Fractional, because a shift-drag is allowed to sit between bar lines and the stored
		// bar is what a mining session reads. Rounding it here would report a boundary as
		// being on a bar line it was deliberately placed off.
		const bar = (t: number) => (tempo ? Math.round(barAtTime(tempo, t) * 1000) / 1000 : 0);
		// The plain drag snaps to bar lines, so a start that is off one was placed there with
		// the fine drag - a statement that the bar line belongs at the mark. Recorded here
		// rather than inferred later, because maps drawn before the editor snapped to bars are
		// full of beat-snapped boundaries that meant no such thing.
		const offBar = tempo ? Math.abs(bar(s.startTime) - Math.round(bar(s.startTime))) > 0.001 : false;
		// Recomputed from where the boundary IS, not merged onto where it was. Spreading the
		// old flag left a boundary nudged off the grid and back still claiming a deliberate
		// off-grid placement - and a keyboard nudge makes that round trip two keystrokes.
		const { offGrid: _was, ...rest } = s;
		return {
			...rest,
			startBar: bar(s.startTime),
			endBar: bar(s.endTime),
			...(offBar ? { offGrid: true } : {})
		};
	}

	function commit(next: JudgedSection[]) {
		onsections(next.map(withBars));
	}

	function handleDown(e: PointerEvent, boundary: number) {
		if (!sections) return;
		e.stopPropagation();
		flushNudge();
		if (e.altKey) {
			// Merge: the seam disappears and the left section absorbs the right one's span.
			const next = sections.map((s) => ({ ...s }));
			next[boundary - 1].endTime = next[boundary].endTime;
			next.splice(boundary, 1);
			selected = null;
			commit(next);
			return;
		}
		const el = e.currentTarget as HTMLElement;
		el.setPointerCapture(e.pointerId);
		// Explicit, because a button is not focused by a press on every platform, and the
		// selection the arrow keys read is this element's focus.
		el.focus();
		drag = { boundary, t: sections[boundary].startTime, live: true };
	}

	function handleMove(e: PointerEvent) {
		if (!drag?.live || !sections) return;
		const lo =
			sections[drag.boundary - 1].startTime +
			minSpanAt(sections[drag.boundary - 1].startTime, e.shiftKey);
		const hi =
			sections[drag.boundary].endTime -
			minSpanAt(sections[drag.boundary].endTime - 1e-3, e.shiftKey);
		// Snapped AFTER the clamp: clamping a snapped value pushes it back off the grid, by
		// however much the local bar differs from the median one.
		const t = snapT(Math.max(lo, Math.min(hi, timeFrom(e))), e.shiftKey);
		drag = { boundary: drag.boundary, t, live: true };
	}

	function handleUp(e: PointerEvent) {
		if (!drag?.live || !sections) return;
		(e.currentTarget as HTMLElement).releasePointerCapture(e.pointerId);
		const { boundary, t } = drag;
		drag = null;
		// A press that only selects the handle is not an edit, and a save per press is a step
		// the undo has to be walked back through for nothing.
		if (t === sections[boundary].startTime) return;
		const next = sections.map((s) => ({ ...s }));
		next[boundary - 1].endTime = t;
		next[boundary].startTime = t;
		commit(next);
	}

	// ---- Keyboard nudge -------------------------------------------------------------------
	// The drag's own two steps, one press at a time. This is what makes a boundary placeable:
	// a bar is a couple of pixels wide at full zoom, and the hand cannot hit it.

	/** The nudged map waiting on its timer. Held whole, so a disarm cannot drop the edit. */
	let pending: JudgedSection[] | null = null;
	let commitTimer: ReturnType<typeof setTimeout> | null = null;

	/**
	 * One grid step from `t`, on the same grids `snapT` snaps to.
	 *
	 * Stepping to the next line in the direction of travel rather than from `round + dir`, so a
	 * boundary deliberately left between two bar lines moves onto the nearer one instead of
	 * jumping across it. The epsilon is for a bar line whose own number reads back as 9.999999.
	 */
	function stepT(t: number, dir: number, fine: boolean): number {
		const tempo = analysis?.tempo;
		if (!tempo) return t;
		const unit = fine ? tempo.beatsPerBar : 1;
		const u = barAtTime(tempo, t) * unit;
		return barTimeAt(tempo, (dir > 0 ? Math.floor(u + 1e-6) + 1 : Math.ceil(u - 1e-6) - 1) / unit);
	}

	function nudge(boundary: number, dir: number, fine: boolean) {
		const base = pending ?? sections;
		if (!base || boundary <= 0 || boundary >= base.length) return;
		const t = stepT(base[boundary].startTime, dir, fine);
		// The real constraint, rather than the drag's one-step margin: a step onto the grid is
		// as narrow as a section is allowed to get, and a margin in median bars would refuse it
		// wherever the local bar is longer.
		if (t <= base[boundary - 1].startTime || t >= base[boundary].endTime) return;
		const next = base.map((s) => ({ ...s }));
		next[boundary - 1].endTime = t;
		next[boundary].startTime = t;
		pending = next;
		drag = { boundary, t, live: false };
		if (commitTimer) clearTimeout(commitTimer);
		commitTimer = setTimeout(flushNudge, 220);
	}

	/** Held presses are one gesture, so they are one save - the drag's bargain with release. */
	function flushNudge() {
		if (commitTimer) clearTimeout(commitTimer);
		commitTimer = null;
		const next = pending;
		pending = null;
		if (!next) return;
		if (drag && !drag.live) drag = null;
		commit(next);
	}

	// A nudge still on its timer when the lane goes away is an edit the owner made and cannot
	// see was lost, so it is written rather than dropped.
	$effect(() => () => flushNudge());

	function handleKey(e: KeyboardEvent, boundary: number) {
		if (e.metaKey || e.ctrlKey || e.altKey) return;
		if (e.key === 'Escape') {
			e.stopPropagation();
			flushNudge();
			(e.currentTarget as HTMLElement).blur();
			return;
		}
		const dir = e.key === 'ArrowLeft' ? -1 : e.key === 'ArrowRight' ? 1 : 0;
		if (dir === 0) return;
		// Consumed here, or the window's own arrow binding seeks the track underneath the edit.
		e.preventDefault();
		e.stopPropagation();
		nudge(boundary, dir, e.shiftKey);
	}

	function split(e: MouseEvent, index: number) {
		if (!sections) return;
		e.stopPropagation();
		flushNudge();
		const s = sections[index];
		const t = snapT(timeFrom(e), e.shiftKey);
		if (
			t < s.startTime + minSpanAt(s.startTime, e.shiftKey) ||
			t > s.endTime - minSpanAt(s.endTime - 1e-3, e.shiftKey)
		)
			return;
		const next = sections.map((x) => ({ ...x }));
		next.splice(index + 1, 0, { ...next[index], startTime: t });
		next[index] = { ...next[index], endTime: t };
		picker = null;
		commit(next);
	}

	function pickKind(index: number, kind: string) {
		if (!sections) return;
		const next = sections.map((s, i) => (i === index ? { ...s, kind } : { ...s }));
		picker = null;
		commit(next);
	}

	function openPicker(index: number, clientX: number) {
		flushNudge();
		const at = SECTION_KINDS.findIndex((k) => k === sections?.[index]?.kind);
		const x = clientX - (host?.getBoundingClientRect().left ?? 0);
		picker = { index, x, cursor: at < 0 ? 0 : at };
	}

	function pickerKey(e: KeyboardEvent) {
		if (!picker) return;
		// The popup has the keyboard while it is open, so nothing it does not use reaches the
		// bindings underneath it.
		e.stopPropagation();
		if (e.key === 'Escape') {
			picker = null;
			return;
		}
		const dir = e.key === 'ArrowDown' ? 1 : e.key === 'ArrowUp' ? -1 : 0;
		if (dir !== 0) {
			e.preventDefault();
			const n = SECTION_KINDS.length;
			picker = { ...picker, cursor: (picker.cursor + dir + n) % n };
			return;
		}
		if (e.key === 'Enter' || e.key === ' ') {
			e.preventDefault();
			pickKind(picker.index, SECTION_KINDS[picker.cursor]);
		}
	}

	$effect(() => {
		if (picker) pickerEl?.focus({ preventScroll: true });
	});

	/** A movement mark is the panel's to add and either surface's to take back. */
	function removeMovement(index: number) {
		onmovements(movements.filter((_, i) => i !== index));
	}

	function onWindowKey(e: KeyboardEvent) {
		if (!editing) return;
		if (!(e.metaKey || e.ctrlKey) || e.key.toLowerCase() !== 'z') return;
		const el = e.target;
		if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) return;
		e.preventDefault();
		// Flushed first, or the step being undone is one the stack has not been told about.
		flushNudge();
		picker = null;
		onundo();
	}

	/** The seam positions being rendered: the dragged one follows the pointer. */
	function boundaryTime(i: number): number {
		if (!sections) return 0;
		return drag && drag.boundary === i ? drag.t : sections[i].startTime;
	}

	function editStart(i: number): number {
		if (!sections) return 0;
		return i === 0 ? sections[0].startTime : boundaryTime(i);
	}

	function editEnd(i: number): number {
		if (!sections) return 0;
		return i === sections.length - 1 ? sections[i].endTime : boundaryTime(i + 1);
	}

	/**
	 * The drum lane is drawn rather than laid out.
	 *
	 * A four-minute track carries a few thousand onsets, and one element each is tens of
	 * thousands of nodes for a lane eighteen pixels tall. Counting them into one column per
	 * pixel says the same thing - where the kit is busy and where it stops - for a fraction of
	 * the cost, and it is the only lane with nothing worth hovering.
	 */
	$effect(() => {
		const el = canvas;
		const w = width;
		const a = analysis;
		const range = view;
		if (!el || w <= 0) return;

		const dpr = Math.min(2, globalThis.devicePixelRatio || 1);
		const h = el.clientHeight || 26;
		el.width = Math.max(1, Math.round(w * dpr));
		el.height = Math.max(1, Math.round(h * dpr));
		const ctx = el.getContext('2d');
		if (!ctx) return;

		ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
		ctx.clearRect(0, 0, w, h);
		if (!a || duration <= 0) return;

		const rows: [readonly number[], string][] = [
			[a.onsets.kick.times, '#ff6a1a'],
			[a.onsets.snare.times, '#5aa9ff'],
			[a.onsets.hat.times, '#8f8fa6']
		];
		const rowH = h / rows.length;

		rows.forEach(([times, colour], row) => {
			const counts = densityColumns(times, duration, Math.ceil(w), range);
			let peak = 1;
			for (const c of counts) if (c > peak) peak = c;

			ctx.fillStyle = colour;
			const top = row * rowH;
			for (let x = 0; x < counts.length; x++) {
				if (counts[x] === 0) continue;
				// Density as opacity, not height: a row six pixels tall has no room for a bar chart.
				ctx.globalAlpha = 0.3 + 0.7 * Math.min(1, counts[x] / peak);
				ctx.fillRect(x, top + 1, 1, Math.max(1, rowH - 2));
			}
		});
		ctx.globalAlpha = 1;
	});

	$effect(() => {
		const el = host;
		if (!el) return;
		const observer = new ResizeObserver(([entry]) => (width = entry.contentRect.width));
		observer.observe(el);
		width = el.getBoundingClientRect().width;
		return () => observer.disconnect();
	});
</script>

<svelte:window onkeydown={onWindowKey} />

<div class="strip" class:empty={!show}>
	<div
		class="lanes"
		bind:this={host}
		{@attach wheel}
		onpointerdown={seekFrom}
		ondblclick={reset}
		onpointerleave={() => (tip = null)}
		role="presentation">
		{#if tempoMap.length > 1}
			<!-- Only where there is something to say: one segment is every ordinary track, and a
			     lane announcing "this track has one tempo" is noise. -->
			<div class="lane tempi" aria-label="Tempo changes">
				{#each tempoMap as seg (seg.startBar)}
					<div class="tempo" style:left={`${pct(seg.start)}%`} style:width={`${widthPct(seg.start, seg.end)}%`}>
						<span class="label mono">{seg.bpm.toFixed(0)}</span>
					</div>
				{/each}
			</div>
		{/if}

		{#if editing && sections}
			<div class="lane sections editing" aria-label="Sections, adjustable">
				{#each sections as s, i (i)}
					<div
						class="sec"
						style:left={`${pct(editStart(i))}%`}
						style:width={`${widthPct(editStart(i), editEnd(i))}%`}
						style:background={`var(--sec-${s.kind})`}
						onpointerdown={(e) => e.stopPropagation()}
						onclick={(e) => {
							e.stopPropagation();
							if (picker?.index === i) picker = null;
							else openPicker(i, e.clientX);
						}}
						ondblclick={(e) => split(e, i)}
						role="presentation">
						<span class="label">{titleCase(s.kind)}</span>
					</div>
				{/each}
				<!-- Where a new song starts: the same mark the panel lists, drawn where it falls.
				     Under the handles, because a movement often lands on a seam and the seam has
				     to stay draggable; its glyph sits clear of the line for the same reason. -->
				{#each movements as t, i (i)}
					<div class="movement" style:left={`${pct(t)}%`}>
						<button
							class="mark"
							type="button"
							title="A new song starts here. Click to hear it, alt-click to take the mark back."
							aria-label={`New song at ${clock(t)}`}
							onpointerdown={(e) => e.stopPropagation()}
							onclick={(e) => {
								e.stopPropagation();
								if (e.altKey) removeMovement(i);
								else onseek(t);
							}}>‖</button>
					</div>
				{/each}
				{#each sections as s, i (i)}
					{#if i > 0}
						<button
							class="handle"
							class:held={drag?.boundary === i}
							class:selected={selected === i}
							type="button"
							style:left={`${pct(boundaryTime(i))}%`}
							title="Drag to move the boundary, or click it and use the arrow keys. Alt-click merges the two sections."
							aria-label={`Boundary before ${titleCase(s.kind)}`}
							onpointerdown={(e) => handleDown(e, i)}
							onpointermove={handleMove}
							onpointerup={handleUp}
							onkeydown={(e) => handleKey(e, i)}
							onfocus={() => (selected = i)}
							onblur={() => {
								if (selected === i) selected = null;
								flushNudge();
							}}>
						</button>
					{/if}
				{/each}
			</div>
		{:else}
			<div class="lane sections" aria-label="Sections">
				{#each timeline.sections as s (s.index)}
					<div
						class="sec"
						style:left={`${pct(s.start)}%`}
						style:width={`${widthPct(s.start, s.end)}%`}
						style:background={`var(--sec-${s.kind})`}
						onpointerenter={(e) => showTip(e, titleCase(s.title), s.lines)}
						role="presentation">
						<span class="label">{titleCase(s.kind)}</span>
					</div>
				{/each}
			</div>
		{/if}

		<div class="lane cues" aria-label="Cues">
			{#each timeline.cues as c (c.bar)}
				<div
					class="cue"
					style:left={`${pct(c.start)}%`}
					style:width={`${widthPct(c.start, c.end)}%`}
					style:opacity={0.3 + 0.7 * c.intensity}
					onpointerenter={(e) => showTip(e, c.title, c.lines)}
					role="presentation">
					<span class="label">{titleCase(c.section)}</span>
				</div>
			{/each}
		</div>

		<div class="lane drums" aria-label="Kick, snare and hat density">
			<canvas bind:this={canvas}></canvas>
		</div>

		<div class="lane hits" aria-label="Strobes, blackouts and slams">
			{#each timeline.markers as m, i (i)}
				<div
					class="hit {m.kind}"
					style:left={`${pct(m.start)}%`}
					style:width={`${widthPct(m.start, m.end)}%`}
					onpointerenter={(e) => showTip(e, titleCase(m.title), m.lines)}
					role="presentation">
					<span class="glyph">{m.kind === 'strobe' ? '⚡' : m.kind === 'blackout' ? '■' : '▲'}</span>
				</div>
			{/each}
		</div>

		<!-- Only while it is in view. `.lanes` does not clip, because the tooltip rises out of it. -->
		{#if duration > 0 && fractionIn(view, position / duration) >= 0 && fractionIn(view, position / duration) <= 1}
			<div class="playhead" style:left={`${pct(position)}%`}></div>
		{/if}

		{#if tip}
			<div
				class="tooltip"
				style:left={`${tip.x}px`}
				class:flip={width > 0 && tip.x > width - 180}>
				<strong>{tip.title}</strong>
				{#each tip.lines as line (line)}
					<span>{line}</span>
				{/each}
			</div>
		{/if}

		{#if picker && sections}
			<div
				class="picker"
				style:left={`${picker.x}px`}
				class:flip={width > 0 && picker.x > width - 180}
				bind:this={pickerEl}
				tabindex="-1"
				role="menu"
				aria-label="Section kind"
				onpointerdown={(e) => e.stopPropagation()}
				onkeydown={pickerKey}>
				{#each SECTION_KINDS as kind, k (kind)}
					<button
						class="kind"
						class:on={sections[picker.index]?.kind === kind}
						class:cursor={picker.cursor === k}
						type="button"
						role="menuitemradio"
						aria-checked={sections[picker.index]?.kind === kind}
						onclick={() => picker && pickKind(picker.index, kind)}>
						<i class="swatch" style:background={`var(--sec-${kind})`}></i>
						{titleCase(kind)}
					</button>
				{/each}
			</div>
		{/if}
	</div>

	<div class="legend subtle">
		{#if editing}
			<span>click a boundary, then ← → nudges it a bar · shift for a beat · escape lets go</span>
			<span>or drag it · double-click splits · alt-click a handle merges</span>
			<span>click a section for its kind · alt-click ‖ takes the mark back · ⌘Z undoes</span>
			<span class="sep">·</span>
		{/if}
		<span><i class="swatch kick"></i>Kick</span>
		<span><i class="swatch snare"></i>Snare</span>
		<span><i class="swatch hat"></i>Hat</span>
		<span class="sep">·</span>
		<span>⚡ Strobe</span>
		<span>■ Blackout</span>
		<span>▲ Slam</span>
		<span class="spacer"></span>
		{#if !isFullWindow(view)}
			<!-- Only while there is something to say: at full width the range is the track. -->
			<button class="zoom" onclick={reset} title="Show the whole track">
				<Icon name="search" size={12} />
				<span class="mono">
					{clock(view.start * duration)}-{clock(view.end * duration)}
				</span>
			</button>
			<span class="sep">·</span>
		{/if}
		{#if show}
			<span class="mono">{timeline.cues.length} cues · {timeline.markers.length} hits</span>
			<span class="sep">·</span>
			<span class="mono">{clock(position)} / {clock(duration)}</span>
		{/if}
	</div>
</div>

<style>
	.strip {
		padding: 4px 14px 12px;
		user-select: none;
	}
	.strip.empty {
		opacity: 0.35;
		pointer-events: none;
	}
	.lanes {
		position: relative;
		display: flex;
		flex-direction: column;
		gap: 3px;
		cursor: pointer;
		touch-action: none;
	}
	.tempi {
		height: 13px;
	}
	.tempi .tempo {
		position: absolute;
		top: 0;
		bottom: 0;
		border-left: 1px solid var(--border);
		display: flex;
		align-items: center;
		padding-left: 4px;
		overflow: hidden;
	}
	.tempi .label {
		font-size: 9.5px;
		color: var(--muted-foreground);
	}
	.lane {
		position: relative;
		width: 100%;
		border-radius: var(--radius-sm);
		overflow: hidden;
	}
	.sections {
		height: 24px;
		background: var(--muted);
	}
	.cues {
		height: 20px;
		background: var(--muted);
	}
	.drums {
		height: 26px;
		background: #08080b;
	}
	.hits {
		height: 24px;
		background: var(--muted);
		overflow: visible;
	}
	canvas {
		display: block;
		width: 100%;
		height: 26px;
	}

	.sec,
	.cue {
		position: absolute;
		top: 0;
		bottom: 0;
		box-sizing: border-box;
	}
	.sec {
		border-right: 1px solid #00000091;
	}
	/* The divider between cues is drawn as a full inset rule rather than a coloured left edge,
	   so a one-bar cue reads as a block rather than as a stripe. */
	.cue {
		background: var(--card-raised);
		box-shadow: inset 1px 0 0 #ffffff2e;
	}
	.sec:hover,
	.cue:hover {
		filter: brightness(1.4);
	}
	.label {
		position: absolute;
		inset: 0;
		display: flex;
		align-items: center;
		padding-left: 7px;
		font-size: 11px;
		font-weight: 500;
		color: #ffffffd6;
		white-space: nowrap;
		overflow: hidden;
		pointer-events: none;
	}

	.hit {
		position: absolute;
		top: 0;
		bottom: 0;
		min-width: 3px;
		border-radius: 3px;
		display: flex;
		align-items: center;
		justify-content: center;
	}
	.hit .glyph {
		font-size: 12px;
		line-height: 1;
		pointer-events: none;
		/* The glyph is a label for the block, so it must not vanish when the block is 2px wide. */
		text-shadow: 0 0 3px #000;
	}
	.hit.strobe {
		background: #fbbf2445;
		box-shadow: inset 0 0 0 1px var(--warn);
		color: #ffe9a8;
	}
	.hit.blackout {
		background: #78788c45;
		box-shadow: inset 0 0 0 1px #7a7a8c;
		color: #c9c9d6;
	}
	.hit.slam,
	.hit.bump {
		background: #ff6a1a45;
		box-shadow: inset 0 0 0 1px var(--live);
		color: #ffc79a;
	}
	.hit:hover {
		filter: brightness(1.5);
	}

	.playhead {
		position: absolute;
		top: 0;
		bottom: 0;
		width: 2px;
		background: var(--foreground);
		box-shadow: 0 0 5px #ffffff80;
		pointer-events: none;
	}

	/* Handles rise above the lane, so the lane must not clip while editing (the .hits precedent). */
	.sections.editing {
		overflow: visible;
	}
	.sections.editing .sec {
		cursor: pointer;
	}
	/* The grab area stops short of the lane's foot; the bar it draws does not. That bottom
	   band belongs to the movement marks, which land on a seam more often than not. */
	.handle {
		position: absolute;
		top: -3px;
		bottom: 9px;
		width: 9px;
		transform: translateX(-50%);
		cursor: col-resize;
		z-index: 3;
	}
	.handle::after {
		content: '';
		position: absolute;
		inset: 0 3px -12px;
		border-radius: 2px;
		background: var(--foreground);
		opacity: 0.55;
	}
	.handle:hover::after,
	.handle.held::after {
		opacity: 1;
		box-shadow: 0 0 5px #ffffff80;
	}
	.handle:focus-visible {
		outline: none;
	}
	/* The accent, because a selected handle is the one thing on this lane that is listening. */
	.handle.selected::after {
		opacity: 1;
		background: var(--live);
		box-shadow: 0 0 6px var(--live);
	}

	/* Heavier than a seam and taller than the lane, because it is a statement about the whole
	   track rather than about the two sections it happens to fall between. Above the handles,
	   but the line itself takes no pointer: a movement usually lands ON a boundary, and a
	   3px rule that ate the drag would cost more than it is worth. */
	.movement {
		position: absolute;
		top: -6px;
		bottom: -6px;
		width: 3px;
		transform: translateX(-50%);
		background: var(--foreground);
		pointer-events: none;
		z-index: 4;
	}
	/**
	 * The glyph keeps to a band along the foot of the lane, which is the one strip no handle
	 * claims. A mark on a seam is the ordinary case rather than the awkward one, so the two
	 * cannot be allowed to fight over the same pixels: the handle owns the height above this
	 * band at every x, and the mark owns the band.
	 */
	.movement .mark {
		position: absolute;
		left: 3px;
		bottom: 6px;
		display: flex;
		align-items: center;
		height: 9px;
		padding: 0 4px;
		font-size: 10px;
		line-height: 1;
		color: var(--foreground);
		/* The glyph is the mark's only label, so it has to hold over any section colour. */
		text-shadow: 0 0 3px #000;
		pointer-events: auto;
	}
	.movement .mark:hover {
		color: var(--live);
	}

	.picker {
		position: absolute;
		bottom: calc(100% + 8px);
		transform: translateX(-6px);
		display: flex;
		flex-direction: column;
		gap: 1px;
		padding: 5px;
		background: var(--popover);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		box-shadow: var(--shadow-md);
		z-index: 6;
	}
	.picker.flip {
		transform: translateX(calc(-100% + 6px));
	}
	.picker:focus {
		outline: none;
	}
	.kind {
		display: flex;
		align-items: center;
		gap: 7px;
		padding: 4px 9px;
		border-radius: var(--radius-sm);
		font-size: 12px;
		color: var(--muted-foreground);
		text-align: left;
	}
	.kind:hover,
	.kind.cursor {
		background: var(--hover);
		color: var(--foreground);
	}
	/* The kind this section already is, which the keyboard cursor moves over rather than
	   replaces: one says where you are, the other says where you started. */
	.kind.on {
		color: var(--foreground);
		background: var(--muted);
	}
	.kind.on::after {
		content: '✓';
		margin-left: auto;
		padding-left: 10px;
		font-size: 10px;
		color: var(--subtle-foreground);
	}
	.kind .swatch {
		width: 9px;
		height: 9px;
		border-radius: 2px;
	}

	.tooltip {
		position: absolute;
		bottom: calc(100% + 8px);
		transform: translateX(-6px);
		display: flex;
		flex-direction: column;
		gap: 2px;
		min-width: 130px;
		max-width: 300px;
		padding: 9px 11px;
		background: var(--popover);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		font-size: 12px;
		line-height: 1.5;
		color: var(--muted-foreground);
		white-space: pre-line;
		pointer-events: none;
		box-shadow: var(--shadow-md);
		z-index: 5;
	}
	.tooltip.flip {
		transform: translateX(calc(-100% + 6px));
	}
	.tooltip strong {
		color: var(--foreground);
		font-size: 12.5px;
		font-weight: 600;
	}

	.legend {
		display: flex;
		flex-wrap: wrap;
		align-items: center;
		gap: 6px 12px;
		margin-top: 10px;
		font-size: 11.5px;
	}
	.legend span {
		display: inline-flex;
		align-items: center;
		gap: 5px;
	}
	.legend .sep {
		opacity: 0.4;
	}
	.legend .spacer {
		flex: 1;
	}
	.zoom {
		display: inline-flex;
		align-items: center;
		gap: 5px;
		padding: 2px 7px;
		border-radius: var(--radius-sm);
		background: var(--muted);
		font-size: 11.5px;
		color: var(--muted-foreground);
	}
	.zoom:hover {
		background: var(--hover);
		color: var(--foreground);
	}
	.swatch {
		width: 8px;
		height: 8px;
		border-radius: 2px;
	}
	.swatch.kick {
		background: #ff6a1a;
	}
	.swatch.snare {
		background: #5aa9ff;
	}
	.swatch.hat {
		background: #8f8fa6;
	}
</style>
