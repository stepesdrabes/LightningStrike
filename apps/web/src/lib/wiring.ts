import { ledCount, type Light, type RoomModel } from '@mv/core';
import type { Controller, Room } from './rooms.ts';

/** What one controller is sent: every pixel it carries, and where in the show each comes from. */
export interface ControllerPlan {
	controller: Controller;
	pixels: number;
	/** Show pixel per controller pixel, -1 where nothing is wired. */
	source: Int32Array;
	/** Per controller pixel, its light's own level, or null when every level is 1. */
	levels: Float32Array | null;
	/** Summary lamps it carries: the controller pixel, and which of the room's lamps it shows. */
	lamps: { pixel: number; lamp: number }[];
}

export interface WiringPlan {
	controllers: ControllerPlan[];
	/** Wiring that cannot all be true at once, in words. */
	problems: string[];
}

/** A light's share of a controller: `count` pixels from `from`. */
export interface Span {
	light: Light;
	from: number;
	count: number;
}

/** Controller pixels a light takes: its LEDs, or the one pixel a summary lamp is sent. */
export function pixelsOf(light: Light): number {
	return light.kind === 'lamp' && light.mode === 'summary' ? 1 : ledCount(light);
}

/** The lights wired to a controller, in pixel order. */
export function spansOf(room: Room, controllerId: string): Span[] {
	return room.layout.lights
		.filter((l) => l.wiring?.controller === controllerId)
		.map((light) => ({ light, from: light.wiring!.start, count: pixelsOf(light) }))
		.sort((a, b) => a.from - b.from);
}

/** Pixels a controller is sent: up to the end of its last light. */
export function extentOf(spans: readonly Span[]): number {
	return spans.reduce((n, s) => Math.max(n, s.from + s.count), 0);
}

/** Two lights sharing controller pixels, in words. */
export function wiringProblems(room: Room): string[] {
	const problems: string[] = [];
	for (const controller of room.controllers) {
		const spans = spansOf(room, controller.id);
		spans.forEach((a, i) => {
			for (const b of spans.slice(i + 1)) {
				const from = Math.max(a.from, b.from);
				const to = Math.min(a.from + a.count, b.from + b.count) - 1;
				if (from > to) continue;
				const which = from === to ? `pixel ${from}` : `pixels ${from} to ${to}`;
				problems.push(`"${a.light.name}" and "${b.light.name}" both use ${which} of "${controller.name}".`);
			}
		});
	}
	return problems;
}

/** Where every wired light lands, per controller. Lights with no wiring play in the preview only. */
export function planWiring(room: Room, model: RoomModel): WiringPlan {
	const plans = room.controllers.map((controller) => {
		const spans = spansOf(room, controller.id);
		const pixels = extentOf(spans);
		const source = new Int32Array(pixels).fill(-1);
		const levels = spans.some((s) => (s.light.level ?? 1) < 1) ? new Float32Array(pixels).fill(1) : null;
		const lamps: { pixel: number; lamp: number }[] = [];

		for (const { light, from, count } of spans) {
			// A summary lamp's level is applied where its colour is made, with the director's own.
			if (light.kind === 'lamp' && light.mode === 'summary') {
				const lamp = model.lamps.findIndex((l) => l.id === light.id);
				if (lamp >= 0) lamps.push({ pixel: from, lamp });
				continue;
			}
			if (levels) levels.fill(light.level ?? 1, from, from + count);
			const lit = model.pixels.find((p) => p.light.id === light.id);
			if (!lit) continue;
			const n = lit.index.length;
			for (let k = 0; k < n; k++) {
				source[from + k] = lit.index[light.wiring!.reversed ? n - 1 - k : k];
			}
		}
		return { controller, pixels, source, levels, lamps };
	});

	return { controllers: plans, problems: wiringProblems(room) };
}

/** Assemble one controller's frame from the show's bytes and the lamps' bytes. */
export function fillController(plan: ControllerPlan, bytes: Uint8Array, lamps: Uint8Array, out: Uint8Array): void {
	const { source, levels } = plan;
	for (let p = 0; p < plan.pixels; p++) {
		const s = source[p];
		const o = p * 3;
		if (s < 0) {
			out[o] = 0;
			out[o + 1] = 0;
			out[o + 2] = 0;
			continue;
		}
		const i = s * 3;
		if (levels && levels[p] < 1) {
			const k = levels[p];
			out[o] = Math.round(bytes[i] * k);
			out[o + 1] = Math.round(bytes[i + 1] * k);
			out[o + 2] = Math.round(bytes[i + 2] * k);
		} else {
			out[o] = bytes[i];
			out[o + 1] = bytes[i + 1];
			out[o + 2] = bytes[i + 2];
		}
	}
	for (const { pixel, lamp } of plan.lamps) {
		out[pixel * 3] = lamps[lamp * 3];
		out[pixel * 3 + 1] = lamps[lamp * 3 + 1];
		out[pixel * 3 + 2] = lamps[lamp * 3 + 2];
	}
}
