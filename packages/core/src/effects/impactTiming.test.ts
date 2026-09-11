import { describe, expect, it } from 'vitest';
import type { EffectDef } from '../contracts/effect.ts';
import { createShowFrame } from '../contracts/frame.ts';
import { makePalette } from '../color/palette.ts';
import { DEFAULT_ROOM, buildGeometry } from '../geometry.ts';
import { Mixer } from '../mixer.ts';
import { blockChase } from './blockChase.ts';
import { doubleKickGatling } from './doubleKickGatling.ts';
import { moshSlam } from './moshSlam.ts';

const g = buildGeometry(DEFAULT_ROOM);
const palette = makePalette({ base: 140, accent: 320 });

function atTime(def: EffectDef, fps: number, at: number) {
	const effect = def.create(g);
	const out = new Float32Array(g.count * 3);
	const f = createShowFrame();
	f.beatPeriod = 0.5;
	f.energy = 0.8;
	f.kick = true;
	f.kickEnv = 0.9;
	f.dt = 1 / fps;
	const ctx = {
		g, f, palette, hueShift: 0, motion: 1.25,
		p: Object.fromEntries(def.params.map((p) => [p.key, p.default]))
	};
	effect.render(out, ctx);
	let previous = 0;
	const before = Math.max(0, at - 1 / 120);
	for (let k = 1; k <= Math.ceil(before * fps) + (at > 0 ? 1 : 0); k++) {
		f.t = k > Math.ceil(before * fps) ? at : Math.min(before, k / fps);
		f.dt = f.t - previous;
		f.beatPhase = f.t / f.beatPeriod;
		f.kick = false;
		f.kickEnv = 0;
		effect.render(out, ctx);
		previous = f.t;
	}
	return out;
}

function delivered(def: EffectDef, fps: number) {
	const mixer = new Mixer(g);
	mixer.palette = palette;
	mixer.intensity = 0.92;
	mixer.motion = 1.25;
	mixer.layers[def.role].setEffect(def, g);
	const f = createShowFrame();
	f.beatPeriod = 60 / 128;
	f.energy = 0.8;
	f.dt = 1 / fps;
	f.spectrum.fill(0.7);
	let previousBeat = -1;
	let sum = 0;
	let count = 0;
	for (let k = 0; k < fps * 8; k++) {
		f.t = k / fps;
		const beat = f.t / f.beatPeriod;
		f.beatIndex = Math.floor(beat);
		f.beatPhase = beat - f.beatIndex;
		f.kick = f.beatIndex !== previousBeat;
		f.beat = f.kick;
		f.downbeat = f.kick && f.beatIndex % 4 === 0;
		f.kickEnv = f.kick ? 0.9 : 0.9 * Math.exp(-f.beatPhase * f.beatPeriod / 0.09);
		previousBeat = f.beatIndex;
		mixer.render(f);
		if (f.t < 1) continue;
		for (let i = 0; i < g.count; i++) {
			const at = i * 3;
			sum += Math.max(mixer.bytes[at], mixer.bytes[at + 1], mixer.bytes[at + 2]);
		}
		count += g.count;
	}
	return sum / count;
}

describe.each([doubleKickGatling, moshSlam, blockChase])('$name impact timing', (def) => {
	it('does not spend the preceding frame interval on a new strike', () => {
		const first = atTime(def, 120, 0);
		expect(Math.max(...first)).toBeGreaterThan(0.5);
		expect(atTime(def, 60, 0)).toEqual(first);
		expect(atTime(def, 30, 0)).toEqual(first);
	});

	it('gives the same exposure after different frame histories at equal elapsed times', () => {
		for (const t of [0.025, 0.045, 0.075, 0.135]) {
			const fine = atTime(def, 120, t);
			for (const fps of [30, 60]) {
				const coarse = atTime(def, fps, t);
				for (let k = 0; k < fine.length; k++) expect(coarse[k]).toBeCloseTo(fine[k], 6);
			}
		}
	});

	it('preserves delivered strike energy at 30, 60 and 120 frames per second', () => {
		const levels = [30, 60, 120].map((fps) => delivered(def, fps));
		expect((Math.max(...levels) - Math.min(...levels)) / levels[1], levels.join(', ')).toBeLessThan(0.12);
	});
});
