import type { ShowFrame } from './contracts/frame.ts';
import { Follower } from './dsl/env.ts';
import { GAMMA, LEVEL_BINS, MASTER, perceivedLevel, quantize } from './output.ts';

/** Linear-light floor and passage share leave the corner visible with headroom for kicks. */
const FLOOR = 0.14;
const BED = 0.28;

/** Symmetric smoothing prevents one loud frame from pinning the passage level. */
const PASSAGE_TAU = 2;

/** Accent-coloured passage glow with kick articulation, in linear light. */
export class BounceLamp {
	/** Authoring domain, one pixel. Gamma is applied on the way out, as it is for the room. */
	private readonly frame = new Float32Array(3);
	private readonly hist = new Uint32Array(LEVEL_BINS);
	private readonly passage = new Follower(PASSAGE_TAU, PASSAGE_TAU);

	/** `room` is the blend after highlight compression; `tint` is the full-brightness accent. */
	render(
		room: Float32Array,
		f: ShowFrame,
		tint: ArrayLike<number>,
		dt: number,
		out: Uint8Array,
		master = MASTER
	): void {
		// A percentile commutes with gamma, so raising the one number is the whole conversion.
		const lit = Math.pow(perceivedLevel(room, this.hist), GAMMA);
		const passage = this.passage.update(lit, dt);
		// The player already holds and releases kicks; a second follower smears fast patterns.
		const hit = f.kickEnv;

		// Screening the hit over the bed preserves its full-scale peak at every passage level.
		const peak = Math.max(tint[0], tint[1], tint[2]);
		// Keep blackouts black despite the lit-room floor.
		const bed = lit > 0 ? FLOOR + (1 - FLOOR) * passage * BED : 0;
		const level = bed + (1 - bed) * hit;
		if (peak <= 0 || bed <= 0) {
			this.frame.fill(0);
			quantize(this.frame, out, GAMMA, master);
			return;
		}

		// Normalize by the strongest tint channel to preserve hue and make level independent of
		// hue.
		// Invert gamma here because quantize applies it at the output boundary.
		const scale = Math.pow(level, 1 / GAMMA) / peak;
		this.frame[0] = tint[0] * scale;
		this.frame[1] = tint[1] * scale;
		this.frame[2] = tint[2] * scale;
		quantize(this.frame, out, GAMMA, master);
	}

	reset(): void {
		this.frame.fill(0);
		this.passage.reset();
	}
}
