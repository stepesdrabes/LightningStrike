import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Viz } from './viz.svelte.ts';

/** Just enough Web Audio to follow what the player schedules, on a clock the test moves. */
class FakeParam {
	value = 1;
	curves: { at: number; seconds: number; rising: boolean }[] = [];
	setValueAtTime(value: number) {
		this.value = value;
	}
	linearRampToValueAtTime() {}
	setValueCurveAtTime(curve: Float32Array, at: number, seconds: number) {
		this.curves.push({ at, seconds, rising: curve[curve.length - 1] > curve[0] });
	}
	cancelScheduledValues() {
		this.curves = [];
	}
}

class FakeNode {
	connected = false;
	connect() {
		this.connected = true;
	}
	disconnect() {
		this.connected = false;
	}
}

class FakeGain extends FakeNode {
	gain = new FakeParam();
}

class FakeSource extends FakeNode {
	buffer: { duration: number } | null = null;
	loop = false;
	onended: (() => void) | null = null;
	startedAt: number | null = null;
	stopped = false;
	start(when: number) {
		this.startedAt = when;
	}
	stop() {
		this.stopped = true;
	}
}

class FakeContext {
	static last: FakeContext;
	currentTime = 0;
	sampleRate = 44100;
	destination = new FakeNode();
	sources: FakeSource[] = [];
	gains: FakeGain[] = [];
	constructor() {
		FakeContext.last = this;
	}
	resume() {
		return Promise.resolve();
	}
	createGain() {
		const gain = new FakeGain();
		this.gains.push(gain);
		return gain;
	}
	createBufferSource() {
		const source = new FakeSource();
		this.sources.push(source);
		return source;
	}
	createBuffer(_channels: number, length: number, rate: number) {
		return { duration: length / rate };
	}
	decodeAudioData() {
		return Promise.resolve({ duration: 60 });
	}
	close() {
		return Promise.resolve();
	}
}

const song = (duration: number) => ({ duration }) as AudioBuffer;

describe('crossfading rows', () => {
	beforeEach(() => {
		vi.useFakeTimers();
		vi.stubGlobal('AudioContext', FakeContext);
	});
	afterEach(() => {
		vi.useRealTimers();
		vi.unstubAllGlobals();
	});

	async function playing(first: AudioBuffer) {
		const v = new Viz();
		await v.decode(new ArrayBuffer(0));
		const ctx = FakeContext.last;
		v.useBuffer(first);
		await v.play();
		return { v, ctx };
	}

	it('starts the next row where the crossfade falls and hands over to it', async () => {
		const { v, ctx } = await playing(song(60));
		const handovers = vi.fn();
		v.onHandover = handovers;
		v.planCrossfade(song(100), 4);
		const [outgoing, incoming] = ctx.sources;
		expect(incoming.startedAt).toBeCloseTo(56, 5);

		ctx.currentTime = 56;
		vi.advanceTimersByTime(56_000);
		expect(handovers).toHaveBeenCalledOnce();
		expect(v.duration).toBe(100);
		expect(v.isPlaying).toBe(true);
		expect(v.position).toBeCloseTo(0, 5);
		// The outgoing row keeps fading until its own end.
		expect(outgoing.stopped).toBe(false);
		ctx.currentTime = 58;
		expect(v.position).toBeCloseTo(2, 5);
	});

	it('hands over when the outgoing row runs out before the timer does', async () => {
		const { v, ctx } = await playing(song(60));
		const handovers = vi.fn();
		const ends = vi.fn();
		v.onHandover = handovers;
		v.onEnded = ends;
		v.planCrossfade(song(100), 4);
		const [outgoing, incoming] = ctx.sources;
		ctx.currentTime = 60;
		outgoing.onended?.();
		expect(handovers).toHaveBeenCalledOnce();
		expect(ends).not.toHaveBeenCalled();
		expect(incoming.stopped).toBe(false);
		expect(v.position).toBeCloseTo(4, 5);
	});

	it('takes the next row back when playback pauses, and schedules it again on resume', async () => {
		const { v, ctx } = await playing(song(60));
		v.planCrossfade(song(100), 4);
		ctx.currentTime = 30;
		v.pause();
		expect(ctx.sources[1].stopped).toBe(true);
		vi.advanceTimersByTime(60_000);
		expect(v.duration).toBe(60);

		await v.play();
		const again = ctx.sources[ctx.sources.length - 1];
		expect(again.buffer?.duration).toBe(100);
		expect(again.startedAt).toBeCloseTo(56, 5);
	});

	it('plays a row at its own level, which a crossfade leaves alone', async () => {
		const v = new Viz();
		await v.decode(new ArrayBuffer(0));
		const ctx = FakeContext.last;
		v.useBuffer(song(60), undefined, 0.4);
		await v.play();
		expect(ctx.gains[ctx.gains.length - 1].gain.value).toBeCloseTo(0.4);
		v.planCrossfade(song(100), 4);
		expect(ctx.sources).toHaveLength(1);
	});

	it('leaves rows with their own fade-out, and rows loaded meanwhile, alone', async () => {
		const faded = new Viz();
		await faded.decode(new ArrayBuffer(0));
		const ctx = FakeContext.last;
		faded.useBuffer(song(60), { at: 50, seconds: 5 });
		await faded.play();
		faded.planCrossfade(song(100), 4);
		expect(ctx.sources).toHaveLength(1);

		const { v, ctx: other } = await playing(song(60));
		v.planCrossfade(song(100), 4);
		v.useBuffer(song(30));
		await v.play();
		vi.advanceTimersByTime(60_000);
		expect(other.sources[1].stopped).toBe(true);
		expect(v.duration).toBe(30);
	});
});
