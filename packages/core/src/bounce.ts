import type { ShowFrame } from './contracts/frame.ts';
import { Follower } from './dsl/env.ts';
import { GAMMA, LEVEL_BINS, MASTER, perceivedLevel, quantize } from './output.ts';

/**
 * Where the colour dies sit in the quietest lit passage, before any hit.
 *
 * Low, because this is a punch budget: everything the bed holds is range the kick cannot swing
 * through, and the dies are the only thing swinging. It was 0.6 for one round, to make the colour
 * bright, and that left a groove's kick a 1.3:1 move - the colour was bright and the lamp did
 * nothing. A saturated hue at a fifth of its die is still plainly that hue; a hue with no headroom
 * above it is not a fixture that answers a kit.
 *
 * A genuinely black room still takes the lamp to black, so a blackout in the show is a blackout
 * in the corner. This is the floor of a lit room, not of a dark one.
 *
 * **In light, not in the authoring domain**, which is where every constant in this file was
 * measured: the board it came from wrote PWM duty directly. Set as an authoring value it would go
 * through `quantize` a second time and land at a fraction of the light it names.
 */
const FLOOR = 0.18;

/**
 * How much of the range above the floor the passage may hold between hits.
 *
 * The rest is left for the kick, which screens over it and always reaches full scale. Kept under a
 * half so a drop - where the passage is already near the top - still has somewhere to punch to;
 * at 1.0 a loud section would pin the dies high and the hits would vanish exactly where they are
 * most wanted.
 */
const BED = 0.35;

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
 *
 * **The three colour dies do all of it, and the white phosphors are not used at all.** The pixel
 * is the accent hue at its own saturation, and the level - the strongest channel, 0..1 - carries
 * both the passage and the kit: it rests where the section puts it and screens to full on every
 * hit. `lamp/src/fixture.rs` holds its fourth gate at zero for the whole show.
 *
 * The phosphors were tried for a full evening and are worth writing down. They outnumber the dies
 * on this reel, so they make a much brighter lamp - and a much whiter one, and their share of a
 * flare depends on the accent hue, one gate against one die, so a white that reads as an edge on
 * green reads as a flash on blue. Every attempt to spend them a little ended up spending them a
 * lot. There is also less to gain than there looked: the round that chased them was working around
 * a lamp that could not make red, which turned out to be a solder bridge between two gate stubs.
 *
 * What that costs is honest and worth knowing: a hue is one die, so how bright this lamp gets now
 * depends on which one. A green accent has about three times the luminance of a red one and four
 * times a blue one, at the same drive, and nothing here can lift that - the dies already reach
 * full scale on a hit.
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

		// The bed is what the section holds; the hit screens over it and always reaches full scale,
		// so a kick is the same gesture whatever the passage was doing. Sharing one range between
		// them instead is what made a kick's answer depend on how loud the passage already was.
		const peak = Math.max(tint[0], tint[1], tint[2]);
		// A genuinely black room still goes black, so a blackout in the show is a blackout in the
		// corner. Without this the floor would outlive the show it belongs to.
		const bed = lit > 0 ? FLOOR + (1 - FLOOR) * passage * BED : 0;
		const level = bed + (1 - bed) * hit;
		if (peak <= 0 || bed <= 0) {
			this.frame.fill(0);
			quantize(this.frame, out, GAMMA, master);
			return;
		}

		// Normalised by the tint's own strongest channel, uniformly, so the hue arrives exact and
		// the level is the level whatever the hue is: the colour ramp trades peak channel for
		// roughly constant flux around the wheel, which a wall of 720 emitters needs and one lamp
		// only pays for. The root is `quantize`'s gamma, crossed back so asking for `level` of the
		// light does not cost it that exponent a second time.
		const scale = Math.pow(level, 1 / GAMMA) / peak;
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
