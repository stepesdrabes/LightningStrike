import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { setSample } from '../color/palette.ts';
import { alphaFor, clamp, lerp } from '../dsl/math.ts';
import { sinewave } from '../dsl/wave.ts';
import { ringU } from '../dsl/space.ts';
import { bandAt, spectralTilt, spectrumFocus } from '../dsl/spectrum.ts';
import { BeatHold } from '../dsl/env.ts';
import { INTENSITY, param } from './helpers.ts';

/**
 * Deliberately dull, on a 30-60 s period: silence should look like the room resting, not like
 * the analyser chewing on the noise floor.
 *
 * Deaf to level, and not deaf to the music. `listen` puts the spectrum on where the gradient sits
 * and how far up the palette it reaches, and lays the bands themselves across the room as a
 * shallow relief, which is what an intro under a lone pad needs: nothing here answers a hit, but
 * the room shows what is playing rather than holding one frame for a minute. Set it to zero for
 * the old idle wash.
 *
 * The relief is why the two aggregate readings above are not enough on their own. In a sparse
 * intro most bands are silent - measured on one, 59% of the spectrum sat under 0.02 - so a tilt
 * and a focus computed across all of them barely move, while the handful of bands actually
 * carrying the passage vary plenty. Reading them where they are is the difference between a room
 * that looks asleep and one that looks quiet.
 */
export const ambientDrift: EffectDef = {
	id: 'ambientDrift',
	name: 'Ambient Drift',
	role: 'bed',
	blurb: 'Calm idle wash. Very slow, very dim, shaped by whatever little is playing.',
	taste: {
		energy: 1,
		sections: ['intro', 'groove', 'breakdown', 'build', 'void', 'drop', 'outro'],
		minBars: 2,
		maxBars: 64,
		peakReserved: false,
		quiet: 2.89
	},
	params: [INTENSITY, param('period', 'Period', 0.5), param('listen', 'How much it hears', 0.45)],
	create(g) {
		const lean = new BeatHold(0.4);
		const spread = new BeatHold(0.4);
		// One latch per pixel would be 720 of them for a value that only moves on the beat, so the
		// ring is read at a handful of points and interpolated between them.
		const TAPS = 10;
		const taps = Array.from({ length: TAPS }, () => new BeatHold(0.3));
		const held = new Float32Array(TAPS);
		let phase = 0;
		let heard = 0;
		let reach = 0;
		return {
			reset() {
				phase = 0;
				heard = 0;
				reach = 0;
				lean.reset();
				spread.reset();
				for (const t of taps) t.reset();
				held.fill(0);
			},
			render(out, ctx) {
				const { f, p, palette, hueShift, motion } = ctx;
				phase += (f.dt / (30 + p.period * 30)) * motion;
				const gain = 0.32 + p.intensity * 0.5;

				// Latched on the beat, then eased over a couple of bars on top. Where the music
				// sits and how narrow it is are questions about the passage rather than about the
				// moment, and a drift that twitches has stopped being a drift.
				const ease = alphaFor(f.dt, Math.max(0.5, f.beatPeriod * 8));
				heard += (lean.update(spectralTilt(f), f.beat, f.dt, f.beatPeriod) - heard) * ease;
				reach += (spread.update(spectrumFocus(f), f.beat, f.dt, f.beatPeriod) - reach) * ease;
				const listen = clamp(p.listen);

				// The gradient walks round the room as the arrangement climbs and stretches as it
				// narrows onto one voice. Colour and position only: the level here is the cue's
				// business, and a bed that follows the noise floor's level flickers at it.
				const slide = phase + (heard - 0.5) * listen * 0.9;
				const stretch = 0.7 + reach * listen * 0.5;
				// Kept inside the base hue. A walk between two of the show's hues spends most of
				// its time on a colour the show never declared.
				// A spectral term may only walk the slot inside base..glow. That span is safe because it
				// is a SATURATION move at constant flux (measured x1.03 over 24 hues); crossing to
				// white is x2.66, a spectrum driving BRIGHTNESS through the palette, which is the
				// blinking the mixer already had to be rescued from once.
				const top = lerp(SLOT.base, SLOT.glow, clamp(reach * listen));

				for (let k = 0; k < TAPS; k++) {
					held[k] = taps[k].update(bandAt(f, k / (TAPS - 1)), f.beat, f.dt, f.beatPeriod);
				}
				// Shallow, and centred on unity so it shapes the wash rather than dimming it. The
				// latch is what makes a band safe on a level at all: the shimmer this project was
				// rescued from came from reading the spectrum per FRAME, and a value that steps on
				// the beat and glides between beats cannot produce it.
				const depth = 0.8 * listen;

				for (let i = 0; i < g.count; i++) {
					const u = ringU(g, i);
					const v = 0.35 + 0.65 * sinewave(u * stretch + slide);
					// Mirrored, so both halves of the room read low to high and the bass sits at the
					// front wall wherever the strip happens to start.
					const fold = (u < 0.5 ? u * 2 : (1 - u) * 2) * (TAPS - 1);
					const k = Math.min(TAPS - 2, Math.floor(fold));
					const band = held[k] + (held[k + 1] - held[k]) * (fold - k);
					const slot = lerp(SLOT.deep, top, v);
					const level = v * gain * (1 + depth * (band - 0.5));
					setSample(out, i, palette, slot + sinewave(phase * 0.3) * 0.06 + hueShift, level);
				}
			}
		};
	}
};
