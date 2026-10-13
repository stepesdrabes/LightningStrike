import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { sample } from '../color/palette.ts';
import { clamp, frac, smoothstep } from '../dsl/math.ts';
import { stampGaussian } from '../dsl/buffer.ts';
import { Presence } from '../dsl/env.ts';
import { hash01 } from '../dsl/rng.ts';
import { ringsFor, scatter } from '../dsl/space.ts';
import { INTENSITY, param } from './helpers.ts';

const MAX_SHELLS = 4;
const SPARKS = 24;
/** Burst points in ring units from the front middle: wall middles and the four corners' flanks. */
const SITES = [0, 0.11, 0.25, 0.39, 0.5, 0.61, 0.75, 0.89];
/** Seconds of streak behind a spark: a short exposure, not a comet. */
const STREAK = 0.05;
/** Middle of the front wall in the counter-clockwise frame. */
const FRONT_THETA = 0.75;

interface Shell {
	alive: boolean;
	t0: number;
	at: number;
	slot: number;
	power: number;
	seq: number;
}

/** Each bar's burst site, from the bar number alone, so the next shell can rise early. */
function siteOf(bar: number): number {
	const k = Math.floor(hash01(bar * 2246822519 + 7) * SITES.length);
	// Never the same site twice running: step past the previous bar's.
	const prev = Math.floor(hash01((bar - 1) * 2246822519 + 7) * SITES.length);
	return SITES[k === prev ? (k + 3) % SITES.length : k];
}

/**
 * A shell rises through the last beat of the bar at the next burst site and bursts on the
 * downbeat: one colour per shell, sparks fanning both ways round the ring under drag, the
 * beam catching the flash as a lit sky. Downbeats burst only while the kit plays.
 */
export const fireworks: EffectDef = {
	id: 'fireworks',
	name: 'Fireworks',
	role: 'accent',
	blurb: 'A shell rises through the last beat and bursts on the downbeat, sparks fanning round the walls as the sky lights.',
	taste: {
		energy: 4,
		sections: ['drop'],
		minBars: 2,
		maxBars: 16,
		peakReserved: false,
		activity: 0.5,
		character: 'impact',
		kit: 'any',
		carries: false
	},
	params: [INTENSITY, param('spread', 'Spark reach', 0.5)],
	create(g) {
		const rings = ringsFor(g);
		const ring = rings.perimeter;
		const beam = rings.beam;
		const n = ring.length;
		const ringBuf = new Float32Array(n * 3);
		const beamBuf = new Float32Array(beam.length * 3);
		const rgb: [number, number, number] = [0, 0, 0];
		let front = 0;
		let best = Infinity;
		for (let k = 0; k < n; k++) {
			const d = Math.abs(frac(g.theta[ring.map[k]] - FRONT_THETA + 0.5) - 0.5);
			if (d < best) {
				best = d;
				front = k;
			}
		}
		const shells: Shell[] = [];
		for (let s = 0; s < MAX_SHELLS; s++) {
			shells.push({ alive: false, t0: 0, at: 0, slot: 0, power: 0, seq: 0 });
		}
		// How far each spark of a shell slot travels before it hangs; the sign picks its way round.
		const travel = new Float32Array(MAX_SHELLS * SPARKS);
		const kit = new Presence();
		let next = 0;
		let launched = 0;
		let lastBar = Number.NaN;

		const launch = (t: number, site: number, power: number, reach: number) => {
			const index = next;
			const shell = shells[index];
			next = (next + 1) % MAX_SHELLS;
			shell.alive = true;
			shell.t0 = t;
			shell.at = front + site * n;
			shell.slot = launched % 2 === 0 ? SLOT.accent : SLOT.third;
			shell.power = power;
			shell.seq = launched++;
			for (let i = 0; i < SPARKS; i++) {
				const way = i % 2 === 0 ? 1 : -1;
				travel[index * SPARKS + i] = way * reach * (0.35 + 0.65 * hash01(shell.seq * 977 + i * 31));
			}
		};

		return {
			reset() {
				for (const s of shells) s.alive = false;
				kit.reset();
				next = 0;
				launched = 0;
				lastBar = Number.NaN;
				ringBuf.fill(0);
				beamBuf.fill(0);
			},
			render(out, ctx) {
				const { f, p, palette, hueShift, motion } = ctx;
				const playing = kit.update(Math.max(f.kickEnv, f.snareEnv), f.dt, f.beatPeriod);
				const beat = Math.max(0.15, f.beatPeriod);
				const life = (beat * 1.6) / Math.max(0.3, motion);
				const gain = 0.7 + p.intensity * 1.1;

				if (f.downbeat && f.barIndex !== lastBar && playing > 0.15) {
					lastBar = f.barIndex;
					const power = clamp(0.55 + 0.45 * playing);
					const reach = n * (0.08 + 0.1 * p.spread);
					const site = siteOf(f.barIndex);
					launch(f.t, site, power, reach);
					// A phrase opens with a pair, mirrored across the room.
					if (f.phraseStart) {
						const mirror = frac(1 - site);
						launch(f.t, mirror === site ? frac(site + 0.5) : mirror, power, reach);
					}
				}

				ringBuf.fill(0);
				beamBuf.fill(0);
				let sky = 0;
				let skySlot: number = SLOT.accent;
				for (let s = 0; s < MAX_SHELLS; s++) {
					const shell = shells[s];
					if (!shell.alive) continue;
					const age = f.t - shell.t0;
					const u = age / life;
					if (u >= 1) {
						shell.alive = false;
						continue;
					}
					const fade = (1 - u) * (1 - u);
					// The burst itself: a soft bloom at the site that clears within a beat.
					const bloom = Math.exp(-age / (beat * 0.22)) * shell.power;
					sample(palette, shell.slot + hueShift, bloom * gain * 0.7, rgb);
					stampGaussian(ringBuf, n, shell.at, 9, rgb[0], rgb[1], rgb[2], true);
					if (bloom > sky) {
						sky = bloom;
						skySlot = shell.slot;
					}
					// Drag: a spark covers its distance as 1 - e^(-t/tau), fast out, slowing to a hang.
					const tau = life * 0.3;
					for (let i = 0; i < SPARKS; i++) {
						const reach = travel[s * SPARKS + i];
						const level = fade * shell.power * gain * (0.55 + 0.45 * hash01(shell.seq * 31 + i * 7));
						for (let k = 0; k < 3; k++) {
							const t = Math.max(0, age - (k * STREAK) / 2);
							const flown = reach * (1 - Math.exp(-t / tau));
							// Sparks emerge from the bloom as they leave it, so the burst instant does not
							// pile every spark onto one pixel.
							const emerged = Math.min(1, Math.abs(flown) / 5);
							sample(palette, shell.slot + hueShift, level * (1 - k * 0.3) * emerged, rgb);
							stampGaussian(ringBuf, n, shell.at + flown, 1.8, rgb[0], rgb[1], rgb[2], true);
						}
					}
				}

				// The next shell rising through the last beat in its own colour, gathering at its site.
				const rise = smoothstep(0.72, 1, f.barPhase);
				if (rise > 0 && playing > 0.15) {
					const slot = launched % 2 === 0 ? SLOT.accent : SLOT.third;
					sample(palette, slot + hueShift, rise * rise * 0.35 * gain, rgb);
					const site = front + siteOf(f.barIndex + 1) * n;
					stampGaussian(ringBuf, n, site, 2 + 2 * rise, rgb[0], rgb[1], rgb[2], true);
				}
				if (sky > 0.01) {
					// The beam is the sky, lit by the burst in its colour: an even lift, well under it.
					sample(palette, skySlot + hueShift, sky * 0.3 * gain, rgb);
					for (let k = 0; k < beam.length; k++) {
						const o = k * 3;
						beamBuf[o] = rgb[0];
						beamBuf[o + 1] = rgb[1];
						beamBuf[o + 2] = rgb[2];
					}
				}
				// Crossing sparks sum; past full scale the output stage would hold the excess for a
				// beat as it slews down, so the ceiling is set here, preserving hue.
				for (let k = 0; k < ringBuf.length; k += 3) {
					const peak = Math.max(ringBuf[k], ringBuf[k + 1], ringBuf[k + 2]);
					if (peak <= 1.2) continue;
					const s = 1.2 / peak;
					ringBuf[k] *= s;
					ringBuf[k + 1] *= s;
					ringBuf[k + 2] *= s;
				}
				out.fill(0);
				scatter(ring, ringBuf, out);
				scatter(beam, beamBuf, out);
			}
		};
	}
};
