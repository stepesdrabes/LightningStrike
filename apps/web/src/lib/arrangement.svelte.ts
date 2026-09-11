import type { Show, TrackAnalysis } from '@mv/core';
import type { JudgedSection, Judgement, JudgementPatch, TrackMeta } from './types.ts';
import type { Viz } from './viz.svelte.ts';

interface ArrangementHost {
	readonly trackId: string | null;
	readonly meta: TrackMeta | null;
	readonly judgements: Record<string, Judgement>;
	readonly viz: Pick<Viz, 'loadShow' | 'clearShow'> | null;
	show: Show | null;
	analysis: TrackAnalysis | null;
	loadJudgements(): Promise<void>;
	saveJudgement(patch: JudgementPatch): Promise<void>;
	openTimeline(): void;
	note(line: string): void;
}

type MapEdit = { sections: JudgedSection[] } | { movements: number[] };

export function createArrangementEditor(host: ArrangementHost) {
	let sectionEditing = $state(false);
	let sectionDraft = $state<JudgedSection[] | null>(null);
	let previewShow = $state<Show | null>(null);
	// One stack preserves gesture order across section edits and movement marks.
	let undoStack: MapEdit[] = [];
	let shelvedShow: Show | null = null;
	let shelvedAnalysis: TrackAnalysis | null = null;
	let previewFetching = false;
	let previewPending = false;
	const movements = $derived(host.trackId ? (host.judgements[host.trackId]?.movements ?? []) : []);
	const movementVetoes = $derived(
		host.trackId ? (host.judgements[host.trackId]?.movementVetoes ?? []) : []
	);

	// Preserve saved hand boundaries; arrangement adoption rounds them to bars.
	function seedSections(): JudgedSection[] | null {
		const saved = host.trackId ? host.judgements[host.trackId]?.sections : null;
		if (saved?.length) return saved.map((s) => ({ ...s }));
		return seedFromAnalysis();
	}

	async function armSectionEdit(on: boolean) {
		undoStack = [];
		if (!on) {
			sectionEditing = false;
			sectionDraft = null;
			return;
		}
		await host.loadJudgements();
		sectionDraft = seedSections();
		if (!sectionDraft) return;
		sectionEditing = true;
		host.openTimeline();
	}

	function applySections(list: JudgedSection[]) {
		if (!host.trackId) return;
		sectionDraft = list;
		if (previewShow) void stagePreview(false);
		// Save only the editor's map and grid, leaving panel fields unchanged.
		void host.saveJudgement({
			trackId: host.trackId,
			title: host.meta?.title ?? host.judgements[host.trackId]?.title ?? '',
			sections: list,
			analysisHash: host.analysis?.hash ?? null,
			showSeed: host.show?.seed ?? null,
			authoredBy: host.show?.authoredBy ?? null
		});
	}

	function saveSections(list: JudgedSection[]) {
		if (sectionDraft) {
			undoStack = [...undoStack.slice(-49), { sections: $state.snapshot(sectionDraft) }];
		}
		applySections(list);
	}

	function applyMovements(list: number[]) {
		if (!host.trackId) return;
		void host.saveJudgement({
			trackId: host.trackId,
			title: host.meta?.title ?? host.judgements[host.trackId]?.title ?? '',
			movements: list
		});
	}

	function saveMovements(list: number[]) {
		undoStack = [...undoStack.slice(-49), { movements: [...movements] }];
		applyMovements(list);
	}

	function vetoMovement(t: number) {
		if (!host.trackId) return;
		if (movementVetoes.some((x) => Math.abs(x - t) < 0.5)) return;
		void host.saveJudgement({
			trackId: host.trackId,
			title: host.meta?.title ?? host.judgements[host.trackId]?.title ?? '',
			movementVetoes: [...movementVetoes, Math.round(t * 10) / 10].sort((a, b) => a - b)
		});
	}

	function liftVeto(t: number) {
		if (!host.trackId) return;
		void host.saveJudgement({
			trackId: host.trackId,
			title: host.meta?.title ?? host.judgements[host.trackId]?.title ?? '',
			movementVetoes: movementVetoes.filter((x) => Math.abs(x - t) >= 0.5)
		});
	}

	function undoMapEdit() {
		const last = undoStack.at(-1);
		if (!last) return;
		undoStack = undoStack.slice(0, -1);
		if ('sections' in last) applySections(last.sections);
		else applyMovements(last.movements);
	}

	function discardSections() {
		if (!host.trackId) return;
		void togglePreview(false);
		if (host.judgements[host.trackId]) void host.saveJudgement({ trackId: host.trackId, sections: null });
		sectionDraft = sectionEditing ? seedFromAnalysis() : null;
	}

	function seedFromAnalysis(): JudgedSection[] | null {
		if (!host.analysis) return null;
		return host.analysis.sections.map((s) => ({
			kind: s.kind,
			startTime: s.startTime,
			endTime: s.endTime,
			startBar: s.startBar,
			endBar: s.endBar
		}));
	}

	async function togglePreview(on: boolean) {
		if (!host.viz) return;
		if (!on) {
			if (!previewShow) return;
			// A later reroll or author takes precedence over the shelved show.
			if (host.show === previewShow) {
				host.show = shelvedShow;
				if (shelvedAnalysis) host.analysis = shelvedAnalysis;
				if (host.show && host.analysis) host.viz.loadShow(host.analysis, host.show);
				else host.viz.clearShow();
			}
			previewShow = null;
			shelvedShow = null;
			shelvedAnalysis = null;
			return;
		}
		if (previewShow) return;
		await stagePreview(true);
	}

	async function stagePreview(first: boolean) {
		if (!host.trackId || !host.analysis || !host.viz) return;
		// Coalesce in-flight edits to the latest draft, then compose it when the request finishes.
		if (previewFetching) {
			previewPending = true;
			return;
		}
		previewFetching = true;
		try {
			while (true) {
				previewPending = false;
				const res = await fetch(`/api/track/${host.trackId}/preview-arrangement`, {
					method: 'POST',
					headers: { 'content-type': 'application/json' },
					body: JSON.stringify({ sections: sectionDraft ?? undefined })
				});
				if (!res.ok) throw new Error((await res.text()).slice(0, 300));
				const data = (await res.json()) as { show: Show; analysis: TrackAnalysis };
				if (first && !previewShow) {
					shelvedShow = host.show;
					shelvedAnalysis = host.analysis;
				}
				host.show = data.show;
				// Read back the page's $state proxy so restoration recognises it by identity.
				previewShow = host.show;
				host.analysis = data.analysis;
				host.viz.loadShow(data.analysis, data.show);
				const drawn = sectionDraft ?? host.judgements[host.trackId]?.sections ?? [];
				let moved = 0;
				let worst = 0;
				for (let i = 0; i < Math.min(drawn.length, data.analysis.sections.length); i++) {
					const by = Math.abs(data.analysis.sections[i].startTime - drawn[i].startTime);
					if (by > 0.05) {
						moved++;
						worst = Math.max(worst, by);
					}
				}
				const rounded =
					moved > 0
						? ` - ${moved} boundary${moved === 1 ? '' : 's'} rounded onto a bar line, ` +
							`up to ${worst.toFixed(2)}s`
						: '';
				if (first) {
					host.note(
						`previewing the hand-drawn arrangement: ${data.show.cues.length} cues, ` +
							`${data.analysis.sections.length} sections${rounded}`
					);
				} else if (rounded) {
					host.note(`preview recomposed${rounded}`);
				}
				if (!previewPending) break;
			}
		} catch (e) {
			host.note(`ERROR ${(e as Error).message}`);
		} finally {
			previewFetching = false;
		}
	}

	function reset() {
		// In-flight preview requests finish independently of this track-local reset.
		sectionEditing = false;
		sectionDraft = null;
		undoStack = [];
		previewShow = null;
		shelvedShow = null;
		shelvedAnalysis = null;
	}

	return {
		get sectionEditing() {
			return sectionEditing;
		},
		get sectionDraft() {
			return sectionDraft;
		},
		get previewShow() {
			return previewShow;
		},
		get movements() {
			return movements;
		},
		get movementVetoes() {
			return movementVetoes;
		},
		armSectionEdit,
		saveSections,
		saveMovements,
		vetoMovement,
		liftVeto,
		undoMapEdit,
		discardSections,
		togglePreview,
		reset
	};
}
