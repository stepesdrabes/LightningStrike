import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { setSample } from '../color/palette.ts';
import { clamp, lerp } from '../dsl/math.ts';
import { Follower } from '../dsl/env.ts';
import { sinewave } from '../dsl/wave.ts';
import { ringU } from '../dsl/space.ts';
import { bandBetween, spectralTilt } from '../dsl/spectrum.ts';
import { INTENSITY, param } from './helpers.ts';

export const ambientDrift: EffectDef = {
	id: 'ambientDrift',
	name: 'Ambient Drift',
	role: 'bed',
	blurb: 'A broad, calm tide with soft local replies to the music, even before the drums arrive.',
	taste: {
		energy: 1,
		sections: ['intro', 'groove', 'breakdown', 'build', 'void', 'drop', 'outro'],
		minBars: 2,
		maxBars: 64,
		peakReserved: false,
		activity: 0.05,
		quiet: 5.39
	},
	params: [INTENSITY, param('period', 'Period', 0.5), param('listen', 'How much it hears', 0.45)],
	create(g) {
		const lean = new Follower(0.8, 1.6);
		const taps = Array.from({ length: 6 }, () => new Follower(0.09, 0.5));
		const held = new Float32Array(6);
		let phase = 0;
		return {
			reset() {
				phase = 0;
				lean.reset();
				for (const t of taps) t.reset();
				held.fill(0);
			},
			render(out, ctx) {
				const { f, p, palette, hueShift, motion } = ctx;
				const beats = f.dt / Math.max(0.15, f.beatPeriod);
				phase += beats * motion / (12 + p.period * 24);
				const tilt = lean.update(spectralTilt(f), beats);
				const listen = clamp(p.listen);
				for (let k = 0; k < held.length; k++) {
					held[k] = taps[k].update(bandBetween(f, k / held.length, (k + 1) / held.length), beats);
				}
				const gain = 0.42 + p.intensity * 0.62;
				for (let i = 0; i < g.count; i++) {
					const u = ringU(g, i);
					const tide = sinewave(u - phase + (tilt - 0.5) * listen * 0.18);
					const fold = clamp(u < 0.5 ? u * 2 : (1 - u) * 2) * (held.length - 1);
					const k = Math.min(held.length - 2, Math.floor(fold));
					const voice = lerp(held[k], held[k + 1], fold - k);
					const slot = lerp(SLOT.base, SLOT.glow, tide * 0.7);
					const relief = 1 + (voice - 0.3) * listen * 1.6;
					setSample(out, i, palette, slot + hueShift, gain * (0.55 + tide * 0.45) * relief);
				}
			}
		};
	}
};
