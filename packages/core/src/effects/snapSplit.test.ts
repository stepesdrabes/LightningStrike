import { describe, expect, it } from 'vitest';
import { makePalette } from '../color/palette.ts';
import { createShowFrame } from '../contracts/frame.ts';
import { DEFAULT_ROOM, buildGeometry } from '../geometry.ts';
import { fixtureAnalysis, fixtureShow } from '../ambient/fixture.ts';
import { EffectRegistry } from './index.ts';
import { Mixer } from '../mixer.ts';
import { ShowPlayer } from '../player.ts';
import { snapSplit } from './snapSplit.ts';
import { runGate } from './gate.ts';

const g = buildGeometry(DEFAULT_ROOM);
const corner = g.strips.find((s) => s.inPerimeter)!.offset * 3;

function single(fps: number, snare = false) {
	const effect = snapSplit.create(g);
	const out = new Float32Array(g.count * 3);
	const f = createShowFrame();
	f.dt = 1 / fps;
	f.beatPeriod = 0.35;
	const ctx = { g, f, palette: makePalette({ base: 320, accent: 170, third: 245 }), motion: 1.21, hueShift: 0,
		p: Object.fromEntries(snapSplit.params.map((p) => [p.key, p.key === 'hold' ? 0.6 : p.default])) };
	const peak = (at: number) => Math.max(out[at], out[at + 1], out[at + 2]);
	effect.render(out, ctx);
	const rows: { t: number; corner: number; beam: number }[] = [];
	const beam = g.strips.find((s) => !s.inPerimeter)!;
	for (let k = 0; k <= fps / 2; k++) {
		f.kick = !snare && k === 0;
		f.snare = snare && k === 0;
		f.kickEnv = snare ? 0 : 1;
		f.snareEnv = snare ? 1 : 0;
		effect.render(out, ctx);
		rows.push({ t: k / fps, corner: peak(corner), beam: peak((beam.offset + Math.floor(beam.count / 2)) * 3) });
	}
	return rows;
}

describe('Snap Split timing', () => {
	it.each([
		{ fps: 30, releaseAt: 1 / 30 },
		{ fps: 60, releaseAt: 3 / 60 },
		{ fps: 120, releaseAt: 7 / 120 }
	])('retains the short corner hold and immediate attack at $fps Hz', ({ fps, releaseAt }) => {
		const rows = single(fps);
		const peak = rows[0].corner;
		expect(peak).toBeGreaterThan(0.5);
		for (const row of rows.filter((r) => r.t < releaseAt)) expect(row.corner).toBeCloseTo(peak, 6);
		expect(rows.find((r) => r.corner < peak)!.t).toBe(releaseAt);
		expect(rows.find((r) => r.t >= 0.1)!.corner).toBeLessThan(peak * 0.7);
	});

	it('keeps the snare beam easing from its first frame', () => {
		for (const fps of [30, 60, 120]) {
			const rows = single(fps, true);
			expect(rows[0].beam).toBeGreaterThan(0.2);
			expect(rows[1].beam).toBeLessThan(rows[0].beam);
			expect(rows.find(r => r.t >= 0.2)!.beam).toBeLessThan(rows[0].beam * 0.4);
		}
	});

	it.each([30, 60, 120])('adds no delay after player onset delivery at 171 BPM / %i Hz', (fps) => {
		const analysis = fixtureAnalysis(171.429);
		analysis.onsets.kick = { times: [1, 1.175, 1.525], levels: [1, 1, 1] };
		analysis.onsets.snare = { times: [], levels: [] };
		analysis.onsets.hat = { times: [], levels: [] };
		const show = fixtureShow(analysis);
		show.cues = [{ bar: 0, section: 'chorus', intensity: 0.92, motion: 1.21, fadeBeats: 0,
			layers: { rhythm: { effect: 'snapSplit', params: { hold: 0.6 } } }, note: 'timing probe' }];
		show.hits = [];
		const mixer = new Mixer(g);
		const player = new ShowPlayer(mixer, new EffectRegistry([snapSplit]));
		player.load(analysis, show);
		let previous = 0;
		let hits = 0;
		for (let k = 0; k < fps * 2; k++) {
			const t = k / fps;
			const f = player.update(t, 1 / fps);
			mixer.render(f);
			const value = Math.max(...mixer.layers.rhythm.buf.subarray(corner, corner + 3));
			if (f.kick) {
				expect(t).toBeLessThanOrEqual(analysis.onsets.kick.times[hits]);
				expect(t).toBeGreaterThanOrEqual(analysis.onsets.kick.times[hits] - 0.041);
				expect(value - previous).toBeGreaterThan(0.3);
				hits++;
			}
			previous = value;
		}
		expect(hits).toBe(3);
	});

	it('passes the deterministic bounded-output gate', () => {
		expect(runGate(snapSplit, g).failures).toEqual([]);
	});
});
