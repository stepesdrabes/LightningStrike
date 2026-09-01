import { error, json } from '@sveltejs/kit';
import {
	CONTRAST_MAX,
	CONTRAST_MIN,
	OFFSET_MAX_MS,
	OFFSET_MIN_MS,
	OUTPUT_BRIGHTNESS_MIN,
	isOutputFps,
	isWireProtocol,
	type WireProtocol
} from '$lib/hardware.ts';
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
import { isLocal } from '$lib/server/access.ts';
import { settings } from '$lib/server/settings.ts';
import type { ColourSource } from '@mv/core';
import { authorModel, isEffort, type EffortLevel } from '@mv/author-ai';
import type { RequestHandler } from './$types';

/**
 * Loopback only, both ways.
 *
 * Reading says whether a key is stored and never what it is, but knowing the machine has one is
 * still a fact about the person running the night, and writing spends their money. This sits
 * behind the same boundary as the hardware and the queue.
 */
export const GET: RequestHandler = async (event) => {
	if (!isLocal(event)) error(403, 'settings belong to the machine running the show');
	return json(await settings.read());
};

export const PUT: RequestHandler = async (event) => {
	if (!isLocal(event)) error(403, 'settings belong to the machine running the show');

	const body = (await event.request.json()) as Writable;

	const patch: Writable = {};
	if (typeof body.deepseekApiKey === 'string') patch.deepseekApiKey = body.deepseekApiKey.trim();
	if (typeof body.autopilot === 'boolean') patch.autopilot = body.autopilot;
	if (typeof body.lounge === 'boolean') patch.lounge = body.lounge;
	if (typeof body.rest === 'boolean') patch.rest = body.rest;
	// Checked against the catalogue rather than merely typed, so nothing that reaches the CLI as
	// a `--model` argument came from the request body.
	if (authorModel(body.authorModel)) patch.authorModel = body.authorModel;
	if (isEffort(body.authorEffort)) patch.authorEffort = body.authorEffort;
	if (isColourSource(body.ambientColour)) patch.ambientColour = body.ambientColour;
	// Clamped rather than rejected: every one of these is a slider, and the bound is what the
	// control is for rather than a validity rule worth failing a request over. The hue wraps
	// instead, because it is a wheel and 370 means 10 rather than "too far".
	if (number(body.ambientHue)) patch.ambientHue = wrapDegrees(body.ambientHue);
	if (number(body.ambientSat)) patch.ambientSat = clamp(body.ambientSat, SAT_MIN, SAT_MAX);
	if (number(body.ambientDrift)) patch.ambientDrift = clamp(body.ambientDrift, DRIFT_MIN, DRIFT_MAX);
	if (number(body.ambientDwell)) {
		patch.ambientDwell = Math.round(clamp(body.ambientDwell, DWELL_MIN, DWELL_MAX));
	}
	if (number(body.outputOffsetMs)) {
		patch.outputOffsetMs = clamp(body.outputOffsetMs, OFFSET_MIN_MS, OFFSET_MAX_MS);
	}
	if (number(body.outputBrightness)) {
		patch.outputBrightness = clamp(body.outputBrightness, OUTPUT_BRIGHTNESS_MIN, 1);
	}
	if (number(body.outputContrast)) {
		patch.outputContrast = clamp(body.outputContrast, CONTRAST_MIN, CONTRAST_MAX);
	}
	if (number(body.outputLampBrightness)) {
		patch.outputLampBrightness = clamp(body.outputLampBrightness, OUTPUT_BRIGHTNESS_MIN, 1);
	}
	// One of three rather than clamped: this is a picker, and a rate between them is not a
	// slower version of either, it is a frame interval nothing was tuned against.
	if (isOutputFps(body.outputFps)) patch.outputFps = body.outputFps;
	if (isWireProtocol(body.outputProtocol)) patch.outputProtocol = body.outputProtocol;
	if (Object.keys(patch).length === 0) error(400, 'nothing to change');

	return json(await settings.update(patch));
};

interface Writable {
	deepseekApiKey?: string;
	authorModel?: string;
	authorEffort?: EffortLevel;
	outputOffsetMs?: number;
	outputFps?: number;
	outputBrightness?: number;
	outputContrast?: number;
	outputLampBrightness?: number;
	outputProtocol?: WireProtocol;
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
