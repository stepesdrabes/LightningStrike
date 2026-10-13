import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { setSample } from '../color/palette.ts';
import { alphaFor, clamp, lerp } from '../dsl/math.ts';
import { Follower, Presence } from '../dsl/env.ts';
import { hash01 } from '../dsl/rng.ts';
import { noise3 } from '../dsl/wave.ts';
import { ringsFor } from '../dsl/space.ts';
import { INTENSITY, param } from './helpers.ts';

const MAX_BIRDS = 64;
/** Flock path samples kept for the lagging birds; covers two seconds at 120 fps. */
const HISTORY = 256;
/** Pixels. A bird is a soft point, never a hot one. */
const BIRD_SIGMA = 1.6;

/**
 * The flock follows one path; each bird replays it a little late, the lag growing with its
 * distance from where the current turn began. A reversal therefore starts at one point and
 * travels through the flock as a compression wave, the signature of a real murmuration.
 * A snare is a falcon strike: the birds near it scatter on a damped spring and close back.
 */
export const murmuration: EffectDef = {
	id: 'murmuration',
	name: 'Murmuration',
	role: 'accent',
	blurb: 'A flock of points wheels around the room, turning in waves that ripple through it and scattering when the snare strikes.',
	taste: {
		energy: 2,
		sections: ['intro', 'groove', 'breakdown', 'build', 'drop', 'outro'],
		minBars: 4,
		maxBars: 64,
		peakReserved: false,
		activity: 0.3,
		carries: false
	},
	params: [INTENSITY, param('birds', 'Birds', 44, 16, MAX_BIRDS, 1), param('pace', 'Pace', 0.5)],
	create(g) {
		const rings = ringsFor(g);
		const ring = rings.perimeter;
		const beam = rings.beam;
		const n = ring.length;
		const density = new Float32Array(n);
		const beamGlow = new Float32Array(beam.length);
		const ringY = new Float32Array(n);
		for (let k = 0; k < n; k++) ringY[k] = g.ny[ring.map[k]];
		let yLo = Infinity;
		let yHi = -Infinity;
		for (let k = 0; k < beam.length; k++) {
			yLo = Math.min(yLo, g.ny[beam.map[k]]);
			yHi = Math.max(yHi, g.ny[beam.map[k]]);
		}

		const rank = new Float32Array(MAX_BIRDS);
		const seed = new Float32Array(MAX_BIRDS);
		for (let k = 0; k < MAX_BIRDS; k++) {
			// Evenly spread through the flock with a little jitter, so spacing is never a grid.
			rank[k] = ((k + 0.5) / MAX_BIRDS) * 2 - 1 + (hash01(k * 41 + 7) - 0.5) * 0.04;
			seed[k] = hash01(k * 113 + 29) * 50;
		}
		const lag = new Float32Array(MAX_BIRDS);
		const shove = new Float32Array(MAX_BIRDS);
		const shoveV = new Float32Array(MAX_BIRDS);
		const pathT = new Float64Array(HISTORY);
		const pathX = new Float64Array(HISTORY);
		const passage = new Follower(0.6, 1.5);
		const snares = new Presence();

		let head = 0;
		let filled = 0;
		let x = 0;
		let v = 0;
		let heading = 1;
		let origin = 0;
		let clock = 0;
		let lastTurnBar = -1;
		let lastStrike = -Infinity;
		let strikes = 0;

		const at = (t: number): number => {
			// Newest first; the lag is short, so the walk back is a few dozen samples at most.
			let i = head;
			for (let k = 0; k < filled - 1; k++) {
				const j = (i - 1 + HISTORY) % HISTORY;
				if (pathT[j] <= t) {
					const span = pathT[i] - pathT[j];
					const u = span > 1e-9 ? (t - pathT[j]) / span : 1;
					return pathX[j] + (pathX[i] - pathX[j]) * clamp(u);
				}
				i = j;
			}
			return pathX[i];
		};

		return {
			reset() {
				head = 0;
				filled = 0;
				x = 0;
				v = 0;
				heading = 1;
				origin = 0;
				clock = 0;
				lastTurnBar = -1;
				lastStrike = -Infinity;
				strikes = 0;
				lag.fill(0);
				shove.fill(0);
				shoveV.fill(0);
				passage.reset();
				snares.reset();
			},
			render(out, ctx) {
				const { f, p, palette, hueShift, motion } = ctx;
				const birds = Math.max(4, Math.min(MAX_BIRDS, Math.round(p.birds)));
				const beat = Math.max(0.15, f.beatPeriod);
				const level = passage.update(f.energy, f.dt);
				const playing = snares.update(f.snareEnv, f.dt, f.beatPeriod);

				if (filled === 0) {
					x = n * 0.6;
					pathT[0] = f.t;
					pathX[0] = x;
					filled = 1;
				}

				// A phrase always turns the flock; some bars turn it too, picked by bar number so a
				// seek lands on the same choreography.
				const turnHere = f.downbeat && f.barIndex !== lastTurnBar &&
					(f.phraseStart || hash01(f.barIndex * 2654435761) < 0.3);
				if (turnHere) {
					lastTurnBar = f.barIndex;
					heading = -heading;
					origin = (hash01(f.barIndex * 97 + 13) * 2 - 1) * 0.8;
				}
				const cruise = (n * (0.035 + 0.05 * p.pace) * (0.75 + 0.5 * level) * Math.max(0, motion)) / beat;
				v += (heading * cruise - v) * alphaFor(f.dt, beat * 0.45);
				x += v * f.dt;
				clock += f.dt * Math.max(0, motion);
				head = (head + 1) % HISTORY;
				pathT[head] = f.t;
				pathX[head] = x;
				filled = Math.min(HISTORY, filled + 1);

				const spread = n * 0.1;
				const maxLag = beat * 0.7;
				const settle = alphaFor(f.dt, beat * 0.5);
				const omega = (2 * Math.PI) / (beat * 1.2);

				// A falcon strike inside the flock, at most once a beat, only while a snare plays.
				let strikeAt = Number.NaN;
				if (f.snare && playing > 0.15 && f.t - lastStrike > beat) {
					lastStrike = f.t;
					strikeAt = (hash01(strikes++ * 31 + 5) * 2 - 1) * 0.7;
				}

				density.fill(0);
				const inv = 1 / (2 * BIRD_SIGMA * BIRD_SIGMA);
				const reach = Math.ceil(BIRD_SIGMA * 3);
				let sumY = 0;
				for (let k = 0; k < birds; k++) {
					const r = rank[Math.floor(((k + 0.5) * MAX_BIRDS) / birds)];
					lag[k] += (maxLag * Math.min(1, Math.abs(r - origin)) - lag[k]) * settle;
					if (!Number.isNaN(strikeAt)) {
						const d = r - strikeAt;
						const near = Math.exp(-(d * d) / 0.08);
						shoveV[k] += Math.sign(d || 1) * near * spread * 1.6 * omega * clamp(0.4 + f.snareEnv);
					}
					// Critically damped: the scattered birds return without ringing.
					shoveV[k] += (-omega * omega * shove[k] - 2 * omega * shoveV[k]) * f.dt;
					shove[k] += shoveV[k] * f.dt;
					const wander = (noise3(seed[k], clock * 0.35, 3.1) - 0.5) * 16;
					// A slow agitation wave travels through the ranks, bunching and thinning them.
					const agitation = Math.sin(2 * Math.PI * (r * 1.5 - clock * 0.3)) * spread * 0.12;
					const pos = at(f.t - lag[k]) + r * spread + wander + agitation + shove[k];
					const c = ((pos % n) + n) % n;
					const c0 = Math.round(c);
					for (let d = -reach; d <= reach; d++) {
						const idx = (((c0 + d) % n) + n) % n;
						const dd = c0 + d - c;
						density[idx] += Math.exp(-dd * dd * inv);
					}
					sumY += ringY[c0 % n];
				}

				const gain = 0.34 + p.intensity * 0.62;
				out.fill(0);
				for (let k = 0; k < n; k++) {
					const d = density[k];
					if (d < 0.01) continue;
					// Where the flock is thick it reads hotter, and only there.
					const slot = lerp(SLOT.base, SLOT.white, clamp(d * 0.22)) + hueShift;
					setSample(out, ring.map[k], palette, slot, Math.min(d, 1.6) * gain);
				}

				// The beam carries the flock's shadow at its depth in the room.
				const depth = clamp(((sumY / birds) - yLo) / Math.max(1e-6, yHi - yLo));
				const centre = depth * (beam.length - 1);
				const shade = beam.length * 0.12;
				for (let k = 0; k < beam.length; k++) {
					const d = (k - centre) / shade;
					beamGlow[k] = Math.exp(-d * d) * 0.22 * gain;
					if (beamGlow[k] > 0.004) setSample(out, beam.map[k], palette, SLOT.base + hueShift, beamGlow[k]);
				}
			}
		};
	}
};
