import type { SegmentKind } from '@mv/core';
import type { IconName } from '$lib/ui/icons.ts';
import type { RowKind } from '../queueModel.ts';

/** 'HH:MM' on the room's clock. */
export function clockTime(ms: number): string {
	const d = new Date(ms);
	return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
}

/** A length a person reads at a glance: '48 s', '25 min', '1 h 05'. */
export function lengthLabel(seconds: number): string {
	if (!Number.isFinite(seconds) || seconds <= 0) return '';
	if (seconds < 90) return `${Math.round(seconds)} s`;
	const minutes = Math.round(seconds / 60);
	if (minutes < 60) return `${minutes} min`;
	return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')}`;
}

/** Until a moment, in words: 'in 14 min', 'now'. */
export function untilLabel(ms: number, now: number): string {
	const minutes = Math.round((ms - now) / 60_000);
	if (minutes <= 0) return 'now';
	if (minutes < 60) return `in ${minutes} min`;
	return `in ${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')}`;
}

export const SEGMENT_ICON: Record<SegmentKind, IconName> = {
	block: 'music',
	pause: 'pauseRow',
	hold: 'hold',
	moment: 'moment',
	narration: 'narration'
};

export const SEGMENT_LABEL: Record<SegmentKind, string> = {
	block: 'Songs',
	pause: 'Pause',
	hold: 'Hold',
	moment: 'Moment',
	narration: 'Narration'
};

export const ROW_ICON: Record<RowKind, IconName> = {
	song: 'music',
	pause: 'pauseRow',
	hold: 'hold',
	moment: 'moment',
	narration: 'narration',
	sting: 'bolt'
};

export const ROW_LABEL: Record<RowKind, string> = {
	song: 'Song',
	pause: 'Pause',
	hold: 'Waiting for Go',
	moment: 'Light moment',
	narration: 'Narration',
	sting: 'Transition'
};
