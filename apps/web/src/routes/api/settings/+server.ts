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
import { runner } from '$lib/server/ingestRunner.ts';
import { queue } from '$lib/server/queueStore.ts';
import { settings } from '$lib/server/settings.ts';
import { analysisModelChoices, isAnalysisProvider, offeredYouTubeBrowsers } from '@mv/analysis';
import type { ColourSource } from '@mv/core';
import { authorModel, isEffort, type EffortLevel } from '@mv/author-ai';
import type { RequestHandler } from './$types';

/**
 * Settings reads and writes are loopback-only; responses expose key presence, never
 * credentials.
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
	// Accept only tuned FPS choices; intermediate rates are not slider values.
	if (isOutputFps(body.outputFps)) patch.outputFps = body.outputFps;
	if (isWireProtocol(body.outputProtocol)) patch.outputProtocol = body.outputProtocol;
	// Only a model that can run may prepare songs; one that cannot says why instead.
	if (body.analysisModel !== undefined) {
		const choice = (await analysisModelChoices()).find((m) => m.id === body.analysisModel);
		if (!choice) error(400, 'unknown analysis model');
		if (choice.problem) error(409, choice.problem);
		patch.analysisModel = choice.id;
	}
	// Every provider gives the same events (its check against PyTorch), so analyses stay current.
	if (body.analysisProvider !== undefined) {
		if (!isAnalysisProvider(body.analysisProvider)) error(400, 'unknown analysis provider');
		patch.analysisProvider = body.analysisProvider;
	}
	if (body.youtubeBrowser !== undefined) {
		const offered: string[] = offeredYouTubeBrowsers();
		if (body.youtubeBrowser !== 'none' && !offered.includes(body.youtubeBrowser)) error(400, 'unknown browser');
		patch.youtubeBrowser = body.youtubeBrowser;
	}
	if (Object.keys(patch).length === 0) error(400, 'nothing to change');

	const before = (await settings.read()).analysisModel;
	const published = await settings.update(patch);
	// Songs the other model prepared are prepared again as they come up, as after a version bump.
	if (published.analysisModel !== before) {
		await queue.prepareStaleAgain();
		void runner.pump();
	}
	return json(published);
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
	analysisModel?: string;
	analysisProvider?: string;
	youtubeBrowser?: string;
}

function number(v: unknown): v is number {
	return typeof v === 'number' && Number.isFinite(v);
}
