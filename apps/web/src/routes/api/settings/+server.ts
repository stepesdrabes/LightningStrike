import { error, json } from '@sveltejs/kit';
import {
	DRIFT_MAX,
	DRIFT_MIN,
	DWELL_MAX,
	DWELL_MIN,
	SAT_MAX,
	SAT_MIN,
	clamp,
	isColourSource,
	wrapDegrees
} from '$lib/ambient.ts';
import { settings } from '$lib/server/settings.ts';
import type { ColourSource } from '@mv/core';
import { authorModel, isEffort, type EffortLevel } from '@mv/author-ai';
import type { RequestHandler } from './$types';

/** Responses expose whether a key is set, never the key. */
export const GET: RequestHandler = async () => json(await settings.read());

export const PUT: RequestHandler = async ({ request }) => {
	const body = (await request.json()) as Writable;

	const patch: Writable = {};
	if (typeof body.deepseekApiKey === 'string') patch.deepseekApiKey = body.deepseekApiKey.trim();
	if (typeof body.autopilot === 'boolean') patch.autopilot = body.autopilot;
	if (typeof body.lounge === 'boolean') patch.lounge = body.lounge;
	if (typeof body.rest === 'boolean') patch.rest = body.rest;
	// Validate model IDs against the catalogue before constructing CLI arguments.
	if (authorModel(body.authorModel)) patch.authorModel = body.authorModel;
	if (isEffort(body.authorEffort)) patch.authorEffort = body.authorEffort;
	if (isColourSource(body.ambientColour)) patch.ambientColour = body.ambientColour;
	// Clamp slider values to shared bounds; wrap hue because 370 degrees is 10.
	if (number(body.ambientHue)) patch.ambientHue = wrapDegrees(body.ambientHue);
	if (number(body.ambientSat)) patch.ambientSat = clamp(body.ambientSat, SAT_MIN, SAT_MAX);
	if (number(body.ambientDrift)) patch.ambientDrift = clamp(body.ambientDrift, DRIFT_MIN, DRIFT_MAX);
	if (number(body.ambientDwell)) {
		patch.ambientDwell = Math.round(clamp(body.ambientDwell, DWELL_MIN, DWELL_MAX));
	}
	if (Object.keys(patch).length === 0) error(400, 'nothing to change');

	return json(await settings.update(patch));
};

interface Writable {
	deepseekApiKey?: string;
	authorModel?: string;
	authorEffort?: EffortLevel;
	autopilot?: boolean;
	lounge?: boolean;
	rest?: boolean;
	ambientColour?: ColourSource;
	ambientHue?: number;
	ambientSat?: number;
	ambientDrift?: number;
	ambientDwell?: number;
}

function number(v: unknown): v is number {
	return typeof v === 'number' && Number.isFinite(v);
}
