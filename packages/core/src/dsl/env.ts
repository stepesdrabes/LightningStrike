import { alphaFor, clamp } from './math.ts';

/** Fires to strength, then decays over a musical duration. */
export class PulseEnv {
	value = 0;

	fire(strength = 1): void {
		if (strength > this.value) this.value = strength;
	}

	decay(dt: number, beatPeriod: number, beats = 0.5): number {
		const tau = Math.max(beatPeriod * beats, 0.02) / 3;
		this.value *= 1 - alphaFor(dt, tau);
		if (this.value < 1e-4) this.value = 0;
		return this.value;
	}

	reset(): void {
		this.value = 0;
	}
}

/** Hold hits through the eye's integration window so brightness is independent of frame timing. */
export class FlashEnvelope {
	value = 0;
	private held = 0;
	private readonly holdSeconds: number;
	private readonly releaseTau: number;

	constructor(holdSeconds = 0.035, releaseTau = 0.09) {
		this.holdSeconds = holdSeconds;
		this.releaseTau = releaseTau;
	}

	fire(strength = 1): void {
		if (strength > this.value) this.value = strength;
		this.held = this.holdSeconds;
	}

	update(dt: number): number {
		if (this.held > 0) {
			this.held -= dt;
			return this.value;
		}
		this.value *= 1 - alphaFor(dt, this.releaseTau);
		if (this.value < 1e-4) this.value = 0;
		return this.value;
	}

	reset(): void {
		this.value = 0;
		this.held = 0;
	}
}

/**
 * Smooth continuous measurements in seconds, preserving between-beat articulation.
 * The 25 ms attack suppresses frame noise; the 140 ms release avoids abrupt note endings.
 * Use a slower attack for position and a faster one for meter tips.
 */
export class Follower {
	value = 0;
	private readonly attackTau: number;
	private readonly releaseTau: number;
	private started = false;

	constructor(attackTau = 0.025, releaseTau = 0.14) {
		this.attackTau = attackTau;
		this.releaseTau = releaseTau;
	}

	update(target: number, dt: number): number {
		// Start at the first reading to avoid adding a cue-entry fade.
		if (!this.started) {
			this.started = true;
			this.value = target;
			return this.value;
		}
		const tau = target > this.value ? this.attackTau : this.releaseTau;
		this.value += (target - this.value) * alphaFor(dt, tau);
		return this.value;
	}

	reset(): void {
		this.value = 0;
		this.started = false;
	}
}

/** Hysteresis, so a value hovering at a threshold does not chatter. */
export class Schmitt {
	private state: boolean;
	private readonly lo: number;
	private readonly hi: number;

	constructor(lo: number, hi: number, initial = false) {
		this.lo = lo;
		this.hi = hi;
		this.state = initial;
	}

	update(v: number): boolean {
		if (this.state) {
			if (v < this.lo) this.state = false;
		} else if (v > this.hi) {
			this.state = true;
		}
		return this.state;
	}

	get value(): boolean {
		return this.state;
	}

	reset(initial = false): void {
		this.state = initial;
	}
}

/** Rises over `riseTau`, collapses instantly when the target drops. */
export function ratchet(current: number, target: number, dt: number, riseTau: number): number {
	if (target <= current) return target;
	return clamp(current + (target - current) * alphaFor(dt, riseTau));
}

/**
 * Sample once per beat; glide in beats to soften position steps. Pass 0 for a true hold.
 * Use Follower for continuous spectrum articulation.
 */
export class BeatHold {
	private held = Number.NaN;
	private shown = Number.NaN;
	/** In beats; explicit fields support type stripping. */
	private readonly glide: number;

	constructor(glide = 0.12) {
		this.glide = glide;
	}

	reset(): void {
		this.held = Number.NaN;
		this.shown = Number.NaN;
	}

	update(target: number, beat: boolean, dt: number, beatPeriod: number): number {
		if (Number.isNaN(this.held)) {
			this.held = target;
			this.shown = target;
			return this.shown;
		}
		if (beat) this.held = target;
		if (this.glide <= 0) {
			this.shown = this.held;
			return this.shown;
		}
		this.shown += (this.held - this.shown) * alphaFor(dt, Math.max(1e-3, this.glide * beatPeriod));
		return this.shown;
	}
}

/**
 * Hold an instrument's hit level across musical gaps, then release when it leaves.
 * Grid pulses keep their timing and use this as permission to strike. A bar-long hold covers
 * syncopated patterns; envelope strength preserves ghost notes.
 */
export class Presence {
	private level = 0;
	private sinceHit = Infinity;
	/** In beats; explicit fields support type stripping. */
	private readonly holdBeats: number;
	private readonly releaseBeats: number;

	constructor(holdBeats = 4, releaseBeats = 4) {
		this.holdBeats = holdBeats;
		this.releaseBeats = releaseBeats;
	}

	reset(): void {
		this.level = 0;
		this.sinceHit = Infinity;
	}

	/** Accumulate time in beats so tempo changes cannot retroactively change a hit's age. */
	update(env: number, dt: number, beatPeriod: number): number {
		if (env > this.level) {
			this.level = env;
			this.sinceHit = 0;
		} else {
			this.sinceHit += dt / Math.max(1e-3, beatPeriod);
			if (this.sinceHit > this.holdBeats) {
				const tau = Math.max(1e-3, this.releaseBeats / 3);
				this.level *= Math.exp(-dt / Math.max(1e-3, beatPeriod) / tau);
			}
		}
		return this.level;
	}
}
