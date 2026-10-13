import type { EffectDef } from '../contracts/effect.ts';
import { SPECTRUM_BANDS } from '../contracts/frame.ts';
import { SLOT } from '../contracts/palette.ts';
import { sample } from '../color/palette.ts';
import { alphaFor, clamp, frac } from '../dsl/math.ts';
import { stampGaussian } from '../dsl/buffer.ts';
import { Follower } from '../dsl/env.ts';
import { hash01 } from '../dsl/rng.ts';
import { ringsFor, scatter } from '../dsl/space.ts';
import { INTENSITY, param } from './helpers.ts';

const MAX_FLIES = 48;
/** Share of the swarm on the beam; the rest hang round the ring. */
const BEAM_SHARE = 0.16;
/** Neighbours each side a fly watches; local coupling makes sync spread as waves. */
const NEIGHBOURS = 2;
/** Cycles per beat at rest: a flash every two beats once the swarm has locked to the grid. */
const RATE = 0.5;
/** Middle of the front wall in the counter-clockwise frame; low notes light the front. */
const FRONT_THETA = 0.75;
/** Registers the spectrum is split into, front to back. */
const REGISTERS = 5;
/** Rise in a register, above its own recent level, that counts as a new note. */
const ONSET = 0.05;
/** Phase at which a fly starts glowing up to its flash. */
const GLOW = 0.93;

/**
 * Kuramoto fireflies: each blinks at its own rate and nudges its phase toward its neighbours'
 * and toward the beat grid. Coupling builds through the phrase, so a scattered twinkle draws
 * into waves and then into one flash on the beat; every phrase scatters them again. A note
 * makes the resting flies in its register flash at once, and the swarm folds them back in.
 */
export const fireflies: EffectDef = {
	id: 'fireflies',
	name: 'Fireflies',
	role: 'rhythm',
	blurb: 'Fireflies blink out of step, answer the notes where they sit, and pull each other into one flash on the beat by the phrase end.',
	taste: {
		energy: 2,
		sections: ['intro', 'groove', 'breakdown', 'outro'],
		minBars: 4,
		maxBars: 64,
		peakReserved: false,
		activity: 0.35,
		noteReactive: true,
		carries: false
	},
	params: [
		INTENSITY,
		param('flies', 'Fireflies', 36, 12, MAX_FLIES, 1),
		param('pull', 'How fast they sync', 0.5)
	],
	create(g) {
		const rings = ringsFor(g);
		const ring = rings.perimeter;
		const beam = rings.beam;
		const ringBuf = new Float32Array(ring.length * 3);
		const beamBuf = new Float32Array(beam.length * 3);
		const rgb: [number, number, number] = [0, 0, 0];
		let front = 0;
		let best = Infinity;
		for (let k = 0; k < ring.length; k++) {
			const d = Math.abs(frac(g.theta[ring.map[k]] - FRONT_THETA + 0.5) - 0.5);
			if (d < best) {
				best = d;
				front = k;
			}
		}

		const phase = new Float64Array(MAX_FLIES);
		const next = new Float64Array(MAX_FLIES);
		const rate = new Float32Array(MAX_FLIES);
		const place = new Float32Array(MAX_FLIES);
		const register = new Uint8Array(MAX_FLIES);
		const now = new Float32Array(SPECTRUM_BANDS);
		const recent = new Float32Array(SPECTRUM_BANDS);
		const armed = new Uint8Array(REGISTERS);
		const lastNote = new Float64Array(REGISTERS);
		const heard = new Follower(0.3, 1.2);
		let count = 0;
		let onBeam = 0;
		let scatters = 0;
		let started = false;

		const layout = (flies: number) => {
			count = flies;
			onBeam = Math.max(2, Math.round(flies * BEAM_SHARE));
			const around = count - onBeam;
			for (let i = 0; i < count; i++) {
				const beamFly = i >= around;
				const k = beamFly ? i - around : i;
				const slots = beamFly ? onBeam : around;
				// Evenly spaced with jitter, so the swarm never reads as a grid.
				place[i] = (k + 0.5 + (hash01(i * 71 + 3) - 0.5) * 0.7) / slots;
				rate[i] = RATE * (1 + (hash01(i * 37 + 11) - 0.5) * 0.24);
				// Front to back, 0..1, mirrored on both sides of the ring; the beam runs the same way.
				let depth = place[i];
				if (!beamFly) {
					depth = Math.abs(frac((place[i] * ring.length - front) / ring.length + 0.5) - 0.5) * 2;
				}
				register[i] = Math.min(REGISTERS - 1, Math.floor(depth * REGISTERS));
			}
		};

		const scatterPhases = () => {
			for (let i = 0; i < count; i++) phase[i] = hash01(i * 131 + scatters * 7919 + 1);
			scatters++;
		};

		return {
			reset() {
				heard.reset();
				scatters = 0;
				started = false;
				ringBuf.fill(0);
				beamBuf.fill(0);
			},
			render(out, ctx) {
				const { f, p, palette, hueShift, motion } = ctx;
				const flies = Math.max(8, Math.min(MAX_FLIES, Math.round(p.flies)));
				const bands = Math.min(SPECTRUM_BANDS, f.spectrum.length);
				if (!started || flies !== count) {
					started = true;
					layout(flies);
					scatterPhases();
					for (let b = 0; b < bands; b++) {
						now[b] = f.spectrum[b];
						recent[b] = f.spectrum[b];
					}
					armed.fill(1);
					lastNote.fill(-Infinity);
				} else if (f.phraseStart) {
					scatterPhases();
				}

				// Coupling rises through the phrase: free twinkle, then waves, then one flash.
				const pull = (0.02 + 0.16 * p.pull) * (0.1 + 0.9 * clamp(f.phrasePhase * 1.15) ** 2);
				const grid = frac((f.beatIndex + f.beatPhase) * RATE);
				const beats = (f.dt / Math.max(0.05, f.beatPeriod)) * Math.max(0, motion);
				const around = count - onBeam;
				for (let i = 0; i < count; i++) {
					const lo = i < around ? 0 : around;
					const len = i < around ? around : onBeam;
					let tug = 0;
					for (let d = -NEIGHBOURS; d <= NEIGHBOURS; d++) {
						if (d === 0) continue;
						const j = lo + ((((i - lo + d) % len) + len) % len);
						tug += Math.sin(2 * Math.PI * (phase[j] - phase[i]));
					}
					tug /= 2 * NEIGHBOURS;
					const lock = Math.sin(2 * Math.PI * (grid - phase[i]));
					next[i] = phase[i] + (rate[i] + pull * (tug + 0.6 * lock)) * beats;
				}
				for (let i = 0; i < count; i++) phase[i] = frac(next[i]);

				const fast = alphaFor(f.dt, 0.02);
				const slow = alphaFor(f.dt, 0.45);
				for (let b = 0; b < bands; b++) {
					now[b] += (f.spectrum[b] - now[b]) * fast;
					recent[b] += (f.spectrum[b] - recent[b]) * slow;
				}
				for (let r = 0; r < REGISTERS; r++) {
					const lo = Math.round((0.06 + (0.88 * r) / REGISTERS) * (bands - 1));
					const hi = Math.max(lo + 1, Math.round((0.06 + (0.88 * (r + 1)) / REGISTERS) * (bands - 1)));
					let rise = 0;
					for (let b = lo; b < hi; b++) rise += Math.max(0, now[b] - recent[b]);
					rise /= hi - lo;
					if (rise < ONSET * 0.5) armed[r] = 1;
					if (!armed[r] || rise < ONSET || f.t - lastNote[r] < 0.15) continue;
					armed[r] = 0;
					lastNote[r] = f.t;
					// Only resting flies answer; one already glowing keeps its own flash.
					for (let i = 0; i < count; i++) {
						if (register[i] === r && phase[i] >= 0.3 && phase[i] < GLOW) phase[i] = GLOW;
					}
				}

				const level = heard.update(f.level, f.dt);
				const gain = (0.5 + p.intensity * 0.8) * (0.65 + 0.5 * clamp(level * 1.3));
				ringBuf.fill(0);
				beamBuf.fill(0);
				for (let i = 0; i < count; i++) {
					const u = phase[i];
					// A quick glow up to the flash, then a slower fade, both inside a beat.
					const flash = u >= GLOW ? ((u - GLOW) / (1 - GLOW)) ** 2 : u < 0.3 ? (1 - u / 0.3) ** 2 : 0;
					if (flash < 0.01) continue;
					sample(palette, SLOT.glow + hueShift, flash * gain, rgb);
					if (i < around) {
						stampGaussian(ringBuf, ring.length, place[i] * ring.length, 2.4, rgb[0], rgb[1], rgb[2], true);
					} else {
						stampGaussian(beamBuf, beam.length, place[i] * beam.length, 2, rgb[0], rgb[1], rgb[2], false);
					}
				}
				out.fill(0);
				scatter(ring, ringBuf, out);
				scatter(beam, beamBuf, out);
			}
		};
	}
};
