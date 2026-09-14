import type { Finding, MeasuredAudio, RowPlan } from '@mv/core';
import type { RowKind, RowRole } from '../queueModel.ts';
import type { SegmentProjection } from './plan.ts';

export type EveningStatus = 'idle' | 'loaded' | 'running' | 'rehearsal' | 'ended';

export interface EveningRowView {
	key: string;
	kind: RowKind;
	segment: string;
	role: RowRole;
	title: string;
	artist: string;
	/** Seconds; a hold's expected wait. */
	duration: number;
	startAt: number;
	endAt: number;
	ready: boolean;
	addedBy?: string;
	heat?: number;
}

export interface PrepareView {
	running: boolean;
	total: number;
	done: number;
	failed: number;
	current: string | null;
}

/** What the host's rail and player need from the evening, published over SSE. */
export interface EveningView {
	status: EveningStatus;
	file: string | null;
	/** Evening files the host can open: the repo's evenings folder, then recent ones. */
	files: string[];
	name: string | null;
	loading: boolean;
	findings: Finding[];
	/** Findings from an edit the running evening did not take, when it kept the last good file. */
	rejected: boolean;
	segments: SegmentProjection[];
	/** Planned rows from the current one on, or the whole evening before it starts. */
	rows: EveningRowView[];
	/** The evening's rows already played, with the times they had. */
	past: EveningRowView[];
	/** The evening's clock when this view was published; a rehearsal runs its own. */
	now: number;
	/** Evening clock minus the wall clock, milliseconds. */
	clockOffset: number;
	/** The rehearsal timeline from the evening's start to its end, for seeking. */
	span: { start: number; end: number } | null;
	hold: { key: string; since: number } | null;
	/** Segment ids the host asked to hold after. */
	holdsAfter: string[];
	endsAt: number | null;
	waiting: number;
	/** Rows set aside when the evening started, which Restore brings back. */
	setAside: number;
	/** Open this row at this position, paused: after a restart, a seek or an ended rehearsal. */
	cue: { key: string; position: number; paused: boolean; token: number } | null;
	prepare: PrepareView;
	bailed: boolean;
}

/** A row's lighting as the players fetch it. */
export interface RowLightingView {
	key: string;
	kind: RowKind;
	title: string;
	light: number;
	plan: RowPlan;
	/** A narration's own level and spectrum, once prepared. */
	measured?: MeasuredAudio;
}

export const IDLE_VIEW: EveningView = {
	status: 'idle',
	file: null,
	files: [],
	name: null,
	loading: false,
	findings: [],
	rejected: false,
	segments: [],
	rows: [],
	past: [],
	now: 0,
	clockOffset: 0,
	span: null,
	hold: null,
	holdsAfter: [],
	endsAt: null,
	waiting: 0,
	setAside: 0,
	cue: null,
	prepare: { running: false, total: 0, done: 0, failed: 0, current: null },
	bailed: false
};
