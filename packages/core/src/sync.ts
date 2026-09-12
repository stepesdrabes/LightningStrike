/**
 * The browser director's local decisions, carried to the hardware renderer with each position
 * sync so both rooms make the same choices. Everything else the renderer needs is a
 * deterministic function of the track position.
 */
export interface RoomSync {
	/** Linear show/ambient crossfade position: 0 the show, 1 ambient. */
	ambience: number;
	/** Seconds since audio last sounded, for the rest grace. */
	stopped: number;
	/** The ambient scene, the picker's stride counter behind it, and how long it has held. */
	scene: string;
	sceneCounter: number;
	sceneHeld: number;
	/** The idle grid clock, so resting scenes breathe in step. */
	idleT: number;
}

/** Position steps beyond this are seeks; anything smaller is transport jitter to absorb. */
const SEEK_STEP = 0.35;
/** Fraction of real time the clock may run fast or slow while absorbing an error. */
const MAX_SLEW = 0.08;
/** Seconds over which a measured error is removed. Shorter would chase sync jitter. */
const CORRECT_TAU = 0.6;

export interface ClockReading {
	/** Track position for the renderer, with the wire lead applied. */
	t: number;
	playing: boolean;
	/** The position stepped while playing, so the show has to restart there. */
	seek: boolean;
}

/**
 * Recover the browser's audio clock from position syncs. The clock runs on the local timeline
 * between syncs; small disagreements slew it a few percent, never backwards, so transport
 * jitter cannot rewind the show, while a large one is a seek and steps.
 */
export class RemoteClock {
	private t = 0;
	private offset = 0;
	private playing = false;
	private syncedAt = Number.NaN;
	private readAt = Number.NaN;
	private pending = 0;
	private stepped = false;
	private readonly staleMs: number;

	constructor(staleMs = 3000) {
		this.staleMs = staleMs;
	}

	/** Whether a browser is saying audio sounds, recently enough to believe it. */
	sounding(nowMs: number): boolean {
		return this.playing && nowMs - this.syncedAt < this.staleMs;
	}

	/** The position the clock is at, without the wire lead. */
	get position(): number {
		return this.t;
	}

	/** Change the wire lead without a step: the reading stays continuous and catches up. */
	trim(seconds: number): void {
		const delta = seconds - this.offset;
		if (delta === 0) return;
		this.offset = seconds;
		this.t -= delta;
		this.pending += delta;
	}

	sync(position: number, playing: boolean, nowMs: number): void {
		const was = this.sounding(nowMs);
		const elapsed =
			was && Number.isFinite(this.readAt) ? Math.max(0, nowMs - this.readAt) / 1000 : 0;
		const expected = this.t + elapsed;
		this.syncedAt = nowMs;
		this.playing = playing;
		if (!playing || !was) {
			// Paused, starting or recovering from a stale sync: the browser's position is where
			// the show restarts, and nothing shows it live in between.
			this.step(position, nowMs);
			return;
		}
		const err = position - expected;
		if (Math.abs(err) >= SEEK_STEP) {
			this.step(position, nowMs);
			this.stepped = true;
		} else {
			this.pending = err;
		}
	}

	/** The position is exact at `nowMs`, so the next read advances from there. */
	private step(position: number, nowMs: number): void {
		this.t = position;
		this.pending = 0;
		this.readAt = nowMs;
	}

	/** Advance to `nowMs` and read. Call once per rendered frame. */
	read(nowMs: number): ClockReading {
		const elapsed = Number.isFinite(this.readAt) ? Math.max(0, nowMs - this.readAt) / 1000 : 0;
		this.readAt = nowMs;
		const playing = this.sounding(nowMs);
		if (playing) {
			let adjust = this.pending * Math.min(1, elapsed / CORRECT_TAU);
			const limit = MAX_SLEW * elapsed;
			if (adjust > limit) adjust = limit;
			else if (adjust < -limit) adjust = -limit;
			this.t += elapsed + adjust;
			this.pending -= adjust;
			if (Math.abs(this.pending) < 1e-4) this.pending = 0;
		}
		const seek = this.stepped;
		this.stepped = false;
		return { t: this.t + this.offset, playing, seek };
	}
}
