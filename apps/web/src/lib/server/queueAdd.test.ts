import { describe, expect, it } from 'vitest';
import { fromGuest } from './queueAdd.ts';

const ID = 'dQw4w9WgXcQ';

describe('fromGuest', () => {
	it('builds the source from the track id, whatever source the phone sent', () => {
		const item = fromGuest({ source: '/Users/host/Music/private.m4a', trackId: ID }, 'Anna');
		expect(item?.source).toBe(`https://music.youtube.com/watch?v=${ID}`);
		expect(item?.trackId).toBe(ID);
		expect(item?.addedBy).toBe('Anna');
	});

	it('reads the id out of a YouTube link when none is given', () => {
		const item = fromGuest({ source: `https://www.youtube.com/watch?v=${ID}&t=42` }, 'Anna');
		expect(item?.trackId).toBe(ID);
	});

	it('refuses anything that is not a YouTube track', () => {
		for (const source of ['/etc/hosts', 'file:///etc/hosts', 'https://example.com/song.mp3', '']) {
			expect(fromGuest({ source }, 'Anna'), source).toBeNull();
		}
		expect(fromGuest({ source: '', trackId: '../../etc' }, 'Anna')).toBeNull();
	});

	it("keeps YouTube's own artwork and replaces any other address", () => {
		const art = 'https://lh3.googleusercontent.com/abc=w544-h544';
		expect(fromGuest({ source: '', trackId: ID, thumbnail: art }, 'Anna')?.thumbnail).toBe(art);
		const fallback = `https://i.ytimg.com/vi/${ID}/hqdefault.jpg`;
		for (const thumbnail of [
			'http://lh3.googleusercontent.com/abc',
			'https://googleusercontent.com.evil.example/x.png',
			'http://192.168.0.1/admin'
		]) {
			expect(fromGuest({ source: '', trackId: ID, thumbnail }, 'Anna')?.thumbnail, thumbnail).toBe(fallback);
		}
	});

	it('bounds what a phone can write into a row', () => {
		const item = fromGuest(
			{ source: '', trackId: ID, title: 'x'.repeat(500), uploader: '  ', duration: -3 },
			'Anna'
		);
		expect(item?.title).toHaveLength(200);
		expect(item?.uploader).toBeUndefined();
		expect(item?.duration).toBeUndefined();
	});
});
