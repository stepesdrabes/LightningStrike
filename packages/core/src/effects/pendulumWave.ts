import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { setSample } from '../color/palette.ts';
import { clamp, frac, lerp } from '../dsl/math.ts';
import { Follower } from '../dsl/env.ts';
import { bandAt } from '../dsl/spectrum.ts';
import { INTENSITY, param } from './helpers.ts';

/** Middle of the front wall in the counter-clockwise frame, where the slowest lamp hangs. */
const FRONT_THETA = 0.75;
/** Oscillations per phrase of the slowest lamp: a two-beat swing in 4/4. */
const SLOWEST = 16;
const MAX_LAMPS = 16;
/** Lamp width in lamp spacings; narrow enough that dark separates neighbours. */
const LAMP_SIGMA = 0.3;
/** Beats over which a section seam that restarts the phrase grid mid-swing is crossfaded. */
const SEAM_BEATS = 0.5;

/**
 * Lamp j completes SLOWEST + j swings per phrase, so neighbours drift apart by one swing a
 * phrase: travelling waves, then alternation, then unison on the next phrase downbeat. Phase
 * comes from the phrase grid, so motion sets the swing's depth rather than its speed.
 */
export const pendulumWave: EffectDef = {
	id: 'pendulumWave',
	name: 'Pendulum Wave',
	role: 'rhythm',
	blurb: 'Lamps from front to back swing at slowly diverging rates, weaving waves that fall back into unison on every phrase.',
	taste: {
		energy: 2,
		sections: ['intro', 'groove', 'breakdown', 'outro'],
		minBars: 4,
		maxBars: 64,
		peakReserved: false,
		activity: 0.2,
		noteReactive: true,
		carries: false
	},
	params: [INTENSITY, param('lamps', 'Lamps front to back', 12, 6, MAX_LAMPS, 1)],
	create(g) {
		let front = 0;
		let best = Infinity;
		for (let i = 0; i < g.count; i++) {
			if (g.perim[i] < 0) continue;
			const d = Math.abs(frac(g.theta[i] - FRONT_THETA + 0.5) - 0.5);
			if (d < best) {
				best = d;
				front = g.perim[i];
			}
		}
		// Front-to-back position, mirrored on both sides of the ring; the beam spans the same run.
		const along = new Float32Array(g.count);
		for (let i = 0; i < g.count; i++) {
			if (g.perim[i] < 0) {
				along[i] = g.local[i];
				continue;
			}
			let d = Math.abs(g.perim[i] - front);
			if (d > 0.5) d = 1 - d;
			along[i] = d * 2;
		}
		const value = new Float32Array(MAX_LAMPS);
		const slot = new Float32Array(MAX_LAMPS);
		const held = new Float32Array(MAX_LAMPS);
		const heldSlot = new Float32Array(MAX_LAMPS);
		const heard = Array.from({ length: MAX_LAMPS }, () => new Follower(0.04, 0.3));
		const settled = Array.from({ length: MAX_LAMPS }, () => new Follower(0.8, 1.6));
		const passage = new Follower(0.09, 0.65);
		let lastPhase = Number.NaN;
		let seam = 0;

		return {
			reset() {
				for (const h of heard) h.reset();
				for (const s of settled) s.reset();
				passage.reset();
				value.fill(0);
				slot.fill(0);
				held.fill(0);
				heldSlot.fill(0);
				lastPhase = Number.NaN;
				seam = 0;
			},
			render(out, ctx) {
				const { f, p, palette, hueShift, motion } = ctx;
				const lamps = Math.max(2, Math.min(MAX_LAMPS, Math.round(p.lamps)));
				const step = f.phrasePhase - lastPhase;
				// A restarted grid, not the phrase wrapping, which lands every lamp in unison anyway.
				if ((step < -0.02 && step > -0.97) || step > 0.02) {
					held.set(value);
					heldSlot.set(slot);
					seam = 1;
				}
				lastPhase = f.phrasePhase;

				const level = passage.update(f.energy, f.dt);
				const gain = (0.16 + p.intensity * 0.42) * clamp(0.35 + level * 0.85);
				const depth = clamp(motion);
				seam = Math.max(0, seam - f.dt / Math.max(0.05, SEAM_BEATS * f.beatPeriod));

				for (let j = 0; j < lamps; j++) {
					const swing = 0.5 + 0.5 * Math.cos(2 * Math.PI * (SLOWEST + j) * f.phrasePhase);
					const shaped = Math.pow(swing, 1.5);
					// Front lamps listen low, back lamps high; a note brightens its own lamps.
					const band = bandAt(f, 0.08 + (0.8 * j) / (lamps - 1));
					const now = heard[j].update(band, f.dt);
					const rise = clamp((now - settled[j].update(band, f.dt)) * 4);
					const voice = 0.72 + 0.28 * now + 0.45 * rise;
					value[j] = lerp(gain * voice * (0.5 * (1 - depth) + depth * shaped), held[j], seam);
					slot[j] = lerp(lerp(SLOT.base, SLOT.glow, 0.15 + 0.6 * shaped), heldSlot[j], seam);
				}

				const inv = 1 / (2 * LAMP_SIGMA * LAMP_SIGMA);
				for (let i = 0; i < g.count; i++) {
					const x = along[i] * (lamps - 1);
					const a = Math.min(lamps - 2, Math.floor(x));
					const da = x - a;
					const db = 1 - da;
					const wa = Math.exp(-da * da * inv);
					const wb = Math.exp(-db * db * inv);
					const v = wa * value[a] + wb * value[a + 1];
					const s = (wa * slot[a] + wb * slot[a + 1]) / Math.max(1e-6, wa + wb);
					setSample(out, i, palette, s + hueShift, v);
				}
			}
		};
	}
};
