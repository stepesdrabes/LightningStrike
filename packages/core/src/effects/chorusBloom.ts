import type { EffectDef } from '../contracts/effect.ts';
import { sectionBase } from '../contracts/frame.ts';
import { SLOT } from '../contracts/palette.ts';
import { setSample } from '../color/palette.ts';
import { clamp, envelope, lerp } from '../dsl/math.ts';
import { Follower } from '../dsl/env.ts';
import { sinewave } from '../dsl/wave.ts';
import { ringU } from '../dsl/space.ts';
import { bandBetween, spectralTilt } from '../dsl/spectrum.ts';
import { INTENSITY } from './helpers.ts';

export const chorusBloom: EffectDef = {
	id: 'chorusBloom',
	name: 'Chorus Bloom',
	role: 'bed',
	blurb: 'Two broad petals gently turn and open through the chorus, with the music flowing inside.',
	taste: {
		energy: 3,
		sections: ['intro', 'groove', 'breakdown', 'build', 'void', 'drop', 'outro'],
		minBars: 2,
		maxBars: 32,
		peakReserved: false,
		activity: 0.1,
		quiet: 5.30
	},
	params: [INTENSITY],
	create(g) {
		// Follower times are in beats; geometry settles more slowly than local articulation.
		const lean = new Follower(1, 2);
		const voices = Array.from({ length: 4 }, () => new Follower(0.16, 0.65));
		const held = new Float32Array(4);
		let bloom = Number.NaN;
		let phase = 0;
		return {
			reset() {
				bloom = Number.NaN;
				phase = 0;
				lean.reset();
				for (const v of voices) v.reset();
				held.fill(0);
			},
			render(out, ctx) {
				const { f, p, palette, hueShift, motion } = ctx;
				const beats = f.dt / Math.max(0.15, f.beatPeriod);
				phase += beats * motion / 32;
				let target = clamp(0.18 + f.energy * 0.5);
				const chorus = sectionBase(f.section) === 'drop';
				if (chorus) {
					const phrases = Math.floor(f.timeSinceDrop / Math.max(0.1, f.beatPeriod * 32));
					const lift = Number.isFinite(phrases) ? Math.min(0.12, phrases * 0.06) : 0;
					target = clamp(0.48 + f.sectionProgress * 0.2 + lift);
				}
				bloom = Number.isNaN(bloom) ? target : envelope(bloom, target, beats, 1.5, 3);
				const tilt = lean.update(spectralTilt(f), beats);
				for (let k = 0; k < held.length; k++) {
					held[k] = voices[k].update(bandBetween(f, k / 4, (k + 1) / 4), beats);
				}
				// Chorus strikes need contrast above the carrying bed; quiet cues keep their fill.
				const gain = (0.52 + p.intensity * 0.76) * (0.76 + bloom * 0.24) * (chorus ? 0.82 : 1);
				for (let i = 0; i < g.count; i++) {
					const u = ringU(g, i);
					// Integer lobe count closes the ring. Opening changes width, never position.
					const petal = Math.pow(sinewave(u * 2 - phase + (tilt - 0.5) * 0.12), 1.8 - bloom);
					const fold = clamp(u < 0.5 ? u * 2 : (1 - u) * 2) * (held.length - 1);
					const k = Math.min(held.length - 2, Math.floor(fold));
					const voice = lerp(held[k], held[k + 1], fold - k);
					const slot = lerp(SLOT.base, SLOT.glow, 0.15 + petal * 0.65);
					const relief = 1 + (voice - 0.35) * 0.55;
					setSample(out, i, palette, slot + hueShift, gain * (0.62 + petal * 0.38) * relief);
				}
			}
		};
	}
};
