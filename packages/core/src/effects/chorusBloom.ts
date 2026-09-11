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

/** Each eight-bar drop phrase lifts the bloom; outside drops it follows passage energy. */
/**
 * Keep relief shallower than spectrumBed because it multiplies spatial petal lobes.
 * Stronger cuts leave the dimmest wall too dark to carry the room.
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
		// Smooth each band's colour over about a beat, slower than brightness, to avoid
		// note-rate hue changes.
		const tones = Array.from({ length: 6 }, () => new Follower(0.1, 0.5));
		const tone = new Float32Array(6);
		let bloom = 0;
		// Smooth the kick/snare sum so simultaneous hits do not double the petal opening.
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

				// Use track-normalized energy outside drops so full-band outros differ from
				// sparse intros.
				let target = clamp(0.12 + f.energy * 0.5);
				if (sectionBase(f.section) === 'drop') {
					const phrases = Math.floor(f.timeSinceDrop / Math.max(0.1, f.beatPeriod * 32));
					const lift = Math.min(0.2, Number.isFinite(phrases) ? phrases * 0.1 : 0.2);
					target = clamp(0.4 + f.sectionProgress * 0.25 + lift, 0, 0.8);
				}
				bloom = envelope(bloom, target, f.dt, 0.6, 1.4);

				// Drums open petal geometry rather than adding a separate brightness pulse.
				const punch = kit.update(clamp(f.kickEnv * 0.8 + f.snareEnv * 0.5), f.dt);
				const open = clamp(bloom + punch * 0.3);

				// Cap phrase gains below white so hits retain headroom.
				const gain = (0.5 + p.intensity * 1.0) * (0.55 + bloom * 0.45) * (1 + punch * 0.15);

				// Follow each petal's spectrum slice continuously for between-beat arrangement
				// detail.
				const tilt = lean.update(spectralTilt(f), f.dt);
				let sum = 0;
				for (let k = 0; k < held.length; k++) {
					const band = bandAt(f, k / (held.length - 1));
					held[k] = voices[k].update(band, f.dt);
					tone[k] = tones[k].update(band, f.dt);
					sum += tone[k];
				}
				const mean = sum / tone.length;

				// Whole-flower warmth is only a small floor; each petal supplies its own
				// colour.
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

					// Slow per-petal band levels choose palette reach, preserving multiple
					// simultaneous colours.
					// The continuous slot ramp passes through glow and white on its way to
					// third.
					const climb = clamp(warmth * 0.45 + hue * 0.9 - 0.08);
					// Reserve accent for a band dominant against the six-band mean, not every
					// loud peak.
					const lead = clamp((hue - mean) * 2.6) * clamp(hue * 1.5);
					const slot = lerp(lerp(SLOT.base, SLOT.third, climb), SLOT.accent, lead * 0.35);
					// Shallow relief from the same followed band, so the room shows which part of
					// it the arrangement is in rather than one even wash.
					setSample(buf, i, palette, slot + hueShift, gain * petal * (1 + RELIEF * (voice - 0.5)));
				}

				// Shorten output smoothing during hits so kit edges survive; settle gently
				// between them.
				nblend(out, buf, alphaFor(f.dt, lerp(0.09, 0.025, punch)));
			}
		};
	}
};
