import { readFileSync } from 'node:fs';
import { compileModule } from 'svelte/compiler';
import ts from 'typescript';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Show, TrackAnalysis } from '@mv/core';
import type { createArrangementEditor as CreateEditor } from './arrangement.svelte.ts';
import type { JudgedSection, Judgement, JudgementPatch, TrackMeta } from './types.ts';

// Exercise compiled runes and real proxies without requiring a DOM or changing the suite's config.
async function compileRunes<T>(source: string, filename: string): Promise<T> {
	const js = ts.transpileModule(source, {
		compilerOptions: { target: ts.ScriptTarget.ESNext, module: ts.ModuleKind.ESNext }
	}).outputText;
	const compiled = compileModule(js, { filename, generate: 'client' }).js.code;
	const code = compiled.replace(/(['"])(svelte\/internal\/client)\1/g, (_, quote, name: string) =>
		`${quote}${import.meta.resolve(name)}${quote}`
	);
	return import(/* @vite-ignore */ `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
}

const { createArrangementEditor } = await compileRunes<{ createArrangementEditor: typeof CreateEditor }>(
	readFileSync(new URL('./arrangement.svelte.ts', import.meta.url), 'utf8'),
	'arrangement.svelte.js'
);
const { reactive } = await compileRunes<{ reactive: <T>(value: T) => T }>(
	'export function reactive(value) { let state = $state(value); return state; }',
	'fixture.svelte.js'
);

function section(startTime = 0): JudgedSection {
	return { kind: 'verse', startTime, endTime: 16, startBar: 0, endBar: 8 };
}

function bundle(seed: number, sections = [section()]) {
	return {
		show: { seed, authoredBy: 'engine', cues: [], hits: [] } as unknown as Show,
		analysis: { hash: `analysis-${seed}`, sections } as unknown as TrackAnalysis
	};
}

function response(data: ReturnType<typeof bundle>) {
	return { ok: true, json: async () => data } as Response;
}

function deferred<T>() {
	let resolve!: (value: T) => void;
	const promise = new Promise<T>((done) => {
		resolve = done;
	});
	return { promise, resolve };
}

function fixture() {
	const initial = bundle(1);
	const state = reactive({
		trackId: 'a' as string | null,
		meta: { title: 'Track A' } as TrackMeta | null,
		show: initial.show as Show | null,
		analysis: initial.analysis as TrackAnalysis | null,
		judgements: {} as Record<string, Judgement>
	});
	const viz = { loadShow: vi.fn(), clearShow: vi.fn() };
	const note = vi.fn();
	const openTimeline = vi.fn();
	const loadJudgements = vi.fn(async () => {});
	const saveJudgement = vi.fn(async (patch: JudgementPatch) => {
		state.judgements = {
			...state.judgements,
			[patch.trackId]: { ...(state.judgements[patch.trackId] ?? ({} as Judgement)), ...patch }
		};
	});
	const editor = createArrangementEditor({
		get trackId() {
			return state.trackId;
		},
		get meta() {
			return state.meta;
		},
		get show() {
			return state.show;
		},
		set show(value) {
			state.show = value;
		},
		get analysis() {
			return state.analysis;
		},
		set analysis(value) {
			state.analysis = value;
		},
		get judgements() {
			return state.judgements;
		},
		viz,
		note,
		openTimeline,
		loadJudgements,
		saveJudgement
	});
	const fetch = vi.fn<typeof globalThis.fetch>();
	vi.stubGlobal('fetch', fetch);
	return { state, editor, viz, note, openTimeline, loadJudgements, saveJudgement, fetch };
}

afterEach(() => {
	vi.unstubAllGlobals();
});

describe('arrangement editing', () => {
	it('waits for judgements and preserves saved fine boundaries without sharing mutable drafts', async () => {
		const f = fixture();
		const loading = deferred<void>();
		const saved = [{ ...section(0.13), offGrid: true }];
		f.loadJudgements.mockImplementationOnce(() => loading.promise);
		const arming = f.editor.armSectionEdit(true);
		expect(f.editor.sectionEditing).toBe(false);
		expect(f.openTimeline).not.toHaveBeenCalled();
		f.state.judgements.a = { sections: saved } as Judgement;
		loading.resolve();
		await arming;
		expect(f.editor.sectionDraft).toEqual(saved);
		expect(f.editor.sectionEditing).toBe(true);
		expect(f.openTimeline).toHaveBeenCalledOnce();
		f.editor.sectionDraft![0].startTime = 0.2;
		expect(f.state.judgements.a.sections![0].startTime).toBe(0.13);
	});

	it('uses analysis without a saved map and does not arm without analysis', async () => {
		const f = fixture();
		await f.editor.armSectionEdit(true);
		expect(f.editor.sectionDraft).toEqual([section()]);
		await f.editor.armSectionEdit(false);
		f.state.analysis = null;
		await f.editor.armSectionEdit(true);
		expect(f.editor.sectionEditing).toBe(false);
		expect(f.editor.sectionDraft).toBeNull();
		expect(f.openTimeline).toHaveBeenCalledOnce();
	});

	it('undoes mixed gestures in order without overwriting other judgement fields', async () => {
		const f = fixture();
		f.state.judgements.a = { rating: 4, movements: [2], comment: 'Keep this' } as Judgement;
		await f.editor.armSectionEdit(true);
		f.editor.saveSections([section(0.2)]);
		f.editor.saveMovements([2, 10]);
		f.editor.undoMapEdit();
		expect(f.editor.movements).toEqual([2]);
		expect(f.editor.sectionDraft).toEqual([section(0.2)]);
		f.editor.undoMapEdit();
		expect(f.editor.sectionDraft).toEqual([section()]);
		expect(f.state.judgements.a).toMatchObject({ rating: 4, comment: 'Keep this' });
		expect(f.saveJudgement.mock.calls[0][0]).toEqual({
			trackId: 'a', title: 'Track A', sections: [section(0.2)],
			analysisHash: 'analysis-1', showSeed: 1, authoredBy: 'engine'
		});
		f.editor.undoMapEdit();
		expect(f.saveJudgement).toHaveBeenCalledTimes(4);
	});

	it('retains the last 50 undo gestures and clears them when disarming', async () => {
		const f = fixture();
		await f.editor.armSectionEdit(true);
		for (let i = 1; i <= 51; i++) f.editor.saveSections([section(i)]);
		for (let i = 0; i < 51; i++) f.editor.undoMapEdit();
		expect(f.editor.sectionDraft![0].startTime).toBe(1);
		f.editor.saveSections([section(2)]);
		await f.editor.armSectionEdit(false);
		f.editor.undoMapEdit();
		expect(f.editor.sectionDraft).toBeNull();
		expect(f.state.judgements.a.sections![0].startTime).toBe(2);
	});

	it('rounds and sorts movement vetoes, deduplicates nearby marks, and retains the half-second edge', () => {
		const f = fixture();
		f.state.judgements.a = { movementVetoes: [10] } as Judgement;
		f.editor.vetoMovement(10.49);
		expect(f.saveJudgement).not.toHaveBeenCalled();
		f.editor.vetoMovement(4.16);
		f.editor.vetoMovement(10.5);
		expect(f.editor.movementVetoes).toEqual([4.2, 10, 10.5]);
		f.editor.liftVeto(10);
		expect(f.editor.movementVetoes).toEqual([4.2, 10.5]);
	});
});

describe('arrangement preview', () => {
	it('restores the original show and analysis using the staged proxy identity', async () => {
		const f = fixture();
		const originalShow = f.state.show;
		const originalAnalysis = f.state.analysis;
		const preview = bundle(2);
		f.fetch.mockResolvedValueOnce(response(preview));
		await f.editor.togglePreview(true);
		expect(f.editor.previewShow).toBe(f.state.show);
		expect(f.editor.previewShow).not.toBe(preview.show);
		expect(f.viz.loadShow).toHaveBeenLastCalledWith(preview.analysis, preview.show);
		expect(f.fetch).toHaveBeenCalledWith('/api/track/a/preview-arrangement', {
			method: 'POST', headers: { 'content-type': 'application/json' }, body: '{}'
		});
		await f.editor.togglePreview(false);
		expect(f.state.show).toBe(originalShow);
		expect(f.state.analysis).toBe(originalAnalysis);
		expect(f.editor.previewShow).toBeNull();
		expect(f.viz.loadShow).toHaveBeenLastCalledWith(originalAnalysis, originalShow);
	});

	it('coalesces edits during a compose to the latest draft and keeps the original shelf', async () => {
		const f = fixture();
		const originalShow = f.state.show;
		const originalAnalysis = f.state.analysis;
		f.fetch.mockResolvedValueOnce(response(bundle(2)));
		await f.editor.armSectionEdit(true);
		await f.editor.togglePreview(true);
		const first = deferred<Response>();
		const latest = deferred<Response>();
		f.fetch.mockReturnValueOnce(first.promise).mockReturnValueOnce(latest.promise);
		f.editor.saveSections([section(0.1)]);
		f.editor.saveSections([section(0.2)]);
		f.editor.saveSections([section(0.3)]);
		expect(f.fetch).toHaveBeenCalledTimes(2);
		expect(JSON.parse(f.fetch.mock.calls[1][1]!.body as string)).toEqual({ sections: [section(0.1)] });
		expect(f.fetch.mock.invocationCallOrder[1]).toBeLessThan(f.saveJudgement.mock.invocationCallOrder[0]);
		first.resolve(response(bundle(3, [section(0.1)])));
		await vi.waitFor(() => expect(f.fetch).toHaveBeenCalledTimes(3));
		expect(JSON.parse(f.fetch.mock.calls[2][1]!.body as string)).toEqual({ sections: [section(0.3)] });
		latest.resolve(response(bundle(4, [section(0.3)])));
		await vi.waitFor(() => expect(f.state.show?.seed).toBe(4));
		await f.editor.togglePreview(false);
		expect(f.state.show).toBe(originalShow);
		expect(f.state.analysis).toBe(originalAnalysis);
		expect(f.fetch).toHaveBeenCalledTimes(3);
	});

	it('does not restore over a later authored or rerolled show', async () => {
		const f = fixture();
		f.fetch.mockResolvedValueOnce(response(bundle(2)));
		await f.editor.togglePreview(true);
		const replacement = bundle(3);
		f.state.show = replacement.show;
		f.state.analysis = replacement.analysis;
		const staged = f.state.show;
		const analysis = f.state.analysis;
		await f.editor.togglePreview(false);
		expect(f.state.show).toBe(staged);
		expect(f.state.analysis).toBe(analysis);
		expect(f.viz.loadShow).toHaveBeenCalledOnce();
		expect(f.editor.previewShow).toBeNull();
	});

	it('clears the renderer when the original track had no show', async () => {
		const f = fixture();
		f.state.show = null;
		const originalAnalysis = f.state.analysis;
		f.fetch.mockResolvedValueOnce(response(bundle(2)));
		await f.editor.togglePreview(true);
		await f.editor.togglePreview(false);
		expect(f.state.show).toBeNull();
		expect(f.state.analysis).toBe(originalAnalysis);
		expect(f.viz.clearShow).toHaveBeenCalledOnce();
	});

	it('discards a hand map only after restoring the original analysis', async () => {
		const f = fixture();
		await f.editor.armSectionEdit(true);
		f.editor.saveSections([section(0.2)]);
		f.fetch.mockResolvedValueOnce(response(bundle(2, [section(0.5)])));
		await f.editor.togglePreview(true);
		f.editor.discardSections();
		expect(f.editor.previewShow).toBeNull();
		expect(f.editor.sectionDraft).toEqual([section()]);
		expect(f.state.judgements.a.sections).toBeNull();
		expect(f.saveJudgement).toHaveBeenLastCalledWith({ trackId: 'a', sections: null });
	});

	it('resets track-local editing without restoring over the new track', async () => {
		const f = fixture();
		await f.editor.armSectionEdit(true);
		f.editor.saveSections([section(0.2)]);
		f.fetch.mockResolvedValueOnce(response(bundle(2)));
		await f.editor.togglePreview(true);
		const next = bundle(3);
		f.state.trackId = 'b';
		f.state.show = next.show;
		f.state.analysis = next.analysis;
		f.state.judgements.b = { movements: [8] } as Judgement;
		const staged = f.state.show;
		f.editor.reset();
		f.editor.undoMapEdit();
		await f.editor.togglePreview(false);
		expect(f.state.show).toBe(staged);
		expect(f.editor.sectionEditing).toBe(false);
		expect(f.editor.sectionDraft).toBeNull();
		expect(f.editor.previewShow).toBeNull();
		expect(f.editor.movements).toEqual([8]);
		expect(f.viz.loadShow).toHaveBeenCalledOnce();
	});

	it('preserves the existing in-flight response behavior across a track reset', async () => {
		const f = fixture();
		const pending = deferred<Response>();
		f.fetch.mockReturnValueOnce(pending.promise);
		const previewing = f.editor.togglePreview(true);
		const next = bundle(3);
		f.state.trackId = 'b';
		f.state.show = next.show;
		f.state.analysis = next.analysis;
		const nextShow = f.state.show;
		const nextAnalysis = f.state.analysis;
		f.editor.reset();
		// Reset does not cancel a request; changing that race is outside this extraction.
		pending.resolve(response(bundle(2)));
		await previewing;
		expect(f.state.show?.seed).toBe(2);
		await f.editor.togglePreview(false);
		expect(f.state.show).toBe(nextShow);
		expect(f.state.analysis).toBe(nextAnalysis);
	});

	it('reports request errors without disturbing the stage and allows a later retry', async () => {
		const f = fixture();
		const originalShow = f.state.show;
		f.fetch.mockResolvedValueOnce({ ok: false, text: async () => 'x'.repeat(350) } as Response);
		await f.editor.togglePreview(true);
		expect(f.note).toHaveBeenCalledWith(`ERROR ${'x'.repeat(300)}`);
		expect(f.state.show).toBe(originalShow);
		expect(f.viz.loadShow).not.toHaveBeenCalled();
		f.fetch.mockResolvedValueOnce(response(bundle(2)));
		await f.editor.togglePreview(true);
		expect(f.state.show?.seed).toBe(2);
	});

	it('keeps the original rounding messages and threshold', async () => {
		const f = fixture();
		await f.editor.armSectionEdit(true);
		f.editor.saveSections([section(0.1), section(4), section(8)]);
		f.fetch.mockResolvedValueOnce(response(bundle(2, [section(0.5), section(4.04), section(8.2)])));
		await f.editor.togglePreview(true);
		expect(f.note).toHaveBeenLastCalledWith(
			'previewing the hand-drawn arrangement: 0 cues, 3 sections - 2 boundarys rounded onto a bar line, up to 0.40s'
		);
	});
});
