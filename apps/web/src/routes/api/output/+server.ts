import { error, json } from '@sveltejs/kit';
import type { LightTestKind, RoomSync } from '@mv/core';
import { loadCurrent, output } from '$lib/server/output.ts';
import { queue } from '$lib/server/queueStore.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => json(output.status);

/** The browser's room decisions, taken only in the shape the director expects. */
function decisionsFrom(value: unknown): RoomSync | undefined {
	if (typeof value !== 'object' || value === null) return undefined;
	const o = value as Record<string, unknown>;
	const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
	const ambience = num(o.ambience);
	const stopped = num(o.stopped);
	const sceneCounter = num(o.sceneCounter);
	const sceneHeld = num(o.sceneHeld);
	const idleT = num(o.idleT);
	if (
		ambience === null ||
		stopped === null ||
		sceneCounter === null ||
		sceneHeld === null ||
		idleT === null ||
		typeof o.scene !== 'string'
	) {
		return undefined;
	}
	const exposure = num(o.exposure);
	return { ambience, stopped, scene: o.scene, sceneCounter, sceneHeld, idleT, ...(exposure !== null ? { exposure } : {}) };
}

const TESTS: readonly LightTestKind[] = ['identify', 'walk', 'colours'];

/**
 * `start` lights the room that plays with whatever the queue has on; `reload` reads the current
 * show from disk again after it was rerolled or re-read; `sync` carries the browser's position;
 * `test` draws a setup pattern on some lights until `untest`.
 */
export const POST: RequestHandler = async ({ request }) => {
	const body = (await request.json()) as {
		action: 'start' | 'stop' | 'sync' | 'reload' | 'test' | 'untest';
		position?: number;
		playing?: boolean;
		decisions?: unknown;
		age?: number;
		key?: string;
		kind?: string;
		lights?: unknown;
	};

	switch (body.action) {
		case 'test': {
			const kind = TESTS.find((t) => t === body.kind);
			if (!kind || !Array.isArray(body.lights)) error(400, 'a test needs a kind and the lights to show it on');
			output.testLights(kind, body.lights.filter((l): l is string => typeof l === 'string'));
			break;
		}
		case 'untest':
			output.stopTest();
			break;
		case 'start':
			await loadCurrent();
			await output.start();
			break;
		case 'stop':
			await output.stop();
			break;
		case 'reload':
			if (output.running) await loadCurrent();
			break;
		case 'sync': {
			const age = typeof body.age === 'number' && body.age >= 0 ? body.age : Infinity;
			const key = typeof body.key === 'string' ? body.key : undefined;
			output.sync(
				body.position ?? 0,
				body.playing ?? false,
				decisionsFrom(body.decisions),
				age,
				key,
				queue.snapshot.currentKey ?? undefined
			);
			break;
		}
		default:
			error(400, 'unknown action');
	}
	return json(output.status);
};
