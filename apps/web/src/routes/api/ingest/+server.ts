import { error, json } from '@sveltejs/kit';
import { readFile, writeFile } from 'node:fs/promises';
import { BUILT_IN_EFFECTS } from '@mv/core';
import { showPath } from '@mv/analysis';
import { composeShow, refreshShow, lintShow } from '@mv/author-engine';
import type { Show } from '@mv/core';
import { ingestDetached } from '../../../lib/server/ingestDetached.ts';
import type { RequestHandler } from './$types';

/** Prepare an engine show immediately, preserving an existing authored show on the same grid. */
export const POST: RequestHandler = async ({ request }) => {
	const { source, metricalLevel } = (await request.json()) as {
		source?: string;
		metricalLevel?: number;
	};
	if (!source?.trim()) error(400, 'source required');
	if (metricalLevel !== undefined && !(metricalLevel > 0.2 && metricalLevel < 5)) {
		error(400, 'metricalLevel must be between 0.2 and 5');
	}

	try {
		const result = await ingestDetached(source.trim(), { metricalLevel });

		let existing: Show | null = null;
		try {
			existing = JSON.parse(await readFile(showPath(result.id), 'utf8')) as Show;
		} catch {
			// No readable saved show.
		}

		const composition = { artHue: result.meta.artHue, context: result.context };
		// An explicit grid correction rebuilds authored arrangements too: cues are bar-addressed.
		const candidate = metricalLevel !== undefined
			? composeShow(result.analysis, {
				...composition,
				seed: existing?.analysisHash === result.analysis.hash ? existing?.seed : undefined
			})
			: refreshShow(result.analysis, { ...composition, existing, analysisChanged: !result.fromCache,
				arrangementUnchanged: result.arrangementUnchanged });
		let show: Show | null = candidate;
		if (candidate !== existing) {
			const verdict = lintShow(candidate, {
				analysis: result.analysis,
				effects: new Map(BUILT_IN_EFFECTS.map((e) => [e.id, e])),
				context: result.context
			});
			// A show the linter rejects would be rejected on load too; better to say so here.
			if (!verdict.ok) show = null;
			else await writeFile(showPath(result.id), JSON.stringify(candidate, null, '\t'));
		}

		return json({
			id: result.id,
			analysis: result.analysis,
			meta: result.meta,
			show,
			fromCache: result.fromCache
		});
	} catch (e) {
		// Preserve yt-dlp and ffmpeg error details for diagnosing ingest failures.
		error(502, (e as Error).message);
	}
};
