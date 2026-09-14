import { describe, expect, it } from 'vitest';
import { compileEvening, type EveningScript } from '@mv/core';
import { block, evening, fill, moment, song } from '@mv/core/evening';
import { EMPTY_QUEUE, type QueueItem, type QueueState } from '../queueModel.ts';
import type { LibraryTrack } from './library.ts';
import { EMPTY_MEMORY, planEvening, type PlanInput } from './plan.ts';
import { bailQueue, reconcileQueue } from './reconcile.ts';

const now = Date.UTC(2026, 8, 19, 18, 0);

const library: LibraryTrack[] = ['a', 'b', 'c', 'd', 'e', 'f'].map((l, i) => ({
	id: `${l.repeat(10)}1`,
	title: `Song ${l}`,
	artist: `Artist ${l}`,
	thumbnail: '',
	source: `https://music.youtube.com/watch?v=${l.repeat(10)}1`,
	duration: 180,
	ready: i !== 5,
	genre: 'house',
	bpm: 120,
	heat: 2 + i * 0.5,
	loungeOnly: false
}));

const script: EveningScript = compileEvening(
	evening('Night', {
		segments: [
			moment('Spark', { length: 8, timeline: [{ at: 0, look: 'resting' }] }),
			block('Rise', { songs: [song('Song a'), fill({ count: 3 })] })
		]
	})
).script!;

const base = (overrides: Partial<PlanInput> = {}): PlanInput => ({
	script,
	run: 'r1',
	library,
	queue: EMPTY_QUEUE,
	now,
	offsetMinutes: -120,
	running: false,
	progress: null,
	hold: null,
	timedEndsAt: null,
	memory: EMPTY_MEMORY,
	...overrides
});

const facts = () => ({ authored: 'engine' as const });

function guestRow(key: string): QueueItem {
	return {
		key,
		source: 'https://music.youtube.com/watch?v=gggggggggg1',
		trackId: 'gggggggggg1',
		title: 'Guest pick',
		uploader: 'Someone',
		thumbnail: '',
		duration: 200,
		status: 'pending',
		message: '',
		authored: 'none',
		addedBy: 'Ada',
		addedAt: 5
	};
}

describe('laying a plan over the queue', () => {
	it('starts an evening from an empty queue on its first row', () => {
		const plan = planEvening(base());
		const state = reconcileQueue(EMPTY_QUEUE, plan, 'r1', facts, now);
		expect(state.items.map((i) => i.key)).toEqual(plan.rows.map((r) => r.key));
		expect(state.currentKey).toBe(plan.rows[0].key);
		expect(state.items[0]).toMatchObject({ kind: 'moment', status: 'ready', trackId: null });
		expect(state.items[1].kind).toBeUndefined();
		expect(state.items.find((i) => i.trackId === 'ffffffffff1')?.status ?? 'pending').toBe('pending');
	});

	it('changes nothing, not even the revision, when the plan has not changed', () => {
		const plan = planEvening(base());
		const state = reconcileQueue(EMPTY_QUEUE, plan, 'r1', facts, now);
		const replanned = planEvening(base({ running: true, queue: state, memory: plan.memory }));
		expect(reconcileQueue(state, replanned, 'r1', facts, now)).toBe(state);
	});

	it('keeps what a row learned while preparing', () => {
		const plan = planEvening(base());
		const state = reconcileQueue(EMPTY_QUEUE, plan, 'r1', facts, now);
		const preparing = {
			...state,
			items: state.items.map((i, n) => (n === 2 ? { ...i, status: 'analysing' as const, message: 'Tracking beats' } : i))
		};
		const replanned = planEvening(base({ running: true, queue: preparing, memory: plan.memory }));
		const next = reconcileQueue(preparing, replanned, 'r1', facts, now);
		expect(next.items[2]).toMatchObject({ status: 'analysing', message: 'Tracking beats' });
	});

	it('leaves history and the playing row alone and keeps waiting requests at the end', () => {
		const plan = planEvening(base());
		const started = reconcileQueue(EMPTY_QUEUE, plan, 'r1', facts, now);
		const playing: QueueState = { ...started, items: [...started.items, guestRow('g1')], currentKey: started.items[1].key };
		const replanned = planEvening(base({ running: true, queue: playing, memory: plan.memory, now: now + 10_000 }));
		const next = reconcileQueue(playing, replanned, 'r1', facts, now);
		expect(next.items.slice(0, 2)).toEqual(playing.items.slice(0, 2));
		expect(next.items[next.items.length - 1].key).toBe('g1');
		expect(next.currentKey).toBe(playing.currentKey);
	});
});

describe('bailing out', () => {
	it('keeps the playing song, drops what is not a song, played or not, and forgets the evening tags', () => {
		const plan = planEvening(base());
		const started = reconcileQueue(EMPTY_QUEUE, plan, 'r1', facts, now);
		const playing: QueueState = { ...started, items: [...started.items, guestRow('g1')], currentKey: started.items[1].key };
		const bailed = bailQueue(playing);
		expect(bailed.currentKey).toBe(playing.currentKey);
		expect(bailed.items.every((i) => i.evening === undefined && i.kind === undefined)).toBe(true);
		expect(bailed.items.map((i) => i.key)).toEqual(playing.items.filter((i) => (i.kind ?? 'song') === 'song').map((i) => i.key));
		expect(started.items[0].kind).not.toBe('song');
	});

	it('keeps each song coming up once', () => {
		const plan = planEvening(base());
		const started = reconcileQueue(EMPTY_QUEUE, plan, 'r1', facts, now);
		const again = { ...guestRow('g1'), trackId: started.items[2].trackId };
		const bailed = bailQueue({ ...started, items: [...started.items, again], currentKey: started.items[1].key });
		expect(bailed.items.filter((i) => i.trackId === again.trackId).map((i) => i.key)).toEqual([started.items[2].key]);
	});

	it('moves on to the next song when a silent row is playing', () => {
		const plan = planEvening(base());
		const started = reconcileQueue(EMPTY_QUEUE, plan, 'r1', facts, now);
		const bailed = bailQueue(started);
		expect(bailed.currentKey).toBe(started.items[1].key);
	});
});
