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

describe('the end of the audio', () => {
	/** A full-length level track, loud until `loudUntil`, fading out by `silentFrom`. */
	function levelled(analysis: ReturnType<typeof fixtureAnalysis>, loudUntil: number, silentFrom: number) {
		const fps = 100;
		const bytes = new Uint8Array(Math.ceil(analysis.duration * fps));
		for (let i = 0; i < bytes.length; i++) {
			const t = (i + 0.5) / fps;
			const fade = (silentFrom - t) / Math.max(1e-6, silentFrom - loudUntil);
			bytes[i] = t < loudUntil ? 200 : t < silentFrom ? Math.round(200 * fade) : 0;
		}
		analysis.level = { fps, data: encodeBase64(bytes) };
	}

	it('eases the show out where the audio really ends, onto the outro floor', () => {
		const analysis = fixtureAnalysis();
		levelled(analysis, 12, 12);
		const mixer = new Mixer(g);
		const player = new ShowPlayer(mixer, new EffectRegistry());
		player.load(analysis, fixtureShow(analysis));

		player.update(11, 1 / 60);
		expect(mixer.fade).toBe(1);
		expect(mixer.floor).toBeCloseTo(0.34, 5);
		player.update(11.75, 1 / 60);
		expect(mixer.fade).toBeGreaterThan(0.4);
		expect(mixer.fade).toBeLessThan(1);
		player.update(12, 1 / 60);
		expect(mixer.fade).toBeCloseTo(0.35, 5);
		expect(mixer.floor).toBeCloseTo(0.42, 5);
		// Trailing silence stays settled: the show does not come back after the audio ends.
		player.update(13, 1 / 60);
		expect(mixer.fade).toBeCloseTo(0.35, 5);
	});

	it('follows a fade-out down with the music, in any section', () => {
		const analysis = fixtureAnalysis();
		levelled(analysis, 20, 28);
		const show = fixtureShow(analysis);
		show.cues = [{ bar: 0, section: 'groove', note: '', layers: { bed: { effect: 'wash' } }, fadeBeats: 0 }];
		const mixer = new Mixer(g);
		const player = new ShowPlayer(mixer, new EffectRegistry());
		player.load(analysis, show);
		const before: number[] = [];
		for (let t = 0; t < 27.6; t += 1 / 60) {
			player.update(t, 1 / 60);
			if (t > 19 && t < 19.1) before.push(mixer.intensity);
		}
		expect(Math.min(...before)).toBeCloseTo(1, 3);
		expect(mixer.intensity).toBeLessThan(0.5);
		expect(mixer.fade).toBeLessThan(1);
	});

	it('lifts an outro that still has energy, and keeps it under a groove', () => {
		const analysis = fixtureAnalysis();
		const show = fixtureShow(analysis);
		show.defaults.intensity = 0.5;
		const mixer = new Mixer(g);
		const player = new ShowPlayer(mixer, new EffectRegistry());
		player.load(analysis, show);
		const outro = analysis.sections.find((s) => s.kind === 'outro')!;
		for (let t = outro.startTime - 4; t < outro.startTime + 6; t += 1 / 60) player.update(t, 1 / 60);
		expect(mixer.intensity).toBeGreaterThan(0.58);
		expect(mixer.intensity).toBeLessThan(0.66);
		expect(mixer.motion).toBeGreaterThan(1.05);
		expect(mixer.motion).toBeLessThan(1.15);

		show.defaults.intensity = 0.95;
		player.load(analysis, show);
		for (let t = outro.startTime - 4; t < outro.startTime + 6; t += 1 / 60) player.update(t, 1 / 60);
		expect(mixer.intensity).toBeCloseTo(0.95, 5);
	});
});

describe('restarting', () => {
	it('warms to the same state on every host', () => {
		const analysis = fixtureAnalysis();
		const show = fixtureShow(analysis);
		const a = new Mixer(g);
		const b = new Mixer(g);
		const one = new ShowPlayer(a, new EffectRegistry());
		const two = new ShowPlayer(b, new EffectRegistry());
		one.load(analysis, show);
		two.load(analysis, show);
		for (let t = 0; t < 20; t += 1 / 60) one.update(t, 1 / 60);
		one.warm(30);
		two.warm(30);
		a.compose(one.update(30, 1 / 60));
		b.compose(two.update(30, 1 / 60));
		expect(Array.from(a.frame)).toEqual(Array.from(b.frame));
		// Near the start there is less to pre-roll, and it must not overshoot the time asked.
		one.warm(0.1);
		expect(one.update(0.1, 1 / 60).t).toBe(0.1);
	});

	it('holds the clock for a frame on a small backward step, and rewinds on a real one', () => {
		const analysis = fixtureAnalysis();
		analysis.onsets.kick = { times: [4.7], levels: [1] };
		analysis.onsets.snare = { times: [], levels: [] };
		analysis.onsets.hat = { times: [], levels: [] };
		const player = new ShowPlayer(new Mixer(g), new EffectRegistry());
		player.load(analysis, fixtureShow(analysis));
		for (let t = 4; t <= 5; t += 1 / 60) player.update(t, 1 / 60);
		const held = player.update(4.98, 1 / 60);
		expect(held.t).toBeCloseTo(5, 5);
		expect(held.kick).toBe(false);
		player.update(4.5, 1 / 60);
		expect(player.update(4.72, 1 / 60).kick).toBe(true);
	});
});
