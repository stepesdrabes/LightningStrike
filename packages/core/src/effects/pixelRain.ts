import type { EffectDef } from '../contracts/effect.ts';
import type { StripSpec } from '../contracts/room.ts';
import type { Palette } from '../contracts/palette.ts';
import { SLOT } from '../contracts/palette.ts';
import { sample } from '../color/palette.ts';
import { fadeToBlack } from '../dsl/buffer.ts';
import { PulseEnv } from '../dsl/env.ts';
import { spectralTilt } from '../dsl/spectrum.ts';
import { stampOnStrip } from '../dsl/space.ts';
import { beatRelease, INTENSITY, param, WallDrops, type WallDrop } from './helpers.ts';

export const pixelRain: EffectDef = {
	id: 'pixelRain',
	name: 'Pixel Rain',
	role: 'rhythm',
	blurb: 'Droplets from the corners sliding to each wall centre on the 8th-note grid.',
	taste: {
		energy: 3,
		sections: ['intro', 'groove', 'breakdown', 'build', 'drop'],
		minBars: 2,
		maxBars: 32,
		peakReserved: false,
		activity: 0.3
	},
	params: [
		INTENSITY,
		param('perBeat', 'Drops per beat', 2, 0.5, 4, 0.5),
		param('fallBeats', 'Beats to land', 4, 1, 8, 0.5)
	],
	create(g) {
		const rain = new WallDrops(g);
		const landGlow = rain.walls.map(() => new PulseEnv());
		const landTint = new Float32Array(rain.walls.length).fill(SLOT.base);
		const rgb: [number, number, number] = [0, 0, 0];

		// The frame's context, held so the fall callbacks can be built once. `fall` takes them
		// every frame, and a fresh closure per frame is an allocation per frame.
		let dst: Float32Array = new Float32Array(0);
		let palette: Palette = new Float32Array(0);
		let hueShift = 0;
		let gain = 1;

		const onFall = (drop: WallDrop, u: number, pos: number, wall: StripSpec): void => {
			sample(palette, drop.tint + hueShift, gain * (0.5 + 0.5 * u), rgb);
			// A droplet two pixels of sigma wide: a one-pixel drop at full level was a hot
			// point sliding down the wall, and a wall of hot points is grain.
			stampOnStrip(dst, g.count, wall, pos, 2.2, rgb);
		};
		const onLand = (drop: WallDrop): void => {
			landGlow[drop.wall].fire(0.8);
			landTint[drop.wall] = drop.tint;
		};

		return {
			reset() {
				rain.reset();
				for (const l of landGlow) l.reset();
				landTint.fill(SLOT.base);
			},
			render(out, ctx) {
				const { f, p } = ctx;
				dst = out;
				palette = ctx.palette;
				hueShift = ctx.hueShift;
				fadeToBlack(out, f.dt, beatRelease(f.beatPeriod, 0.2));

				// Low, because a droplet two pixels wide carries twice the light of the hot
				// point it replaced: measured, the old rain delivered 42 bytes over a drop, more
				// than any bed, from a look that is supposed to be a few drops on a wall.
				gain = 0.15 + p.intensity * 0.22;
				const spawned = rain.spawn(f, p.perBeat);
				if (spawned) {
					// Where the arrangement is sitting chooses the droplet's colour, so a bass
					// passage rains in the home hue and an opening one answers in the accent.
					// Read once at spawn, which is on the grid, so nothing recolours mid-fall.
					const tilt = spectralTilt(f);
					spawned.tint = tilt < 0.34 ? SLOT.base : tilt < 0.62 ? SLOT.third : SLOT.accent;
				}

				rain.fall(f, p.fallBeats / Math.max(0.2, ctx.motion), onFall, onLand);

				for (let w = 0; w < rain.walls.length; w++) {
					const v = landGlow[w].decay(f.dt, f.beatPeriod, 3);
					if (v < 0.02) continue;
					const wall = rain.walls[w];
					// The splash keeps its own droplet's colour. A base-hue glow under an accent
					// droplet is two hues in one place, which sums to one the palette cannot make.
					sample(palette, landTint[w] + hueShift, v * gain * 0.8, rgb);
					stampOnStrip(out, g.count, wall, wall.count / 2, 3.2, rgb);
				}
			}
		};
	}
};
