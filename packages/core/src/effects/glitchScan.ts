import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { addSample } from '../color/palette.ts';
import { Follower, Schmitt } from '../dsl/env.ts';
import { clamp } from '../dsl/math.ts';
import { hash01 } from '../dsl/rng.ts';
import { bandAt, bandBetween } from '../dsl/spectrum.ts';
import { ringsFor } from '../dsl/space.ts';
import { INTENSITY, param } from './helpers.ts';

const MAX_SEGMENTS = 32;

export const glitchScan: EffectDef = {
	id: 'glitchScan',
	name: 'Glitch Scan',
	role: 'rhythm',
	blurb: 'Feathered segments answer loud phrases and offbeat swells, resting when the music settles.',
	taste: {
		energy: 4,
		sections: ['groove', 'breakdown', 'build', 'drop'],
		minBars: 2,
		maxBars: 16,
		peakReserved: false,
		activity: 0.5,
		carries: false,
		noteReactive: true
	},
	params: [
		INTENSITY,
		param('segments', 'Segments', 16, 8, 32, 4),
		param('perBeat', 'Steps per beat', 2, 1, 4, 1)
	],
	create(g) {
		const ring = ringsFor(g).perimeter;
		const born = new Float64Array(MAX_SEGMENTS).fill(-Infinity);
		const power = new Float32Array(MAX_SEGMENTS);
		const lit = new Float32Array(MAX_SEGMENTS);
		const segSlot = new Float32Array(MAX_SEGMENTS).fill(SLOT.base);
		const voice = new Follower(0.06, 0.2);
		const passage = new Follower(1.5, 3);
		const onset = new Schmitt(0.015, 0.065);
		let lastSlot = -1;
		let lastFire = -Infinity;
		let rising = false;
		return {
			reset() {
				born.fill(-Infinity);
				power.fill(0);
				lit.fill(0);
				segSlot.fill(SLOT.base);
				voice.reset();
				passage.reset();
				onset.reset();
				lastSlot = -1;
				lastFire = -Infinity;
				rising = false;
			},
			render(out, ctx) {
				const { f, p, palette, hueShift, motion } = ctx;
				out.fill(0);
				const tempo = Math.max(0.15, f.beatPeriod);
				const heard = voice.update(Math.max(
					bandBetween(f, 0.18, 0.5), bandBetween(f, 0.4, 0.78)
				), f.dt / tempo);
				const held = passage.update(heard, f.dt / tempo);
				const energy = Math.max(f.energy, heard * 0.6);
				const audible = clamp((heard - 0.12) / 0.52) * Math.sqrt(clamp((energy - 0.08) / 0.5));
				const lifted = onset.update(heard - held);
				const note = lifted && !rising;
				rising = lifted;
				const segs = Math.min(MAX_SEGMENTS, Math.max(8, Math.round(p.segments)));
				const perBeat = Math.max(1, Math.round(p.perBeat));
				const beat = f.beatIndex + f.beatPhase;
				const slot = Math.floor(beat * perBeat);
				const grid = slot !== lastSlot;
				lastSlot = slot;
				const gap = Math.max(0.08, tempo * 0.35 / Math.max(0.75, motion));
				const at = note ? f.t : f.t - (beat - slot / perBeat) * tempo;
				if ((grid || note) && audible > 0.18 && at - lastFire >= gap) {
					lastFire = at;
					const seed = slot * 13 + (note ? 7 : 0);
					const count = audible > 0.75 ? 3 : 2;
					const strength = clamp(0.3 + audible * 0.5 + Math.max(0, heard - held) * 0.8);
					for (let c = 0; c < count; c++) {
						const idx = Math.floor(hash01(seed + c * 101) * segs);
						born[idx] = at;
						power[idx] = strength;
						const band = bandAt(f, (idx + 0.5) / segs);
						segSlot[idx] = band > 0.6 ? SLOT.accent : band > 0.3 ? SLOT.third : SLOT.base;
					}
				}

				const release = tempo * 0.17 / Math.max(0.7, motion);
				const articulation = clamp(0.75 + heard * 0.25 + (heard - held) * 1.5, 0.4, 1.35);
				const gain = (0.6 + p.intensity * 0.95) * audible * articulation;
				const segPx = ring.length / segs;
				const feather = 3 / segPx;
				for (let s = 0; s < segs; s++) {
					lit[s] = power[s] * Math.exp(-Math.max(0, f.t - born[s] - 0.035) / release);
				}
				for (let k = 0; k < ring.length; k++) {
					const pos = k / segPx;
					const s = Math.min(segs - 1, Math.floor(pos));
					const t = pos - s;
					let w = 1;
					let other = -1;
					if (t < feather) {
						w = 0.5 + (0.5 * t) / feather;
						other = (s - 1 + segs) % segs;
					} else if (t > 1 - feather) {
						w = 0.5 + (0.5 * (1 - t)) / feather;
						other = (s + 1) % segs;
					}
					const a = lit[s] * w;
					if (a >= 0.015) addSample(out, ring.map[k], palette, segSlot[s] + hueShift, a * gain);
					if (other < 0) continue;
					const b = lit[other] * (1 - w);
					if (b >= 0.015) addSample(out, ring.map[k], palette, segSlot[other] + hueShift, b * gain);
				}
			}
		};
	}
};
