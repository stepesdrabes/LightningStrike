import { BUILT_IN_EFFECTS, SHOW_VERSION, type Show, type TrackAnalysis } from '@mv/core';
import { composeShow } from './plan.ts';
import { lintShow } from './lint.ts';

interface RefreshOptions extends Omit<NonNullable<Parameters<typeof composeShow>[1]>, 'seed'> {
	existing?: Show | null;
	analysisChanged: boolean;
	/** Ingest compared the previous grid, sections and punctuation before replacing its cache. */
	arrangementUnchanged?: boolean;
}

const record = (value: unknown): value is Record<string, unknown> =>
	typeof value === 'object' && value !== null && !Array.isArray(value);
const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const optionalFinite = (value: unknown) => value === undefined || finite(value);
const params = (value: unknown) => value === undefined || (record(value) && Object.values(value).every(finite));
const palette = (value: unknown) => record(value) && finite(value.base) && finite(value.accent) &&
	['third', 'sat', 'shade', 'white'].every((key) => optionalFinite(value[key]));

/** JSON parsing alone does not establish the containers and numbers playback needs. */
function hasSavedShowShape(value: unknown): value is Show {
	if (!record(value) || !finite(value.version) || !optionalFinite(value.seed) ||
		!['engine', 'claude', 'deepseek', undefined].includes(value.authoredBy as Show['authoredBy']) ||
		(value.brief !== undefined && typeof value.brief !== 'string') || !palette(value.palette) ||
		!record(value.defaults) || !finite(value.defaults.intensity) || !finite(value.defaults.motion) ||
		!finite(value.defaults.fadeBeats) ||
		!Array.isArray(value.generatedEffects) || !Array.isArray(value.cues) || !value.cues.length ||
		!Array.isArray(value.hits)) return false;
	return value.generatedEffects.every((effect: unknown) => record(effect) && typeof effect.id === 'string' &&
		typeof effect.source === 'string' && Array.isArray(effect.params)) &&
		value.cues.every((cue: unknown) => record(cue) && finite(cue.bar) && typeof cue.section === 'string' &&
			(cue.note === undefined || typeof cue.note === 'string') && record(cue.layers) &&
			Object.values(cue.layers).every((layer) => record(layer) && typeof layer.effect === 'string' &&
				optionalFinite(layer.opacity) && params(layer.params)) &&
			['intensity', 'motion', 'fadeBeats'].every((key) => optionalFinite(cue[key])) &&
			(cue.palette === undefined || cue.palette === 'swap' || cue.palette === 'inherit' || palette(cue.palette))) &&
		value.hits.every((hit: unknown) => record(hit) && finite(hit.bar) && optionalFinite(hit.beat) &&
			finite(hit.beats) && ['slam', 'strobe', 'blackout', 'bump'].includes(hit.kind as string) && params(hit.params));
}

/** Keep authored arrangements and the listener's reroll seed across analysis refreshes. */
export function refreshShow(analysis: TrackAnalysis, options: RefreshOptions): Show {
	const { existing, analysisChanged, arrangementUnchanged, ...composition } = options;
	const sameAudio = existing?.analysisHash === analysis.hash;
	if (sameAudio && hasSavedShowShape(existing)) {
		const author = existing.authoredBy ?? (existing.generatedEffects.length > 0 ? 'claude' : 'engine');
		if (author !== 'engine' || (existing.version === SHOW_VERSION && !analysisChanged)) {
			return existing;
		}
		if (existing.version === SHOW_VERSION && arrangementUnchanged && lintShow(existing, {
			analysis, context: composition.context,
			effects: new Map(BUILT_IN_EFFECTS.map((effect) => [effect.id, effect]))
		}).ok) return existing;
	}
	const seed = sameAudio && finite(existing?.seed) ? existing.seed : undefined;
	return composeShow(analysis, { ...composition, seed });
}
