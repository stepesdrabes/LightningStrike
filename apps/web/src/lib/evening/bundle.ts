import { silentAnalysis, silentShow, songShow, type MeasuredAudio, type RowPlan, type Show, type TrackAnalysis } from '@mv/core';

export interface RowBundle {
	analysis: TrackAnalysis;
	/** Null only for a song whose engine show does not exist yet. */
	show: Show | null;
	/** Calm scenes follow the music instead of the show. */
	lounge: boolean;
}

/**
 * The analysis and show one evening row plays. Pure, so the preview and the hardware renderer
 * build exactly the same frames from the same plan.
 */
export function rowBundle(
	key: string,
	plan: RowPlan,
	track: { analysis: TrackAnalysis; show: Show | null } | null,
	measured: MeasuredAudio | null = null
): RowBundle | null {
	if (plan.kind === 'song') {
		if (!track) return null;
		return {
			analysis: track.analysis,
			show: track.show ? songShow(track.analysis, track.show, plan) : null,
			lounge: plan.calm && !plan.look
		};
	}
	if (plan.kind === 'silent') {
		const analysis = silentAnalysis(key, plan);
		return { analysis, show: silentShow(analysis, plan), lounge: false };
	}
	const analysis = silentAnalysis(key, { ...plan, calm: false }, measured ?? undefined);
	return { analysis, show: silentShow(analysis, plan), lounge: false };
}
