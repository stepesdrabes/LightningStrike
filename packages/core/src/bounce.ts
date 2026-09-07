import type { ShowFrame } from './contracts/frame.ts';
import { Follower } from './dsl/env.ts';
import { GAMMA, LEVEL_BINS, MASTER, perceivedLevel, quantize } from './output.ts';

/**
 * Level this fixture holds while a show is running, as a fraction of the light it can make.
 *
 * The one thing that makes a light distracting is going fully dark and coming back: a fixture
 * breathing between a fifth and full reads as alive, and the same fixture between nothing and
 * full reads as a fault. It matters more here than on the frame, because a lamp standing in a
 * corner sits in peripheral vision whenever the room is what is being looked at, and the
 * periphery is markedly more flicker-sensitive than the fovea.
 *
 * It costs range, and that is why it is not higher. Against the measured section table it turns
 * a room running 0.28 at an intro and 0.90 at a drop into a lamp running 0.37 and 0.91, so the
 * show's 3.2:1 between them arrives as 2.5:1.
 *
 * **In light, not in the authoring domain**, which is where the number was measured: the board it
 * came from wrote PWM duty directly. Set as an authoring value it would go through `quantize` a
 * second time and land at 1% of the light it names, which is a lamp that reads as off.
 */
const FLOOR = 0.12;

/**
 * Share of the range above the floor that answers this beat rather than this passage.
 *
 * A fixture asked to be both the beat and the room tone is good at neither. Splitting the two
 * and giving the beat a modest share is what lets it stay responsive without being the thing
 * that keeps catching your eye: the hit reads as a shimmer over a steady wash instead of the
 * whole lamp blinking.
 */
const BEAT_DEPTH = 0.42;

/** Snares carry the backbeat but should not rival the kick, which is what the lamp is for. */
const SNARE_SHARE = 0.55;

/** Instant up, so a hit lands on the frame it arrives on; ~100 ms down. */
const BEAT_RELEASE = 0.1;

/**
 * Which section the track is in rather than which beat, so it is symmetric: one loud frame must
 * not pin the lamp high for the next two seconds.
 */
const PASSAGE_TAU = 2;

/**
 * How far the lamp is lifted above the light the room is actually making.
 *
 * Matching the room's light one for one is what the level maths above computes, and it reads too
 * dim in the corner: the frame is 720 emitters across a wall and the lamp is one small diffuse
 * source seen in the periphery, so equal light is not equal presence. Applied as a root rather
 * than a gain so the top of the range is untouched and nothing clips - it lifts the ordinary
 * passages, where the lamp spends its life, and leaves a drop where it already was.
 *
 * It costs contrast, which is the thing to watch: against the measured section table an intro at
 * 0.37 and a drop at 0.91 become 0.58 and 0.95, so 2.5:1 arrives as 1.6:1. Set it to 1 to get
 * the untouched room level back.
 */
const LIFT = 1.8;

/**
 * The Bounce Lamp: the show's accent hue, pulsed on the kit.
 *
 * A one-pixel fixture. It carries colour, level and timing, and nothing a show says by moving
 * light across a room - so it is derived from the frame rather than painted by an effect, and
 * nothing in the catalog has to know it exists.
 *
 * The two envelopes are the design the firmware's analog lamp was built around and measured. The
 * one thing that changes by computing them here is where the beat comes from: a percentile taken
 * over the whole fixture barely moves per kick, because one hit lights a small share of a big
 * frame, so the board could only ever infer the beat. `kickEnv` is the beat, exactly.
 *
 * Colour is not eased. The board had to, because it read hue from a mean of the room that moved
 * whenever anything in the room did; a palette slot only changes when the room's own colour
 * changes, and easing the lamp alone would leave it lagging the walls through every cue.
 *
 * Everything about the level happens in **light** rather than in the authoring domain, because
 * that is the domain every constant here was measured in and the domain the eye reads. The one
 * conversion back sits on the last line.
 */
export class BounceLamp {
	/** Authoring domain, one pixel. Gamma is applied on the way out, as it is for the room. */
	private readonly frame = new Float32Array(3);
	private readonly hist = new Uint32Array(LEVEL_BINS);
	private readonly passage = new Follower(PASSAGE_TAU, PASSAGE_TAU);
	private readonly beat = new Follower(0, BEAT_RELEASE);

	/**
	 * One frame, from the room as it actually goes out.
	 *
	 * `room` is the blended frame after highlight compression, so the lamp answers the level the
	 * frame is at rather than the level the show was authored at. `tint` is the accent slot at
	 * full brightness.
	 */
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
		const hit = this.beat.update(Math.max(f.kickEnv, f.snareEnv * SNARE_SHARE), dt);

		const mix = passage * (1 - BEAT_DEPTH) + hit * BEAT_DEPTH;
		// A genuinely black room still goes black, so a blackout in the show is a blackout in the
		// corner. Without this the floor would outlive the show it belongs to.
		const level = lit > 0 ? FLOOR + (1 - FLOOR) * mix : 0;

		// Back across the boundary: `quantize` raises what it is given by gamma, so scaling the
		// light by `level` means scaling the authoring value by its root. Multiplying `level`
		// straight into the tint would darken the lamp by its own gamma a second time.
		const scale = Math.pow(Math.pow(level, 1 / LIFT), 1 / GAMMA);
		this.frame[0] = tint[0] * scale;
		this.frame[1] = tint[1] * scale;
		this.frame[2] = tint[2] * scale;
		quantize(this.frame, out, GAMMA, master);
	}

	reset(): void {
		this.frame.fill(0);
		this.passage.reset();
		this.beat.reset();
	}
}
