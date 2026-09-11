import { error } from '@sveltejs/kit';
import { readFile, writeFile } from 'node:fs/promises';
import {
	BUILT_IN_EFFECTS,
	DEFAULT_ROOM,
	buildGeometry,
	compileGenerated,
	type Show,
	type TrackAnalysis
} from '@mv/core';
import { analysisPath, findAudioFile, isValidId, readContext, readMeta, showPath } from '@mv/analysis';
import { composeShow, formatFindings, lintShow } from '@mv/author-engine';
import { reviseShow, type AuthorEvent } from '@mv/author-ai';
import { isLocal } from '$lib/server/access.ts';
import { settings } from '$lib/server/settings.ts';
import type { RequestHandler } from './$types';

/** Stream tool progress over SSE during long-running authoring. */
export const GET: RequestHandler = async (event) => {
	const { url, request } = event;

	if (!isLocal(event)) error(403, 'authoring belongs to the machine running the show');

	const id = url.searchParams.get('id');
	if (!id || !isValidId(id)) error(400, 'valid track id required');

	const chosen = await settings.authoring(
		url.searchParams.get('model'),
		url.searchParams.get('effort')
	);
	if ('error' in chosen) error(400, chosen.error);

	let analysis: TrackAnalysis;
	try {
		analysis = JSON.parse(await readFile(analysisPath(id), 'utf8')) as TrackAnalysis;
	} catch {
		error(404, 'that track has not been analysed yet');
	}

	const audioPath = (await findAudioFile(id)) ?? undefined;
	const artHue = (await readMeta(id))?.artHue;
	const context = await readContext(id);
	const geometry = buildGeometry(DEFAULT_ROOM);

	// Revise a valid engine draft, keeping a working show if authoring fails.
	let draft: Show;
	try {
		const existing = JSON.parse(await readFile(showPath(id), 'utf8')) as Show;
		draft =
			existing.analysisHash === analysis.hash
				? existing
				: composeShow(analysis, { artHue, context });
	} catch {
		draft = composeShow(analysis, { artHue, context });
	}
	const encoder = new TextEncoder();

	const stream = new ReadableStream({
		async start(controller) {
			let closed = false;
			const send = (event: string, data: unknown) => {
				if (closed) return;
				try {
					controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`));
				} catch {
					closed = true;
				}
			};
			request.signal.addEventListener('abort', () => (closed = true));

			// Persist and lint against the final grid, including any tempo correction made by the agent.
			let grid = analysis;

			try {
				send('event', {
					type: 'note',
					text: `authoring ${analysis.title} with ${chosen.model} at ${chosen.effort} effort`
				} satisfies AuthorEvent);

				const result = await reviseShow(grid, geometry, draft, {
					provider: chosen.provider,
					model: chosen.model,
					briefEffort: chosen.effort,
					showEffort: chosen.effort,
					audioPath,
					context,
					onAnalysis: (next) => (grid = next),
					onEvent: (e) => send('event', e)
				});
				grid = result.analysis;
				// Restore the draft roll omitted by the agent schema to retain composition provenance.
				result.show.seed ??= draft.seed;

				const effects = new Map(BUILT_IN_EFFECTS.map((e) => [e.id, e]));
				const rejected: string[] = [];
				for (const gen of result.show.generatedEffects) {
					const compiled = compileGenerated(gen, geometry);
					if (compiled.def) effects.set(gen.id, compiled.def);
					else rejected.push(`${gen.id} rejected: ${compiled.failures.join('; ')}`);
				}

				const verdict = lintShow(result.show, { analysis: grid, effects, context });
				if (!verdict.ok) {
					send('failed', `the authored show does not lint clean:\n${formatFindings(verdict)}`);
					controller.close();
					return;
				}

				await writeFile(showPath(id), JSON.stringify(result.show, null, '\t'));
				if (grid !== analysis) {
					await writeFile(analysisPath(id), JSON.stringify(grid, null, '\t'));
				}

				send('done', {
					id,
					show: result.show,
					analysis: grid,
					brief: result.brief,
					warnings: [...verdict.warnings.map((w) => `${w.rule}: ${w.message}`), ...rejected]
				});
			} catch (e) {
				send('failed', (e as Error).message);
			} finally {
				try {
					controller.close();
				} catch {
					// Already closed by an aborted request.
				}
			}
		}
	});

	return new Response(stream, {
		headers: {
			'content-type': 'text/event-stream',
			'cache-control': 'no-cache, no-transform',
			connection: 'keep-alive'
		}
	});
};
