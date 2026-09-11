import type { EffectDef } from '../contracts/effect.ts';
import { STROBE_MAX_HZ } from '../contracts/show.ts';
import { SLOT } from '../contracts/palette.ts';
import { sample } from '../color/palette.ts';
import { Follower } from '../dsl/env.ts';
import { clamp, lerp } from '../dsl/math.ts';
import { bandBetween } from '../dsl/spectrum.ts';
import { INTENSITY } from './helpers.ts';

export const buildStrobe: EffectDef = {
	id: 'buildStrobe',
	name: 'Build Strobe',
	role: 'accent',
	blurb: 'Feathered flashes enter halfway through the build, gathering pace, width and light into the drop.',
	taste: {
		energy: 4,
		sections: ['build'],
		minBars: 2,
		maxBars: 16,
		peakReserved: false,
		activity: 0.7,
		carries: false,
		character: 'flash'
	},
	params: [INTENSITY],
	create(g) {
		const block = new Uint8Array(g.count);
		const distance = new Float32Array(g.count);
		let walls = 0;
		for (const strip of g.strips) {
			if (!strip.inPerimeter) continue;
			for (let k = 0; k < strip.count; k++) {
				block[strip.offset + k] = walls;
				distance[strip.offset + k] = (k + 0.5) / strip.count - 0.5;
			}
			walls++;
		}
		for (const strip of g.strips) {
			if (strip.inPerimeter) continue;
			for (let k = 0; k < strip.count; k++) {
				block[strip.offset + k] = walls;
				distance[strip.offset + k] = (k + 0.5) / strip.count - 0.5;
			}
		}
		const voice = new Follower(0.06, 0.22);
		const passage = new Follower(1.5, 3);
		const rgb: [number, number, number] = [0, 0, 0];
		let nextBeat = Number.NaN;
		let born = -Infinity;
		let pulse = 0;
		let side = 0;
		let spread = 0;
		return {
			reset() {
				nextBeat = Number.NaN;
				born = -Infinity;
				pulse = 0;
				side = 0;
				spread = 0;
				voice.reset();
				passage.reset();
			},
			render(out, ctx) {
				const { f, p, palette, hueShift, motion } = ctx;
				out.fill(0);
				const tempo = Math.max(0.05, f.beatPeriod);
				const beats = f.dt / tempo;
				const heard = voice.update(Math.max(
					bandBetween(f, 0.18, 0.5), bandBetween(f, 0.4, 0.78)
				), beats);
				const held = passage.update(heard, beats);
				const progress = clamp((f.buildProgress - 0.5) * 2);
				if (f.buildProgress < 0.5) {
					nextBeat = Number.NaN;
					born = -Infinity;
					return;
				}

				const rung = progress < 0.3 ? 0 : progress < 0.6 ? 1 : progress < 0.85 ? 2 : 3;
				let period = 2 ** (1 - rung);
				while (period * tempo < 1 / STROBE_MAX_HZ) period *= 2;
				const beat = f.beatIndex + f.beatPhase;
				if (Number.isNaN(nextBeat)) nextBeat = Math.ceil((beat - 1e-6) / period) * period;
				if (beat >= nextBeat - 1e-6) {
					const stamp = nextBeat + Math.floor(Math.max(0, beat - nextBeat) / period) * period;
					const at = f.t - (beat - stamp) * tempo;
					// Changing the subdivision cannot create an edge before the scheduled pulse.
					nextBeat = stamp + period;
					if (at - born >= 1 / STROBE_MAX_HZ - 1e-6) {
						born = at;
						side = pulse++ % 2;
						spread = progress;
					}
				}

				const age = f.t - born;
				const release = Math.max(0.018, tempo * 0.08) / Math.max(0.75, motion);
				const level = Math.exp(-Math.max(0, age - 0.03) / release);
				if (level < 0.006) return;
				const note = clamp(0.76 + heard * 0.35 + (heard - held) * 1.1, 0.45, 1.25);
				const emit = (1.05 + progress * 0.8) * (0.75 + p.intensity * 0.55) * level * note;
				sample(palette, lerp(SLOT.glow, SLOT.white, 0.12 + progress * 0.45) + hueShift, emit, rgb);
				const width = 0.14 + spread * 0.2;
				for (let i = 0; i < g.count; i++) {
					const isWall = block[i] < walls;
					const lit = isWall ? block[i] % 2 === side || spread >= 0.85 : spread >= 0.6;
					if (!lit) continue;
					const feather = Math.exp(-0.5 * (distance[i] / width) ** 2);
					const shape = spread * 0.12 + (1 - spread * 0.12) * feather;
					const at = i * 3;
					out[at] = rgb[0] * shape;
					out[at + 1] = rgb[1] * shape;
					out[at + 2] = rgb[2] * shape;
				}
			}
		};
	}
};
