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
		expect(arrived).toBeGreaterThan(8);
		expect(arrived).toBeLessThan(9.5);
	});

	/**
	 * A handover must stay at least as bright as either endpoint, including when the show is
	 * paused. Delivered light is what the eye sums, so the measure is every channel's bytes,
	 * not the strongest one: two hues crossing keep their light while their peaks halve.
	 */
	it('never dips below either end of a handover', () => {
		const d = loaded();
		const mean = () => {
			let sum = 0;
			for (let i = 0; i < d.bytes.length; i++) sum += d.bytes[i];
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

	it('plays an authored show at its written levels, whatever exposure the room built up', () => {
		const dim = { ...show, cues: show.cues.map((c) => ({ ...c, intensity: 0.15 })) };
		const authored = { ...dim, exposure: 'fixed' as const };
		const lifted = new RoomDirector(g, new EffectRegistry());
		lifted.load(analysis, dim);
		for (let i = 0; i < 60 * 60; i++) lifted.update(i / 60, 1 / 60, PLAYING);
		const fresh = new RoomDirector(g, new EffectRegistry());
		fresh.load(analysis, authored);
		lifted.load(analysis, authored, 0);
		for (let i = 0; i < 60 * 3; i++) {
			lifted.update(60 + i / 60, 1 / 60, PLAYING);
			fresh.update(60 + i / 60, 1 / 60, PLAYING);
		}
		let worst = 0;
		for (let i = 0; i < fresh.bytes.length; i++) worst = Math.max(worst, Math.abs(fresh.bytes[i] - lifted.bytes[i]));
		expect(worst).toBeLessThanOrEqual(1);
	});

	it('keeps the exposure songs built up through an authored row between them', () => {
		const dim = { ...show, cues: show.cues.map((c) => ({ ...c, intensity: 0.15 })) };
		const d = new RoomDirector(g, new EffectRegistry());
		d.load(analysis, dim);
		for (let i = 0; i < 60 * 60; i++) d.update(i / 60, 1 / 60, PLAYING);
		const built = d.sync().exposure!;
		expect(built).toBeGreaterThan(1.3);
		d.load(analysis, { ...dim, exposure: 'fixed' }, 0);
		for (let i = 0; i < 60 * 3; i++) d.update(60 + i / 60, 1 / 60, PLAYING);
		expect(d.sync().exposure).toBeCloseTo(built, 5);
		d.load(analysis, dim, 0);
		d.update(63, 1 / 60, PLAYING);
		expect(d.sync().exposure!).toBeGreaterThan(built - 0.01);
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

describe('RoomDirector transitions', () => {
	const DT = 1 / 60;
	/** Delivered light per pixel, every channel: the eye sums them. */
	const light = (d: RoomDirector) => {
		let sum = 0;
		for (let i = 0; i < d.bytes.length; i++) sum += d.bytes[i];
		return sum / (d.bytes.length / 3);
	};
	/** Mean absolute byte change between two frames: what a jump looks like on the wire. */
	const delta = (a: Uint8Array, b: Uint8Array) => {
		let sum = 0;
		for (let i = 0; i < a.length; i++) sum += Math.abs(a[i] - b[i]);
		return sum / a.length;
	};

	interface Walk {
		worst: number;
		darkest: number;
	}

	/** Step `frames` frames and report the worst single-frame move and the darkest frame. */
	function walk(d: RoomDirector, frames: number, at: (i: number) => number, state: DirectorState): Walk {
		let prev = Uint8Array.from(d.bytes);
		let worst = 0;
		let darkest = Infinity;
		for (let i = 0; i < frames; i++) {
			d.update(at(i), DT, state);
			worst = Math.max(worst, delta(d.bytes, prev));
			darkest = Math.min(darkest, light(d));
			prev = Uint8Array.from(d.bytes);
		}
		return { worst, darkest };
	}

	/** The show's own ordinary movement, so a transition is judged against it. */
	function steady(d: RoomDirector, from: number): number {
		for (let i = 0; i < 60 * 3; i++) d.update(from + i * DT, DT, PLAYING);
		return Math.max(6, walk(d, 60 * 2, (i) => from + 3 + i * DT, PLAYING).worst * 1.5);
	}

	it('carries one track into the next without a jump or a dark gap', () => {
		const d = loaded();
		const second = fixtureAnalysis(100);
		const end = analysis.duration;
		const limit = steady(d, end - 12);

		const tail = walk(d, 60, (i) => end - 1 + i * DT, PLAYING);
		// The audio has ended: the show eased out and the room holds the settled look.
		expect(d.showMix.fade).toBeCloseTo(0.35, 2);
		const held = Uint8Array.from(d.bytes);
		const gap = walk(d, 60, () => end, STOPPED);
		expect(Array.from(d.bytes)).toEqual(Array.from(held));
		d.clearShow();
		const unloaded = walk(d, 30, () => end, { ...STOPPED, hasShow: false });
		expect(Array.from(d.bytes)).toEqual(Array.from(held));
		d.load(second, fixtureShow(second));
		const opening = walk(d, 60 * 3, (i) => i * DT, PLAYING);

		for (const part of [tail, gap, unloaded, opening]) {
			expect(part.worst).toBeLessThan(limit);
			expect(part.darkest).toBeGreaterThan(8);
		}
	});

	it('holds the picture through a pause and is a pure function of position after resuming', () => {
		const d = loaded();
		const limit = steady(d, 10);
		for (let i = 0; i < 60 * 2; i++) d.update(15 + i * DT, DT, PLAYING);
		const held = Uint8Array.from(d.bytes);
		for (let i = 0; i < 60 * 2; i++) {
			d.update(17, DT, STOPPED);
			if (i % 20 === 0) expect(Array.from(d.bytes)).toEqual(Array.from(held));
		}

		expect(walk(d, 60 * 2, (i) => 17 + i * DT, PLAYING).worst).toBeLessThan(limit);
		const fresh = loaded();
		for (let i = 0; i < 60 * 2; i++) fresh.update(17 + i * DT, DT, PLAYING);
		expect(Array.from(d.showMix.frame)).toEqual(Array.from(fresh.showMix.frame));
	});

	it('cuts or dissolves into a row loaded onto a live room over the time its loader asked for', () => {
		const second = fixtureAnalysis(100);
		const next = { ...fixtureShow(second), palette: { base: 20, accent: 200 } };
		const cut = loaded();
		const faded = loaded();
		for (const d of [cut, faded]) for (let i = 0; i < 60 * 5; i++) d.update(i * DT, DT, PLAYING);
		cut.load(second, next, 0);
		faded.load(second, next, 4);
		const fresh = new RoomDirector(g, new EffectRegistry());
		fresh.load(second, next, 0);
		for (let i = 0; i < 60; i++) {
			for (const d of [cut, faded, fresh]) d.update(i * DT, DT, PLAYING);
		}
		// A second in, the cut shows only the new row; the four-second dissolve is still under way.
		expect(Array.from(cut.showMix.frame)).toEqual(Array.from(fresh.showMix.frame));
		expect(delta(cut.bytes, fresh.bytes)).toBeLessThan(0.5);
		expect(delta(faded.bytes, fresh.bytes)).toBeGreaterThan(2);
	});

	it('restarts on a seek, forward and back, and dissolves into the new position', () => {
		const d = loaded();
		const limit = steady(d, 10);
		const same = (t: number) => {
			const fresh = loaded();
			for (let i = 0; i < 60; i++) fresh.update(t + i * DT, DT, PLAYING);
			expect(Array.from(d.showMix.frame)).toEqual(Array.from(fresh.showMix.frame));
		};

		d.seek();
		expect(walk(d, 60, (i) => 40 + i * DT, PLAYING).worst).toBeLessThan(limit);
		same(40);
		d.seek();
		expect(walk(d, 60, (i) => 12 + i * DT, PLAYING).worst).toBeLessThan(limit);
		same(12);

		// The hardware is not told about seeks; it sees the position jump.
		const hardware = loaded();
		steady(hardware, 10);
		expect(walk(hardware, 60, (i) => 40 + i * DT, PLAYING).worst).toBeLessThan(limit);
		const fresh = loaded();
		for (let i = 0; i < 60; i++) fresh.update(40 + i * DT, DT, PLAYING);
		expect(Array.from(hardware.showMix.frame)).toEqual(Array.from(fresh.showMix.frame));
	});

	it('absorbs clock jitter without restarting the show', () => {
		const d = loaded();
		const limit = steady(d, 0);
		const bed = d.showMix.layers.bed.effect;
		const jittered = walk(d, 60 * 3, (i) => 5 + i * DT - (i % 3 === 1 ? 0.02 : 0), PLAYING);
		expect(jittered.worst).toBeLessThan(limit);
		expect(d.showMix.layers.bed.effect).toBe(bed);
	});

	it('eases the lounge floor and motion instead of stepping them', () => {
		const d = loaded();
		const limit = steady(d, 0);
		let floorStep = 0;
		let motionStep = 0;
		let prevFloor = Number.NaN;
		let prevMotion = Number.NaN;
		const watch = (frames: number, at: (i: number) => number, state: DirectorState) => {
			let prev = Uint8Array.from(d.bytes);
			let worst = 0;
			for (let i = 0; i < frames; i++) {
				d.update(at(i), DT, state);
				worst = Math.max(worst, delta(d.bytes, prev));
				prev = Uint8Array.from(d.bytes);
				const floor = d.ambientMix.floor;
				const motion = d.ambientMix.motion;
				if (Number.isFinite(prevFloor)) {
					floorStep = Math.max(floorStep, Math.abs(floor - prevFloor));
					motionStep = Math.max(motionStep, Math.abs(motion - prevMotion));
				}
				prevFloor = floor;
				prevMotion = motion;
			}
			return worst;
		};
		// Rest first, so the scenes are on their resting floor when the music arrives.
		for (let i = 0; i < 60 * 12; i++) d.update(5, DT, STOPPED);
		expect(d.ambience).toBe(1);
		const restFloor = d.ambientMix.floor;
		expect(watch(60 * 8, (i) => 5 + i * DT, LOUNGE)).toBeLessThan(limit);
		expect(d.ambientMix.floor).toBeLessThan(restFloor - 0.1);
		expect(floorStep).toBeLessThan(0.01);
		expect(motionStep).toBeLessThan(0.02);
		expect(watch(60 * 3, (i) => 13 + i * DT, PLAYING)).toBeLessThan(limit);
	});
});
