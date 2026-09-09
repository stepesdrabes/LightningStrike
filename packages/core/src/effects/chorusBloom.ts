import type { EffectDef } from '../contracts/effect.ts';
import { sectionBase } from '../contracts/frame.ts';
import { SLOT } from '../contracts/palette.ts';
import { setSample } from '../color/palette.ts';
import { alphaFor, clamp, envelope, lerp } from '../dsl/math.ts';
import { Follower } from '../dsl/env.ts';
import { nblend } from '../dsl/buffer.ts';
import { sinewave } from '../dsl/wave.ts';
import { ringU } from '../dsl/space.ts';
import { bandAt, spectralTilt } from '../dsl/spectrum.ts';
import { INTENSITY } from './helpers.ts';

/**
 * Outside a chorus this rests as a dim base wash, which is what earns the bloom: every
 * 8-bar phrase inside the drop lifts the floor another step, the "one more gear" feeling.
 */
/**
 * How deep the latched band cuts into the level. See `spectrumBed`'s RELIEF for the sweep.
 *
 * Shallower than `spectrumBed`'s 1.4 because this bed already varies in space: the relief
 * multiplies the petal lobes rather than a flat field, so the two compound. At 1.1 the gate's own
 * carries test refused it - dimmest wall 23% of the brightest against a 35% bar - which is the
 * test doing its job rather than a number to argue with.
 */
const RELIEF = 0.9;

export const chorusBloom: EffectDef = {
	id: 'chorusBloom',
	name: 'Chorus Bloom',
	role: 'bed',
	blurb: 'The bed blooms brighter through the chorus, lifting a step every phrase.',
	taste: {
		energy: 3,
		sections: ['intro', 'groove', 'breakdown', 'build', 'void', 'drop', 'outro'],
		minBars: 2,
		maxBars: 32,
		peakReserved: false,
		activity: 0.05,
		quiet: 2.08
	},
	params: [INTENSITY],
	create(g) {
		const buf = new Float32Array(g.count * 3);
		// Slow, because the tilt decides which way the whole flower leans and that should settle
		// rather than chase.
		const lean = new Follower(0.12, 0.4);
		const voices = Array.from({ length: 6 }, () => new Follower(0.025, 0.16));
		const held = new Float32Array(6);
		// A second, slower read of the same six bands, for colour only.
		//
		// Brightness may snap; hue may not. A palette position driven at the speed of the level
		// makes the room change colour on every note, which reads as a fault rather than as the
		// arrangement - and it is the one kind of movement the eye cannot ignore. Roughly a beat
		// to travel, so a petal changes colour when its part of the mix changes and not when it
		// merely plays.
		const tones = Array.from({ length: 6 }, () => new Follower(0.1, 0.5));
		const tone = new Float32Array(6);
		let bloom = 0;
		// The kit, held just long enough to read. `f.kickEnv` is already attack-hold-release, so
		// this only smooths the sum of the two so a kick and a snare on the same beat do not
		// double the petal open.
		const kit = new Follower(0.012, 0.11);

		return {
			reset() {
				bloom = 0;
				buf.fill(0);
				kit.reset();
				lean.reset();
				for (const v of voices) v.reset();
				for (const t of tones) t.reset();
				tone.fill(0);
				held.fill(0);
			},
			render(out, ctx) {
				const { f, p, palette, hueShift } = ctx;

				// Outside a drop the flower opens as far as the passage earns, rather than to a
				// constant. This was pinned at 0.2 everywhere but a drop, which made an outro that
				// is still the whole band playing look identical to an intro with one guitar in it:
				// the gain, the petal geometry and the colour are all downstream of this, so a
				// fixed value here is a fixed picture. `f.energy` is normalised across the track,
				// so it answers "how loud is this for this song" and a genuinely quiet passage
				// still rests.
				let target = clamp(0.12 + f.energy * 0.5);
				if (sectionBase(f.section) === 'drop') {
					const phrases = Math.floor(f.timeSinceDrop / Math.max(0.1, f.beatPeriod * 32));
					const lift = Math.min(0.2, Number.isFinite(phrases) ? phrases * 0.1 : 0.2);
					target = clamp(0.4 + f.sectionProgress * 0.25 + lift, 0, 0.8);
				}
				bloom = envelope(bloom, target, f.dt, 0.6, 1.4);

				// The kit opens the petals on top of that. A bloom is a thing that opens, so the
				// drums belong in how far open it is rather than bolted onto its brightness: the
				// room breathes with the beat instead of pumping with it.
				const punch = kit.update(clamp(f.kickEnv * 0.8 + f.snareEnv * 0.5), f.dt);
				const open = clamp(bloom + punch * 0.3);

				// The climb is capped well under white: over a real 32-bar chorus the old gain
				// reached 2.0 by the last phrase, which made this the brightest bed in every
				// stack it joined and left the room nowhere to go on the hits.
				const gain = (0.5 + p.intensity * 1.0) * (0.55 + bloom * 0.45) * (1 + punch * 0.15);

				// Which petal is open is the arrangement's business, not a fixed pattern's. Each
				// voice follows its own slice of the spectrum at the rate that slice actually
				// moves; latching them on the beat made this the same still picture in every
				// breakdown it was chosen for, which is most of them.
				const tilt = lean.update(spectralTilt(f), f.dt);
				let sum = 0;
				for (let k = 0; k < held.length; k++) {
					const band = bandAt(f, k / (held.length - 1));
					held[k] = voices[k].update(band, f.dt);
					tone[k] = tones[k].update(band, f.dt);
					sum += tone[k];
				}
				const mean = sum / tone.length;

				// How warm the whole flower is, and deliberately a small term.
				//
				// Colour used to be computed here for the entire room, from the bloom and the
				// centroid, so every petal sat on the same palette position and the only thing
				// that ever changed was which one. That is a flower painted one colour. It stays
				// as a floor - the room does warm as the bloom opens - and the petals decide the
				// rest for themselves below.
				const warmth = clamp(open * 0.3 + tilt * 0.35);

				for (let i = 0; i < g.count; i++) {
					const u = ringU(g, i);
					// Petal lobes that widen as the bloom opens, and lean toward whichever part of
					// the spectrum is carrying: the lobes ride up the room as a filter opens.
					const petal =
						0.7 + 0.3 * sinewave(u * (5 - open * 2) + open * 0.5 + tilt * 0.6);
					const fold = clamp(u < 0.5 ? u * 2 : (1 - u) * 2) * (held.length - 1);
					const k = Math.min(held.length - 2, Math.floor(fold));
					const voice = held[k] + (held[k + 1] - held[k]) * (fold - k);
					const hue = tone[k] + (tone[k + 1] - tone[k]) * (fold - k);

					// Each petal takes its palette position from how loud ITS OWN part of the mix
					// is, so the room carries as many colours at once as the arrangement has parts
					// and the quiet ones stay near the show's home hue. The rule is loudness rather
					// than which slice a petal happens to hold, which is what keeps this a flower
					// rather than a second spectrum analyser laid over the room.
					//
					// The slots are one ramp - deep, base, glow, white, third, accent - so a petal
					// climbing from base to third travels through the room's bright read and its
					// highlight on the way rather than jumping between two hues.
					const climb = clamp(warmth * 0.45 + hue * 0.9 - 0.08);
					// And the accent, only where one band is genuinely running away with the
					// passage - measured against the mean of the six rather than its own scale, so
					// a loud passage where everything is loud never reaches for it and a lone hook
					// over a thin mix does. Spending it on every peak instead would put the
					// strongest colour in the palette under the whole arrangement, which is the one
					// thing it must not be.
					const lead = clamp((hue - mean) * 2.6) * clamp(hue * 1.5);
					const slot = lerp(lerp(SLOT.base, SLOT.third, climb), SLOT.accent, lead * 0.35);
					// Shallow relief from the same followed band, so the room shows which part of
					// it the arrangement is in rather than one even wash.
					setSample(buf, i, palette, slot + hueShift, gain * petal * (1 + RELIEF * (voice - 0.5)));
				}

				// The blend is what keeps this a field rather than a meter, and at a fixed 90 ms it
				// also flattened every kick back out again on the way to the wire. Shortened while
				// the kit is hitting, so a drum arrives at close to its own edge and the room still
				// settles smoothly between hits.
				nblend(out, buf, alphaFor(f.dt, lerp(0.09, 0.025, punch)));
			}
		};
	}
};
