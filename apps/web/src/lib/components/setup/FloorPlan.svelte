<script lang="ts">
	import { matrixOrder, type Light, type PathLight, type Vec3 } from '@mv/core';
	import type { RoomsClient } from '$lib/rooms.svelte.ts';
	import { freshId } from '$lib/rooms.ts';
	import {
		axesOf,
		dataEntry,
		faces,
		frameOf,
		gridStep,
		nearestOnSegment,
		panelCell,
		panelCorners,
		place,
		project,
		reachable,
		ringAt,
		ringOutline,
		snap,
		surfaceOf,
		type PlanView,
		type Uv
	} from '$lib/plan.ts';
	import {
		freshName,
		keepInside,
		ledsAlong,
		movePoint,
		plan,
		removePoint,
		round,
		splitRun,
		translate,
		withCopy,
		withLight,
		withoutLight
	} from '$lib/roomEdit.ts';
	import Icon from '$lib/ui/Icon.svelte';
	import Segmented from '$lib/ui/Segmented.svelte';
	import { metres } from './labels.ts';

	let { rooms, view = $bindable('top') }: { rooms: RoomsClient; view?: PlanView } = $props();

	/** Room for the dimension labels round the room, px. */
	const PAD = 30;
	/** The toolbar above the room and the hint below it, px. */
	const TOP = 44;
	const BOTTOM = 22;
	/** Metres a light snaps to when nothing nearer is lined up. */
	const GRID = 0.05;
	/** Pixels within which a point lines up with another. */
	const REACH = 8;
	const CHEVRON_EVERY = 54;
	const DENSITY = 60;

	/** A light being dragged: as it was when the drag began, and where the pointer went down. */
	type Drag =
		| { kind: 'move' | 'radius' | 'corner'; from: Uv; origin: Light; gesture: string; moved: boolean }
		| { kind: 'point'; index: number; from: Uv; origin: PathLight; gesture: string; moved: boolean };

	let box: HTMLDivElement | undefined = $state();
	let svg: SVGSVGElement | undefined = $state();
	let width = $state(0);
	let height = $state(0);

	let tool = $state<'select' | 'draw'>('select');
	let sketch = $state.raw<Vec3[]>([]);
	let cursor = $state.raw<Uv | null>(null);
	let guides = $state.raw<{ u: number | null; v: number | null }>({ u: null, v: null });
	let dragging = $state(false);
	let drag: Drag | null = null;
	let gestures = 0;

	$effect(() => {
		const el = box;
		if (!el) return;
		const ro = new ResizeObserver(() => {
			width = el.clientWidth;
			height = el.clientHeight;
		});
		ro.observe(el);
		return () => ro.disconnect();
	});

	const room = $derived(rooms.room);
	const layout = $derived(room?.layout ?? null);
	const axes = $derived(axesOf(view));
	const frame = $derived(layout ? frameOf(view, layout) : { u0: -1, u1: 1, v0: -1, v1: 1 });
	const fit = $derived.by(() => {
		const spanU = Math.max(0.01, frame.u1 - frame.u0);
		const spanV = Math.max(0.01, frame.v1 - frame.v0);
		const availableW = Math.max(1, width - PAD * 2);
		const availableH = Math.max(1, height - TOP - BOTTOM - PAD * 2);
		const scale = Math.max(1, Math.min(availableW / spanU, availableH / spanV));
		return {
			scale,
			cx: width / 2,
			cy: TOP + PAD + availableH / 2,
			uc: (frame.u0 + frame.u1) / 2,
			vc: (frame.v0 + frame.v1) / 2
		};
	});

	const selectedId = $derived(rooms.selection?.kind === 'light' ? rooms.selection.id : null);
	const selectedPoint = $derived(rooms.selection?.kind === 'light' ? rooms.selection.point : undefined);
	const selected = $derived(layout?.lights.find((l) => l.id === selectedId) ?? null);

	function sx(u: number): number {
		return fit.cx + (u - fit.uc) * fit.scale;
	}
	function sy(v: number): number {
		return fit.cy - (v - fit.vc) * fit.scale;
	}
	function screen(p: Vec3): [number, number] {
		const [u, v] = project(p, axes);
		return [sx(u), sy(v)];
	}
	function toPlan(e: { clientX: number; clientY: number }): Uv {
		const r = svg!.getBoundingClientRect();
		return [fit.uc + (e.clientX - r.left - fit.cx) / fit.scale, fit.vc - (e.clientY - r.top - fit.cy) / fit.scale];
	}
	function line(points: readonly (readonly [number, number])[], closed: boolean): string {
		if (points.length === 0) return '';
		const d = points.map(([x, y], i) => `${i === 0 ? 'M' : 'L'}${x.toFixed(1)} ${y.toFixed(1)}`).join('');
		return closed ? `${d}Z` : d;
	}

	interface Shape {
		light: Light;
		d: string;
		area: boolean;
		reach: boolean;
		wired: boolean;
		entry: [number, number] | null;
		label: { x: number; y: number; anchor: 'start' | 'middle' };
	}

	/** Beside the longest run, on the side away from where its counts go when it is selected. */
	function pathLabel(points: [number, number][], closed: boolean): Shape['label'] {
		let best = { length: -1, x: points[0][0], y: points[0][1], nx: 0, ny: 0 };
		const runs = closed ? points.length : points.length - 1;
		for (let r = 0; r < runs; r++) {
			const [ax, ay] = points[r];
			const [bx, by] = points[(r + 1) % points.length];
			const length = Math.hypot(bx - ax, by - ay);
			if (length <= best.length) continue;
			best = { length, x: (ax + bx) / 2, y: (ay + by) / 2, nx: length ? -(by - ay) / length : 0, ny: length ? (bx - ax) / length : 1 };
		}
		const vertical = Math.abs(best.ny) < 0.5;
		return { x: best.x + best.nx * 14, y: best.y + best.ny * 14, anchor: vertical ? 'start' : 'middle' };
	}

	function below(points: [number, number][]): Shape['label'] {
		const x = points.reduce((n, p) => n + p[0], 0) / points.length;
		const y = Math.max(...points.map((p) => p[1]));
		return { x, y: y + 13, anchor: 'middle' };
	}

	/** Every light as the view sees it. */
	const shapes = $derived.by((): Shape[] => {
		if (!layout) return [];
		return layout.lights.map((light) => {
			const reach = reachable(view, light);
			const wired = light.wiring !== undefined;
			const entryAt = dataEntry(light);
			const entry = entryAt ? screen(entryAt[0]) : null;
			switch (light.kind) {
				case 'path': {
					const points = light.points.map(screen);
					return { light, d: line(points, light.closed), area: false, reach, wired, entry, label: pathLabel(points, light.closed) };
				}
				case 'ring': {
					const points = ringOutline(light).map(screen);
					return { light, d: line(points, true), area: false, reach, wired, entry, label: below(points) };
				}
				case 'matrix': {
					const points = panelCorners(light).map(screen);
					return { light, d: line(points, true), area: true, reach, wired, entry, label: below(points) };
				}
				case 'lamp': {
					const [x, y] = screen(light.at);
					const r = Math.max(4, (light.diameter / 2) * fit.scale);
					const label = { x: x + r + 6, y: view === 'top' ? y : y - 8, anchor: 'start' as const };
					if (view === 'top') {
						return {
							light,
							d: `M${x - r} ${y}a${r} ${r} 0 1 0 ${2 * r} 0a${r} ${r} 0 1 0 ${-2 * r} 0Z`,
							area: true,
							reach,
							wired,
							entry: null,
							label
						};
					}
					const top = Math.min(y - 4, sy(project(light.at, axes)[1] + light.height));
					return { light, d: `M${x - r} ${y}L${x + r} ${y}L${x + r} ${top}L${x - r} ${top}Z`, area: true, reach, wired, entry: null, label };
				}
			}
		});
	});

	/** The light's LEDs as the data walks them, for the arrows along the selected light. */
	const route = $derived.by((): [number, number][] => {
		const light = selected;
		if (!light) return [];
		const reversed = light.wiring?.reversed === true;
		if (light.kind === 'path') {
			const points = [...light.points];
			const order = light.closed ? [...points, points[0]] : points;
			return (reversed ? order.reverse() : order).map(screen);
		}
		if (light.kind === 'ring') {
			return Array.from({ length: 73 }, (_, k) => screen(ringAt(light, (reversed ? -5 : 5) * k)));
		}
		// Two lines of a panel say where its data enters, which way it runs, and whether it zigzags.
		if (light.kind === 'matrix' && faces(view, light.mount)) {
			const order = reversed ? matrixOrder(light).reverse() : matrixOrder(light);
			return order.slice(0, (light.horizontal ? light.columns : light.rows) * 2).map(([c, r]) => screen(panelCell(light, c, r)));
		}
		return [];
	});

	/** Evenly spaced along the route, pointing the way the data goes. */
	const chevrons = $derived.by(() => {
		const out: { x: number; y: number; angle: number }[] = [];
		let carried = CHEVRON_EVERY / 2;
		for (let i = 1; i < route.length; i++) {
			const [ax, ay] = route[i - 1];
			const [bx, by] = route[i];
			const length = Math.hypot(bx - ax, by - ay);
			if (length < 0.001) continue;
			const angle = (Math.atan2(by - ay, bx - ax) * 180) / Math.PI;
			let at = carried;
			while (at <= length) {
				out.push({ x: ax + ((bx - ax) * at) / length, y: ay + ((by - ay) * at) / length, angle });
				at += CHEVRON_EVERY;
			}
			carried = at - length;
		}
		return out;
	});

	/** For the selected path: its points, and the middle of each run with its LED count. */
	const handles = $derived.by(() => {
		const light = selected;
		if (!light || light.kind !== 'path' || !reachable(view, light)) return null;
		const points = light.points.map(screen);
		const runs = light.counts.map((count, r) => {
			const [ax, ay] = points[r];
			const [bx, by] = points[(r + 1) % points.length];
			const length = Math.hypot(bx - ax, by - ay);
			// Labels sit to the left of the run's direction, outside a loop drawn clockwise.
			const nx = length > 0 ? (by - ay) / length : 0;
			const ny = length > 0 ? -(bx - ax) / length : 0;
			return { x: (ax + bx) / 2, y: (ay + by) / 2, lx: (ax + bx) / 2 + nx * 13, ly: (ay + by) / 2 + ny * 13, count, long: length > 44 };
		});
		return { points, runs };
	});

	/** The one handle a ring or panel has, seen face on: its radius, or its far corner. */
	const sizer = $derived.by(() => {
		const light = selected;
		if (!light || !faces(view, light.kind === 'lamp' ? 'floor' : light.mount) || !reachable(view, light)) return null;
		if (light.kind === 'ring') {
			const [u, v] = project(light.centre, axes);
			return { kind: 'radius' as const, x: sx(u + light.radius), y: sy(v) };
		}
		if (light.kind === 'matrix') {
			const [x, y] = screen(panelCorners(light)[2]);
			return { kind: 'corner' as const, x, y };
		}
		return null;
	});

	const grid = $derived.by(() => {
		const step = gridStep(fit.scale);
		const us: { at: number; major: boolean }[] = [];
		const vs: { at: number; major: boolean }[] = [];
		const major = (m: number) => Math.abs(m - Math.round(m)) < 1e-6;
		for (let u = Math.ceil(frame.u0 / step) * step; u <= frame.u1 + 1e-9; u += step) us.push({ at: sx(u), major: major(u) });
		for (let v = Math.ceil(frame.v0 / step) * step; v <= frame.v1 + 1e-9; v += step) vs.push({ at: sy(v), major: major(v) });
		return { us, vs };
	});

	const outline = $derived({ x0: sx(frame.u0), x1: sx(frame.u1), y0: sy(frame.v1), y1: sy(frame.v0) });

	/** Which side of the drawing the front wall is, in the top view. */
	const front = $derived.by(() => {
		if (!layout || view !== 'top') return null;
		const { x0, x1, y0, y1 } = outline;
		switch (layout.front) {
			case 'north':
				return { x1: x0, y1: y0, x2: x1, y2: y0, lx: (x0 + x1) / 2, ly: y0 - 8, rotate: 0 };
			case 'south':
				return { x1: x0, y1, x2: x1, y2: y1, lx: (x0 + x1) / 2, ly: y1 + 16, rotate: 0 };
			case 'east':
				return { x1, y1: y0, x2: x1, y2: y1, lx: x1 + 16, ly: (y0 + y1) / 2, rotate: 90 };
			case 'west':
				return { x1: x0, y1: y0, x2: x0, y2: y1, lx: x0 - 16, ly: (y0 + y1) / 2, rotate: -90 };
		}
	});

	const hint = $derived.by(() => {
		if (tool === 'draw') {
			return sketch.length === 0
				? 'Click where the strip starts.'
				: sketch.length < 3
					? 'Click to add a corner. Enter finishes it, Esc cancels.'
					: 'Click the first point to close a loop, or press Enter to finish.';
		}
		if (selected?.kind === 'path') return 'Drag a point to reshape. Double-click a run to add one; Delete removes the selected point.';
		if (selected) return 'Drag to move, arrow keys to nudge. Hold Alt to place it off the grid.';
		if (layout && layout.lights.length > 0) return 'Select a light to edit it, or drag it into place.';
		return '';
	});

	function edgeGuides(): { us: number[]; vs: number[] } {
		const us = [frame.u0, frame.u1, (frame.u0 + frame.u1) / 2];
		const vs = view === 'top' ? [frame.v0, frame.v1, 0] : [frame.v0, frame.v1];
		return { us, vs };
	}

	function snapTo(target: Uv, us: number[], vs: number[], free: boolean): Uv {
		if (free) {
			guides = { u: null, v: null };
			return [round(target[0]), round(target[1])];
		}
		const reach = REACH / fit.scale;
		const a = snap(target[0], us, reach, GRID);
		const b = snap(target[1], vs, reach, GRID);
		guides = { u: a.guide, v: b.guide };
		return [round(a.value), round(b.value)];
	}

	function inside(p: Vec3): Vec3 {
		if (!layout) return p;
		const hw = layout.width / 2;
		const hd = layout.depth / 2;
		const c = (v: number, lo: number, hi: number) => round(Math.min(hi, Math.max(lo, v)));
		return [c(p[0], -hw, hw), c(p[1], -hd, hd), c(p[2], 0, layout.height)];
	}

	function begin(e: PointerEvent, next: Drag) {
		if (e.button !== 0) return;
		e.stopPropagation();
		drag = next;
		svg?.setPointerCapture(e.pointerId);
	}

	function pickLight(e: PointerEvent, light: Light) {
		if (tool === 'draw') return;
		rooms.select({ kind: 'light', id: light.id });
		begin(e, { kind: 'move', from: toPlan(e), origin: light, gesture: `drag-${++gestures}`, moved: false });
	}

	function pickPoint(e: PointerEvent, light: PathLight, index: number) {
		if (e.altKey) {
			e.stopPropagation();
			removeAt(light, index);
			return;
		}
		rooms.select({ kind: 'light', id: light.id, point: index });
		begin(e, { kind: 'point', index, from: toPlan(e), origin: light, gesture: `drag-${++gestures}`, moved: false });
	}

	function pickSizer(e: PointerEvent, kind: 'radius' | 'corner') {
		if (!selected) return;
		begin(e, { kind, from: toPlan(e), origin: selected, gesture: `drag-${++gestures}`, moved: false });
	}

	function onpointermove(e: PointerEvent) {
		if (tool === 'draw') {
			cursor = sketchAt(e);
			return;
		}
		const d = drag;
		if (!d || !layout) return;
		const at = toPlan(e);
		if (!d.moved) {
			const px = Math.hypot(at[0] - d.from[0], at[1] - d.from[1]) * fit.scale;
			if (px < 3) return;
			d.moved = true;
			dragging = true;
		}
		const du = at[0] - d.from[0];
		const dv = at[1] - d.from[1];
		const free = e.altKey;
		const edges = edgeGuides();
		let next: Light;

		if (d.kind === 'move') {
			// The light's first point lands on the grid, and the rest of it follows.
			const anchor = plan(d.origin)[0];
			const ref = project(anchor, axes);
			const moved = place(snapTo([ref[0] + du, ref[1] + dv], edges.us, edges.vs, free), anchor, axes);
			next = translate(d.origin, moved[0] - anchor[0], moved[1] - anchor[1], moved[2] - anchor[2]);
			next = keepInside(next, layout.width, layout.depth, layout.height);
		} else if (d.kind === 'point') {
			const light = d.origin;
			const n = light.points.length;
			const neighbours = [d.index - 1, d.index + 1]
				.filter((i) => light.closed || (i >= 0 && i < n))
				.map((i) => project(light.points[(i + n) % n], axes));
			const start = project(light.points[d.index], axes);
			const [u, v] = snapTo(
				[start[0] + du, start[1] + dv],
				[...edges.us, ...neighbours.map((p) => p[0])],
				[...edges.vs, ...neighbours.map((p) => p[1])],
				free
			);
			next = movePoint(light, d.index, inside(place([u, v], light.points[d.index], axes)));
		} else if (d.kind === 'radius' && d.origin.kind === 'ring') {
			const c = project(d.origin.centre, axes);
			const raw = Math.hypot(at[0] - c[0], at[1] - c[1]);
			const radius = Math.max(0.03, free ? round(raw) : Math.round(raw / GRID) * GRID);
			next = { ...d.origin, radius: round(radius) };
		} else if (d.kind === 'corner' && d.origin.kind === 'matrix') {
			const panel = d.origin;
			const c = project(panel.centre, axes);
			const left = c[0] - panel.width / 2;
			const top = c[1] + panel.height / 2;
			const [u, v] = snapTo(at, [], [], free);
			const w = Math.max(0.02, round(u - left));
			const h = Math.max(0.02, round(top - v));
			const centre = place([left + w / 2, top - h / 2], panel.centre, axes);
			next = { ...panel, width: w, height: h, centre: inside(centre) };
		} else {
			return;
		}
		rooms.edit((r) => withLight(r, next), d.gesture);
	}

	function onpointerup(e: PointerEvent) {
		if (svg?.hasPointerCapture(e.pointerId)) svg.releasePointerCapture(e.pointerId);
		if (drag?.moved) rooms.settle();
		drag = null;
		dragging = false;
		guides = { u: null, v: null };
	}

	function onbackground(e: PointerEvent) {
		if (e.button !== 0) return;
		if (tool === 'draw') {
			addSketchPoint(e);
			return;
		}
		rooms.select(null);
	}

	function ondblclick(e: MouseEvent) {
		if (tool === 'draw') {
			finishSketch(false);
			return;
		}
		const light = selected;
		if (!light || light.kind !== 'path' || !reachable(view, light)) return;
		const at = toPlan(e);
		const points = light.points.map((p) => project(p, axes));
		let best: { run: number; t: number; distance: number } | null = null;
		for (let r = 0; r < light.counts.length; r++) {
			const hit = nearestOnSegment(at, points[r], points[(r + 1) % points.length]);
			if (!best || hit.distance < best.distance) best = { run: r, ...hit };
		}
		if (!best || best.distance * fit.scale > 12) return;
		split(light, best.run, best.t);
	}

	function split(light: PathLight, run: number, t: number) {
		rooms.edit((r) => withLight(r, splitRun(light, run, Math.min(0.95, Math.max(0.05, t)))));
		rooms.select({ kind: 'light', id: light.id, point: run + 1 });
	}

	function removeAt(light: PathLight, index: number) {
		const next = removePoint(light, index);
		if (next === light) return;
		rooms.edit((r) => withLight(r, next));
		rooms.select({ kind: 'light', id: light.id });
	}

	// Drawing a strip.

	function sketchAt(e: PointerEvent): Uv {
		const edges = edgeGuides();
		const placed = sketch.map((p) => project(p, axes));
		const last = placed.at(-1);
		const first = placed[0];
		const us = [...edges.us, ...(last ? [last[0]] : []), ...(first ? [first[0]] : [])];
		const vs = [...edges.vs, ...(last ? [last[1]] : []), ...(first ? [first[1]] : [])];
		const [u, v] = snapTo(toPlan(e), us, vs, e.altKey);
		return [Math.min(frame.u1, Math.max(frame.u0, u)), Math.min(frame.v1, Math.max(frame.v0, v))];
	}

	function addSketchPoint(e: PointerEvent) {
		if (!layout) return;
		const at = sketchAt(e);
		const first = sketch[0];
		if (first && sketch.length >= 3) {
			const [fu, fv] = project(first, axes);
			if (Math.hypot(at[0] - fu, at[1] - fv) * fit.scale <= 10) {
				finishSketch(true);
				return;
			}
		}
		const point = place(at, surfaceOf(view, layout).anchor, axes);
		const last = sketch.at(-1);
		if (last && Math.hypot(point[0] - last[0], point[1] - last[1], point[2] - last[2]) < 0.01) return;
		sketch = [...sketch, point];
	}

	function finishSketch(closed: boolean) {
		const points = sketch;
		if (!layout || !room || points.length < (closed ? 3 : 2)) {
			if (points.length > 0) cancelSketch();
			return;
		}
		const runs = closed ? points.length : points.length - 1;
		const counts = Array.from({ length: runs }, (_, r) => ledsAlong(points[r], points[(r + 1) % points.length], DENSITY));
		const taken = layout.lights.map((l) => l.name);
		const light: PathLight = {
			id: freshId(closed ? 'loop' : 'strip', layout.lights.map((l) => l.id)),
			name: freshName(closed ? 'Loop' : 'Strip', taken),
			kind: 'path',
			points,
			counts,
			closed,
			density: DENSITY,
			mount: surfaceOf(view, layout).mount,
			role: 'auto'
		};
		rooms.edit((r) => withLight(r, light));
		rooms.select({ kind: 'light', id: light.id });
		cancelSketch();
		tool = 'select';
	}

	function cancelSketch() {
		sketch = [];
		cursor = null;
		guides = { u: null, v: null };
	}

	export function startDrawing() {
		rooms.select(null);
		cancelSketch();
		tool = 'draw';
	}

	/** Keys for the setup. True when the key was the plan's to handle. */
	export function key(e: KeyboardEvent): boolean {
		const mod = e.metaKey || e.ctrlKey;
		if (mod && e.key.toLowerCase() === 'z') {
			if (e.shiftKey) rooms.redo();
			else rooms.undo();
			return true;
		}
		if (mod && e.key.toLowerCase() === 'y') {
			rooms.redo();
			return true;
		}
		if (tool === 'draw') {
			if (e.key === 'Escape') {
				if (sketch.length > 0) cancelSketch();
				else tool = 'select';
				return true;
			}
			if (e.key === 'Enter') {
				finishSketch(false);
				return true;
			}
			if (e.key === 'Backspace' || e.key === 'Delete') {
				sketch = sketch.slice(0, -1);
				return true;
			}
			return false;
		}
		const light = selected;
		if (mod && e.key.toLowerCase() === 'd' && light && room) {
			const copy = withCopy(room, light.id);
			if (copy) {
				rooms.edit(() => copy.room);
				rooms.select({ kind: 'light', id: copy.id });
			}
			return true;
		}
		if (e.key === 'Escape' && rooms.selection) {
			rooms.select(null);
			return true;
		}
		if ((e.key === 'Delete' || e.key === 'Backspace') && light) {
			if (light.kind === 'path' && selectedPoint !== undefined) removeAt(light, selectedPoint);
			else {
				rooms.edit((r) => withoutLight(r, light.id));
				rooms.select(null);
			}
			return true;
		}
		const arrows: Record<string, Uv> = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, 1], ArrowDown: [0, -1] };
		const step = arrows[e.key];
		if (step && light && layout) {
			const by = e.shiftKey ? 0.1 : 0.01;
			const [du, dv] = [step[0] * by, step[1] * by];
			let next: Light;
			if (light.kind === 'path' && selectedPoint !== undefined) {
				const [u, v] = project(light.points[selectedPoint], axes);
				next = movePoint(light, selectedPoint, inside(place([u + du, v + dv], light.points[selectedPoint], axes)));
			} else {
				const anchor = plan(light)[0];
				const [u, v] = project(anchor, axes);
				const moved = place([u + du, v + dv], anchor, axes);
				next = keepInside(
					translate(light, moved[0] - anchor[0], moved[1] - anchor[1], moved[2] - anchor[2]),
					layout.width,
					layout.depth,
					layout.height
				);
			}
			rooms.edit((r) => withLight(r, next), `nudge-${light.id}`);
			return true;
		}
		return false;
	}

	// Another view drops a half-drawn strip.
	$effect(() => {
		void view;
		cancelSketch();
	});

	const VIEWS: { id: PlanView; label: string; title: string }[] = [
		{ id: 'top', label: 'Plan', title: 'The room from above' },
		{ id: 'north', label: 'North', title: 'The north wall, seen from inside' },
		{ id: 'east', label: 'East', title: 'The east wall, seen from inside' },
		{ id: 'south', label: 'South', title: 'The south wall, seen from inside' },
		{ id: 'west', label: 'West', title: 'The west wall, seen from inside' }
	];

	const sketchLine = $derived.by(() => {
		if (tool !== 'draw' || sketch.length === 0) return null;
		const placed = sketch.map(screen);
		const end = cursor ? ([sx(cursor[0]), sy(cursor[1])] as [number, number]) : null;
		const last = sketch.at(-1)!;
		const lastUv = project(last, axes);
		const metresLeft = cursor ? Math.hypot(cursor[0] - lastUv[0], cursor[1] - lastUv[1]) : 0;
		return {
			d: line(end ? [...placed, end] : placed, false),
			points: placed,
			end,
			label: end ? `${metres(metresLeft)} · ${Math.round(metresLeft * DENSITY)} LEDs` : '',
			closing:
				end !== null &&
				sketch.length >= 3 &&
				Math.hypot(end[0] - placed[0][0], end[1] - placed[0][1]) <= 10
		};
	});
</script>

<div class="plan" bind:this={box} class:drawing={tool === 'draw'} class:dragging>
	{#if layout && width > 0}
		<svg
			bind:this={svg}
			{width}
			{height}
			role="application"
			aria-label="Floor plan"
			onpointerdown={onbackground}
			{onpointermove}
			{onpointerup}
			onpointercancel={onpointerup}
			onpointerleave={() => (cursor = tool === 'draw' ? null : cursor)}
			{ondblclick}>
			<g class="grid">
				{#each grid.us as g (g.at)}
					<line x1={g.at} x2={g.at} y1={outline.y0} y2={outline.y1} class:major={g.major} />
				{/each}
				{#each grid.vs as g (g.at)}
					<line y1={g.at} y2={g.at} x1={outline.x0} x2={outline.x1} class:major={g.major} />
				{/each}
			</g>

			<rect
				class="room"
				x={outline.x0}
				y={outline.y0}
				width={outline.x1 - outline.x0}
				height={outline.y1 - outline.y0} />
			{#if front}
				<line class="front" x1={front.x1} y1={front.y1} x2={front.x2} y2={front.y2} />
				<text class="front-label" x={front.lx} y={front.ly} transform="rotate({front.rotate} {front.lx} {front.ly})">Front</text>
			{/if}

			<text class="dimension" x={(outline.x0 + outline.x1) / 2} y={outline.y0 - 12}>{metres(frame.u1 - frame.u0)}</text>
			<text
				class="dimension"
				x={outline.x0 - 12}
				y={(outline.y0 + outline.y1) / 2}
				transform="rotate(-90 {outline.x0 - 12} {(outline.y0 + outline.y1) / 2})">{metres(frame.v1 - frame.v0)}</text>
			{#if view === 'top'}
				<g class="north" transform="translate({outline.x1 + 16} {outline.y0 + 4})">
					<path d="M0 -7L4 3L0 1L-4 3Z" />
					<text y="15">N</text>
				</g>
			{/if}

			{#each shapes as s (s.light.id)}
				{@const isSelected = s.light.id === selectedId}
				<g
					class="light"
					class:selected={isSelected}
					class:hovered={rooms.hovered === s.light.id}
					class:unwired={!s.wired}
					class:away={!s.reach}
					class:area={s.area}
					role="button"
					tabindex="-1"
					aria-label={s.light.name}
					onpointerenter={() => (rooms.hovered = s.light.id)}
					onpointerleave={() => (rooms.hovered = rooms.hovered === s.light.id ? null : rooms.hovered)}
					onpointerdown={(e) => s.reach && pickLight(e, s.light)}>
					<title>{s.light.name}</title>
					<path class="hit" d={s.d} />
					<path class="shape" d={s.d} />
					{#if s.entry}<circle class="entry" cx={s.entry[0]} cy={s.entry[1]} r={isSelected ? 4 : 3} />{/if}
					<text class="name" x={s.label.x} y={s.label.y} text-anchor={s.label.anchor}>{s.light.name}</text>
				</g>
			{/each}

			{#if selected && route.length > 1}
				<g class="route" class:snake={selected.kind === 'matrix'}>
					{#if selected.kind === 'matrix'}<path d={line(route, false)} />{/if}
					{#each chevrons as c, i (i)}
						<path class="chevron" d="M-3 -4L2 0L-3 4" transform="translate({c.x} {c.y}) rotate({c.angle})" />
					{/each}
				</g>
			{/if}

			{#if handles && selected?.kind === 'path'}
				{@const light = selected}
				{#each handles.runs as run, r (r)}
					<text class="count" x={run.lx} y={run.ly}>{run.count}</text>
					{#if run.long}
						<g
							class="split"
							role="button"
							tabindex="-1"
							aria-label="Add a point here"
							onpointerdown={(e) => {
								e.stopPropagation();
								split(light, r, 0.5);
							}}>
							<circle cx={run.x} cy={run.y} r="7" />
							<path d="M{run.x - 3} {run.y}h6M{run.x} {run.y - 3}v6" />
						</g>
					{/if}
				{/each}
				{#each handles.points as [x, y], i (i)}
					<circle
						class="handle"
						class:picked={selectedPoint === i}
						cx={x}
						cy={y}
						r={selectedPoint === i ? 6 : 5}
						role="button"
						tabindex="-1"
						aria-label="Point {i + 1}"
						onpointerdown={(e) => pickPoint(e, light, i)} />
				{/each}
			{/if}

			{#if sizer}
				<rect
					class="handle sizer"
					x={sizer.x - 5}
					y={sizer.y - 5}
					width="10"
					height="10"
					rx="2"
					role="button"
					tabindex="-1"
					aria-label={sizer.kind === 'radius' ? 'Radius' : 'Size'}
					onpointerdown={(e) => pickSizer(e, sizer.kind)} />
			{/if}

			{#if guides.u !== null}
				<line class="guide" x1={sx(guides.u)} x2={sx(guides.u)} y1={outline.y0 - 6} y2={outline.y1 + 6} />
			{/if}
			{#if guides.v !== null}
				<line class="guide" y1={sy(guides.v)} y2={sy(guides.v)} x1={outline.x0 - 6} x2={outline.x1 + 6} />
			{/if}

			{#if sketchLine}
				<path class="sketch" d={sketchLine.d} />
				{#each sketchLine.points as [x, y], i (i)}
					<circle class="handle" class:closing={i === 0 && sketchLine.closing} cx={x} cy={y} r={i === 0 && sketchLine.closing ? 7 : 4} />
				{/each}
				{#if sketchLine.end && sketchLine.label}
					<text class="measure" x={sketchLine.end[0] + 12} y={sketchLine.end[1] - 10}>{sketchLine.label}</text>
				{/if}
			{/if}
		</svg>
	{/if}

	<div class="tools">
		<Segmented options={VIEWS} bind:value={view} variant="glass" ariaLabel="Seen from" />
		<button
			class="tool"
			class:on={tool === 'draw'}
			aria-pressed={tool === 'draw'}
			title="Draw a strip: click where it runs, point by point"
			onclick={() => (tool === 'draw' ? ((tool = 'select'), cancelSketch()) : startDrawing())}>
			<Icon name="strip" size={14} />
			<span>Draw</span>
		</button>
		<span class="spacer"></span>
		<div class="pair">
			<button class="tool icon" title="Undo" aria-label="Undo" disabled={!rooms.canUndo} onclick={() => rooms.undo()}>
				<Icon name="undo" size={14} />
			</button>
			<button class="tool icon" title="Redo" aria-label="Redo" disabled={!rooms.canRedo} onclick={() => rooms.redo()}>
				<Icon name="redo" size={14} />
			</button>
		</div>
	</div>

	{#if layout && layout.lights.length === 0 && tool === 'select'}
		<div class="empty">
			<p class="title">This room has no lights yet</p>
			<p>Draw a strip where it runs, or add one from the list on the left.</p>
			<button class="start" onclick={startDrawing}>
				<Icon name="strip" size={14} />
				Draw a strip
			</button>
		</div>
	{/if}

	{#if hint}<p class="hint">{hint}</p>{/if}
</div>

<style>
	.plan {
		position: relative;
		min-height: 0;
		overflow: hidden;
		background: var(--panel);
		backdrop-filter: var(--panel-blur);
		border-bottom: 1px solid var(--border);
		user-select: none;
	}
	.plan.drawing svg {
		cursor: crosshair;
	}
	.plan.dragging svg {
		cursor: grabbing;
	}
	svg {
		display: block;
		touch-action: none;
	}

	.grid line {
		stroke: #ffffff08;
		stroke-width: 1;
	}
	.grid line.major {
		stroke: #ffffff12;
	}
	.room {
		fill: #ffffff05;
		stroke: #3a3a42;
		stroke-width: 1.5;
	}
	.front {
		stroke: var(--muted-foreground);
		stroke-width: 3;
		stroke-linecap: round;
	}
	text {
		font-family: var(--sans);
		font-size: 11px;
		fill: var(--subtle-foreground);
		text-anchor: middle;
		dominant-baseline: middle;
	}
	.front-label {
		fill: var(--muted-foreground);
		font-weight: 500;
	}
	.dimension,
	.count,
	.measure {
		font-family: var(--mono);
		font-variant-numeric: tabular-nums;
	}
	.north path {
		fill: var(--subtle-foreground);
	}

	.light {
		cursor: grab;
	}
	.light .hit {
		fill: none;
		stroke: transparent;
		stroke-width: 14;
		stroke-linejoin: round;
	}
	.light.area .hit {
		fill: transparent;
	}
	.light .shape {
		fill: none;
		stroke: #8b8b94;
		stroke-width: 2.5;
		stroke-linejoin: round;
		stroke-linecap: round;
		transition: stroke 0.12s ease;
	}
	.light.area .shape {
		fill: #ffffff10;
	}
	.light.unwired .shape {
		stroke-dasharray: 5 4;
	}
	.light.hovered .shape {
		stroke: #d4d4d8;
	}
	.light.selected .shape {
		stroke: var(--foreground);
		stroke-width: 3;
	}
	.light.selected.area .shape {
		fill: #ffffff1c;
	}
	.light.away {
		opacity: 0.3;
		pointer-events: none;
	}
	.entry {
		fill: #a1a1aa;
		pointer-events: none;
	}
	.name {
		font-size: 11.5px;
		fill: var(--subtle-foreground);
		stroke: #0f0f12;
		stroke-width: 3px;
		stroke-linejoin: round;
		paint-order: stroke;
		pointer-events: none;
		transition: fill 0.12s ease;
	}
	.light.hovered .name,
	.light.selected .name {
		fill: var(--foreground);
	}
	.light.selected .entry {
		fill: var(--foreground);
	}

	.route {
		pointer-events: none;
	}
	.route.snake path:first-child {
		fill: none;
		stroke: #ffffff38;
		stroke-width: 1;
	}
	.chevron {
		fill: none;
		stroke: var(--foreground);
		stroke-width: 1.6;
		stroke-linecap: round;
		stroke-linejoin: round;
	}
	.count {
		fill: var(--muted-foreground);
		pointer-events: none;
	}

	.handle {
		fill: var(--foreground);
		stroke: #09090b;
		stroke-width: 1.5;
		cursor: move;
	}
	.handle.picked {
		stroke: var(--foreground);
		stroke-width: 2;
		fill: #09090b;
	}
	.handle.sizer {
		cursor: nwse-resize;
	}
	.handle.closing {
		fill: none;
		stroke: var(--foreground);
		stroke-width: 2;
	}
	.split {
		cursor: copy;
		opacity: 0.5;
		transition: opacity 0.12s ease;
	}
	.split:hover {
		opacity: 1;
	}
	.split circle {
		fill: #18181c;
		stroke: #52525b;
		stroke-width: 1;
	}
	.split path {
		stroke: var(--foreground);
		stroke-width: 1.4;
		stroke-linecap: round;
	}
	.guide {
		stroke: #ffffff45;
		stroke-width: 1;
		stroke-dasharray: 3 3;
		pointer-events: none;
	}
	.sketch {
		fill: none;
		stroke: var(--foreground);
		stroke-width: 2.5;
		stroke-dasharray: 6 4;
		stroke-linecap: round;
		pointer-events: none;
	}
	.measure {
		fill: var(--foreground);
		text-anchor: start;
	}

	.tools {
		position: absolute;
		top: 0;
		left: 0;
		right: 0;
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 10px 12px;
		pointer-events: none;
	}
	.tools > :global(*) {
		pointer-events: auto;
	}
	.spacer {
		flex: 1;
		pointer-events: none;
	}
	.tool {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 32px;
		padding: 0 11px;
		border-radius: var(--radius-md);
		background: #0d0d10cc;
		backdrop-filter: blur(10px);
		border: 1px solid #ffffff14;
		font-size: 12.5px;
		font-weight: 500;
		color: var(--muted-foreground);
		transition:
			background-color 0.13s ease,
			border-color 0.13s ease,
			color 0.13s ease;
	}
	.tool:hover:not(:disabled) {
		color: var(--foreground);
		border-color: #ffffff2b;
	}
	.tool.on {
		background: #ffffff17;
		border-color: #ffffff2b;
		color: var(--foreground);
	}
	.tool:disabled {
		opacity: 0.4;
	}
	.tool.icon {
		width: 32px;
		padding: 0;
		justify-content: center;
	}
	.pair {
		display: flex;
		gap: 4px;
	}

	.empty {
		position: absolute;
		left: 50%;
		top: 50%;
		translate: -50% -50%;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 6px;
		max-width: 320px;
		padding: 18px 20px;
		text-align: center;
		border-radius: var(--radius-lg);
		background: #0d0d10e6;
		border: 1px solid var(--border);
		box-shadow: var(--shadow-md);
		font-size: 13px;
		color: var(--muted-foreground);
	}
	.empty .title {
		font-weight: 600;
		color: var(--foreground);
	}
	.start {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		height: var(--h-sm);
		margin-top: 8px;
		padding: 0 12px;
		border-radius: var(--radius-md);
		background: var(--primary);
		color: var(--primary-foreground);
		font-size: 13px;
		font-weight: 600;
	}
	.hint {
		position: absolute;
		left: 14px;
		right: 14px;
		bottom: 8px;
		font-size: 12px;
		color: var(--subtle-foreground);
		pointer-events: none;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
</style>
