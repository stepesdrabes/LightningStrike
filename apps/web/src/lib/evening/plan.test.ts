import { describe, expect, it } from 'vitest';
import { compileEvening, type EveningScript } from '@mv/core';
import { block, evening, fill, hold, moment, pause, song, sting, type Segment } from '@mv/core/evening';
import { EMPTY_QUEUE, addItems, jumpTo, playNext, removeItem, type QueueItem, type QueueState } from '../queueModel.ts';
import { songKeysOf, type LibraryTrack } from './library.ts';
import { EMPTY_MEMORY, planEvening, renamedSegments, requestPool, type Plan, type PlanInput, type PlanMemory } from './plan.ts';
import { reconcileQueue } from './reconcile.ts';

// Saturday 2026-09-19 19:00 local, in UTC+2.
const OFFSET = -120;
const at = (hh: number, mm = 0, ss = 0) => Date.UTC(2026, 8, 19, hh - 2, mm, ss);

function track(id: string, heat: number, minutes = 3, extra: Partial<LibraryTrack> = {}): LibraryTrack {
	return {
		id,
		title: `Song ${id}`,
		artist: `Artist ${id}`,
		thumbnail: '',
		source: `https://music.youtube.com/watch?v=${id}`,
		duration: minutes * 60,
		ready: true,
		genre: 'house',
		bpm: 120,
		heat,
		loungeOnly: false,
		...extra
	};
}

const LIBRARY: LibraryTrack[] = [
	track('aaaaaaaaaa1', 1.5, 3, { title: 'Chill One', genre: 'ambient' }),
	track('aaaaaaaaaa2', 2, 4, { title: 'Chill Two', genre: 'ambient' }),
	track('aaaaaaaaaa3', 3, 3),
	track('aaaaaaaaaa4', 3.5, 3),
	track('aaaaaaaaaa5', 4, 3),
	track('aaaaaaaaaa6', 4.5, 3),
	track('aaaaaaaaaa7', 5, 3),
	track('aaaaaaaaaa8', 2.5, 3),
	track('aaaaaaaaaa9', 3, 2),
	track('bbbbbbbbbb1', 4, 3.5, { title: 'poster boy', artist: '2hollis' }),
	track('bbbbbbbbbb2', 4, 3, { title: 'Desire', artist: 'Ian Asher' }),
	track('bbbbbbbbbb3', 4, 3, { title: 'Desire', artist: 'Years & Years' })
];

function compile(segments: Segment[]): EveningScript {
	const { script, findings } = compileEvening(evening('Test', { palette: 'ember', segments }));
	const errors = findings.filter((f) => f.severity === 'error');
	if (errors.length > 0 || !script) throw new Error(errors.map((f) => f.message).join('\n'));
	return script;
}

function input(script: EveningScript, overrides: Partial<PlanInput> = {}): PlanInput {
	return {
		script,
		run: 't1',
		library: LIBRARY,
		queue: EMPTY_QUEUE,
		now: at(19),
		offsetMinutes: OFFSET,
		running: false,
		progress: null,
		hold: null,
		timedEndsAt: null,
		memory: EMPTY_MEMORY,
		...overrides
	};
}

/** The queue an evening would hold for a plan, current at `current`. */
function queueFor(rows: ReturnType<typeof planEvening>['rows'], current: number, extra: QueueItem[] = []): QueueState {
	const items: QueueItem[] = rows.map((r) => ({
		key: r.key,
		source: r.source,
		trackId: r.trackId,
		title: r.title,
		uploader: r.artist,
		thumbnail: r.thumbnail,
		duration: r.duration,
		status: 'ready',
		message: '',
		authored: 'engine',
		addedAt: 0,
		kind: r.kind,
		...(r.tag ? { evening: r.tag } : {})
	}));
	return { items: [...items, ...extra], currentKey: items[current]?.key ?? null, revision: 1 };
}

const secondsBetween = (a: number, b: number) => Math.round((b - a) / 1000);

describe('expanding an evening', () => {
	it('turns segments into rows in order, with stable keys and the right kinds', () => {
		const flash = sting('Flash', { length: 2, timeline: [{ at: 0, section: 'void', look: 'resting' }] });
		const script = compile([
			hold('Doors', { look: 'dusk', expectEnd: '20:00' }),
			moment('Ignition', { length: 12, timeline: [{ at: 0, section: 'build', look: 'resting' }] }),
			block('Opening', {
				enter: { sting: flash, hit: 'slam' },
				songs: [song('poster boy'), fill({ count: 2, where: { heat: [3, 5] } })]
			}),
			pause('Breather', { music: [song('Chill One')] })
		]);
		const plan = planEvening(input(script));
		expect(plan.findings.filter((f) => f.severity === 'error')).toEqual([]);
		expect(plan.rows.map((r) => [r.kind, r.tag?.segment, r.tag?.role])).toEqual([
			['hold', 'doors', 'hold'],
			['moment', 'ignition', 'moment'],
			['sting', 'opening', 'sting'],
			['song', 'opening', 'named'],
			['song', 'opening', 'fill'],
			['song', 'opening', 'fill'],
			['song', 'breather', 'music']
		]);
		expect(plan.rows[3].key).toBe('evt1:opening:i0:bbbbbbbbbb1');
		expect(plan.rows[3].light).toBe(0);
		expect(plan.rows[3].lighting).toMatchObject({ kind: 'song', hit: 'slam' });
		expect(plan.rows[6].lighting).toMatchObject({ kind: 'song', calm: true });
		expect(planEvening(input(script)).rows.map((r) => r.key)).toEqual(plan.rows.map((r) => r.key));
	});

	it('projects times from a hold expected to end at a clock time', () => {
		const script = compile([
			hold('Doors', { expectEnd: '20:00' }),
			moment('Ignition', { length: 12, timeline: [{ at: 0, look: 'resting' }] }),
			block('Opening', { songs: [song('poster boy'), song('Chill Two')] })
		]);
		const [doors, ignition, first, second] = planEvening(input(script)).rows;
		expect(doors.endAt).toBe(at(20));
		expect(ignition.startAt).toBe(at(20));
		expect(first.startAt).toBe(at(20, 0, 12));
		// A short load gap separates two songs that do not crossfade.
		expect(secondsBetween(first.endAt, second.startAt)).toBe(1);
	});

	it('overlaps crossfaded songs', () => {
		const script = compile([block('Mix', { between: { crossfade: 6 }, songs: [song('Chill One'), song('Chill Two')] })]);
		const [a, b] = planEvening(input(script)).rows;
		expect(secondsBetween(b.startAt, a.endAt)).toBe(6);
		expect(b.lighting).toMatchObject({ crossfade: 6 });
		// The lights cross over as long as the music does.
		expect(b.light).toBe(6);
	});

	it('finds songs by title and artist, and says when it cannot', () => {
		const script = compile([
			block('Songs', {
				songs: [
					song('Desire', { by: 'Ian Asher' }),
					song('Desire'),
					song('Nope Not Here'),
					song('Fresh', { id: 'zzzzzzzzzz1' })
				]
			})
		]);
		const plan = planEvening(input(script));
		const messages = plan.findings.map((f) => f.message);
		expect(plan.rows[0].trackId).toBe('bbbbbbbbbb2');
		expect(messages.some((m) => m.startsWith('"Desire" matches more than one song'))).toBe(true);
		expect(messages).toContain('"Nope Not Here" is not in the library. Check the title, or add its id.');
		expect(messages).toContain('"Fresh" is not in the library yet; Prepare fetches it.');
		expect(plan.rows.find((r) => r.trackId === 'zzzzzzzzzz1')).toMatchObject({ ready: false, source: 'https://music.youtube.com/watch?v=zzzzzzzzzz1' });
	});
});

describe('fill', () => {
	it('rises in heat, never repeats a song, and keeps artists apart', () => {
		const script = compile([block('Rise', { songs: [fill({ count: 5, where: { heat: [3, 5] } })] })]);
		const rows = planEvening(input(script)).rows;
		const heats = rows.map((r) => LIBRARY.find((t) => t.id === r.trackId)!.heat);
		expect(heats).toEqual([...heats].sort((a, b) => a - b));
		expect(new Set(rows.map((r) => r.trackId)).size).toBe(rows.length);
	});

	it('keeps earlier picks when it plans again, whatever order the library comes in', () => {
		const script = compile([block('Rise', { songs: [fill({ count: 3, order: 'shuffle' })] })]);
		const first = planEvening(input(script));
		const again = planEvening(input(script, { library: [...LIBRARY].reverse(), memory: first.memory }));
		expect(again.rows.map((r) => r.trackId)).toEqual(first.rows.map((r) => r.trackId));
	});

	it('knows a song by its title, and by the song alone in an upload named after its act', () => {
		expect(songKeysOf('Green Velvet, MEDUZA \u2013 La La Land')).toContain('lalaland');
		expect(songKeysOf('Kato feat. Jon \u2014 Turn The Lights Off (Jon Hamm)')).toContain('turnthelightsoff');
		// A version after the dash is not a song, and numbers are not dashes.
		expect(songKeysOf('Levels - Radio Edit')).toEqual(['levels']);
		expect(songKeysOf('Track 2 3 Four')).toEqual(['track23four']);
	});

	it('never fills with another upload of a song the evening names', () => {
		const library = [
			...LIBRARY.filter((t) => t.genre !== 'house'),
			track('ccccccccc01', 4, 3, { title: 'Turn The Lights Off (Album Version)', artist: 'KATO' }),
			track('ccccccccc02', 4, 3, { title: 'Kato feat. Jon - Turn The Lights Off (Jon Hamm)', artist: 'Danny Green' }),
			track('ccccccccc03', 4, 3, { title: 'Levels - Radio Edit', artist: 'Avicii' }),
			track('ccccccccc04', 4, 3, { title: 'Levels', artist: 'Avicii' }),
			track('ccccccccc05', 4, 3, { title: 'Something Else', artist: 'Someone' })
		];
		const script = compile([
			block('Named', { songs: [song('Turn The Lights Off', { id: 'ccccccccc01' })] }),
			block('Filled', { songs: [fill({ count: 3, where: { heat: [3.5, 4.5] } })] })
		]);
		const plan = planEvening(input(script, { library }));
		const filled = plan.rows.slice(1).map((r) => r.trackId);
		expect(filled).toHaveLength(2);
		expect(filled).toContain('ccccccccc05');
		expect(filled.filter((id) => id === 'ccccccccc03' || id === 'ccccccccc04')).toHaveLength(1);
		expect(plan.findings.some((f) => f.message.includes('needs 3 songs and only 2'))).toBe(true);
	});

	it('does not ask for an expected length on a hold that ends the evening', () => {
		const script = compile([block('Songs', { songs: [song('poster boy')] }), hold('Goodnight')]);
		expect(planEvening(input(script)).findings.filter((f) => f.severity === 'info')).toEqual([]);
	});

	it('fills a length with whole songs, nearest the target', () => {
		const script = compile([block('Twenty', { songs: [fill({ length: '20m', where: { families: ['house'] } })] })]);
		const rows = planEvening(input(script)).rows;
		const total = rows.reduce((s, r) => s + r.duration, 0);
		expect(Math.abs(total - 20 * 60)).toBeLessThanOrEqual(90);
	});

	it('reports a fill that cannot find enough songs', () => {
		const script = compile([block('Chill', { songs: [fill({ count: 4, where: { families: ['ambient'] } })] })]);
		const plan = planEvening(input(script));
		expect(plan.rows).toHaveLength(2);
		expect(plan.findings.map((f) => f.message)).toContain('A fill here needs 4 songs and only 2 match its criteria.');
	});
});

describe('pauses', () => {
	it('fades the song that crosses the end of a fixed pause', () => {
		const script = compile([pause('Breather', { length: '5m', music: [song('Chill One'), song('Chill Two')] })]);
		const rows = planEvening(input(script)).rows;
		expect(rows).toHaveLength(2);
		const faded = rows[1].lighting;
		expect(faded.kind === 'song' && faded.fade?.at).toBeCloseTo(5 * 60 - 3 * 60 - 0.5, 0);
		expect(rows[1].endAt).toBe(rows[0].startAt + 5 * 60 * 1000);
	});

	it('keeps the room calm for the rest of a pause its music does not fill', () => {
		const script = compile([pause('Breather', { length: '5m', music: [song('Chill One')] })]);
		const rows = planEvening(input(script)).rows;
		expect(rows.map((r) => [r.kind, r.tag?.role])).toEqual([
			['song', 'music'],
			['pause', 'tail']
		]);
		expect(rows[1].endAt).toBe(rows[0].startAt + 5 * 60 * 1000);
	});

	it('lasts until its clock time, and lights all of it', () => {
		const script = compile([pause('Doors', { until: '19:45' }), block('Go', { songs: [song('Chill One')] })]);
		const rows = planEvening(input(script)).rows;
		expect(rows[0].endAt).toBe(at(19, 45));
		expect(rows[1].startAt).toBe(at(19, 45));
		expect(rows[0].lighting).toMatchObject({ kind: 'silent', length: 45 * 60 });

		// Once it plays, it keeps the length it started with.
		const live = planEvening(input(script, { running: true, queue: queueFor(rows, 0), now: at(19, 5), timedEndsAt: at(19, 45) }));
		expect(live.rows[0].lighting).toMatchObject({ kind: 'silent', length: 45 * 60 });
	});

	it('keeps fading the song that crosses the end while the pause plays', () => {
		const calm = ['gggggggggg1', 'gggggggggg2', 'gggggggggg3'].map((id, i) => track(id, 2, 4, { title: `Calm ${i}`, genre: 'ambient' }));
		const library = [...LIBRARY, ...calm];
		const script = compile([
			pause('Breather', { length: '10m', music: calm.map((t) => song(t.title)) }),
			block('After', { songs: [song('poster boy')] })
		]);
		const planned = planEvening(input(script, { library }));
		const now = at(19, 4, 5);
		const progress = { key: planned.rows[1].key, position: 4.5, at: now, playing: true };
		const live = planEvening(input(script, { library, running: true, queue: queueFor(planned.rows, 1), memory: planned.memory, now, progress }));
		const last = live.rows.find((r) => r.title === 'Calm 2')!;
		const fade = last.lighting.kind === 'song' ? last.lighting.fade : undefined;
		expect(fade?.at).toBeGreaterThan(118);
		expect(fade?.at).toBeLessThan(121);
		expect(Math.abs(secondsBetween(at(19, 10), live.rows.find((r) => r.title === 'poster boy')!.startAt))).toBeLessThanOrEqual(2);
	});
});

describe('anchors', () => {
	it('waits in the room it was in when the next segment would start early', () => {
		const script = compile([
			pause('Doors', { length: '10m', look: 'hearth' }),
			block('Intro', { at: '19:30', songs: [song('poster boy')] })
		]);
		const rows = planEvening(input(script)).rows;
		expect(rows.map((r) => r.tag?.role)).toEqual(['pause', 'wait', 'named']);
		expect(rows[1].startAt).toBe(at(19, 10));
		expect(rows[2].startAt).toBe(at(19, 30));
		expect(rows[1].lighting.kind === 'silent' && rows[1].lighting.timeline[0].look?.layers.bed?.effect).toBe('hearth');
	});

	it('grows a fill with a length target before waiting', () => {
		const script = compile([
			block('Warm', { songs: [fill({ length: '6m', where: { families: ['house'] } })] }),
			block('Peak', { at: '19:20', songs: [song('poster boy')] })
		]);
		const plan = planEvening(input(script));
		const peak = plan.rows.find((r) => r.tag?.segment === 'peak')!;
		expect(Math.abs(secondsBetween(at(19, 20), peak.startAt))).toBeLessThan(90);
		expect(plan.rows.filter((r) => r.tag?.role === 'wait').length).toBeLessThanOrEqual(1);
	});

	it('shrinks a fill with a length target to arrive on time, and says when it cannot', () => {
		const script = compile([
			block('Warm', { songs: [fill({ length: '24m', where: { families: ['house'] } })] }),
			block('Peak', { at: '19:12', songs: [song('poster boy')] })
		]);
		const plan = planEvening(input(script));
		const peak = plan.rows.find((r) => r.tag?.segment === 'peak')!;
		expect(secondsBetween(at(19, 12), peak.startAt)).toBeLessThan(120);

		const tight = compile([
			block('Named', { songs: [song('Chill Two'), song('Song aaaaaaaaaa3'), song('Song aaaaaaaaaa4')] }),
			block('Peak', { at: '19:05', songs: [song('poster boy')] })
		]);
		expect(planEvening(input(tight)).findings.map((f) => f.message)).toContain('"Peak" is projected 5 min after 19:05.');
	});

	it('never trims for notBefore, only waits', () => {
		const script = compile([
			block('Named', { songs: [song('Chill Two'), song('Song aaaaaaaaaa3')] }),
			block('Finale', { notBefore: '19:02', songs: [song('poster boy')] })
		]);
		const plan = planEvening(input(script));
		expect(plan.findings.filter((f) => f.segment === 'finale')).toEqual([]);
		expect(plan.rows.map((r) => r.tag?.role)).toEqual(['named', 'named', 'named']);
	});
});

describe('a running evening', () => {
	const script = compile([
		moment('Spark', { length: 10, timeline: [{ at: 0, look: 'resting' }] }),
		block('Rise', { songs: [fill({ count: 4, where: { families: ['house'] } })] }),
		block('Requests', { songs: [fill({ count: 3, from: 'requests-then-library', where: { families: ['house'] } })] }),
		block('End', { songs: [song('poster boy')] })
	]);

	it('keeps the current row, the next and the next eight minutes as they are', () => {
		const planned = planEvening(input(script));
		const queue = queueFor(planned.rows, 1);
		const library = LIBRARY.map((t) => ({ ...t, heat: 6 - t.heat }));
		const replanned = planEvening(input(script, { running: true, queue, library, memory: { ...EMPTY_MEMORY }, now: at(19, 1) }));
		const frozen = replanned.rows.filter((r) => r.frozen).map((r) => r.key);
		expect(frozen.slice(0, 3)).toEqual(planned.rows.slice(1, 4).map((r) => r.key));
		expect(replanned.rows[0].key).toBe(planned.rows[1].key);
	});

	it('projects the current song from the last progress report', () => {
		const planned = planEvening(input(script));
		const queue = queueFor(planned.rows, 1);
		const now = at(19, 10);
		const replanned = planEvening(
			input(script, {
				running: true,
				queue,
				memory: planned.memory,
				now,
				progress: { key: planned.rows[1].key, position: 60, at: now - 5000, playing: true }
			})
		);
		expect(replanned.rows[0].startAt).toBe(now - 65_000);
	});

	it('places guest requests in a requests slot in turn, and fills the rest from the library', () => {
		const planned = planEvening(input(script));
		const request = (key: string, id: string, guest: string, addedAt: number): QueueItem => ({
			key,
			source: `https://music.youtube.com/watch?v=${id}`,
			trackId: id,
			title: `Request ${id}`,
			uploader: guest,
			thumbnail: '',
			duration: 180,
			status: 'ready',
			message: '',
			authored: 'engine',
			addedBy: guest,
			addedAt
		});
		const extra = [
			request('r1', 'ccccccccc01', 'Ada', 1),
			request('r2', 'ccccccccc02', 'Ada', 2),
			request('r3', 'ccccccccc03', 'Ben', 3),
			request('r4', 'ccccccccc04', 'Ada', 4)
		];
		const queue = queueFor(planned.rows, 0, extra);
		expect(requestPool(queue, 't1').map((r) => r.key)).toEqual(['r1', 'r3', 'r2', 'r4']);
		const replanned = planEvening(input(script, { running: true, queue, memory: planned.memory, now: at(19) }));
		const slot = replanned.rows.filter((r) => r.tag?.segment === 'requests');
		expect(slot.map((r) => r.key)).toEqual(['r1', 'r3', 'r2']);
		expect(slot.every((r) => r.tag?.role === 'request')).toBe(true);
		expect(replanned.waiting).toEqual(['r4']);
	});

	it('leaves out what the host skipped and chooses another song for its slot', () => {
		const planned = planEvening(input(script));
		const skippedRow = planned.rows[3];
		const memory: PlanMemory = { ...planned.memory, skipped: [skippedRow.key], used: [skippedRow.trackId!] };
		const queue = queueFor(planned.rows, 0);
		const replanned = planEvening(input(script, { running: true, queue, memory, now: at(19), library: LIBRARY }));
		const rise = replanned.rows.filter((r) => r.tag?.segment === 'rise');
		expect(rise.map((r) => r.key)).not.toContain(skippedRow.key);
		expect(rise.length).toBe(4);
	});

	it('keeps a song played next by hand where it is and continues the script after it', () => {
		const planned = planEvening(input(script));
		const queue = queueFor(planned.rows, 1);
		const handPicked: QueueItem = { ...queue.items[1], key: 'hand', evening: undefined, kind: undefined, trackId: 'aaaaaaaaaa1' };
		queue.items.splice(2, 0, handPicked);
		const replanned = planEvening(input(script, { running: true, queue, memory: planned.memory, now: at(19, 1) }));
		expect(replanned.rows[1].key).toBe('hand');
		expect(replanned.rows.filter((r) => r.key === planned.rows[2].key)).toHaveLength(1);
		expect(replanned.rows[0].key).toBe(planned.rows[1].key);
	});

	it('inserts a hold the host asked for after the current segment', () => {
		const planned = planEvening(input(script));
		const memory: PlanMemory = { ...planned.memory, holds: [{ after: 'rise', key: 'evt1:hold:1' }] };
		const replanned = planEvening(input(script, { memory }));
		const hold = replanned.rows.findIndex((r) => r.key === 'evt1:hold:1');
		expect(replanned.rows[hold - 1].tag?.segment).toBe('rise');
		expect(replanned.rows[hold + 1].tag?.segment).toBe('requests');
		expect(replanned.rows[hold].kind).toBe('hold');
	});
});

describe('changing course while the evening runs', () => {
	const request = (key: string, id: string, guest = 'Ada'): QueueItem => ({
		key,
		source: `https://music.youtube.com/watch?v=${id}`,
		trackId: id,
		title: `Request ${id}`,
		uploader: guest,
		thumbnail: '',
		duration: 180,
		status: 'ready',
		message: '',
		authored: 'engine',
		addedBy: guest,
		addedAt: 5
	});
	const many = Array.from({ length: 30 }, (_, i) => track(`ffffffff${String(i).padStart(3, '0')}`, 3, 3));

	it('plays a request that arrives once its block is committed to, inside that block', () => {
		const script = compile([
			block('Warm', { songs: [song('Song ffffffff000'), song('Song ffffffff001')] }),
			block('Requests', { songs: [fill({ length: '20m', from: 'requests-then-library', where: { families: ['house'] } })] }),
			block('Close', { songs: [song('Song ffffffff028'), song('Song ffffffff029')] })
		]);
		const planned = planEvening(input(script, { library: many }));
		const queue = queueFor(planned.rows, 3, [request('late', 'zzzzzzzzzz1')]);
		const live = planEvening(input(script, { library: many, running: true, queue, memory: planned.memory, now: at(19, 7) }));
		const placed = live.rows.findIndex((r) => r.key === 'late');
		expect(placed).toBeGreaterThan(0);
		expect(live.rows[placed].tag?.segment).toBe('requests');
		expect(live.rows.slice(0, placed).every((r) => r.tag?.segment !== 'close')).toBe(true);
		expect(live.waiting).toEqual([]);

		// Once the evening has moved past the block, a new request waits for a block that takes it.
		const close = live.rows.findIndex((r) => r.tag?.segment === 'close');
		const past = queueFor(live.rows, close, [request('later', 'zzzzzzzzzz2', 'Ben')]);
		const after = planEvening(input(script, { library: many, running: true, queue: past, memory: live.memory, now: at(19, 30) }));
		expect(after.rows.some((r) => r.key === 'later')).toBe(false);
		expect(after.waiting).toEqual(['later']);
	});

	it('keeps the rows a song played next by hand jumped over', () => {
		const library = [...LIBRARY, track('eeeeeeeeee1', 3, 4.5, { title: 'Long One' }), track('eeeeeeeeee2', 3, 4.5, { title: 'Long Two' })];
		const script = compile([
			block('Rise', { songs: [song('Long One'), song('Song aaaaaaaaaa3'), song('Song aaaaaaaaaa4')] }),
			block('Peak', { songs: [song('Song aaaaaaaaaa5'), song('Long Two')] }),
			block('End', { songs: [song('poster boy')] })
		]);
		const planned = planEvening(input(script, { library }));
		const moved = playNext(queueFor(planned.rows, 0), planned.rows.find((r) => r.title === 'Long Two')!.key);
		const live = planEvening(input(script, { library, running: true, queue: moved, memory: planned.memory }));
		expect(live.rows.map((r) => r.title)).toEqual(['Long One', 'Long Two', 'Song aaaaaaaaaa3', 'Song aaaaaaaaaa4', 'Song aaaaaaaaaa5', 'poster boy']);

		// And once the moved song plays, what it jumped over is still to come.
		const playing = jumpTo(reconcileQueue(moved, live, 't1', () => null, 0), moved.items[1].key);
		const next = planEvening(input(script, { library, running: true, queue: playing, memory: live.memory, now: at(19, 5) }));
		expect(next.rows.map((r) => r.title)).toEqual(['Long Two', 'Song aaaaaaaaaa3', 'Song aaaaaaaaaa4', 'Song aaaaaaaaaa5', 'poster boy']);
	});

	it('does not bring back a segment the host skipped past with new picks', () => {
		const script = compile([
			block('Rise', { songs: [fill({ count: 4, where: { families: ['house'] } })] }),
			block('Peak', { songs: [song('poster boy')] })
		]);
		const planned = planEvening(input(script));
		const queue = queueFor(planned.rows, 0);
		const passed = queue.items.slice(1, 4);
		const memory: PlanMemory = { ...planned.memory, skipped: passed.map((i) => i.key), used: passed.map((i) => i.trackId!) };
		const live = planEvening(input(script, { running: true, queue: jumpTo(queue, queue.items[4].key), memory, now: at(19, 3) }));
		expect(live.rows.map((r) => r.title)).toEqual(['poster boy']);
	});

	it('keeps a removed moment removed', () => {
		const script = compile([
			block('Rise', { songs: [song('Chill One'), song('Chill Two')] }),
			moment('Strike', { length: 20, timeline: [{ at: 0, look: 'resting' }] }),
			block('Peak', { songs: [song('Song aaaaaaaaaa5')] })
		]);
		const planned = planEvening(input(script));
		const strike = planned.rows.find((r) => r.kind === 'moment')!;
		const queue = removeItem(queueFor(planned.rows, 0), strike.key);
		const live = planEvening(input(script, { running: true, queue, memory: { ...planned.memory, skipped: [strike.key] } }));
		expect(live.rows.map((r) => r.kind)).toEqual(['song', 'song', 'song']);
	});

	it('plays each song once when an edit renames the block playing or reorders its songs', () => {
		const songs = ['Song aaaaaaaaaa3', 'Song aaaaaaaaaa4', 'Song aaaaaaaaaa5', 'Song aaaaaaaaaa6'];
		const planned = planEvening(input(compile([block('Rise', { songs: songs.map((s) => song(s)) })])));
		const queue = queueFor(planned.rows, 1);
		const renamed = planEvening(input(compile([block('Rise Up', { songs: songs.map((s) => song(s)) })]), { running: true, queue, memory: planned.memory }));
		expect(renamed.rows.map((r) => r.title)).toEqual(songs.slice(1));
		expect(renamed.rows.every((r) => r.tag?.segment === 'rise-up')).toBe(true);
		const order = [songs[0], songs[3], songs[1], songs[2]];
		const reordered = planEvening(input(compile([block('Rise', { songs: order.map((s) => song(s)) })]), { running: true, queue, memory: planned.memory }));
		expect(reordered.rows.map((r) => r.trackId).sort()).toEqual(planned.rows.slice(1).map((r) => r.trackId).sort());
	});

	it('plays a song once when the host plays one the evening has coming up, and fills its place', () => {
		const script = compile([
			block('Rise', { songs: [song('Chill One'), fill({ count: 2, where: { families: ['house'] } })] }),
			block('Peak', { songs: [song('poster boy')] })
		]);
		const planned = planEvening(input(script));
		const pick = planned.rows[1];
		const queue = queueFor(planned.rows, 0);
		queue.items.splice(1, 0, { ...queue.items[1], key: 'hand', evening: undefined, kind: undefined });
		queue.currentKey = 'hand';
		const live = planEvening(input(script, { running: true, queue, memory: planned.memory, now: at(19, 3) }));
		expect(live.rows.filter((r) => r.trackId === pick.trackId).map((r) => r.key)).toEqual(['hand']);
		// Another song takes the pick's place in its block, before the next block starts.
		expect(live.rows.map((r) => r.tag?.segment ?? null)).toEqual([null, 'rise', 'rise', 'peak']);

		// A request for a song already coming up waits rather than taking its place.
		const again: QueueItem = { ...queue.items[1], key: 'again', addedBy: 'Ada', trackId: planned.rows[2].trackId };
		const requested = planEvening(input(script, { running: true, queue: queueFor(planned.rows, 0, [again]), memory: planned.memory }));
		expect(requested.rows.filter((r) => r.trackId === again.trackId).map((r) => r.key)).toEqual([planned.rows[2].key]);
		expect(requested.waiting).toEqual(['again']);
	});

	it('leaves a song the host plays next out of the evening, which carries on after it', () => {
		const script = compile([
			moment('Spark', { length: 10, timeline: [{ at: 0, look: 'resting' }] }),
			block('Rise', { songs: [song('Chill One'), song('Chill Two'), song('Song aaaaaaaaaa3')] })
		]);
		const planned = planEvening(input(script));
		const added = addItems(queueFor(planned.rows, 1), [{ source: 'x', trackId: 'zzzzzzzzzz9', title: 'Hand', duration: 180, authored: 'engine' }], () => 'hand', 1);
		const queue = jumpTo(playNext(added, 'hand'), 'hand');
		const live = planEvening(input(script, { running: true, queue, memory: planned.memory, now: at(19, 1) }));
		expect(live.rows[0]).toMatchObject({ key: 'hand', tag: null });
		expect(live.rows.map((r) => r.title)).toEqual(['Hand', 'Chill Two', 'Song aaaaaaaaaa3']);
		const reconciled = reconcileQueue(queue, live, 't1', () => null, 0);
		expect(reconciled.items.find((i) => i.key === 'hand')!.evening).toBeUndefined();
	});
});

describe('the evening keeps its shape while it runs', () => {
	const request = (key: string, id: string, guest = 'Ada'): QueueItem => ({
		key,
		source: `https://music.youtube.com/watch?v=${id}`,
		trackId: id,
		title: `Request ${id}`,
		uploader: guest,
		thumbnail: '',
		duration: 180,
		status: 'ready',
		message: '',
		authored: 'engine',
		addedBy: guest,
		addedAt: 5
	});
	const many = Array.from({ length: 40 }, (_, i) => track(`ffffffff${String(i).padStart(3, '0')}`, 3, 3));

	/** Play the evening row by row, planning and laying each plan over the queue as the store does. */
	function playThrough(script: EveningScript, library: LibraryTrack[], extra: QueueItem[]) {
		const first = planEvening(input(script, { library }));
		let queue = queueFor(first.rows, 0, extra);
		let memory = first.memory;
		let now = at(19);
		const played: QueueItem[] = [];
		for (let guard = 0; guard < 80; guard++) {
			const plan: Plan = planEvening(input(script, { library, running: true, queue, memory, now }));
			memory = plan.memory;
			queue = reconcileQueue(queue, plan, 't1', () => null, 0);
			const at = queue.items.findIndex((i) => i.key === queue.currentKey);
			played.push(queue.items[at]);
			now += queue.items[at].duration * 1000;
			if (at + 1 >= queue.items.length) break;
			queue = jumpTo(queue, queue.items[at + 1].key);
			memory = { ...memory, used: [...memory.used, ...(played[played.length - 1].trackId ? [played[played.length - 1].trackId!] : [])] };
		}
		return played;
	}

	it('keeps a requests fill to its length once its requests start playing', () => {
		const warm = ['Song ffffffff000', 'Song ffffffff001', 'Song ffffffff002'];
		const script = compile([
			block('Warm', { songs: warm.map((s) => song(s)) }),
			block('Open Sky', { songs: [fill({ length: '15m', from: 'requests-then-library', where: { families: ['house'] } })] }),
			block('Close', { songs: [song('Song ffffffff039')] })
		]);
		const requests = Array.from({ length: 6 }, (_, i) => request(`r${i}`, `zzzzzzzzz0${i}`, `guest${i}`));
		const openSky = playThrough(script, many, requests).filter((r) => r.evening?.segment === 'open-sky');
		expect(openSky.reduce((sum, r) => sum + r.duration, 0)).toBeLessThanOrEqual(15 * 60 + 60);
		expect(openSky.filter((r) => r.addedBy).length).toBe(5);
	});

	it('keeps a requests fill to its count, and a new request never adds to what it committed to', () => {
		const script = compile([
			block('Warm', { songs: ['Song ffffffff000', 'Song ffffffff001', 'Song ffffffff002'].map((s) => song(s)) }),
			block('Requests', { songs: [fill({ count: 3, from: 'requests-then-library', where: { families: ['house'] } })] }),
			block('Close', { songs: [song('Song ffffffff039')] })
		]);
		const played = playThrough(script, many, [request('r1', 'zzzzzzzzz01'), request('r2', 'zzzzzzzzz02', 'Ben')]);
		expect(played.filter((r) => r.evening?.segment === 'requests').map((r) => r.key).slice(0, 2)).toEqual(['r1', 'r2']);
		expect(played.filter((r) => r.evening?.segment === 'requests')).toHaveLength(3);

		// Its songs all committed to, a new request waits rather than lengthening the block.
		const planned = planEvening(input(script, { library: many }));
		const first = planned.rows.findIndex((r) => r.tag?.segment === 'requests');
		const live = planEvening(input(script, { library: many, running: true, queue: queueFor(planned.rows, first, [request('late', 'zzzzzzzzz03')]), memory: planned.memory }));
		expect(live.rows.filter((r) => r.tag?.segment === 'requests')).toHaveLength(3);
		expect(live.waiting).toEqual(['late']);
	});

	it('leaves a song the evening names in its own block when the host adds it as a request', () => {
		const script = compile([
			block('Warm', { songs: [song('Song ffffffff000')] }),
			block('Open Sky', { songs: [fill({ length: '10m', from: 'requests-then-library', where: { families: ['house'] } })] }),
			block('Last Light', { songs: [song('Song ffffffff038'), song('Song ffffffff039')] })
		]);
		const planned = planEvening(input(script, { library: many }));
		const queue = queueFor(planned.rows, 0, [request('again', 'ffffffff039')]);
		const live = planEvening(input(script, { library: many, running: true, queue, memory: planned.memory }));
		expect(live.rows.filter((r) => r.trackId === 'ffffffff039').map((r) => r.tag?.segment)).toEqual(['last-light']);
	});

	it('does not wait again on a hold the host skipped past', () => {
		const script = compile([
			block('Rise', { songs: [song('Chill One'), song('Chill Two')] }),
			block('Peak', { songs: [song('poster boy'), song('Song aaaaaaaaaa5')] })
		]);
		const planned = planEvening(input(script));
		const memory: PlanMemory = { ...planned.memory, holds: [{ after: 'rise', key: 'evt1:hold:1' }] };
		const held = planEvening(input(script, { running: true, queue: queueFor(planned.rows, 0), memory }));
		const queue = jumpTo(reconcileQueue(queueFor(planned.rows, 0), held, 't1', () => null, 0), held.rows[3].key);
		const live = planEvening(input(script, { running: true, queue, memory }));
		expect(live.rows.map((r) => r.key)).not.toContain('evt1:hold:1');
	});

	it('keeps a host hold after a fixed-length pause, with the calm tail before it', () => {
		const calm = ['gggggggggg1', 'gggggggggg2', 'gggggggggg3'].map((id, i) => track(id, 2, 4, { title: `Calm ${i}`, genre: 'ambient' }));
		const library = [...LIBRARY, ...calm];
		const holds = [{ after: 'breather', key: 'evt1:hold:1' }];
		const overrun = compile([pause('Breather', { length: '10m', music: calm.map((t) => song(t.title)) }), block('After', { songs: [song('poster boy')] })]);
		const rows = planEvening(input(overrun, { library, memory: { ...EMPTY_MEMORY, holds } })).rows;
		expect(rows.map((r) => r.kind)).toEqual(['song', 'song', 'song', 'hold', 'song']);

		const short = compile([pause('Breather', { length: '10m', music: [song('Calm 0')] }), block('After', { songs: [song('poster boy')] })]);
		expect(planEvening(input(short, { library, memory: { ...EMPTY_MEMORY, holds } })).rows.map((r) => r.tag?.role)).toEqual(['music', 'tail', 'hold', 'named']);
	});

	it('resizes a pause tail the queue holds instead of adding another', () => {
		const before = compile([pause('Breather', { length: '6m', music: [song('Chill One')] }), block('After', { songs: [song('poster boy')] })]);
		const after = compile([pause('Breather', { length: '8m', music: [song('Chill One')] }), block('After', { songs: [song('poster boy')] })]);
		const planned = planEvening(input(before));
		const live = planEvening(input(after, { running: true, queue: queueFor(planned.rows, 0), memory: planned.memory }));
		const keys = live.rows.map((r) => r.key);
		expect(new Set(keys).size).toBe(keys.length);
		expect(live.rows.find((r) => r.tag?.role === 'tail')!.duration).toBeCloseTo(8 * 60 - 3 * 60, 0);
	});

	it('ends a committed wait on its anchor, lit like the room before it', () => {
		const script = compile([pause('Doors', { length: '5m', look: 'hearth' }), block('Intro', { at: '19:30', songs: [song('poster boy')] })]);
		const planned = planEvening(input(script));
		expect(planned.rows.map((r) => r.tag?.role)).toEqual(['pause', 'wait', 'named']);
		// Doors ran two minutes long, so the wait is shorter and Intro still starts at 19:30.
		const now = at(19, 7);
		const live = planEvening(input(script, { running: true, queue: queueFor(planned.rows, 0), memory: planned.memory, now, timedEndsAt: now }));
		const wait = live.rows.find((r) => r.tag?.role === 'wait')!;
		expect(wait.endAt).toBe(at(19, 30));
		expect(wait.lighting.kind === 'silent' && wait.lighting.timeline[0].look?.layers.bed?.effect).toBe('hearth');
		expect(live.rows.find((r) => r.kind === 'song')!.startAt).toBe(at(19, 30));
	});

	it('follows a segment an edit renames without playing its rows again', () => {
		const flash = sting('Flash', { length: 3, timeline: [{ at: 0, section: 'void', look: 'resting' }] });
		const songs = ['Song aaaaaaaaaa3', 'Song aaaaaaaaaa4', 'Song aaaaaaaaaa5'];
		const before = compile([
			block('Warm', { songs: [song('Chill One')] }),
			moment('Strike', { length: 30, timeline: [{ at: 0, look: 'resting' }] }),
			block('Rise', { enter: { sting: flash }, songs: songs.map((s) => song(s)) })
		]);
		const after = compile([
			block('Warm', { songs: [song('Chill One')] }),
			moment('Big Strike', { length: 30, timeline: [{ at: 0, look: 'resting' }] }),
			block('Rise Up', { enter: { sting: flash }, songs: songs.map((s) => song(s)) })
		]);
		const renamed = renamedSegments(before, after);
		expect(renamed).toEqual({ strike: 'big-strike', rise: 'rise-up' });
		const planned = planEvening(input(before));
		const playing = (current: number) =>
			planEvening(input(after, { running: true, queue: queueFor(planned.rows, current), memory: { ...planned.memory, renamed } }));
		expect(playing(1).rows.map((r) => r.kind)).toEqual(['moment', 'sting', 'song', 'song', 'song']);
		expect(playing(3).rows.map((r) => r.title)).toEqual(songs);
		expect(playing(3).rows.every((r) => r.tag?.segment === 'rise-up')).toBe(true);
	});

	it('keeps a removed song, wait or tail removed, even when an edit moves the song', () => {
		const songs = ['Song aaaaaaaaaa3', 'Song aaaaaaaaaa4', 'Song aaaaaaaaaa5'];
		const planned = planEvening(input(compile([block('Rise', { songs: songs.map((s) => song(s)) })])));
		const gone = planned.rows[2];
		const queue = removeItem(queueFor(planned.rows, 0), gone.key);
		const edited = compile([block('Rise', { songs: [song('Chill One'), ...songs.map((s) => song(s))] })]);
		const live = planEvening(input(edited, { running: true, queue, memory: { ...planned.memory, skipped: [gone.key] } }));
		expect(live.rows.map((r) => r.title)).not.toContain(gone.title);

		const anchored = compile([pause('Doors', { length: '5m', look: 'hearth' }), block('Intro', { at: '19:30', songs: [song('poster boy')] })]);
		const withWait = planEvening(input(anchored));
		const wait = withWait.rows.find((r) => r.tag?.role === 'wait')!;
		const again = planEvening(input(anchored, { running: true, queue: removeItem(queueFor(withWait.rows, 0), wait.key), memory: { ...withWait.memory, skipped: [wait.key] } }));
		expect(again.rows.map((r) => r.key)).not.toContain(wait.key);
	});
});

describe('holding while the evening runs', () => {
	it('lands a hold after the current segment even when the next one is already committed to', () => {
		const script = compile([
			block('Rise', { songs: [song('Chill One'), song('Chill Two')] }),
			block('Peak', { songs: [song('poster boy')] })
		]);
		const planned = planEvening(input(script));
		const queue = queueFor(planned.rows, 0);
		const memory: PlanMemory = { ...planned.memory, holds: [{ after: 'rise', key: 'evt1:hold:1' }] };
		const live = planEvening(input(script, { running: true, queue, memory }));
		expect(live.rows.map((r) => r.kind)).toEqual(['song', 'song', 'hold', 'song']);
		expect(live.rows[2].key).toBe('evt1:hold:1');
		expect(live.rows[3].title).toBe('poster boy');

		// Go on the hold, then back to the start of the segment: the hold is not waited on again.
		const released = { ...live.memory, holds: [] };
		const back = planEvening(input(script, { running: true, queue: queueFor(live.rows, 0), memory: released }));
		expect(back.rows.map((r) => r.kind)).toEqual(['song', 'song', 'song']);
	});
});

describe('the last segment', () => {
	it('keeps an open block planned about an hour ahead, however much of it has played', () => {
		const many = Array.from({ length: 60 }, (_, i) => track(`dddddddd${String(i).padStart(3, '0')}`, 3, 3));
		const script = compile([block('Afterglow', { open: true, songs: [fill({ where: { families: ['house'] } })] })]);
		const plan = planEvening(input(script, { library: many }));
		expect(plan.endsAt).toBeNull();
		expect(plan.segments[0].open).toBe(true);
		expect(plan.rows.length).toBe(20);

		// Twelve songs in, the hour ahead is still planned.
		const memory = { ...plan.memory, used: plan.rows.slice(0, 12).map((r) => r.trackId!) };
		const later = planEvening(input(script, { library: many, running: true, queue: queueFor(plan.rows, 12), memory, now: at(19, 36) }));
		expect(later.rows.length).toBe(20);
		expect(new Set(later.rows.map((r) => r.trackId)).size).toBe(20);
	});
});
