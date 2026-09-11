import { describe, expect, it } from 'vitest';
import { CLAUDE, deepseek, environmentFor } from './provider.ts';

describe('claude', () => {
	it('adds nothing to the environment, so the CLI keeps its own login', () => {
		expect(CLAUDE.env).toBeUndefined();
		expect(environmentFor(CLAUDE)).toBe(process.env);
	});

	it('passes every effort level through', () => {
		for (const level of ['low', 'medium', 'high', 'xhigh', 'max'] as const) {
			expect(CLAUDE.effort(level)).toBe(level);
		}
	});
});

describe('deepseek', () => {
	const provider = deepseek('sk-test');

	// V4 implements three levels where Anthropic implements five, and an unrecognised value is
	// not an error the endpoint reports: it is a silent downgrade to the default, so a caller
	// asking for the hardest setting would quietly get the middle one.
	it('folds five effort levels onto the three V4 implements', () => {
		expect(provider.effort('low')).toBe('low');
		expect(provider.effort('medium')).toBe('low');
		expect(provider.effort('high')).toBe('high');
		expect(provider.effort('xhigh')).toBe('high');
		expect(provider.effort('max')).toBe('max');
	});

	it('points the CLI at the Anthropic-compatible endpoint', () => {
		const env = environmentFor(provider);
		expect(env.ANTHROPIC_BASE_URL).toBe('https://api.deepseek.com/anthropic');
		expect(env.ANTHROPIC_AUTH_TOKEN).toBe('sk-test');
		expect(env.ANTHROPIC_MODEL).toBe('deepseek-v4-flash');
	});

	// An Anthropic key left in the environment takes precedence over the token, and the failure
	// is a 401 from a host nobody asked for.
	it('clears an inherited Anthropic key', () => {
		const env = environmentFor(provider);
		expect(env.ANTHROPIC_API_KEY).toBeUndefined();
		expect('ANTHROPIC_API_KEY' in env).toBe(true);
	});

	it('keeps the rest of the environment, so PATH and HOME still reach the subprocess', () => {
		const env = environmentFor(provider);
		expect(env.PATH).toBe(process.env.PATH);
	});

	it('records itself separately from Claude, so a show says which model wrote it', () => {
		expect(provider.id).toBe('deepseek');
		expect(CLAUDE.id).toBe('claude');
	});
});

describe('a subprocess spawned from inside another Claude Code session', () => {
	// An inherited desktop entrypoint changes subprocess authentication; the backend must
	// override it.
	it('identifies as the SDK rather than as whatever launched the server', () => {
		expect(environmentFor(deepseek('sk-test')).CLAUDE_CODE_ENTRYPOINT).toBe('sdk-ts');
	});
});
