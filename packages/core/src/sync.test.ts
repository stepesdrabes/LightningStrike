import { describe, expect, it } from 'vitest';
import { RemoteClock, RowClock } from './sync.ts';
import { RoomDirector, type DirectorState } from './director.ts';
import { DEFAULT_ROOM, buildGeometry } from './geometry.ts';
import { EffectRegistry } from './effects/index.ts';
import { fixtureAnalysis, fixtureShow } from './ambient/fixture.ts';

describe('RemoteClock', () => {
	it('never runs backwards on sync jitter and stays within a few percent of real time', () => {
		const c = new RemoteClock();
		c.sync(10, true, 0);
		const jitter = [0.02, -0.02, 0.015, -0.018, 0.005, -0.012];
		let last = -Infinity;
		let t = 0;
		for (let ms = 0; ms <= 6000; ms += 16) {
			if (ms % 500 === 0 && ms > 0) {
				c.sync(10 + ms / 1000 + jitter[(ms / 500) % jitter.length], true, ms);
			}
			const r = c.read(ms);
			expect(r.playing).toBe(true);
			expect(r.seek).toBe(false);
			expect(r.t).toBeGreaterThanOrEqual(last);
			last = r.t;
			t = r.t;
		}
		expect(Math.abs(t - 16)).toBeLessThan(0.05);
	});

	it('steps on a seek and reports it once', () => {
		const c = new RemoteClock();
		c.sync(10, true, 0);
		c.read(400);
		c.sync(40, true, 500);
		const r = c.read(516);
		expect(r.seek).toBe(true);
		expect(r.t).toBeCloseTo(40.016, 2);
		expect(c.read(532).seek).toBe(false);
	});

	it('freezes where it was when syncs stop, rather than falling back to the last sync', () => {
		const c = new RemoteClock(3000);
		c.sync(10, true, 0);
		let r = c.read(2900);
		expect(r.playing).toBe(true);
		expect(r.t).toBeCloseTo(12.9, 3);
		r = c.read(3100);
		expect(r.playing).toBe(false);
		expect(r.t).toBeCloseTo(12.9, 3);
		// A browser coming back starts the show where it says it is.
		c.sync(15, true, 3200);
		r = c.read(3216);
		expect(r.playing).toBe(true);
		expect(r.t).toBeCloseTo(15.016, 2);
	});

	it('holds a paused position exactly and takes up a wire lead without a step', () => {
		const c = new RemoteClock();
		c.sync(20, false, 0);
		expect(c.read(100).playing).toBe(false);
		expect(c.read(100).t).toBe(20);

		c.sync(20, true, 200);
		c.read(200);
		c.trim(0.05);
		expect(c.read(216).t).toBeCloseTo(20.016, 2);
		let r = c.read(216);
		for (let ms = 224; ms <= 3000; ms += 8) r = c.read(ms);
		expect(r.t).toBeCloseTo(22.85, 2);
	});
});

describe('RowClock', () => {
	it('holds positions for a row until it has loaded, then starts it where the browser has it', () => {
		const rows = new RowClock(new RemoteClock());
		rows.arrive('a', 0);
		rows.sync(100, true, 0, 'a', 'a');
		expect(rows.clock.read(500).t).toBeCloseTo(100.5, 2);

		// The queue moved to b and the browser is already playing it; b is still loading here.
		rows.sync(0.1, true, 600, 'b', 'b');
		expect(rows.clock.read(700).t).toBeCloseTo(100.7, 1);
		rows.arrive('b', 900);
		const r = rows.clock.read(900);
		expect(r.t).toBeCloseTo(0.4, 2);
		expect(r.playing).toBe(true);
	});

	it('starts a row at its beginning when nothing was heard for it, and never waits for ever', () => {
		const rows = new RowClock(new RemoteClock());
		rows.arrive('a', 0);
		rows.sync(30, true, 0, 'a', 'a');
		rows.arrive('b', 100);
		expect(rows.clock.read(100)).toMatchObject({ t: 0, playing: false });

		// A row that never loads stops holding the clock after a couple of seconds.
		rows.sync(5, true, 1000, 'c', 'c');
		rows.sync(8, true, 4000, 'c', 'c');
		expect(rows.clock.read(4000).t).toBeCloseTo(8, 2);
		// A position for the row shown here applies at once, though the queue has moved on.
		rows.sync(12, true, 5000, 'b', 'd');
		expect(rows.clock.read(5000).t).toBeCloseTo(12, 2);
	});

	it('ignores a late position from a row already left', () => {
		const rows = new RowClock(new RemoteClock());
		rows.arrive('hold', 0);
		rows.sync(1800, true, 100, 'hold', 'hold');
		// Go: the queue moves on and this side loads the next row before the browser has.
		rows.arrive('next', 200);
		rows.sync(1800.1, true, 300, 'hold', 'next');
		expect(rows.clock.read(310)).toMatchObject({ t: 0, playing: false });
		rows.sync(0.2, true, 400, 'next', 'next');
		expect(rows.clock.read(400).t).toBeCloseTo(0.2, 2);
	});
});

describe('two rooms', () => {
	const g = buildGeometry(DEFAULT_ROOM);
	const PLAYING: DirectorState = { playing: true, hasShow: true, lounge: false, rest: true };
	const STOPPED: DirectorState = { playing: false, hasShow: true, lounge: false, rest: true };
	const LOUNGE: DirectorState = { playing: true, hasShow: true, lounge: true, rest: true };
	const DT = 1 / 60;

	const maxDiff = (a: Uint8Array, b: Uint8Array) => {
		let worst = 0;
		for (let i = 0; i < a.length; i++) worst = Math.max(worst, Math.abs(a[i] - b[i]));
		return worst;
	};

	it('render identical bytes from identical inputs through every kind of transition', () => {
		const first = fixtureAnalysis();
		const second = fixtureAnalysis(100);
		const rooms = [new RoomDirector(g, new EffectRegistry()), new RoomDirector(g, new EffectRegistry())];
		for (const d of rooms) d.load(first, fixtureShow(first));

		const steps: (() => void)[] = [];
		const walk = (from: number, seconds: number, state: DirectorState, moving = true) => {
			for (let i = 0; i < Math.round(seconds / DT); i++) {
				const t = moving ? from + i * DT : from;
				steps.push(() => {
					for (const d of rooms) d.update(t, DT, state);
				});
			}
		};
		walk(0, 3, PLAYING);
		walk(3, 2, STOPPED, false);
		walk(3, 3, PLAYING);
		steps.push(() => rooms.forEach((d) => d.seek()));
		walk(30, 2, PLAYING);
		walk(32, 3, LOUNGE);
		walk(35, 2, PLAYING);
		walk(37, 10, STOPPED, false);
		steps.push(() => rooms.forEach((d) => d.clearShow()));
		walk(37, 1, { ...STOPPED, hasShow: false }, false);
		steps.push(() => rooms.forEach((d) => d.load(second, fixtureShow(second))));
		walk(0, 4, PLAYING);

		let frame = 0;
		for (const step of steps) {
			step();
			frame++;
			if (frame % 5 !== 0) continue;
			expect(Array.from(rooms[1].bytes), `frame ${frame}`).toEqual(Array.from(rooms[0].bytes));
			expect(Array.from(rooms[1].bounce)).toEqual(Array.from(rooms[0].bounce));
		}
	});

	it('brings a hardware room with its own exposure history to the browser picture', () => {
		const analysis = fixtureAnalysis();
		const dim = { ...fixtureShow(analysis), cues: fixtureShow(analysis).cues.map((c) => ({ ...c, intensity: 0.15 })) };
		const browser = new RoomDirector(g, new EffectRegistry());
		const server = new RoomDirector(g, new EffectRegistry());
		// The hardware has been lighting a dim room for a minute before this tab opened.
		server.load(analysis, dim);
		for (let i = 0; i < 60 * 60; i++) server.update(i * DT, DT, PLAYING);
		browser.load(analysis, dim);
		server.load(analysis, dim);
		for (let i = 0; i < 60 * 12; i++) {
			if (i % 30 === 0) server.follow(browser.sync());
			browser.update(80 + i * DT, DT, PLAYING);
			server.update(80 + i * DT, DT, PLAYING);
		}
		expect(maxDiff(server.bytes, browser.bytes)).toBeLessThanOrEqual(2);
	});

	/**
	 * The hardware renderer only hears positions twice a second, plus the decisions the browser
	 * made. Once it has settled it must show the same scene and the same picture.
	 */
	it('following syncs converges on the room it follows, playing and at rest', () => {
		const analysis = fixtureAnalysis();
		const show = fixtureShow(analysis);
		const browser = new RoomDirector(g, new EffectRegistry());
		const server = new RoomDirector(g, new EffectRegistry());
		browser.load(analysis, show);
		server.load(analysis, show);
		const clock = new RemoteClock();

		let playing = false;
		let position = 0;
		let frame = 0;
		const state = (on: boolean): DirectorState => ({ playing: on, hasShow: true, lounge: false, rest: true });
		const tick = () => {
			const ms = frame * 1000 / 60;
			if (frame % 30 === 0) {
				clock.sync(position, playing, ms);
				server.follow(browser.sync());
			}
			browser.update(position, DT, state(playing));
			const r = clock.read(ms);
			if (r.seek) server.seek();
			server.update(r.t, DT, state(r.playing));
			if (playing) position += DT;
			frame++;
		};

		// Play twelve seconds; after the opening dissolve the two must agree.
		playing = true;
		for (let i = 0; i < 60 * 12; i++) tick();
		expect(server.sceneName).toBe(browser.sceneName);
		expect(maxDiff(server.bytes, browser.bytes)).toBeLessThanOrEqual(2);

		// Stop; rest arrives on both, on the same scene and the same idle clock.
		playing = false;
		for (let i = 0; i < 60 * 14; i++) tick();
		expect(browser.resting).toBe(true);
		expect(server.resting).toBe(true);
		expect(server.sceneName).toBe(browser.sceneName);
		expect(maxDiff(server.bytes, browser.bytes)).toBeLessThanOrEqual(3);

		// The browser nudges to another scene; the server follows through the same fade.
		browser.ambient.next();
		for (let i = 0; i < 60 * 10; i++) tick();
		expect(server.sceneName).toBe(browser.sceneName);
		expect(maxDiff(server.bytes, browser.bytes)).toBeLessThanOrEqual(3);

		// Play again from further in: both wake into the same picture.
		position = 40;
		playing = true;
		for (let i = 0; i < 60 * 6; i++) tick();
		expect(maxDiff(server.bytes, browser.bytes)).toBeLessThanOrEqual(2);
	});
});
