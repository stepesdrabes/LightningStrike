import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { setSample } from '../color/palette.ts';
import { clamp, lerp, smoothstep } from '../dsl/math.ts';
import { Follower } from '../dsl/env.ts';
import { ringU } from '../dsl/space.ts';
import { spectralTilt } from '../dsl/spectrum.ts';
import { INTENSITY, param } from './helpers.ts';

/** Phrase- and bar-length swells fill kit-free passages; the fastest gesture lasts a beat. */
export const phraseArc: EffectDef = {
	id: 'phraseArc',
	name: 'Phrase Arc',
	role: 'bed',
	blurb: 'A slow swell that completes on the phrase, with a smaller lift each bar.',
	taste: {
		energy: 1,
		sections: ['intro', 'groove', 'breakdown', 'build', 'void', 'drop', 'outro'],
		minBars: 2,
		maxBars: 64,
		peakReserved: false,
		activity: 0,
		quiet: 4.55
	},
	params: [INTENSITY, param('bars', 'Bar lift', 0.45), param('sweep', 'How far it travels', 0.6)],
	create(g) {
		// Smooth passage level and spectral tilt so the field opens continuously.
		const level = new Follower(0.1, 0.7);
		const lean = new Follower(0.12, 0.45);
		return {
			reset() {
				level.reset();
				lean.reset();
			},
			render(out, ctx) {
				const { f, p, palette, hueShift, motion } = ctx;

				// Ease both sides so phrase resets do not become abrupt ramps.
				const arc = smoothstep(0, 0.55, f.phrasePhase) * (1 - smoothstep(0.75, 1, f.phrasePhase));
				const barLift = smoothstep(0, 0.3, f.barPhase) * (1 - smoothstep(0.5, 1, f.barPhase));
				const swell = clamp(0.45 + arc * 0.5 + barLift * p.bars * 0.35);
				const heard = level.update(f.energy, f.dt);
				const gain = (0.42 + p.intensity * 0.6) * clamp(0.45 + heard * 0.55);
				// Move by whole lobe periods so phrasePhase wrapping cannot teleport the field.
				const travel = f.phrasePhase * Math.round(p.sweep * 4 * motion) * 0.5;
				const tilt = lean.update(spectralTilt(f), f.dt);
				// Keep temporal spectral tint in the nearly constant-flux base..glow span.
				const top = lerp(SLOT.base, SLOT.glow, clamp(tilt));

				for (let i = 0; i < g.count; i++) {
					const u = ringU(g, i) + travel;
					// Keep both lobes shallow enough to illuminate the whole room.
					const wave = Math.cos((u * 2 - tilt) * Math.PI * 2);
					const lobe = 0.79 + 0.21 * wave;
					const v = clamp(swell * lobe);
					// Use base and third by spatial position; broad palette crossings must not
					// follow fast
					// spectral changes in time.
					const near = lerp(SLOT.base, top, v * 0.9);
					const slot = lerp(near, SLOT.third, clamp(0.5 - wave * 0.5) * (0.6 + tilt * 0.4));
					setSample(out, i, palette, slot + hueShift, (0.38 + v * 0.62) * gain);
				}
			}
		};
	}
};
