import type { EffectDef } from '../contracts/effect.ts';
import type { StripSpec } from '../contracts/room.ts';
import type { Palette } from '../contracts/palette.ts';
import { SLOT } from '../contracts/palette.ts';
import { sample } from '../color/palette.ts';
import { fadeToBlack } from '../dsl/buffer.ts';
import { clamp } from '../dsl/math.ts';
import { Follower, PulseEnv } from '../dsl/env.ts';
import { bandBetween, spectralTilt } from '../dsl/spectrum.ts';
import { stampOnStrip } from '../dsl/space.ts';
import { beatRelease, INTENSITY, param, trailDeposit, WallDrops, type WallDrop } from './helpers.ts';

export const pixelRain: EffectDef = {
	id: 'pixelRain',
	name: 'Pixel Rain',
	role: 'rhythm',
	blurb: 'Droplets slide from corners to wall centres, brightening with quiet notes as they fall.',
	taste: {
		energy: 3,
		sections: ['intro', 'groove', 'breakdown', 'build', 'drop'],
		minBars: 2,
		maxBars: 32,
		peakReserved: false,
		activity: 0.3,
		noteReactive: true
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
		const voice = new Follower(0.08, 0.4);
		const passage = new Follower(1.5, 3);

		// Retain context so fall callbacks allocate once, outside render.
		let dst: Float32Array = new Float32Array(0);
		let palette: Palette = new Float32Array(0);
		let hueShift = 0;
		let gain = 1;

		const onFall = (drop: WallDrop, u: number, pos: number, wall: StripSpec): void => {
			sample(palette, drop.tint + hueShift, gain * (0.5 + 0.5 * u), rgb);
			// A two-pixel sigma avoids hot points from under the frame.
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
				voice.reset();
				passage.reset();
			},
			render(out, ctx) {
				const { f, p } = ctx;
				dst = out;
				palette = ctx.palette;
				hueShift = ctx.hueShift;
				const release = beatRelease(f.beatPeriod, 0.2);
				fadeToBlack(out, f.dt, release);

				// Lower gain compensates for the wider droplets so sparse rain does not
				// outshine beds.
				const beats = f.dt / Math.max(0.15, f.beatPeriod);
				const heard = voice.update(Math.max(bandBetween(f, 0.15, 0.45), bandBetween(f, 0.4, 0.78)), beats);
				const held = passage.update(heard, beats);
				const listen = f.section === 'intro' || f.section === 'breakdown' || f.section === 'build';
				// Existing droplets articulate a note without spawning or recolouring it on a beat.
				const noteGain = listen ? clamp(0.86 + heard * 0.2 + (heard - held) * 2.8, 0.65, 1.55) : 1;
				gain = (0.15 + p.intensity * 0.22) * trailDeposit(f.dt, release) * noteGain;
				const spawned = rain.spawn(f, p.perBeat);
				if (spawned) {
					// Capture spectral colour on the spawn grid; never recolour a falling
					// droplet.
					const tilt = spectralTilt(f);
					spawned.tint = tilt < 0.34 ? SLOT.base : tilt < 0.62 ? SLOT.third : SLOT.accent;
				}

				rain.fall(f, p.fallBeats / Math.max(0.2, ctx.motion), onFall, onLand);

				for (let w = 0; w < rain.walls.length; w++) {
					const v = landGlow[w].decay(f.dt, f.beatPeriod, 3);
					if (v < 0.02) continue;
					const wall = rain.walls[w];
					// Keep splash and droplet colours identical so their sum remains
					// on-palette.
					sample(palette, landTint[w] + hueShift, v * gain * 0.8, rgb);
					stampOnStrip(out, g.count, wall, wall.count / 2, 3.2, rgb);
				}
			}
		};
	}
};
