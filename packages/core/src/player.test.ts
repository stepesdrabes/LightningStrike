import { describe, expect, it } from 'vitest';
import { DEFAULT_ROOM, buildGeometry } from './geometry.ts';
import { EffectRegistry } from './effects/index.ts';
import { Mixer } from './mixer.ts';
import { ShowPlayer } from './player.ts';
import { RoomDirector } from './director.ts';
import { blockChase } from './effects/blockChase.ts';
import { moshSlam } from './effects/moshSlam.ts';
import { doubleKickGatling } from './effects/doubleKickGatling.ts';
import { fixtureAnalysis, fixtureShow } from './ambient/fixture.ts';
import { encodeBase64 } from './base64.ts';

const g = buildGeometry(DEFAULT_ROOM);

describe('seeking within a cue', () => {
	it.each([blockChase, moshSlam, doubleKickGatling])('clears $id holds on a backward output-clock jump', (def) => {
		const analysis = fixtureAnalysis();
		analysis.onsets.kick = { times: [3.5], levels: [1] };
		analysis.onsets.snare = { times: [], levels: [] };
		analysis.onsets.hat = { times: [], levels: [] };
		const show = fixtureShow(analysis);
		show.cues = [{
			bar: 0, section: 'groove', note: 'same cue before and after seek',
			layers: { [def.role]: { effect: def.id, opacity: 0.6, params: { intensity: 0.7 } } }
		}];
		const director = new RoomDirector(g);
		const fresh = new RoomDirector(g);
		director.load(analysis, show);
		fresh.load(analysis, show);
		const state = { playing: true, hasShow: true, lounge: false, rest: true };
		for (let k = 0; k <= 215; k++) director.update(k / 60, 1 / 60, state);
		const layer = director.showMix.layers[def.role];
		const installed = layer.effect;
		const palette = director.showMix.palette;

		// Hardware sync changes time without calling the browser's explicit player.reset().
		for (let k = 6; k <= 66; k++) {
			const frame = director.update(k / 60, 1 / 60, state);
			fresh.update(k / 60, 1 / 60, state);
			expect(frame.kick).toBe(false);
			const expected = fresh.showMix.layers[def.role].buf;
			const maxDelta = layer.buf.reduce((max, value, i) => Math.max(max, Math.abs(value - expected[i])), 0);
			expect(maxDelta).toBe(0);
		}
		expect(layer.effect).toBe(installed);
		expect(layer.opacity).toBe(0.6);
		expect(layer.params.intensity).toBe(0.7);
		expect(director.showMix.palette).toBe(palette);
	});

	it('does not reassert future drum edges after an explicit reset', () => {
		const analysis = fixtureAnalysis();
		for (const voice of ['kick', 'snare', 'hat'] as const) {
			analysis.onsets[voice] = { times: [3.5], levels: [1] };
		}
		const player = new ShowPlayer(new Mixer(g), new EffectRegistry());
		player.load(analysis, fixtureShow(analysis));
		expect(player.update(3.48, 1 / 60).kick).toBe(true);
		player.reset();
		const frame = player.update(0.1, 1 / 60);
		expect([frame.kick, frame.snare, frame.hat]).toEqual([false, false, false]);
	});
});

describe('drum strength', () => {
	it('preserves soft onsets and chooses the strongest hit crossed in one frame', () => {
		const analysis = fixtureAnalysis();
		analysis.onsets.snare = { times: [0.1, 0.6, 0.61], levels: [0.12, 0.9, 0.2] };
		const player = new ShowPlayer(new Mixer(g), new EffectRegistry());
		player.load(analysis, fixtureShow(analysis));
		player.update(0, 1 / 60);
		const soft = player.update(0.07, 1 / 60);
		expect(soft.snare).toBe(true);
		expect(soft.snareEnv).toBeCloseTo(0.12);
		for (let t = 0.1; t < 0.54; t += 1 / 60) player.update(t, 1 / 60);
		const accent = player.update(0.58, 1 / 60);
		expect(accent.snare).toBe(true);
		expect(accent.snareEnv).toBeCloseTo(0.9);
	});
});

describe('hits across cue boundaries', () => {
	/**
	 * A cue installed on a boundary must receive the hit already consumed by the anticipation
	 * lead.
	 */
	it('re-asserts a kick consumed just before the switch to the incoming effect', () => {
		const analysis = fixtureAnalysis(120);
		const show = fixtureShow(analysis);
		expect(show.cues.length).toBeGreaterThan(1);

		// One kick, exactly on the second cue's downbeat.
		const boundaryBar = show.cues[1].bar;
		const boundaryTime = analysis.tempo.barTimes[boundaryBar];
		analysis.onsets.kick = { times: [boundaryTime], levels: [1] };
		analysis.onsets.snare = { times: [], levels: [] };
		analysis.onsets.hat = { times: [], levels: [] };

		const player = new ShowPlayer(new Mixer(g), new EffectRegistry());
		player.load(analysis, show);

		const dt = 1 / 60;
		let kickOnOrAfterBoundary = false;
		// Offset so no frame lands exactly on the boundary: the lead consumes the kick one
		// to two frames early, which is the precise shape of the bug.
		for (let t = boundaryTime - 0.5 + 0.003; t < boundaryTime + 0.1; t += dt) {
			const f = player.update(t, dt);
			if (t >= boundaryTime && f.kick) kickOnOrAfterBoundary = true;
		}
		expect(kickOnOrAfterBoundary).toBe(true);
	});
});

describe('momentary level', () => {
	it('interpolates the level track between frame centres and reads zero without one', () => {
		const analysis = fixtureAnalysis();
		const player = new ShowPlayer(new Mixer(g), new EffectRegistry());
		player.load(analysis, fixtureShow(analysis));
		expect(player.update(1, 1 / 60).level).toBe(0);

		const bytes = new Uint8Array(400);
		bytes.fill(51, 100, 200);
		bytes.fill(255, 200, 300);
		analysis.level = { fps: 100, data: encodeBase64(bytes) };
		player.load(analysis, fixtureShow(analysis));
		expect(player.update(0.5, 1 / 60).level).toBe(0);
		expect(player.update(1.505, 1 / 60).level).toBeCloseTo(0.2, 5);
		expect(player.update(2.505, 1 / 60).level).toBe(1);
		// Sampled 40 ms ahead, with the drum lead, so 1.96 s reads the midpoint of frames 199 and 200.
		expect(player.update(1.96, 1 / 60).level).toBeCloseTo(0.6, 5);
	});
});

describe('intro articulation', () => {
	const clicks = () => {
		const bytes = new Uint8Array(1200);
		for (let f = 0; f < bytes.length; f++) bytes[f] = f % 50 < 4 ? 190 : 0;
		return bytes;
	};

	it('follows the momentary level inside intro cues and nowhere else', () => {
		const analysis = fixtureAnalysis();
		analysis.level = { fps: 100, data: encodeBase64(clicks()) };
		const show = fixtureShow(analysis);
		show.cues = [
			{ bar: 0, section: 'intro', note: '', layers: { bed: { effect: 'wash' } }, intensity: 0.6, fadeBeats: 0 },
			{ bar: 4, section: 'groove', note: '', layers: { bed: { effect: 'wash' } }, intensity: 0.6, fadeBeats: 0 }
		];
		const director = new RoomDirector(g);
		director.load(analysis, show);
		const state = { playing: true, hasShow: true, lounge: false, rest: true };
		const introLevels: number[] = [];
		for (let k = 0; k < 120; k++) {
			director.update(k / 60, 1 / 60, state);
			introLevels.push(director.showMix.intensity);
		}
		expect(Math.max(...introLevels)).toBeGreaterThan(0.55);
		expect(Math.min(...introLevels)).toBeLessThan(0.3);
		const grooveStart = analysis.bars[4].t;
		for (let k = 0; k < 60; k++) {
			director.update(grooveStart + 0.5 + k / 60, 1 / 60, state);
			expect(director.showMix.intensity).toBeCloseTo(0.6, 6);
		}
	});

	it('leaves legacy analyses without a level track at cue intensity', () => {
		const analysis = fixtureAnalysis();
		const show = fixtureShow(analysis);
		show.cues = [{ bar: 0, section: 'intro', note: '', layers: { bed: { effect: 'wash' } }, intensity: 0.6, fadeBeats: 0 }];
		const director = new RoomDirector(g);
		director.load(analysis, show);
		const state = { playing: true, hasShow: true, lounge: false, rest: true };
		for (let k = 0; k < 60; k++) {
			director.update(k / 60, 1 / 60, state);
			expect(director.showMix.intensity).toBeCloseTo(0.6, 6);
		}
	});
});
