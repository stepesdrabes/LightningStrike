import { query } from '@anthropic-ai/claude-agent-sdk';
import { CLAUDE, environmentFor, type AuthorProvider, type EffortLevel } from './provider.ts';
import type { Geometry, Show, TrackAnalysis, TrackContext } from '@mv/core';
import {
	buildBriefPrompt,
	buildRepairPrompt,
	buildRevisePrompt,
	buildSystemPrompt
} from './prompt.ts';
import { allowedFlashes } from '@mv/author-engine';
import { buildTools, createSession, type AuthorSession } from './tools.ts';
import {
	describeToolCall,
	looksRejected,
	summariseResult,
	toolLabel,
	type OnAuthorEvent
} from './events.ts';

interface AuthorOptions {
	/** Which backend authors the show. Claude when absent. */
	provider?: AuthorProvider;
	/** Overrides the provider's model, for pinning a specific snapshot. */
	model?: string;
	/** Opus 5 guidance: start high, reserve xhigh for the hardest stage. */
	briefEffort?: EffortLevel;
	showEffort?: EffortLevel;
	/** Absolute path to the decoded audio, so the agent can probe it itself. */
	audioPath?: string;
	/** Ingest enrichment: identity, genre family, lyrics. Feeds the prompt and the linter. */
	context?: TrackContext | null;
	/** Called after `reanalyse`, so the caller can persist the corrected grid. */
	onAnalysis?: (analysis: TrackAnalysis, reason: string) => void;
	onEvent?: OnAuthorEvent;
}

interface AuthorResult {
	show: Show;
	brief: string;
	/** The grid the show is addressed against; the agent may have corrected it. */
	analysis: TrackAnalysis;
	log: string[];
}

/** Tools the agent gets on top of the lightdesk ones, so it can investigate for itself. */
const INVESTIGATION_TOOLS = ['Bash', 'Read', 'Glob', 'Grep', 'WebSearch', 'WebFetch'];

interface ContentBlock {
	type?: string;
	text?: string;
	name?: string;
	id?: string;
	input?: unknown;
	tool_use_id?: string;
	content?: unknown;
	is_error?: boolean;
}

function blockText(content: unknown): string {
	if (typeof content === 'string') return content;
	if (!Array.isArray(content)) return '';
	return content
		.map((c) => (typeof c === 'string' ? c : ((c as ContentBlock)?.text ?? '')))
		.join('\n');
}

/** Drive one query to completion, translating SDK messages into AuthorEvents. */
async function run(
	stream: AsyncIterable<unknown>,
	emit: OnAuthorEvent,
	names: Map<string, string>
): Promise<string> {
	let out = '';

	for await (const message of stream) {
		const m = message as { type?: string; message?: { content?: ContentBlock[] } };
		const blocks = m.message?.content;
		if (!Array.isArray(blocks)) continue;

		if (m.type === 'assistant') {
			for (const block of blocks) {
				if (block.type === 'text' && block.text) {
					out += block.text;
					emit({ type: 'thinking', text: block.text });
				} else if (block.type === 'tool_use' && block.name) {
					const id = block.id ?? '';
					names.set(id, block.name);
					emit({
						type: 'tool',
						id,
						name: toolLabel(block.name),
						detail: describeToolCall(block.name, block.input)
					});
				}
			}
		} else if (m.type === 'user') {
			for (const block of blocks) {
				if (block.type !== 'tool_result') continue;
				const id = block.tool_use_id ?? '';
				const body = blockText(block.content);
				emit({
					type: 'result',
					id,
					name: toolLabel(names.get(id) ?? ''),
					summary: summariseResult(body),
					ok: !block.is_error && !looksRejected(body)
				});
			}
		}
	}

	return out.trim();
}

/** Settle the brief first so cue-level decisions cannot spend the reserved peak early. */
export async function reviseShow(
	analysis: TrackAnalysis,
	geometry: Geometry,
	draft: Show,
	opts: AuthorOptions = {}
): Promise<AuthorResult> {
	const emit: OnAuthorEvent = opts.onEvent ?? (() => {});
	const session: AuthorSession = createSession(
		analysis,
		geometry,
		opts.audioPath,
		draft,
		opts.context
	);
	session.onAnalysis = (next, reason) => {
		opts.onAnalysis?.(next, reason);
		emit({ type: 'analysis', analysis: next, reason });
	};

	const systemPrompt = buildSystemPrompt();
	const provider = opts.provider ?? CLAUDE;
	const model = opts.model ?? provider.model;
	const env = environmentFor(provider);
	const names = new Map<string, string>();
	const researchTools = buildTools(session, 'research');
	const writeTools = buildTools(session, 'build');

	emit({ type: 'phase', phase: 'research', label: 'Researching the track' });

	const brief = await run(
		query({
			prompt: buildBriefPrompt(session.analysis, opts.audioPath, opts.context),
			options: {
				model,
				systemPrompt,
				env,
				effort: provider.effort(opts.briefEffort ?? 'high'),
				mcpServers: { lightdesk: researchTools },
				allowedTools: INVESTIGATION_TOOLS,
				permissionMode: 'bypassPermissions',
				allowDangerouslySkipPermissions: true,
				maxTurns: 40
			}
		}),
		(e) => {
			// The research phase is the first half of pass one; label it that way until the
			// model stops calling tools and starts writing.
			if (e.type === 'thinking' && e.text.length > 200) {
				emit({ type: 'phase', phase: 'brief', label: 'Writing the design brief' });
			}
			emit(e);
		},
		names
	);

	if (!brief) throw new Error('the author returned an empty brief');
	emit({ type: 'brief', brief });

	emit({
		type: 'phase',
		phase: 'build',
		label: 'Revising the cue list'
	});

	// From the grid the build pass actually addresses: a reanalyse in the research pass may
	// have changed what the track earns.
	const flashAllowance = allowedFlashes(session.analysis, opts.context ?? null);

	await run(
		query({
			prompt: buildRevisePrompt(session.analysis, brief, flashAllowance),
			options: {
				model,
				systemPrompt,
				env,
				effort: provider.effort(opts.showEffort ?? 'high'),
				mcpServers: { lightdesk: writeTools },
				allowedTools: INVESTIGATION_TOOLS,
				permissionMode: 'bypassPermissions',
				allowDangerouslySkipPermissions: true,
				maxTurns: 80
			}
		}),
		emit,
		names
	);

	// Retry once with the existing session and tool log so registered effects survive an
	// incomplete build.
	if (!session.submitted) {
		emit({ type: 'phase', phase: 'repair', label: 'Recovering the show' });
		await run(
			query({
				prompt: buildRepairPrompt(session.analysis, session.log),
				options: {
					model,
					systemPrompt,
					env,
					effort: provider.effort(opts.showEffort ?? 'high'),
					mcpServers: { lightdesk: writeTools },
					allowedTools: INVESTIGATION_TOOLS,
					permissionMode: 'bypassPermissions',
					allowDangerouslySkipPermissions: true,
					maxTurns: 30
				}
			}),
			emit,
			names
		);
	}

	if (!session.submitted) {
		throw new Error(
			`the author finished without submitting a show. Tool log:\n${session.log.join('\n')}`
		);
	}

	return {
		show: { ...session.submitted, authoredBy: provider.id },
		brief,
		analysis: session.analysis,
		log: session.log
	};
}
