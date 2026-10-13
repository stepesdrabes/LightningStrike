import type { EffectDef } from '../contracts/effect.ts';
import type { Palette } from '../contracts/palette.ts';
import { SLOT } from '../contracts/palette.ts';
import { sample } from '../color/palette.ts';
import { clamp } from '../dsl/math.ts';
import { stampGaussian } from '../dsl/buffer.ts';
import { Follower, Presence } from '../dsl/env.ts';
import { hash01 } from '../dsl/rng.ts';
import { ringsFor, scatter } from '../dsl/space.ts';
import { INTENSITY, param } from './helpers.ts';

const JELLIES = 5;
/** Index of the one that swims the beam, turning at its ends; the rest share the ring. */
const BEAM = JELLIES;
/** A pixel that two crossing jellies push past this is held here, before the output slew sees it. */
const CEILING = 1.3;

/** Hue-preserving scale-down of any pixel past CEILING. */
function ceiling(buf: Float32Array): void {
	for (let k = 0; k < buf.length; k += 3) {
		const peak = Math.max(buf[k], buf[k + 1], buf[k + 2]);
		if (peak <= CEILING) continue;
		const s = CEILING / peak;
		buf[k] *= s;
		buf[k + 1] *= s;
		buf[k + 2] *= s;
	}
}

/** Bell and tentacles of one jelly, written into a run's buffer. */
function draw(
	buf: Float32Array,
	n: number,
	wrap: boolean,
	at: number,
	size: number,
	heading: number,
	streaming: number,
	pulse: number,
	ripple: number,
	palette: Palette,
	slot: number,
	level: number,
	rgb: [number, number, number]
): void {
	// The bell tightens and brightens as it contracts, then relaxes back out.
	const sigma = size * (1 - 0.28 * pulse);
	sample(palette, slot, level * (0.7 + 0.5 * pulse), rgb);
	stampGaussian(buf, n, at, sigma, rgb[0], rgb[1], rgb[2], wrap);
	// Tentacles trail away from the swim, longer the faster it goes, rippling slowly.
	const reach = size * (1.5 + 4.5 * streaming);
	const from = sigma * 0.6;
	const span = Math.ceil(from + reach * 3);
	for (let d = 1; d <= span; d++) {
		const i0 = Math.round(at - heading * d);
		const behind = (at - i0) * heading;
		if (behind <= from) continue;
		let i = i0;
		if (wrap) i = ((i % n) + n) % n;
		else if (i < 0 || i >= n) continue;
		const w = Math.exp(-(behind - from) / reach) * (0.82 + 0.18 * Math.sin(behind * 0.8 - ripple));
		const o = i * 3;
		buf[o] += rgb[0] * w * 0.3;
		buf[o + 1] += rgb[1] * w * 0.3;
		buf[o + 2] += rgb[2] * w * 0.3;
	}
}

/**
 * A few jellyfish drift round the room. Each bell contracts on its own beat and the jelly surges
 * forward, then glides to a stop under drag while its tentacles stream behind it. Big ones pulse
 * on the half note, small ones on every beat; a kick on the pulse drives a harder stroke.
 */
export const jellyfish: EffectDef = {
	id: 'jellyfish',
	name: 'Jellyfish',
	role: 'rhythm',
	blurb: 'Jellyfish drift round the room; each bell contracts on its beat and surges forward, then glides as its tentacles stream behind.',
	taste: {
		energy: 4,
		sections: ['groove', 'breakdown', 'drop'],
		minBars: 2,
		maxBars: 32,
		peakReserved: false,
		activity: 0.3,
		carries: false
	},
	params: [INTENSITY, param('pace', 'Swimming pace', 0.5)],
	create(g) {
		const rings = ringsFor(g);
		const ring = rings.perimeter;
		const beam = rings.beam;
		const n = ring.length;
		const ringBuf = new Float32Array(n * 3);
		const beamBuf = new Float32Array(beam.length * 3);
		const rgb: [number, number, number] = [0, 0, 0];

		const count = JELLIES + 1;
		const size = new Float32Array(count);
		const period = new Uint8Array(count);
		const offset = new Uint8Array(count);
		const slot = new Float32Array(count);
		const start = new Float32Array(count);
		for (let j = 0; j < count; j++) {
			size[j] = j === BEAM ? 5 : 7 + hash01(j * 61 + 5) * 7;
			period[j] = size[j] > 10.5 ? 2 : 1;
			offset[j] = hash01(j * 23 + 9) < 0.5 ? 0 : 1;
			// Mostly the home hue, one in the third, so the colour varies across the room, not in time.
			slot[j] = j === 2 ? SLOT.third : j % 2 === 0 ? SLOT.glow : SLOT.base;
			const jitter = (hash01(j * 7 + 1) - 0.5) * 0.5;
			start[j] = j === BEAM ? beam.length / 2 : ((j + 0.5 + jitter) / JELLIES) * n;
		}
		const pos = new Float64Array(count);
		const vel = new Float32Array(count);
		const pulse = new Float32Array(count);
		const heading = new Int8Array(count);
		const passage = new Follower(0.6, 1.5);
		const kicks = new Presence();
		let phrases = 0;
		let clock = 0;
		let started = false;

		return {
			reset() {
				vel.fill(0);
				pulse.fill(0);
				passage.reset();
				kicks.reset();
				phrases = 0;
				clock = 0;
				started = false;
				ringBuf.fill(0);
				beamBuf.fill(0);
			},
			render(out, ctx) {
				const { f, p, palette, hueShift, motion } = ctx;
				if (!started) {
					started = true;
					for (let j = 0; j < count; j++) {
						pos[j] = start[j];
						heading[j] = j % 2 === 0 ? 1 : -1;
					}
				}
				const beat = Math.max(0.15, f.beatPeriod);
				const level = passage.update(f.energy, f.dt);
				const playing = kicks.update(f.kickEnv, f.dt, f.beatPeriod);
				const still = clamp(motion);
				// Each stroke covers `stroke` pixels whatever the drag; the drag only sets the glide.
				const drag = beat * 0.4;
				const stroke = n * (0.03 + 0.04 * p.pace) * (0.75 + 0.5 * level) * still;
				clock += f.dt * still;

				if (f.phraseStart) {
					phrases++;
					// Some turn back each phrase, so the room's traffic never settles into one current.
					for (let j = 0; j < JELLIES; j++) {
						if (hash01(phrases * 131 + j * 17) < 0.35) heading[j] = -heading[j];
					}
				}
				if (f.beat) {
					const push = 0.8 + 0.4 * f.kickEnv * playing;
					for (let j = 0; j < count; j++) {
						if ((((f.beatIndex - offset[j]) % period[j]) + period[j]) % period[j] !== 0) continue;
						pulse[j] = still;
						vel[j] += (heading[j] * stroke * period[j] * push) / drag;
					}
				}

				const glide = Math.exp(-f.dt / drag);
				const relax = Math.exp(-f.dt / (beat * 0.22));
				const gain = 0.4 + p.intensity * 0.7;
				const fastest = Math.max(1e-6, (2 * stroke * 1.2) / drag);
				ringBuf.fill(0);
				beamBuf.fill(0);
				for (let j = 0; j < count; j++) {
					vel[j] *= glide;
					pulse[j] *= relax;
					pos[j] += vel[j] * f.dt;
					const onBeam = j === BEAM;
					if (onBeam) {
						// The beam jelly turns at either end rather than swimming off it.
						const lo = size[j];
						const hi = beam.length - 1 - size[j];
						if ((pos[j] < lo && vel[j] < 0) || (pos[j] > hi && vel[j] > 0)) {
							vel[j] = -vel[j];
							heading[j] = -heading[j];
						}
						pos[j] = clamp(pos[j], lo, hi);
					} else {
						pos[j] = ((pos[j] % n) + n) % n;
					}
					const way = Math.abs(vel[j]) > 1e-3 ? Math.sign(vel[j]) : heading[j];
					draw(
						onBeam ? beamBuf : ringBuf, onBeam ? beam.length : n, !onBeam, pos[j], size[j], way,
						clamp(Math.abs(vel[j]) / fastest), pulse[j], clock * 2.5, palette, slot[j] + hueShift,
						gain, rgb
					);
				}
				ceiling(ringBuf);
				ceiling(beamBuf);
				out.fill(0);
				scatter(ring, ringBuf, out);
				scatter(beam, beamBuf, out);
			}
		};
	}
};
