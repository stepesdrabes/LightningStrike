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
import { runner } from '$lib/server/ingestRunner.ts';
import { queue } from '$lib/server/queueStore.ts';
import { settings } from '$lib/server/settings.ts';
import { analysisModelChoices, isAnalysisProvider, offeredYouTubeBrowsers } from '@mv/analysis';
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
