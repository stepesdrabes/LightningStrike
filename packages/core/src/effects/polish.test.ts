import { describe, expect, it } from 'vitest';
import type { EffectDef, RenderCtx } from '../contracts/effect.ts';
import { createShowFrame } from '../contracts/frame.ts';
import { makePalette } from '../color/palette.ts';
import { DEFAULT_ROOM, buildGeometry } from '../geometry.ts';
import { BUILT_IN_EFFECTS } from './index.ts';

const g = buildGeometry(DEFAULT_ROOM);
const palette = makePalette({ base: 320, accent: 170, third: 260 });

function setup(id: string, motion = 1) {
	const def = BUILT_IN_EFFECTS.find((d) => d.id === id)!;
	const effect = def.create(g);
	const f = createShowFrame();
	f.dt = 1 / 60;
	f.beatPeriod = 0.5;
	f.section = 'intro';
	f.energy = 0.2;
	f.spectrum.fill(0.3);
	f.bands.fill(0.2);
	const ctx: RenderCtx = {
		g, f, palette, hueShift: 0, motion,
		p: Object.fromEntries(def.params.map((p) => [p.key, p.default]))
	};
	return { effect, ctx, out: new Float32Array(g.count * 3) };
}

function relativeDelta(a: Float32Array, b: Float32Array): number {
	let delta = 0;
	let light = 0;
	for (let i = 0; i < a.length; i++) {
		delta += Math.abs(a[i] - b[i]);
		light += Math.abs(a[i]);
	}
	return delta / Math.max(1e-6, light);
}

describe.each(['chorusBloom', 'ambientDrift', 'bandBloom'])('%s quiet movement', (id) => {
	it('moves through sustained, kit-free music and honors the motion control', () => {
		for (const motion of [0, 0.45]) {
			const { effect, ctx, out } = setup(id, motion);
			for (let k = 0; k < 120; k++) effect.render(out, ctx);
			const before = Float32Array.from(out);
			for (let k = 0; k < 240; k++) effect.render(out, ctx);
			const moved = relativeDelta(before, out);
			if (motion === 0) expect(moved).toBeLessThan(0.0001);
			else expect(moved).toBeGreaterThan(0.04);
		}
	});

	it('answers a note between beats without requiring a kick or energy rise', () => {
		const { effect, ctx, out } = setup(id, 0);
		for (let k = 0; k < 120; k++) effect.render(out, ctx);
		const before = Float32Array.from(out);
		ctx.f.spectrum.fill(0.9, 0, Math.ceil(ctx.f.spectrum.length / 3));
		for (let k = 0; k < 8; k++) effect.render(out, ctx);
		expect(relativeDelta(before, out)).toBeGreaterThan(0.02);
	});
});

it('lets the rhythm layers own kick and snare attacks over Chorus Bloom', () => {
	const quiet = setup('chorusBloom');
	const drums = setup('chorusBloom');
	for (let k = 0; k < 240; k++) {
		drums.ctx.f.kick = k % 30 === 0;
		drums.ctx.f.kickEnv = Math.exp(-(k % 30) / 5);
		drums.ctx.f.snare = k % 60 === 30;
		drums.ctx.f.snareEnv = Math.exp(-((k + 30) % 60) / 5);
		quiet.effect.render(quiet.out, quiet.ctx);
		drums.effect.render(drums.out, drums.ctx);
		expect(relativeDelta(quiet.out, drums.out)).toBe(0);
	}
});

function integratedLight(def: EffectDef, fps: number): number {
	const { effect, ctx, out } = setup(def.id);
	const f = ctx.f;
	f.dt = 1 / fps;
	f.section = 'drop';
	f.energy = 0.8;
	f.bands.fill(0.7);
	f.spectrum.fill(0.4);
	let total = 0;
	let frames = 0;
	for (let k = 0; k < fps * 12; k++) {
		f.t = k / fps;
		f.timeSinceDrop = f.t;
		f.beatIndex = Math.floor(k / (fps / 2));
		f.barIndex = Math.floor(k / (fps * 2));
		f.beatPhase = (k % (fps / 2)) / (fps / 2);
		f.barPhase = (k % (fps * 2)) / (fps * 2);
		f.beat = k % (fps / 2) === 0;
		f.downbeat = k % (fps * 2) === 0;
		f.phraseStart = k === 0;
		f.kick = f.beat;
		f.snare = f.beat && f.beatIndex % 2 === 1;
		f.kickEnv = Math.exp(-f.beatPhase * f.beatPeriod / 0.09);
		f.snareEnv = f.beatIndex % 2 === 1 ? f.kickEnv : 0;
		effect.render(out, ctx);
		if (k < fps * 2) continue;
		for (const v of out) total += v;
		frames++;
	}
	return total / (frames * out.length);
}

describe.each([
	'emberStorm', 'discoBall', 'pixelRain', 'beamFlick', 'snareWhip',
	'kickCannon', 'kickTunnel', 'shockwave', 'pyroBursts'
])('%s continuous trails', (id) => {
	it('delivers comparable light at 30, 60 and 120 frames per second', () => {
		const def = BUILT_IN_EFFECTS.find((d) => d.id === id)!;
		const light = [30, 60, 120].map((fps) => integratedLight(def, fps));
		expect(light[1]).toBeGreaterThan(0.001);
		const spread = (Math.max(...light) - Math.min(...light)) / light[1];
		expect(spread, `30/60/120 Hz light: ${light.join(', ')}`).toBeLessThan(0.12);
	});
});
