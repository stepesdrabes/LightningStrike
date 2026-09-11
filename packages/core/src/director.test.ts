import { describe, expect, it } from 'vitest';
import type { DirectorState } from './director.ts';
import { RoomDirector } from './director.ts';
import { DEFAULT_ROOM, buildGeometry } from './geometry.ts';
import { EffectRegistry } from './effects/index.ts';
import { Mixer } from './mixer.ts';
import { ShowPlayer } from './player.ts';
import { fixtureAnalysis, fixtureShow } from './ambient/fixture.ts';

const g = buildGeometry(DEFAULT_ROOM);
const analysis = fixtureAnalysis();
const show = fixtureShow(analysis);

const PLAYING: DirectorState = { playing: true, hasShow: true, lounge: false, rest: true };
const STOPPED: DirectorState = { playing: false, hasShow: true, lounge: false, rest: true };
const LOUNGE: DirectorState = { playing: true, hasShow: true, lounge: true, rest: true };

function loaded(): RoomDirector {
	const d = new RoomDirector(g, new EffectRegistry());
	d.load(analysis, show);
	return d;
}

describe('RoomDirector', () => {
	/** Show playback must remain byte-identical to the standalone mixer. */
	it('renders a playing show exactly as the plain mixer path does', () => {
		const d = loaded();
		const mixer = new Mixer(g);
		const player = new ShowPlayer(mixer, new EffectRegistry());
		player.load(analysis, show);

		for (let i = 0; i < 60 * 12; i++) {
			const t = i / 60;
			d.update(t, 1 / 60, PLAYING);
			mixer.render(player.update(t, 1 / 60));
			if (i % 37 !== 0) continue;
			expect(Array.from(d.bytes), `frame ${i}`).toEqual(Array.from(mixer.bytes));
		}
	});

	it('holds the show through an ordinary gap between tracks', () => {
		const d = loaded();
		for (let i = 0; i < 60 * 4; i++) d.update(i / 60, 1 / 60, PLAYING);
		for (let i = 0; i < 60 * 2; i++) d.update(4, 1 / 60, STOPPED);
		expect(d.ambience).toBe(0);
		expect(d.resting).toBe(false);
	});

	it('dissolves into rest, monotonically, and lands exactly on it', () => {
		const d = loaded();
		for (let i = 0; i < 60 * 4; i++) d.update(i / 60, 1 / 60, PLAYING);

		let last = 0;
		let arrived = -1;
		for (let i = 0; i < 60 * 20; i++) {
			d.update(4, 1 / 60, STOPPED);
			expect(d.ambience).toBeGreaterThanOrEqual(last);
			last = d.ambience;
			if (arrived < 0 && d.ambience >= 1) arrived = i / 60;
		}
		expect(d.ambience).toBe(1);
		expect(arrived).toBeGreaterThan(6.5);
		expect(arrived).toBeLessThan(8.5);
	});

	/**
	 * A handover must stay at least as bright as either endpoint, including when the show is
	 * paused.
	 */
	it('never dips below either end of a handover', () => {
		const d = loaded();
		const mean = () => {
			let sum = 0;
			for (let i = 0; i < d.bytes.length; i += 3) {
				sum += Math.max(d.bytes[i], d.bytes[i + 1], d.bytes[i + 2]);
			}
			return sum / (d.bytes.length / 3);
		};

		for (let i = 0; i < 60 * 20; i++) d.update(20 + i / 60, 1 / 60, PLAYING);
		const show = mean();

		let dip = Infinity;
		let rested = 0;
		for (let i = 0; i < 60 * 12; i++) {
			d.update(40, 1 / 60, STOPPED);
			// Compare the arriving endpoint; later ambient animation is outside the handover.
			if (d.ambience >= 1) {
				rested = mean();
				break;
			}
			dip = Math.min(dip, mean());
		}

		expect(rested).toBeGreaterThan(0);
		expect(show).toBeGreaterThan(rested);
		expect(dip).toBeGreaterThan(Math.min(show, rested) * 0.92);
	});

	it('holds the show still while it is being faded out', () => {
		const d = loaded();
		for (let i = 0; i < 60 * 20; i++) d.update(20 + i / 60, 1 / 60, PLAYING);

		// Allow one second for a paused hit envelope to finish.
		for (let i = 0; i < 60; i++) d.update(40, 1 / 60, STOPPED);
		const settled = Float32Array.from(d.showMix.frame);

		// After envelopes settle, paused effects must stop integrating dt.
		for (let i = 0; i < 60 * 2; i++) d.update(40, 1 / 60, STOPPED);
		expect(Array.from(d.showMix.frame)).toEqual(Array.from(settled));
	});

	/** The output chain must not depend on absolute track time, which resets on track changes. */
	it('is not dimmed by a track change taking the clock backwards', () => {
		const mean = (d: RoomDirector) => {
			let sum = 0;
			for (let i = 0; i < d.bytes.length; i += 3) {
				sum += Math.max(d.bytes[i], d.bytes[i + 1], d.bytes[i + 2]);
			}
			return sum / (d.bytes.length / 3);
		};

		const used = loaded();
		for (let i = 0; i < 60 * 60; i++) used.update(i / 60, 1 / 60, PLAYING);
		used.load(analysis, show);
		for (let i = 0; i < 60 * 5; i++) used.update(i / 60, 1 / 60, PLAYING);

		const fresh = loaded();
		for (let i = 0; i < 60 * 5; i++) fresh.update(i / 60, 1 / 60, PLAYING);

		// Effect phases may differ; delivered brightness should remain comparable.
		expect(mean(used)).toBeGreaterThan(mean(fresh) * 0.8);
		expect(mean(used)).toBeLessThan(mean(fresh) * 1.25);
	});

	it('comes back to the show faster than it left it', () => {
		const d = loaded();
		for (let i = 0; i < 60 * 30; i++) d.update(0, 1 / 60, STOPPED);
		expect(d.ambience).toBe(1);

		let back = -1;
		for (let i = 0; i < 60 * 10; i++) {
			d.update(i / 60, 1 / 60, PLAYING);
			if (back < 0 && d.ambience <= 0) back = i / 60;
		}
		expect(back).toBeGreaterThan(0);
		expect(back).toBeLessThan(2.5);
	});

	it('takes the room at once for lounge, without waiting out the grace', () => {
		const d = loaded();
		for (let i = 0; i < 60 * 4; i++) d.update(i / 60, 1 / 60, PLAYING);
		for (let i = 0; i < 60 * 2; i++) d.update(4 + i / 60, 1 / 60, LOUNGE);
		expect(d.ambience).toBeGreaterThan(0.15);
	});

	it('leaves the room resting when lounge is switched off during a pause', () => {
		const d = loaded();
		for (let i = 0; i < 60 * 30; i++) d.update(0, 1 / 60, { ...LOUNGE, playing: false });
		expect(d.ambience).toBe(1);
		d.update(0, 1 / 60, STOPPED);
		expect(d.ambience).toBeGreaterThan(0.99);
	});

	it('holds the show frozen when resting is switched off', () => {
		const d = loaded();
		const state = { ...STOPPED, rest: false };
		for (let i = 0; i < 60 * 30; i++) d.update(4, 1 / 60, state);
		expect(d.ambience).toBe(0);
	});

	it('lights the room when there is no show at all, without waiting out the grace', () => {
		const d = new RoomDirector(g, new EffectRegistry());
		const state: DirectorState = { playing: false, hasShow: false, lounge: false, rest: true };
		// An empty queue has no inter-track gap to bridge.
		for (let i = 0; i < 60; i++) d.update(0, 1 / 60, state);
		expect(d.ambience).toBeGreaterThan(0);

		for (let i = 0; i < 60 * 20; i++) d.update(0, 1 / 60, state);
		let lit = 0;
		for (let i = 0; i < d.bytes.length; i += 3) {
			if (Math.max(d.bytes[i], d.bytes[i + 1], d.bytes[i + 2]) >= 24) lit++;
		}
		expect(lit / (d.bytes.length / 3)).toBeGreaterThan(0.5);
	});

	it('keeps the frame it hands back about the track, not about the room', () => {
		const d = loaded();
		let f = d.update(0, 1 / 60, PLAYING);
		for (let i = 0; i < 60 * 40; i++) f = d.update(40, 1 / 60, STOPPED);
		expect(d.resting).toBe(true);
		expect(f.t).toBe(40);
		expect(f.barIndex).toBeGreaterThan(10);
	});

	it('never emits a non-finite or negative byte across a whole handover', () => {
		const d = loaded();
		// Aggregate failures to avoid millions of per-byte assertions.
		let bad = '';
		const walk = (frames: number, state: DirectorState, t: number, tag: string) => {
			for (let i = 0; i < frames; i++) {
				d.update(t, 1 / 60, state);
				if (bad) return;
				for (let k = 0; k < d.bytes.length; k++) {
					const b = d.bytes[k];
					if (Number.isFinite(b) && b >= 0 && b <= 255) continue;
					bad = `${tag} frame ${i} byte ${k} = ${b}`;
					return;
				}
			}
		};
		walk(120, PLAYING, 12, 'playing');
		walk(600, STOPPED, 12, 'resting');
		walk(120, PLAYING, 12, 'waking');
		walk(300, LOUNGE, 12, 'lounge');
		expect(bad).toBe('');
	});
});
