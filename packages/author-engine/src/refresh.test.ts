import { describe, expect, it } from 'vitest';
import { SHOW_VERSION, type Show } from '@mv/core';
import { fixture } from './fixture.ts';
import { composeShow } from './plan.ts';
import { refreshShow } from './refresh.ts';

describe('saved show refresh', () => {
	it('preserves a listener reroll while recomposing changed analysis', () => {
		const analysis = fixture();
		const saved = composeShow(analysis, { seed: 7654321 });
		const untouched = JSON.stringify(saved);
		const changed = structuredClone(analysis);
		changed.bars.forEach((bar) => { bar.snares = 0; });
		const refreshed = refreshShow(changed, { existing: saved, analysisChanged: true });
		expect(refreshed).toEqual(composeShow(changed, { seed: saved.seed }));
		expect(refreshed).not.toBe(saved);
		expect(JSON.stringify(saved)).toBe(untouched);
	});

	it('refreshes stale engine versions without discarding their seed', () => {
		const analysis = fixture();
		const saved = { ...composeShow(analysis, { seed: 42 }), version: SHOW_VERSION - 1 };
		const refreshed = refreshShow(analysis, { existing: saved, analysisChanged: false });
		expect(refreshed.version).toBe(SHOW_VERSION);
		expect(refreshed.seed).toBe(42);
	});

	it('retains current saved arrangements exactly when analysis was reused', () => {
		const analysis = fixture();
		const saved = composeShow(analysis);
		saved.defaults.intensity = 0.61;
		expect(refreshShow(analysis, { existing: saved, analysisChanged: false })).toBe(saved);
	});

	it('keeps a valid saved arrangement when only its audio articulation changed', () => {
		const analysis = fixture();
		const saved = composeShow(analysis, { seed: 7654321 });
		const changed = structuredClone(analysis);
		changed.onsets.snare.levels = changed.onsets.snare.levels.map((level) => level * 0.8);
		expect(refreshShow(changed, { existing: saved, analysisChanged: true, arrangementUnchanged: true })).toBe(saved);
	});

	it('recomposes a layout-compatible arrangement that no longer passes the new analysis lint', () => {
		const analysis = fixture();
		const saved = composeShow(analysis, { seed: 7654321 });
		saved.cues[0].bar = 999999;
		const refreshed = refreshShow(analysis, { existing: saved, analysisChanged: true, arrangementUnchanged: true });
		expect(refreshed).not.toBe(saved);
		expect(refreshed).toEqual(composeShow(analysis, { seed: saved.seed }));
	});

	it('still migrates an old engine version when its layout is compatible', () => {
		const analysis = fixture();
		const saved = { ...composeShow(analysis, { seed: 0 }), version: SHOW_VERSION - 1 };
		const refreshed = refreshShow(analysis, { existing: saved, analysisChanged: true, arrangementUnchanged: true });
		expect(refreshed).not.toBe(saved);
		expect(refreshed.version).toBe(SHOW_VERSION);
		expect(refreshed.seed).toBe(0);
	});

	it.each(['claude', 'deepseek'] as const)('retains %s arrangements on the same audio', (authoredBy) => {
		const analysis = fixture();
		const saved = { ...composeShow(analysis), authoredBy, version: SHOW_VERSION - 1 };
		expect(refreshShow(analysis, { existing: saved, analysisChanged: true })).toBe(saved);
	});

	it('retains legacy authored arrangements with generated effects and no author or seed field', () => {
		const analysis = fixture();
		const saved = composeShow(analysis);
		delete saved.authoredBy;
		delete saved.seed;
		saved.version = SHOW_VERSION - 1;
		saved.generatedEffects = [{
			id: 'saved-custom-bed', name: 'Saved bed', role: 'bed', blurb: 'Existing authored effect',
			params: [], source: 'function create() { return { reset() {}, render() {} }; }'
		}];
		saved.cues[0].layers.bed = { effect: 'saved-custom-bed' };
		expect(refreshShow(analysis, { existing: saved, analysisChanged: true, arrangementUnchanged: true })).toBe(saved);
	});

	const corruptions: [string, (show: Show) => unknown][] = [
		['missing generated effects', (show) => ({ ...show, authoredBy: undefined, generatedEffects: undefined })],
		['null cues', (show) => ({ ...show, cues: null })],
		['empty cues', (show) => ({ ...show, cues: [] })],
		['null hits', (show) => ({ ...show, hits: null })],
		['missing defaults even with explicit cue settings', (show) => ({ ...show, defaults: undefined })],
		['null cue', (show) => ({ ...show, cues: [null] })],
		['missing cue layers', (show) => ({ ...show, cues: [{ ...show.cues[0], layers: undefined }] })],
		['null hit', (show) => ({ ...show, hits: [null] })],
		['unknown hit kind', (show) => ({ ...show, hits: [{ bar: 0, kind: 'unknown', beats: 1 }] })],
		['null palette', (show) => ({ ...show, palette: null })],
		['numeric cue note', (show) => ({ ...show, cues: [{ ...show.cues[0], note: 42 }] })],
		['nonfinite layer parameter', (show) => ({ ...show, cues: [{ ...show.cues[0], layers: {
			bed: { effect: 'spectrumBed', params: { gain: Number.NaN } }
		} }] })]
	];
	it.each(corruptions)('recomposes malformed %s without losing seed zero', (_name, corrupt) => {
		const analysis = fixture();
		const valid = composeShow(analysis, { seed: 0 });
		const saved = corrupt(valid) as Show;
		const expected = composeShow(analysis, { seed: 0 });
		for (const analysisChanged of [false, true]) {
			const refreshed = refreshShow(analysis, { existing: saved, analysisChanged, arrangementUnchanged: true });
			expect(refreshed).not.toBe(saved);
			expect(refreshed).toEqual(expected);
		}
	});

	it.each([Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, '0', null])(
		'discards malformed seed %s when rebuilding the cache', (seed) => {
			const analysis = fixture();
			const saved = { ...composeShow(analysis), seed } as Show;
			expect(refreshShow(analysis, { existing: saved, analysisChanged: true, arrangementUnchanged: true }))
				.toEqual(composeShow(analysis));
		}
	);

	it('does not carry an arrangement or reroll into different audio', () => {
		const analysis = fixture();
		const saved = { ...composeShow(analysis, { seed: 42 }), authoredBy: 'claude' as const };
		const changed = { ...analysis, hash: 'another-recording' };
		expect(refreshShow(changed, { existing: saved, analysisChanged: true })).toEqual(composeShow(changed));
	});
});
