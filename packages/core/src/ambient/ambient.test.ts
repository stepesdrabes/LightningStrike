import { describe, expect, it } from 'vitest';
import { rampHueFor } from '../color/hsv.ts';
import { makePalette } from '../color/palette.ts';
import { DEFAULT_ROOM, buildGeometry } from '../geometry.ts';
import { EffectRegistry } from '../effects/index.ts';
import { Mixer } from '../mixer.ts';
import { AmbientColour } from './colour.ts';
import { IdleClock } from './idle.ts';
import { AmbientPlayer, DEFAULT_AMBIENT } from './player.ts';
import { AMBIENT_SCENES } from './scenes.ts';

const g = buildGeometry(DEFAULT_ROOM);

function run(clock: IdleClock, seconds: number, dt = 1 / 60) {
	const beats: number[] = [];
	const bars: number[] = [];
	const phrases: number[] = [];
	for (let i = 0; i < Math.round(seconds / dt); i++) {
		const f = clock.update(dt);
		if (f.beat) beats.push(f.beatIndex);
		if (f.downbeat) bars.push(f.barIndex);
		if (f.phraseStart) phrases.push(f.t);
	}
	return { beats, bars, phrases };
}

describe('IdleClock', () => {
	it('fires each grid edge exactly once, in order', () => {
		const { beats, bars } = run(new IdleClock(), 60);
		// 40 bpm: forty beats and ten bars a minute, counting from the edge the first frame owes.
		expect(beats).toEqual(beats.map((_, i) => i));
		expect(bars).toEqual(bars.map((_, i) => i));
		expect(beats.length).toBeGreaterThanOrEqual(40);
		expect(bars.length).toBeGreaterThanOrEqual(10);
	});

	it('does not skip an edge on a long frame or double one on a short frame', () => {
		const slow = run(new IdleClock(), 60, 1 / 8);
		const fast = run(new IdleClock(), 60, 1 / 240);
		expect(slow.beats).toEqual(fast.beats);
		expect(slow.bars).toEqual(fast.bars);
	});

	it('reports no measurement, because there is nothing to measure', () => {
		const clock = new IdleClock();
		for (let i = 0; i < 600; i++) {
			const f = clock.update(1 / 60);
			expect(Array.from(f.spectrum).every((v) => v === 0)).toBe(true);
			expect(Array.from(f.bands).every((v) => v === 0)).toBe(true);
			expect(f.kick || f.snare || f.hat).toBe(false);
			expect(f.energy).toBeGreaterThan(0.15);
			expect(f.energy).toBeLessThan(0.4);
		}
	});

	it('reproduces exactly from a reset', () => {
		const a = new IdleClock();
		const b = new IdleClock();
		run(a, 30);
		a.reset();
		expect(run(a, 12)).toEqual(run(b, 12));
	});
});

describe('AmbientColour', () => {
	it('puts a picked hue through the ramp, so the room delivers the colour asked for', () => {
		const c = new AmbientColour();
		// Chartreuse: the case the ramp exists for. Fed in raw it leaves the room yellow.
		c.settings = { source: 'fixed', hue: 90, sat: 0.8, drift: 0 };
		c.snap();
		expect(c.shown.base).toBeCloseTo(rampHueFor(90) * 360, 4);
		expect(c.shown.base).not.toBeCloseTo(90, 0);
	});

	it('keeps the accent an arc away from the base', () => {
		const c = new AmbientColour();
		c.settings = { source: 'fixed', hue: 200, sat: 0.8, drift: 0 };
		c.snap();
		const arc = Math.abs(((c.shown.accent - c.shown.base + 540) % 360) - 180);
		expect(arc).toBeGreaterThan(140);
	});

	it('drifts at the rate it was given, in the degrees the interface asked in', () => {
		const c = new AmbientColour();
		c.settings = { source: 'drift', hue: 0, sat: 0.8, drift: 60 };
		c.snap();
		for (let i = 0; i < 600; i++) c.update(1 / 60);
		// Sixty degrees a minute for ten seconds is ten degrees of TEXTBOOK hue, which is what
		// the ramp has to be re-read at rather than added to.
		expect(c.shown.base).toBeCloseTo(rampHueFor(10) * 360, 0);
	});

	it('eases onto a track palette rather than cutting to it, and takes its hues as given', () => {
		const c = new AmbientColour();
		c.settings = { source: 'track', hue: 0, sat: 0.8, drift: 0 };
		c.snap();
		c.trackPalette = { base: 300, accent: 140, third: 330 };
		c.update(1 / 60);
		const first = c.shown.base;
		expect(first).not.toBeCloseTo(300, 0);
		for (let i = 0; i < 60 * 90; i++) c.update(1 / 60);
		// A show's hues are already ramp coordinates and must not be converted again.
		expect(c.shown.base).toBeCloseTo(300, 0);
		expect(c.shown.accent).toBeCloseTo(140, 0);
		expect(c.shown.third).toBeCloseTo(330, 0);
	});

	/** Track mode must preserve the whole palette, including saturation and shade. */
	it('takes a track palette exactly as the show declared it', () => {
		const c = new AmbientColour();
		c.settings = { source: 'track', hue: 28, sat: 0.4, drift: 0 };
		const declared = { base: 312, accent: 158, third: 268, sat: 0.95, shade: 0.13, white: 0.02 };
		c.trackPalette = declared;
		c.snap();
		expect(c.shown).toEqual(declared);

		// And the palette it builds is the one the show itself would have built.
		expect(Array.from(c.palette)).toEqual(Array.from(makePalette(declared)));
	});

	it('fills in only what a palette leaves out, with the same defaults makePalette uses', () => {
		const c = new AmbientColour();
		c.settings = { source: 'track', hue: 28, sat: 0.4, drift: 0 };
		c.trackPalette = { base: 200, accent: 20 };
		c.snap();
		expect(Array.from(c.palette)).toEqual(Array.from(makePalette({ base: 200, accent: 20 })));
	});

	it('holds the record it was following through the gap to the next one', () => {
		const c = new AmbientColour();
		c.settings = { source: 'track', hue: 0, sat: 0.8, drift: 0 };
		c.trackPalette = { base: 300, accent: 140 };
		c.snap();
		// Hold the current colour while the next track bundle loads.
		c.trackPalette = null;
		for (let i = 0; i < 60 * 60; i++) c.update(1 / 60);
		expect(c.shown.base).toBeCloseTo(300, 4);
	});

	it('builds a palette that is actually different when the colour is', () => {
		const c = new AmbientColour();
		c.settings = { source: 'fixed', hue: 0, sat: 0.9, drift: 0 };
		c.snap();
		const red = Float32Array.from(c.palette);
		c.settings = { ...c.settings, hue: 200 };
		c.snap();
		let moved = 0;
		for (let i = 0; i < red.length; i++) moved += Math.abs(red[i] - c.palette[i]);
		expect(moved).toBeGreaterThan(1);
	});
});

describe('AmbientPlayer', () => {
	function playerFor() {
		const mixer = new Mixer(g);
		const player = new AmbientPlayer(mixer, new EffectRegistry());
		player.settings = { ...DEFAULT_AMBIENT };
		return { mixer, player };
	}

	it('offers an empty room only the scenes that work without music', () => {
		const { player } = playerFor();
		const clock = new IdleClock();
		const seen = new Set<string>();
		for (let i = 0; i < 60 * 60 * 30; i += 1) {
			player.update(clock.update(1 / 60), false);
			seen.add(player.sceneId);
			if (i % 600 === 0) player.next();
		}
		const musical = new Set(AMBIENT_SCENES.filter((s) => s.needsMusic).map((s) => s.id));
		expect([...seen].filter((id) => musical.has(id))).toEqual([]);
		expect(seen.size).toBeGreaterThan(4);
	});

	it('never shows the same scene twice running', () => {
		const { player } = playerFor();
		const clock = new IdleClock();
		let last = player.sceneId;
		for (let i = 0; i < 400; i++) {
			player.next();
			player.update(clock.update(1 / 60), false);
			expect(player.sceneId).not.toBe(last);
			last = player.sceneId;
		}
	});

	it('holds a scene for its dwell and no longer', () => {
		const { player } = playerFor();
		player.settings = { ...DEFAULT_AMBIENT, dwell: 60 };
		const clock = new IdleClock();
		const first = player.sceneId;
		let changedAt = -1;
		for (let i = 0; i < 60 * 90; i++) {
			player.update(clock.update(1 / 60), false);
			if (player.sceneId !== first) {
				changedAt = i / 60;
				break;
			}
		}
		expect(changedAt).toBeGreaterThan(59);
		expect(changedAt).toBeLessThan(61);
	});

	it('picks the same scenes again from the same start', () => {
		const walk = () => {
			const { player } = playerFor();
			const clock = new IdleClock();
			const ids: string[] = [];
			for (let i = 0; i < 40; i++) {
				player.next();
				player.update(clock.update(1 / 60), false);
				ids.push(player.sceneId);
			}
			return ids;
		};
		expect(walk()).toEqual(walk());
	});

	/** What a scene delivers: how much of the room, how evenly, and at what level. */
	function look(sceneId: string) {
		const { mixer, player } = playerFor();
		const clock = new IdleClock();
		// Straight to the scene under test, rather than waiting for the walk to reach it.
		while (player.sceneId !== sceneId) player.next();

		let lit = 0;
		let pixels = 0;
		let concentration = 0;
		let counted = 0;
		let meanSum = 0;
		const n = mixer.bytes.length / 3;
		const levels: number[] = [];

		for (let i = 0; i < 60 * 40; i++) {
			const f = clock.update(1 / 60);
			player.update(f, false);
			// Freeze auto-exposure, matching the director's resting path.
			mixer.compose(f);
			mixer.finish(f, false);
			if (i % 30 !== 0) continue;
			levels.length = 0;
			let total = 0;
			for (let k = 0; k < n; k++) {
				const v = Math.max(mixer.bytes[k * 3], mixer.bytes[k * 3 + 1], mixer.bytes[k * 3 + 2]);
				pixels++;
				if (v >= 24) lit++;
				levels.push(v);
				total += v;
			}
			if (total < 1) continue;
			levels.sort((a, b) => b - a);
			const tenth = Math.max(1, Math.round(n / 10));
			let top = 0;
			for (let k = 0; k < tenth; k++) top += levels[k];
			concentration += top / total;
			meanSum += total / n;
			counted++;
		}
		return {
			fill: lit / pixels,
			top10: counted > 0 ? concentration / counted : 1,
			mean: meanSum / Math.max(1, counted)
		};
	}

	/**
	 * Mean checks delivered light, top10 catches corner-only scenes, fill catches narrow
	 * stripes.
	 * Fill allows dark bands because curtains deliberately include them.
	 */
	it('lights the room on every scene an empty room can be shown', () => {
		const dark = AMBIENT_SCENES.filter((s) => !s.needsMusic)
			.map((s) => ({ id: s.id, ...look(s.id) }))
			.filter((r) => r.mean < 30 || r.top10 > 0.3 || r.fill < 0.5)
			.map(
				(r) =>
					`${r.id}: mean byte ${r.mean.toFixed(0)}, fills ${(100 * r.fill).toFixed(0)}%,` +
					` top tenth ${r.top10.toFixed(2)}`
			);
		expect(dark).toEqual([]);
	});
});
