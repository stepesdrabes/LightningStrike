import { describe, expect, it } from 'vitest';
import {
	EMPTY_QUEUE,
	addItems,
	canGuestRemove,
	clearQueue,
	currentItem,
	jumpTo,
	moveItem,
	nextItem,
	patchItem,
	playNext,
	removeItem,
	signatureOf,
	titleKeyOf,
	step,
	videoIdOf,
	type NewItem,
	type QueueState
} from './queueModel.ts';

const keys = (i: number) => `k${i}`;

function seed(...titles: string[]): QueueState {
	const inputs: NewItem[] = titles.map((title, i) => ({
		source: `https://example.test/${i}`,
		trackId: `id${i}`,
		title
	}));
	// A stable key per row, so assertions can name them rather than index into them.
	let n = 0;
	return addItems(EMPTY_QUEUE, inputs, () => keys(n++), 1000);
}

describe('adding', () => {
	it('takes over as current only when nothing was playing', () => {
		const one = seed('a');
		expect(one.currentKey).toBe('k0');

		const two = addItems(one, [{ source: 's', title: 'b' }], () => 'later', 2000);
		expect(two.currentKey).toBe('k0');
		expect(two.items).toHaveLength(2);
	});

	it('leaves an unresolved row pending and a cached one ready', () => {
		const fresh = addItems(EMPTY_QUEUE, [{ source: 's' }], () => 'a', 1);
		expect(fresh.items[0].status).toBe('pending');

		const cached = addItems(
			EMPTY_QUEUE,
			[{ source: 's', trackId: 'abc', authored: 'engine' }],
			() => 'b',
			1
		);
		expect(cached.items[0].status).toBe('ready');
	});

	it('falls back to the source as a title, so a row is never nameless', () => {
		const state = addItems(EMPTY_QUEUE, [{ source: 'https://x.test/y' }], () => 'a', 1);
		expect(state.items[0].title).toBe('https://x.test/y');
	});

	it('ignores an empty batch rather than bumping the revision', () => {
		const state = seed('a');
		expect(addItems(state, [], keys, 1)).toBe(state);
	});
});

describe('removing', () => {
	it('hands the room to whatever moved up when the current row goes', () => {
		const state = seed('a', 'b', 'c');
		const after = removeItem(state, 'k0');
		expect(after.currentKey).toBe('k1');
		expect(after.items.map((i) => i.title)).toEqual(['b', 'c']);
	});

	it('falls back to the row before when the last one is removed', () => {
		let state = seed('a', 'b');
		state = jumpTo(state, 'k1');
		expect(removeItem(state, 'k1').currentKey).toBe('k0');
	});

	it('leaves the current row alone when another is removed', () => {
		const state = seed('a', 'b', 'c');
		expect(removeItem(state, 'k2').currentKey).toBe('k0');
	});

	it('empties out to no current row', () => {
		const state = removeItem(seed('a'), 'k0');
		expect(state.items).toHaveLength(0);
		expect(state.currentKey).toBeNull();
	});

	it('is a no-op for a key that is not there', () => {
		const state = seed('a');
		expect(removeItem(state, 'nope')).toBe(state);
	});
});

describe('ordering', () => {
	it('moves a row and clamps out-of-range targets', () => {
		const state = seed('a', 'b', 'c');
		expect(moveItem(state, 'k2', 0).items.map((i) => i.title)).toEqual(['c', 'a', 'b']);
		expect(moveItem(state, 'k0', 99).items.map((i) => i.title)).toEqual(['b', 'c', 'a']);
	});

	it('reordering never changes what is playing', () => {
		const state = seed('a', 'b', 'c');
		expect(moveItem(state, 'k0', 2).currentKey).toBe('k0');
	});

	it('play next lands the row directly after the current one', () => {
		const state = seed('a', 'b', 'c', 'd');
		expect(playNext(state, 'k3').items.map((i) => i.title)).toEqual(['a', 'd', 'b', 'c']);
	});

	it('play next on an empty current puts the row first', () => {
		const state = { ...seed('a', 'b'), currentKey: null };
		expect(playNext(state, 'k1').items.map((i) => i.title)).toEqual(['b', 'a']);
	});
});

describe('stepping', () => {
	it('advances and retreats', () => {
		const state = seed('a', 'b', 'c');
		const second = step(state, 1);
		expect(second.currentKey).toBe('k1');
		expect(step(second, -1).currentKey).toBe('k0');
	});

	it('stops at both ends rather than wrapping', () => {
		let state = seed('a', 'b');
		expect(step(state, -1)).toBe(state);
		state = jumpTo(state, 'k1');
		expect(step(state, 1)).toBe(state);
	});

	it('starts from the right end when nothing is current', () => {
		const state = { ...seed('a', 'b'), currentKey: null };
		expect(step(state, 1).currentKey).toBe('k0');
		expect(step(state, -1).currentKey).toBe('k1');
	});
});

describe('reading', () => {
	it('reports the current and the next row', () => {
		const state = seed('a', 'b', 'c');
		expect(currentItem(state)?.title).toBe('a');
		expect(nextItem(state)?.title).toBe('b');
	});

	it('has no next row at the end', () => {
		const state = jumpTo(seed('a', 'b'), 'k1');
		expect(nextItem(state)).toBeNull();
	});

	it('treats the first row as next when nothing is playing', () => {
		const state = { ...seed('a', 'b'), currentKey: null };
		expect(nextItem(state)?.title).toBe('a');
	});
});

describe('patching and clearing', () => {
	it('patches one row and bumps the revision', () => {
		const state = seed('a', 'b');
		const after = patchItem(state, 'k1', { status: 'ready', duration: 200 });
		expect(after.items[1].status).toBe('ready');
		expect(after.items[0].status).toBe('pending');
		expect(after.revision).toBe(state.revision + 1);
	});

	it('clear keeps the current row when asked', () => {
		const state = jumpTo(seed('a', 'b', 'c'), 'k1');
		const kept = clearQueue(state, true);
		expect(kept.items.map((i) => i.title)).toEqual(['b']);
		expect(kept.currentKey).toBe('k1');

		const wiped = clearQueue(state, false);
		expect(wiped.items).toHaveLength(0);
		expect(wiped.currentKey).toBeNull();
	});
});

describe('what a guest may take back', () => {
	function withGuests(): QueueState {
		let state = addItems(
			EMPTY_QUEUE,
			[
				{ source: 'a', addedBy: 'Ada' },
				{ source: 'b', addedBy: 'Ada' },
				{ source: 'c', addedBy: 'Grace' },
				{ source: 'd' }
			],
			keys,
			1
		);
		// k0 is playing, so Ada's second track is the first she could take back.
		state = jumpTo(state, 'k0');
		return state;
	}

	it('lets a guest take back their own pending row', () => {
		expect(canGuestRemove(withGuests(), 'k1', 'Ada')).toBe(true);
	});

	it("refuses somebody else's row", () => {
		expect(canGuestRemove(withGuests(), 'k2', 'Ada')).toBe(false);
	});

	it('refuses the row that is playing, because that would be a skip', () => {
		expect(canGuestRemove(withGuests(), 'k0', 'Ada')).toBe(false);
	});

	it('refuses a row nobody claimed', () => {
		expect(canGuestRemove(withGuests(), 'k3', 'Ada')).toBe(false);
	});

	it('refuses an unnamed guest and an unknown row', () => {
		expect(canGuestRemove(withGuests(), 'k1', '')).toBe(false);
		expect(canGuestRemove(withGuests(), 'nope', 'Ada')).toBe(false);
	});
});

describe('videoIdOf', () => {
	it('reads the id whatever host spelled it', () => {
		expect(videoIdOf('https://music.youtube.com/watch?v=Oo9sekHsm3I')).toBe('Oo9sekHsm3I');
		expect(videoIdOf('https://www.youtube.com/watch?v=Oo9sekHsm3I')).toBe('Oo9sekHsm3I');
		expect(videoIdOf('https://youtu.be/Oo9sekHsm3I')).toBe('Oo9sekHsm3I');
	});

	it('keeps its nerve on a local file, which is a source and not a URL', () => {
		expect(videoIdOf('/Users/someone/Music/track.flac')).toBeNull();
		expect(videoIdOf('')).toBeNull();
	});

	it('rejects anything that is not a video id', () => {
		expect(videoIdOf('https://www.youtube.com/watch?v=PLnotanid')).toBeNull();
		expect(videoIdOf('https://example.test/')).toBeNull();
	});
});

describe('signatureOf', () => {
	it('collapses the same recording listed under different ids', () => {
		expect(signatureOf('CHRYSTAL', 'The Days')).toBe(signatureOf('chrystal', 'the days!'));
	});

	it('ignores a bracketed qualifier, which is how one release is listed twice', () => {
		expect(signatureOf('Queen', 'Bohemian Rhapsody (Remastered 2011)')).toBe(
			signatureOf('Queen', 'Bohemian Rhapsody')
		);
	});

	it('ignores a featured credit appended to the title', () => {
		expect(signatureOf('MK', 'Dior feat. Chrystal')).toBe(signatureOf('MK', 'Dior'));
	});

	// The question is whether the room has heard the song, not whether it is the same master,
	// so a remix counts as already played - including one billed to the remixer as well.
	it('reads a remix as the song it is a remix of', () => {
		expect(signatureOf('CHRYSTAL', 'The Days (NOTION Remix)')).toBe(
			signatureOf('CHRYSTAL', 'The Days')
		);
		expect(signatureOf('CHRYSTAL & Mazza_l20', 'The Days (Mazza_l20 Remix)')).toBe(
			signatureOf('CHRYSTAL', 'The Days')
		);
		expect(signatureOf('Nikko x Jynxx', 'The Days')).toBe(signatureOf('Nikko', 'The Days'));
	});

	it('keeps two acts apart when they record the same title', () => {
		expect(signatureOf('Queen', 'Bohemian Rhapsody')).not.toBe(
			signatureOf('Panic! At The Disco', 'Bohemian Rhapsody')
		);
	});
});

describe('titleKeyOf', () => {
	it('reads every version of one song as that song', () => {
		expect(titleKeyOf('The Days (NOTION Remix)')).toBe(titleKeyOf('The Days'));
		expect(titleKeyOf('The Days - NOTION Remix')).toBe(titleKeyOf('The Days'));
		expect(titleKeyOf('Creep - Live at Wembley')).toBe(titleKeyOf('Creep'));
	});

	// Rips made before the catalogue path existed are titled "Artist - Title", and cutting at
	// that dash would key the whole row on the artist's name.
	it('leaves an upload title that leads with the act alone', () => {
		expect(titleKeyOf('CHRYSTAL - THE DAYS  (NOTION REMIX)')).toBe('chrystalthedays');
		expect(titleKeyOf('Daft Punk - One More Time')).toBe('daftpunkonemoretime');
	});

	it('keeps unrelated songs apart', () => {
		expect(titleKeyOf('The Days')).not.toBe(titleKeyOf('The Nights'));
	});
});
