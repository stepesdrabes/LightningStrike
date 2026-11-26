import { describe, expect, it } from 'vitest';
import { DEFAULT_ROOM, roomModel } from '@mv/core';
import { composeShow } from '@mv/author-engine';
import { decodePack, encodePack, portedEffects } from '@mv/roblox';
import { fixture } from '../packages/author-engine/src/fixture.ts';
import { fixtureSong } from '../packages/roblox/src/fixture.ts';
import { compareJourney } from '../packages/roblox/src/journey.ts';
import { MVP_EFFECTS, compositionProblems } from './roblox/mvp.ts';

const meta = { trackId: 'fx', title: 'Fixture', artist: '', gridTrusted: true };
const songs = [fixture(), fixture(174, 0.02), fixtureSong(1).analysis, fixtureSong(2).analysis].map((analysis) => ({
	analysis,
	show: composeShow(analysis, { effects: portedEffects(MVP_EFFECTS) }),
	meta
}));

describe('a show composed from the MVP set', () => {
	it('names only effects in the set and lints clean', () => {
		for (const { analysis, show } of songs) {
			expect(compositionProblems(show, analysis, MVP_EFFECTS, null, meta), analysis.title).toEqual([]);
		}
	});

	it('renders like its pack', () => {
		const room = roomModel(DEFAULT_ROOM);
		const [a, b] = [songs[0], songs[2]];
		const packed = [a, b].map((song) => decodePack(encodePack(song)));
		expect(compareJourney([a, b], [packed[0], packed[1]], room.geometry, room.lamps.length).difference).toBeNull();
	});
});
