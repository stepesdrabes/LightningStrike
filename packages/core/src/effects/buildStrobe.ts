import type { EffectDef } from '../contracts/effect.ts';
import { STROBE_MAX_HZ } from '../contracts/show.ts';
import { SLOT } from '../contracts/palette.ts';
import { sample } from '../color/palette.ts';
import { clamp, lerp } from '../dsl/math.ts';
import { INTENSITY } from './helpers.ts';

/** A flash: full for this long, then a short tail. Under a frame it reads as a dim blip. */
const HOLD = 0.04;
const RELEASE = 0.06;

/**
 * Use only the back half of the build. Widen coverage as the rate ladder rises, keeping
 * flashes short enough to leave true darkness between them.
 */
export const buildStrobe: EffectDef = {
	id: 'buildStrobe',
	name: 'Build Strobe',
	role: 'accent',
	blurb: 'White flashes on a grid that doubles into the drop, spreading from the long walls to the whole frame.',
	taste: {
		energy: 4,
		sections: ['build'],
		minBars: 2,
		maxBars: 16,
		peakReserved: false,
		activity: 1,
		carries: false,
		character: 'flash'
	},
	params: [INTENSITY],
	create(g) {
		// Bit per block: the four walls in ring order, then the beam.
		const block = new Uint8Array(g.count);
		let bit = 0;
		for (const s of g.strips) {
			if (!s.inPerimeter) continue;
			for (let k = 0; k < s.count; k++) block[s.offset + k] = bit;
			bit++;
		}
		const beamBit = bit;
		for (const s of g.strips) {
			if (s.inPerimeter) continue;
			for (let k = 0; k < s.count; k++) block[s.offset + k] = beamBit;
		}
		const LONG = 0b00101;
		const SHORT = 0b01010;
		const BEAM = 1 << beamBit;
		const ALL = LONG | SHORT | BEAM;

		let lastStep = -1;
		let level = 0;
		let held = 0;
		let mask = 0;

		return {
			reset() {
				lastStep = -1;
				level = 0;
				held = 0;
				mask = 0;
			},
			render(out, ctx) {
				const { f, p, palette, hueShift } = ctx;

				if (held > 0) held -= f.dt;
				else level *= Math.exp(-f.dt / RELEASE);
				if (level < 0.01) level = 0;

				const progress = clamp((f.buildProgress - 0.45) / 0.55);
				if (progress > 0) {
					const rung = progress < 0.3 ? 0 : progress < 0.6 ? 1 : progress < 0.85 ? 2 : 3;
					let per = [2, 1, 0.5, 0.25][rung];
					// Stop rate doubling at the strobe ceiling while continuing to widen
					// spatial coverage.
					const floor = 1 / (STROBE_MAX_HZ * Math.max(0.05, f.beatPeriod));
					while (per < floor && per < 2) per *= 2;
					const step = Math.floor((f.beatIndex + f.beatPhase) / per);
					if (step !== lastStep) {
						lastStep = step;
						level = 1;
						held = HOLD;
						mask =
							rung === 0
								? LONG
								: rung === 1
									? step % 2 === 0
										? LONG
										: SHORT
									: rung === 2
										? step % 2 === 0
											? LONG | BEAM
											: SHORT | BEAM
										: ALL;
					}
				}

				if (level === 0) {
					out.fill(0);
					return;
				}
				// Exceed one before mixing to reach white through accent opacity and build
				// intensity.
				const emit = (1.6 + 1.0 * progress) * (0.55 + p.intensity * 0.65) * level;
				const c = sample(palette, lerp(SLOT.glow, SLOT.white, 0.4 + 0.6 * progress) + hueShift, emit);
				for (let i = 0; i < g.count; i++) {
					const o = i * 3;
					const lit = mask & (1 << block[i]);
					out[o] = lit ? c[0] : 0;
					out[o + 1] = lit ? c[1] : 0;
					out[o + 2] = lit ? c[2] : 0;
				}
			}
		};
	}
};
