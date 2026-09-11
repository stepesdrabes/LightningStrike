import { tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import type {
	EffectCharacter,
	EffectDef,
	GeneratedEffect,
	Geometry,
	LayerRole,
	Show,
	TrackAnalysis,
	TrackContext
} from '@mv/core';
import { BUILT_IN_EFFECTS, barAtTime, barTimeAt, compileGenerated, measureEffect } from '@mv/core';
import { analyzeTrack, decodeAudio } from '@mv/analysis';
import { renderArrangementChart, renderBarTable, renderCatalog } from './catalog.ts';
import { formatFindings, formatReading, lintShow, measureShow } from '@mv/author-engine';
import { coerceShow, showSchema } from './showSchema.ts';

/** Mutated by the tools as the author works; read afterwards by the caller. */
export interface AuthorSession {
	analysis: TrackAnalysis;
	geometry: Geometry;
	audioPath?: string;
	/** What the track is, from ingest enrichment. Decides the linter's flash allowance. */
	context?: TrackContext | null;
	/** The engine's show, when the agent is revising one rather than starting from nothing. */
	draft?: Show;
	generated: Map<string, GeneratedEffect>;
	compiled: Map<string, EffectDef>;
	submitted: Show | null;
	log: string[];
	/** Return nonfatal findings once for revision; a second submission must not loop on warnings. */
	pushedBack: boolean;
	onAnalysis?: (analysis: TrackAnalysis, reason: string) => void;
}

export function createSession(
	analysis: TrackAnalysis,
	geometry: Geometry,
	audioPath?: string,
	draft?: Show,
	context?: TrackContext | null
): AuthorSession {
	return {
		analysis,
		geometry,
		audioPath,
		context,
		draft,
		generated: new Map(),
		compiled: new Map(),
		submitted: null,
		log: [],
		pushedBack: false
	};
}

/** The system prompt owns the legend; tool results report only values and actionable problems. */
function describeCharacter(role: LayerRole, c: EffectCharacter): string {
	const lines = [
		`fill ${Math.round(100 * c.fill)}% · brightest tenth ${Math.round(100 * c.top10)}% · on palette ${Math.round(
			100 * c.hue
		)}% · reacts ${c.react.toFixed(2)} · in a quiet passage ${c.quiet.toFixed(2)}`
	];

	if (role === 'bed' && c.fill < 0.22) {
		lines.push(
			`It lights ${Math.round(100 * c.fill)}% of the room. A bed is the floor of a cue, and under 22% there is no floor.`
		);
	}
	if (c.top10 > 0.45) {
		lines.push(
			`${Math.round(100 * c.top10)}% of its light is in a tenth of the pixels: that is a spotlight. Intended?`
		);
	}
	if (c.hue < 0.9) {
		lines.push(
			`${Math.round(100 * (1 - c.hue))}% of its lit bytes are on a hue the palette cannot produce. Address colour through SLOT.`
		);
	}
	if (c.react < 0.02) {
		lines.push('It renders the same with the music switched off. Nothing in it reads the frame.');
	} else if (c.quiet < 0.02 && role !== 'transient') {
		lines.push(
			'It moves on the drums and nothing else, so in an intro or a breakdown it will hold still. The spectrum is what has resolution where the kit does not.'
		);
	}
	return lines.join('\n  ');
}

function effectMap(session: AuthorSession): Map<string, EffectDef> {
	const map = new Map<string, EffectDef>();
	for (const e of BUILT_IN_EFFECTS) map.set(e.id, e);
	for (const [id, def] of session.compiled) map.set(id, def);
	return map;
}

function text(body: string) {
	return { content: [{ type: 'text' as const, text: body }] };
}

/** Research omits write tools so the planning pass cannot submit a show prematurely. */
type ToolPhase = 'research' | 'build';

export function buildTools(session: AuthorSession, phase: ToolPhase = 'build') {
	const getBars = tool(
		'get_bars',
		'Bar-level analysis rows for a range of bars. Use this to zoom into a build, a void or a drop rather than working from the overview.',
		{
			fromBar: z.number().int().min(0).describe('First bar, inclusive'),
			toBar: z.number().int().min(0).describe('Last bar, inclusive')
		},
		async ({ fromBar, toBar }) => {
			const last = session.analysis.bars.length - 1;
			if (fromBar > last) return text(`No such bar. The track has bars 0-${last}.`);
			return text(renderBarTable(session.analysis, fromBar, Math.min(toBar, last)));
		},
		{ annotations: { readOnlyHint: true } }
	);

	const getLyrics = tool(
		'get_lyrics',
		'The synced lyrics mapped onto the bar grid, one line per lyric: "bar 17.2  <text>". This is how to place the first vocal entry, the verse starts and the hook without guessing.',
		{},
		async () => {
			const lines = session.context?.lyrics;
			if (!lines || lines.length === 0) {
				return text('No synced lyrics were found for this track.');
			}
			const { tempo } = session.analysis;
			return text(
				lines
					.map((l) => `bar ${barAtTime(tempo, l.t).toFixed(1).padStart(6)}  ${l.text}`)
					.join('\n')
			);
		},
		{ annotations: { readOnlyHint: true } }
	);

	const getOnsets = tool(
		'get_onsets',
		'Exact onset times for kick, snare or hat within a bar range, so you can see whether a roll is eighths or sixteenths.',
		{
			fromBar: z.number().int().min(0),
			toBar: z.number().int().min(0),
			instrument: z.enum(['kick', 'snare', 'hat'])
		},
		async ({ fromBar, toBar, instrument }) => {
			const { tempo, onsets } = session.analysis;
			const from = barTimeAt(session.analysis.tempo, fromBar);
			const to = barTimeAt(session.analysis.tempo, toBar + 1);
			const hits = onsets[instrument].times.filter((t) => t >= from && t < to);
			if (hits.length === 0) return text(`No ${instrument} onsets in bars ${fromBar}-${toBar}.`);
			// Through the same table the window above came from. Hand-rolled against the
			// median, the labels contradicted their own window on any track that drifts.
			const lines = hits.map((t) => {
				const bars = barAtTime(tempo, t);
				const bar = Math.floor(bars);
				return `${t.toFixed(3)}s  bar ${bar} beat ${((bars - bar) * tempo.beatsPerBar).toFixed(2)}`;
			});
			return text(`${hits.length} ${instrument} onsets:\n${lines.join('\n')}`);
		},
		{ annotations: { readOnlyHint: true } }
	);

	const getDraft = tool(
		'get_draft',
		'The show that already exists for this track, as JSON. Revise it rather than starting over: it already covers every bar and lints clean.',
		{},
		async () => {
			if (!session.draft) return text('No draft exists; write the show from scratch.');
			return text(JSON.stringify(session.draft, null, '\t'));
		},
		{ annotations: { readOnlyHint: true } }
	);

	const audioFile = tool(
		'audio_file',
		'Where the decoded audio lives on disk. You cannot hear it, but you can run ffprobe, ffmpeg or any other command-line tool on it with Bash.',
		{},
		async () => {
			if (!session.audioPath) return text('No audio file is available for this session.');
			return text(
				[
					`path: ${session.audioPath}`,
					`duration: ${session.analysis.duration.toFixed(2)} s`,
					`integrated loudness: ${session.analysis.integratedLufs} LUFS`,
					'',
					'You cannot hear this file. What Bash genuinely buys you:',
					'  ffprobe -v quiet -print_format json -show_format -show_streams <path>',
					'  ffmpeg -i <path> -af ebur128 -f null -              loudness over time',
					'  ffmpeg -i <path> -af astats=metadata=1 -f null -    level statistics',
					'  ffmpeg -ss <sec> -t <sec> -i <path> -af volumedetect -f null -',
					'',
					'Do not try to derive cue timings this way. The bar grid you were given is',
					'sample-accurate; every cue is addressed against it.'
				].join('\n')
			);
		},
		{ annotations: { readOnlyHint: true } }
	);

	const audioStats = tool(
		'audio_stats',
		'Aggregate measurements over a bar range, plus the exact ffmpeg command to verify them independently.',
		{ fromBar: z.number().int().min(0), toBar: z.number().int().min(0) },
		async ({ fromBar, toBar }) => {
			const rows = session.analysis.bars.filter((b) => b.bar >= fromBar && b.bar <= toBar);
			if (rows.length === 0) return text('No such bars.');
			const from = barTimeAt(session.analysis.tempo, fromBar);
			const to = barTimeAt(session.analysis.tempo, toBar + 1);
			const mean = (k: 'energy' | 'sub' | 'low' | 'mid' | 'air') =>
				Math.round(rows.reduce((n, b) => n + b[k], 0) / rows.length);
			const sum = (k: 'kicks' | 'snares' | 'hats') => rows.reduce((n, b) => n + b[k], 0);
			return text(
				[
					`bars ${fromBar}-${toBar} = ${from.toFixed(2)}s to ${to.toFixed(2)}s (${(to - from).toFixed(1)}s)`,
					`energy ${mean('energy')} · sub ${mean('sub')} · low ${mean('low')} · mid ${mean('mid')} · air ${mean('air')}`,
					`kicks ${sum('kicks')} · snares ${sum('snares')} · hats ${sum('hats')}`,
					session.audioPath
						? `\nTo measure it yourself:\n  ffmpeg -ss ${from.toFixed(2)} -t ${(to - from).toFixed(2)} -i ${session.audioPath} -af ebur128=peak=true -f null -`
						: ''
				].join('\n')
			);
		},
		{ annotations: { readOnlyHint: true } }
	);

	const reanalyse = tool(
		'reanalyse',
		'Re-run the local analysis with the tempo constrained near a value you have established. Use this ONLY when the detected tempo is clearly wrong and you have credible evidence. It replaces the bar grid, so every bar number changes and any cues you had written must be rewritten.',
		{
			bpm: z.number().min(40).max(260).describe('The tempo you believe is correct'),
			reason: z.string().describe('Why, and on what evidence')
		},
		async ({ bpm, reason }) => {
			if (!session.audioPath) {
				return text('No audio file is available, so re-analysis is not possible.');
			}
			const before = session.analysis.tempo.bpm;
			const decoded = await decodeAudio(session.audioPath);
			const next = analyzeTrack({
				mono: decoded.mono,
				sampleRate: decoded.sampleRate,
				duration: decoded.duration,
				hash: decoded.hash,
				trackId: session.analysis.trackId,
				title: session.analysis.title,
				bpmHint: bpm
			});

			if (Math.abs(next.tempo.bpm - bpm) > bpm * 0.06) {
				return text(
					`Re-analysis did not settle near ${bpm} bpm; it found ${next.tempo.bpm}. The grid is unchanged at ${before} bpm. Work with the grid you have.`
				);
			}

			session.analysis = next;
			session.log.push(`reanalyse: ${before} -> ${next.tempo.bpm} bpm (${reason})`);
			session.onAnalysis?.(next, reason);

			return text(
				[
					`Grid replaced: ${before} -> ${next.tempo.bpm} bpm. Every bar number has changed, so any cues already written need rewriting against the table below.`,
					`bars 0-${next.bars.length - 1} · downbeatPhase ${next.tempo.downbeatPhase} · phraseAnchorBar ${next.tempo.phraseAnchorBar}`,
					'',
					renderArrangementChart(next)
				].join('\n')
			);
		}
	);

	const listEffects = tool(
		'list_effects',
		'The effect catalog with taste metadata, including any effect you have already generated.',
		{},
		async () => text(renderCatalog([...effectMap(session).values()])),
		{ annotations: { readOnlyHint: true } }
	);

	const testEffect = tool(
		'test_effect',
		'Compile a generated effect, run the admission gate (finite bounded pixels, bitwise determinism across fresh instances, reset() restoring a fresh state), and measure what it looks like. Returns the exact failures, or pass plus its five numbers.',
		{
			id: z.string().regex(/^[a-z][a-zA-Z0-9]*$/).describe('camelCase id, unique'),
			name: z.string(),
			role: z.enum(['bed', 'rhythm', 'transient', 'accent', 'master']),
			blurb: z.string().describe('One sentence on what it looks like'),
			params: z
				.array(
					z.object({
						key: z.string(),
						label: z.string(),
						min: z.number(),
						max: z.number(),
						step: z.number(),
						default: z.number()
					})
				)
				.describe('Include an "intensity" param'),
			source: z
				.string()
				.describe('Plain JS declaring function create(g) returning { reset, render }')
		},
		async (input) => {
			const gen: GeneratedEffect = {
				id: input.id,
				name: input.name,
				role: input.role,
				blurb: input.blurb,
				params: input.params,
				source: input.source
			};
			const result = compileGenerated(gen, session.geometry);
			if (!result.def) {
				session.log.push(`test_effect ${input.id}: FAILED`);
				return text(
					`REJECTED. Fix these and call test_effect again:\n${result.failures
						.map((f) => `- ${f}`)
						.join('\n')}`
				);
			}
			session.generated.set(gen.id, gen);
			session.compiled.set(gen.id, result.def);
			const character = measureEffect(result.def, session.geometry);
			session.log.push(
				`test_effect ${input.id}: passed, fill ${character.fill.toFixed(2)} react ${character.react.toFixed(2)}`
			);
			return text(
				[
					`PASSED. "${input.id}" is registered as a ${input.role} effect and may be used in cues.`,
					`  ${describeCharacter(input.role, character)}`
				].join('\n')
			);
		}
	);

	const lint = tool(
		'lint_show',
		'Validate a Show against the analysed grid and the craft rules. Errors block submission. Call this while iterating.',
		{ show: showSchema },
		async ({ show }) => {
			const { show: candidate, error } = coerceShow(show);
			if (!candidate) {
				session.log.push('lint_show: malformed show');
				return text(`Not read: ${error}`);
			}
			const result = lintShow(candidate, {
				analysis: session.analysis,
				effects: effectMap(session),
				context: session.context
			});
			session.log.push(
				`lint_show: ${result.errors.length} errors, ${result.warnings.length} warnings`
			);
			return text(formatFindings(result));
		},
		{ annotations: { readOnlyHint: true } }
	);

	const preview = tool(
		'preview_show',
		'Play a Show through the same mixer that feeds the LEDs and report what the room receives: delivered brightness, coverage, how much of the room each cue reaches, movement, shimmer, and which punctuation actually fires. This is the only tool that can see what a show looks like.',
		{ show: showSchema },
		async ({ show }) => {
			const { show: candidate, error } = coerceShow(show);
			if (!candidate) return text(`Not read: ${error}`);
			candidate.generatedEffects = [...session.generated.values()];
			const reading = measureShow(
				candidate,
				session.analysis,
				effectMap(session),
				session.geometry
			);
			session.log.push(
				`preview_show: contrast ${reading.contrast.toFixed(2)}x, ${reading.darkBars.length} dark bar(s)`
			);
			return text(formatReading(reading));
		},
		{ annotations: { readOnlyHint: true } }
	);

	const submit = tool(
		'submit_show',
		'Submit the finished Show. Rejected unless it lints with zero errors. The first submission carrying anything unanswered comes back with the reading; name the warnings you are keeping on purpose in acceptedWarnings and submit again.',
		{
			show: showSchema,
			acceptedWarnings: z
				.array(z.string())
				.optional()
				.describe('Rule names from lint_show you are keeping deliberately, e.g. ["single-bed"]')
		},
		async ({ show, acceptedWarnings }) => {
			const { show: candidate, error } = coerceShow(show);
			if (!candidate) return text(`Not accepted: ${error}`);
			const result = lintShow(candidate, {
				analysis: session.analysis,
				effects: effectMap(session),
				context: session.context
			});
			if (!result.ok) {
				return text(
					`NOT ACCEPTED, ${result.errors.length} error(s) remain:\n${formatFindings(result)}`
				);
			}

			candidate.generatedEffects = [...session.generated.values()];
			const reading = measureShow(
				candidate,
				session.analysis,
				effectMap(session),
				session.geometry
			);
			const dead = reading.hits.filter((h) => !h.fired);
			const answered = new Set(acceptedWarnings ?? []);
			const unanswered = result.warnings.filter((w) => !answered.has(w.rule));

			// Handed back once, with everything at once. A show that lints clean can still be one
			// the room cannot see, and neither the dark bar nor the hit that never fires is
			// something a static check will ever find.
			if (
				!session.pushedBack &&
				(unanswered.length > 0 || dead.length > 0 || reading.darkBars.length > 0)
			) {
				session.pushedBack = true;
				session.log.push(
					`submit_show: handed back with ${unanswered.length} warning(s), ${dead.length} dead hit(s), ${reading.darkBars.length} dark bar(s)`
				);
				return text(
					[
						'NOT ACCEPTED yet. It lints clean; this is what it does in the room.',
						'',
						formatReading(reading),
						'',
						unanswered.length > 0
							? `Warnings you have not answered:\n${unanswered
									.map((w) => `- [${w.rule}]${w.bar !== undefined ? ` (bar ${w.bar})` : ''} ${w.message}`)
									.join('\n')}`
							: 'No warnings outstanding.',
						'',
						'Fix what is worth fixing, then submit again. Anything you are keeping on purpose goes in acceptedWarnings by rule name, and the next submission is accepted.'
					].join('\n')
				);
			}

			session.submitted = candidate;
			session.log.push('submit_show: accepted');
			return text(
				[
					`Accepted: ${candidate.cues.length} cues, ${candidate.hits.length} hits, ${candidate.generatedEffects.length} generated effect(s).`,
					`Delivered contrast ${reading.contrast.toFixed(2)}x, ${
						reading.hits.length - dead.length
					}/${reading.hits.length} hits firing, ${result.warnings.length} warning(s) noted.`
				].join('\n')
			);
		}
	);

	return createSdkMcpServer({
		name: 'lightdesk',
		version: '1.0.0',
		instructions:
			'Tools for authoring a lighting show against a pre-analysed track. All timing is by bar index.',
		// There are ten of these and every one of them is load-bearing: deferred behind tool
		// search they cost two round trips before any work starts, and a backend that searches
		// badly finds a show it cannot submit rather than a tool it cannot see.
		alwaysLoad: true,
		tools:
			phase === 'research'
				? [getBars, getOnsets, getLyrics, getDraft, audioFile, audioStats, reanalyse, listEffects]
				: [
						getBars,
						getOnsets,
						getLyrics,
						getDraft,
						audioFile,
						audioStats,
						reanalyse,
						listEffects,
						testEffect,
						lint,
						preview,
						submit
					]
	});
}
