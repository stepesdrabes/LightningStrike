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
