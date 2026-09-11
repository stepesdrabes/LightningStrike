import { z } from 'zod';
import type { Show } from '@mv/core';

/**
 * A concrete schema makes MCP parse the argument as an object; z.any() supplies no JSON
 * Schema.
 */
const numbers = z.record(z.string(), z.number());

const layerSpec = z.object({
	effect: z.string().describe('Effect id from the catalog, or one you generated'),
	opacity: z.number().min(0).max(1).optional(),
	params: numbers.optional()
});

const explicitPalette = z.object({
	name: z.string().optional(),
	base: z.number().describe('Hue in degrees, 0-360'),
	accent: z.number(),
	third: z.number().optional(),
	sat: z.number().min(0).max(1).optional(),
	shade: z.number().min(0).max(1).optional(),
	white: z.number().min(0).max(1).optional()
});

const SECTION_ENUM = z.enum([
	'intro',
	'groove',
	'verse',
	'breakdown',
	'build',
	'void',
	'drop',
	'chorus',
	'outro'
]);

export const showSchema = z.object({
	version: z.number().optional(),
	trackId: z.string().optional(),
	title: z.string().optional(),
	analysisHash: z.string().describe('Copy verbatim from the track header'),
	brief: z.string().describe('The design rationale, in prose'),
	palette: explicitPalette,
	defaults: z.object({
		intensity: z.number().min(0).max(1),
		motion: z.number().min(0).max(4),
		fadeBeats: z.number().min(0).max(32)
	}),
	cues: z
		.array(
			z.object({
				bar: z.number().int().describe('A bar index that exists in the bar table'),
				section: SECTION_ENUM,
				layers: z.object({
					bed: layerSpec.optional(),
					rhythm: layerSpec.optional(),
					transient: layerSpec.optional(),
					accent: layerSpec.optional(),
					master: layerSpec.optional()
				}),
				palette: z.union([z.literal('inherit'), z.literal('swap'), explicitPalette]).optional(),
				intensity: z.number().min(0).max(1).optional(),
				motion: z.number().min(0).max(4).optional(),
				fadeBeats: z.number().min(0).max(32).optional(),
				note: z.string()
			})
		)
		.min(1),
	hits: z
		.array(
			z.object({
				bar: z.number().int(),
				beat: z.number().optional(),
				kind: z.enum(['slam', 'strobe', 'blackout', 'bump']),
				beats: z.number().min(0.25).max(16),
				params: numbers.optional(),
				note: z.string().optional()
			})
		)
		.optional()
});

interface ParsedShow {
	show: Show | null;
	error: string | null;
}

/** Accept stringified arguments as well as objects for MCP compatibility. */
export function coerceShow(input: unknown): ParsedShow {
	let candidate = input;

	if (typeof candidate === 'string') {
		try {
			candidate = JSON.parse(candidate);
		} catch (e) {
			return { show: null, error: `the show argument was a string that is not valid JSON: ${(e as Error).message}` };
		}
	}

	if (!candidate || typeof candidate !== 'object') {
		return { show: null, error: 'the show argument must be a Show object' };
	}

	const parsed = showSchema.safeParse(candidate);
	if (!parsed.success) {
		const issues = parsed.error.issues
			.slice(0, 12)
			.map((i) => `  ${i.path.join('.') || '(root)'}: ${i.message}`)
			.join('\n');
		return { show: null, error: `the show does not match the schema:\n${issues}` };
	}

	const value = parsed.data as unknown as Show;
	value.version ??= 1;
	value.hits ??= [];
	value.generatedEffects ??= [];
	return { show: value, error: null };
}
