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
 * Deterministic idle grid accumulated from dt. Bands and spectrum stay zero because there
 * is no audio measurement; calm effects may still use the grid.
 */
export class IdleClock {
	readonly frame: ShowFrame = createShowFrame();

	private t = 0;
	private lastBeat = Number.NaN;
	private lastBar = Number.NaN;
	private lastPhrase = Number.NaN;

	constructor() {
		this.reset();
	}

	update(dt: number): ShowFrame {
		this.t += dt;
		this.write(dt);
		return this.frame;
	}

	reset(): void {
		this.t = 0;
		this.write(0);
		// The first update owes beat, downbeat and phrase edges, just like ShowPlayer.
		this.lastBeat = Number.NaN;
		this.lastBar = Number.NaN;
		this.lastPhrase = Number.NaN;
	}

	private write(dt: number): void {
		const f = this.frame;
		const beatPeriod = 60 / IDLE_BPM;

		f.t = this.t;
		f.dt = dt;

		const beatsF = this.t / beatPeriod;
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

		f.energy = IDLE_ENERGY + IDLE_SWELL * (sinewave(this.t / IDLE_SWELL_PERIOD) - 0.5) * 2;
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
