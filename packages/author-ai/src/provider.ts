/**
 * Backends share the Agent SDK loop; query-local environments select the subprocess endpoint.
 * DeepSeek accepts low/high/max effort and does not support image input, cache_control, top_k
 * or beta headers.
 */
export type EffortLevel = 'low' | 'medium' | 'high' | 'xhigh' | 'max';

export type BackendId = 'claude' | 'deepseek';

export interface AuthorProvider {
	id: BackendId;
	/** Shown in the app, beside the button that spends it. */
	label: string;
	model: string;
	/** The effort levels this backend implements, which are not the same set. */
	effort(level: EffortLevel): EffortLevel;
	/** Extra environment for the spawned CLI. Absent for Anthropic's own endpoint. */
	env?: Record<string, string | undefined>;
}

export const CLAUDE: AuthorProvider = {
	id: 'claude',
	label: 'Claude',
	model: 'claude-opus-5',
	effort: (level) => level
};

export interface AuthorModel {
	id: string;
	label: string;
	/** One phrase on what picking it changes, shown beside the name. */
	note: string;
	backend: BackendId;
}

/** Long context keeps the bar table and DSL available throughout authoring without compaction. */
export const AUTHOR_MODELS: readonly AuthorModel[] = [
	{ id: 'claude-opus-5', label: 'Claude Opus 5', note: 'Default', backend: 'claude' },
	{ id: 'claude-sonnet-5', label: 'Claude Sonnet 5', note: 'Cheaper', backend: 'claude' },
	{ id: 'claude-opus-4-8', label: 'Claude Opus 4.8', note: 'Previous', backend: 'claude' },
	{ id: 'deepseek-v4-flash', label: 'DeepSeek V4 Flash', note: 'Cheapest', backend: 'deepseek' }
];

export const DEFAULT_MODEL = AUTHOR_MODELS[0].id;

/** Anthropic's five. DeepSeek folds them into its three through `deepseekEffort`. */
const EFFORTS: readonly EffortLevel[] = ['low', 'medium', 'high', 'xhigh', 'max'];
export const DEFAULT_EFFORT: EffortLevel = 'high';

/** Undefined for anything not on the list, which is how an unknown id fails to be honoured. */
export function authorModel(id: string | undefined): AuthorModel | undefined {
	return AUTHOR_MODELS.find((m) => m.id === id);
}

export function isEffort(v: unknown): v is EffortLevel {
	return EFFORTS.includes(v as EffortLevel);
}

/** Map unsupported levels explicitly; the endpoint silently falls back for unknown values. */
function deepseekEffort(level: EffortLevel): EffortLevel {
	if (level === 'low' || level === 'medium') return 'low';
	if (level === 'max') return 'max';
	return 'high';
}

export function deepseek(apiKey: string): AuthorProvider {
	return {
		id: 'deepseek',
		label: 'DeepSeek V4 Flash',
		model: 'deepseek-v4-flash',
		effort: deepseekEffort,
		env: {
			ANTHROPIC_BASE_URL: 'https://api.deepseek.com/anthropic',
			ANTHROPIC_AUTH_TOKEN: apiKey,
			ANTHROPIC_MODEL: 'deepseek-v4-flash',
			ANTHROPIC_DEFAULT_OPUS_MODEL: 'deepseek-v4-flash',
			ANTHROPIC_DEFAULT_SONNET_MODEL: 'deepseek-v4-flash',
			ANTHROPIC_DEFAULT_HAIKU_MODEL: 'deepseek-v4-flash',
			// A key left over from an Anthropic login takes precedence over the token above, and
			// the failure is a 401 from a host that was never asked for.
			ANTHROPIC_API_KEY: undefined,
			// Override an inherited desktop entrypoint so the subprocess uses SDK authentication.
			CLAUDE_CODE_ENTRYPOINT: 'sdk-ts',
			// The context is a million tokens; compacting at the Anthropic default would throw
			// away the bar table halfway through a build pass.
			CLAUDE_CODE_AUTO_COMPACT_WINDOW: '786432'
		}
	};
}

/** The environment the subprocess actually gets: this process's, plus the backend's overrides. */
export function environmentFor(provider: AuthorProvider): Record<string, string | undefined> {
	if (!provider.env) return process.env;
	return { ...process.env, ...provider.env };
}
