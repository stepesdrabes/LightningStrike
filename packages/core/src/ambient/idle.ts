import type { ShowFrame } from '../contracts/frame.ts';
import { createShowFrame } from '../contracts/frame.ts';
import { sinewave } from '../dsl/wave.ts';
import { BARS_PER_PHRASE } from '../grid.ts';

/** 40 BPM slows beat-derived effects to a resting pulse. */
const IDLE_BPM = 40;
const BEATS_PER_BAR = 4;

/** Synthetic quiet-passage energy keeps energy-scaled effects visible at rest. */
const IDLE_ENERGY = 0.28;
const IDLE_SWELL = 0.06;
/** Seconds for one breath in and out. */
const IDLE_SWELL_PERIOD = 26;

/**
 * Following another room's idle time: small differences slew at a tenth of real time, so
 * the grid never steps; a difference this large is a fresh start and steps once.
 */
const FOLLOW_TAU = 1.5;
const FOLLOW_RATE = 0.1;
const FOLLOW_STEP = 30;

/**
 * Deterministic idle grid accumulated from dt. Bands and spectrum stay zero because there
 * is no audio measurement; calm effects may still use the grid.
 */
export class IdleClock {
	readonly frame: ShowFrame = createShowFrame();

	private time = 0;
	private pending = 0;
	private lastBeat = Number.NaN;
	private lastBar = Number.NaN;
	private lastPhrase = Number.NaN;

	constructor() {
		this.reset();
	}

	get t(): number {
		return this.time;
	}

	update(dt: number): ShowFrame {
		let adjust = this.pending * Math.min(1, dt / FOLLOW_TAU);
		const limit = FOLLOW_RATE * dt;
		if (adjust > limit) adjust = limit;
		else if (adjust < -limit) adjust = -limit;
		this.time += dt + adjust;
		this.pending -= adjust;
		if (Math.abs(this.pending) < 1e-4) this.pending = 0;
		this.write(dt);
		return this.frame;
	}

	/** Follow another room's idle time. */
	follow(t: number): void {
		const err = t - this.time;
		if (Math.abs(err) > FOLLOW_STEP) {
			this.time = t;
			this.pending = 0;
		} else {
			this.pending = err;
		}
	}

	reset(): void {
		this.time = 0;
		this.pending = 0;
		this.write(0);
		// The first update owes beat, downbeat and phrase edges, just like ShowPlayer.
		this.lastBeat = Number.NaN;
		this.lastBar = Number.NaN;
		this.lastPhrase = Number.NaN;
	}

	private write(dt: number): void {
		const f = this.frame;
		const beatPeriod = 60 / IDLE_BPM;

		f.t = this.time;
		f.dt = dt;

		const beatsF = this.time / beatPeriod;
		const barsF = beatsF / BEATS_PER_BAR;
		const phrasesF = barsF / BARS_PER_PHRASE;

		const beatIndex = Math.floor(beatsF);
		const barIndex = Math.floor(barsF);
		const phraseIndex = Math.floor(phrasesF);

		// Index-change detection prevents repeated or skipped beat edges.
		f.beat = beatIndex !== this.lastBeat;
		f.downbeat = barIndex !== this.lastBar;
		f.phraseStart = phraseIndex !== this.lastPhrase;
		this.lastBeat = beatIndex;
		this.lastBar = barIndex;
		this.lastPhrase = phraseIndex;

		f.beatIndex = beatIndex;
		f.barIndex = barIndex;
		f.beatPhase = beatsF - beatIndex;
		f.barPhase = barsF - barIndex;
		f.phrasePhase = phrasesF - phraseIndex;
		f.beatPeriod = beatPeriod;
		f.bpm = IDLE_BPM;

		f.section = 'intro';
		// Without a track, structural progress stays neutral.
		f.sectionProgress = 0;
		f.buildProgress = 0;
		f.timeToDrop = Infinity;
		f.timeSinceDrop = Infinity;

		f.energy = IDLE_ENERGY + IDLE_SWELL * (sinewave(this.time / IDLE_SWELL_PERIOD) - 0.5) * 2;
		f.bands.fill(0);
		f.spectrum.fill(0);

		f.pan = 0;
		f.panWidth = 0;
		f.kick = false;
		f.snare = false;
		f.hat = false;
		f.kickEnv = 0;
		f.snareEnv = 0;
		f.hatEnv = 0;
	}
}
