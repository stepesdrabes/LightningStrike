import { describe, expect, it } from 'vitest';
import { createShowFrame, type SectionKind } from '../contracts/frame.ts';
import { buildGeometry, DEFAULT_ROOM } from '../geometry.ts';
import { makePalette } from '../color/palette.ts';
import { pixelRain } from './pixelRain.ts';

const g = buildGeometry(DEFAULT_ROOM);
const palette = makePalette({ base: 140, accent: 320 });
const params = Object.fromEntries(pixelRain.params.map((p) => [p.key, p.default]));

function performance(section: SectionKind, notes: boolean, fps = 60) {
	const effect = pixelRain.create(g);
	const f = createShowFrame();
	f.section = section;
	f.energy = 0.3;
	f.beatPeriod = 0.5;
	f.dt = 1 / fps;
	f.bands.fill(0.3);
	const out = new Float32Array(g.count * 3);
	const ctx = { g, f, p: params, palette, hueShift: 0, motion: 0.7 };
	const run = () => {
		const frames: Float32Array[] = [];
		for (let k = 0; k < fps * 2; k++) {
			f.t = k / fps;
			f.spectrum.fill(0.2);
			// Keep the spawn grid fixed: this note must brighten an existing droplet.
			if (notes && f.t >= 1.2 && f.t < 1.35) f.spectrum.fill(0.9, 3, 15);
			effect.render(out, ctx);
			frames.push(Float32Array.from(out));
		}
		return frames;
	};
	const frames = run();
	effect.reset();
	out.fill(0);
	expect(run()).toEqual(frames);
	return frames;
}

const sum = (frame: Float32Array) => frame.reduce((total, value) => total + value, 0);

describe('pixelRain note articulation', () => {
	it.each(['intro', 'breakdown'] as const)('brightens a falling droplet on an offbeat %s note', (section) => {
		const played = performance(section, true);
		const steady = performance(section, false);
		const at = 80;
		const gain = sum(played[at]) / sum(steady[at]);
		expect(gain).toBeGreaterThan(1.35);
		expect(gain).toBeLessThan(1.9);
		// The same wall and droplet color answer; no extra points appear elsewhere.
		for (let i = 0; i < steady[at].length; i++) {
			if (steady[at][i] === 0) expect(played[at][i]).toBe(0);
		}
		const peak = steady[at].indexOf(Math.max(...steady[at]));
		const pixel = Math.floor(peak / 3) * 3;
		for (let channel = 0; channel < 3; channel++) {
			expect(played[at][pixel + channel] / played[at][peak])
				.toBeCloseTo(steady[at][pixel + channel] / steady[at][peak], 3);
		}
		expect(sum(played[110]) / sum(steady[110])).toBeLessThan(gain);
	});

	it('keeps the delivered note response consistent across frame rates', () => {
		const response = [30, 60, 120].map((fps) => {
			const played = performance('intro', true, fps);
			const steady = performance('intro', false, fps);
			let change = 0;
			let base = 0;
			for (let k = Math.round(fps * 1.2); k < fps * 1.8; k++) {
				change += sum(played[k]) - sum(steady[k]);
				base += sum(steady[k]);
			}
			return change / base;
		});
		expect(Math.min(...response)).toBeGreaterThan(0.05);
		expect(Math.max(...response) / Math.min(...response)).toBeLessThan(1.25);
	});

	it.each(['groove', 'chorus', 'drop'] as const)('preserves the %s rendering', (section) => {
		expect(performance(section, true)).toEqual(performance(section, false));
	});
});
