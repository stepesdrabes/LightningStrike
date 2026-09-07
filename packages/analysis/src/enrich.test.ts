import { describe, expect, it } from 'vitest';
import { CONTEXT_VERSION, type TrackAnalysis, type TrackContext } from '@mv/core';
import { cleanTitle, namesEqual, namesMatch, parseLrc, parseTitle } from './enrich.ts';
import { mapGenres } from './genreMap.ts';
import { correctGenreFamily, publishedLevel } from './ingest.ts';

describe('cleanTitle', () => {
	it('strips upload noise and keeps the remix identity', () => {
		expect(cleanTitle('CHRYSTAL - THE DAYS (NOTION REMIX)')).toBe('CHRYSTAL - THE DAYS (NOTION REMIX)');
		expect(cleanTitle('Artist - Song (Official Video)')).toBe('Artist - Song');
		expect(cleanTitle('Artist - Song [Official Music Video] | Label')).toBe('Artist - Song');
		expect(cleanTitle('Charlotte de Witte - Doppler (Original Mix) [KNTXT010]')).toBe(
			'Charlotte de Witte - Doppler (Original Mix)'
		);
	});
});

describe('parseTitle', () => {
	it('splits artist from title on a dash', () => {
		expect(parseTitle('AC/DC - Thunderstruck (Official Video)', 'acdcVEVO')).toEqual({
			artist: 'AC/DC',
			title: 'Thunderstruck'
		});
	});

	it('takes the artist from a Topic channel', () => {
		expect(parseTitle('Opus', 'Eric Prydz - Topic', 'Eric Prydz - Topic')).toEqual({
			artist: 'Eric Prydz',
			title: 'Opus'
		});
	});

	it('falls back to the uploader when there is no dash', () => {
		expect(parseTitle('Animals', 'MartinGarrix')).toEqual({ artist: 'MartinGarrix', title: 'Animals' });
	});
});

describe('name matching', () => {
	it('is blind to case, diacritics and punctuation', () => {
		expect(namesMatch('Viktor Sheen', 'viktor sheen')).toBe(true);
		expect(namesMatch('Fenomén', 'Fenomen')).toBe(true);
		expect(namesMatch('Skrillex, Fred again.. & Flowdan', 'Skrillex')).toBe(true);
	});

	it('equality refuses mere containment', () => {
		expect(namesEqual('THE DAYS (NOTION REMIX)', 'NOTION')).toBe(false);
		expect(namesEqual('Linkin Park', 'Linkin Park')).toBe(true);
	});
});

describe('parseLrc', () => {
	it('reads line timestamps and drops empty lines', () => {
		const lines = parseLrc('[00:12.34] first words\n[01:02.50]\n[01:10.00] more words');
		expect(lines).toEqual([
			{ t: 12.34, text: 'first words' },
			{ t: 70, text: 'more words' }
		]);
	});

	it('expands repeated timestamps on one line', () => {
		const lines = parseLrc('[00:10.00][00:20.00] chorus line');
		expect(lines.map((l) => l.t)).toEqual([10, 20]);
	});
});

describe('mapGenres', () => {
	it('maps store categories onto lighting families', () => {
		expect(mapGenres(['Hip-Hop/Rap']).family).toBe('hiphop');
		expect(mapGenres(['R&B/Soul']).family).toBe('rnb');
		expect(mapGenres(['Techno']).family).toBe('techno');
		expect(mapGenres(['Drum & Bass']).family).toBe('bass');
		expect(mapGenres(['Singer/Songwriter']).family).toBe('ballad');
	});

	it('lets a specific style outvote a coarse category', () => {
		expect(mapGenres(['Dance', 'drum and bass']).family).toBe('bass');
	});

	it('answers null when nothing matches', () => {
		expect(mapGenres(['Spoken Word']).family).toBeNull();
	});

	it('strikes the Folk, World, & Country parent but keeps every informative one', () => {
		// The judged failure: effnet heard Get Lucky as African/Soukous and the PARENT
		// voted the funk record into the ballad drawer (flash budget zero, half motion).
		const gotLucky = mapGenres([
			'Pop',
			'Folk, World, & Country African',
			'Folk, World, & Country Soukous',
			'Reggae Reggae-Pop'
		]);
		expect(gotLucky.family).not.toBe('ballad');
		// "Hip Hop Trap" must keep its parent: stripped to "Trap" it votes bass.
		expect(mapGenres(['Hip Hop Trap', 'Hip Hop Cloud Rap', 'Hip Hop Gangsta']).family).toBe(
			'hiphop'
		);
		// A genuine folk tag without the Discogs parent still reads ballad.
		expect(mapGenres(['Folk']).family).toBe('ballad');
	});

	it('can be asked for the best family that is not on a list', () => {
		const labels = ['Electronic Tropical House', 'Electronic House', 'Pop Ballad'];
		expect(mapGenres(labels).family).toBe('house');
		expect(mapGenres(labels, undefined, ['house', 'techno', 'edm', 'trance', 'bass']).family).toBe(
			'ballad'
		);
		// The struck family keeps its share of the ballot, so the runner-up's confidence
		// reports how weak a verdict it is.
		expect(mapGenres(labels, undefined, ['house']).confidence).toBeLessThan(
			mapGenres(labels).confidence
		);
	});
});

describe('correctGenreFamily', () => {
	/** Someone You Loved's shape: the classifier's labels over a track with no kick at all. */
	const capaldi = {
		version: CONTEXT_VERSION,
		genres: ['Alternative'],
		audioGenres: ['Electronic---Tropical House', 'Electronic---House', 'Pop---Ballad'],
		genreFamily: 'house',
		genreConfidence: 0.44,
		sources: ['ytmeta', 'deezer', 'effnet'],
		instrumental: false,
		lyrics: null
	} as unknown as TrackContext;

	const analysisWith = (kicksPerBar: number): TrackAnalysis =>
		({
			tempo: { beatsPerBar: 4 },
			bars: Array.from({ length: 64 }, (_, b) => ({ kicks: kicksPerBar, energy: 50 + (b % 8) }))
		}) as unknown as TrackAnalysis;

	it('downgrades a house verdict the record never kicks for', () => {
		const fixed = correctGenreFamily(capaldi, analysisWith(0));
		expect(fixed?.genreFamily).toBe('ballad');
	});

	it('leaves a house verdict the kick corroborates alone', () => {
		// Four to the floor: one kick per beat over the loud bars, well over the floor.
		expect(correctGenreFamily(capaldi, analysisWith(4))).toBeNull();
	});

	it('never touches a family that makes no claim about drums', () => {
		const ambient = { ...capaldi, genreFamily: 'ambient' } as TrackContext;
		expect(correctGenreFamily(ambient, analysisWith(0))).toBeNull();
		const ballad = { ...capaldi, genreFamily: 'ballad' } as TrackContext;
		expect(correctGenreFamily(ballad, analysisWith(0))).toBeNull();
	});

	it('keeps the verdict when the labels have nothing else to offer', () => {
		const onlyHouse = { ...capaldi, genres: [], audioGenres: ['Electronic---House'] } as TrackContext;
		expect(correctGenreFamily(onlyHouse, analysisWith(0))).toBeNull();
	});
});

describe('publishedLevel', () => {
	const beatsAt = (bpm: number) => Array.from({ length: 64 }, (_, i) => (i * 60) / bpm);

	it('doubles a halved reading toward the published figure', () => {
		expect(publishedLevel(beatsAt(87), 174)).toBe(2);
		// Metal is listed at its double-time drums; the model's felt tempo stands.
		expect(publishedLevel(beatsAt(92), 184.6, 'metal')).toBeNull();
		expect(publishedLevel(beatsAt(186), 93, 'metal')).toBe(0.5);
	});

	it('leaves an agreeing grid alone', () => {
		expect(publishedLevel(beatsAt(128), 128.8)).toBeNull();
	});

	it('refuses a ratio no metrical error produces', () => {
		expect(publishedLevel(beatsAt(120), 137)).toBeNull();
	});

	it('never corrects the half-time families', () => {
		expect(publishedLevel(beatsAt(77), 154, 'hiphop')).toBeNull();
		expect(publishedLevel(beatsAt(87), 174, 'bass')).toBe(2);
	});

	it('never doubles a ballad', () => {
		expect(publishedLevel(beatsAt(68), 136, 'ballad')).toBeNull();
		expect(publishedLevel(beatsAt(136), 68, 'ballad')).toBe(0.5);
	});
});
