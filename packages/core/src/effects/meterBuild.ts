import type { EffectDef } from '../contracts/effect.ts';
import type { Palette } from '../contracts/palette.ts';
import { SLOT } from '../contracts/palette.ts';
import { addSample } from '../color/palette.ts';
import { clamp, frac, lerp, smoothstep } from '../dsl/math.ts';
import { BeatHold } from '../dsl/env.ts';
import { spectralTilt } from '../dsl/spectrum.ts';
import { ringsFor } from '../dsl/space.ts';
import { INTENSITY } from './helpers.ts';

/** A bar of the room filling from its start, with a feathered head and segment ticks. */
function fillBar(
	out: Float32Array,
	map: Uint16Array,
	n: number,
	fill: number,
	palette: Palette,
	body: number,
	hueShift: number,
	gain: number
): void {
	if (n === 0) return;
	const edge = fill * n;
	const head = Math.max(3, n * 0.012);
	const last = Math.min(n - 1, Math.ceil(edge));
	for (let k = 0; k <= last; k++) {
		// Feathered rather than a hard cut: an unfeathered front steps LED to LED as it
		// advances, which reads as the bar juddering instead of filling.
		const lit = 1 - smoothstep(edge - 1, edge + 1, k);
		if (lit <= 0) continue;
		const tip = smoothstep(edge - head, edge, k);
		const tick = frac((k / n) * 8) < 0.03 ? 1.5 : 1;
		const slot = lerp(body, SLOT.white, tip) + hueShift;
		addSample(out, map[k], palette, slot, lit * gain * (0.65 * tick + tip));
	}
}

/**
 * The most literal payoff of pre-analysis: the room IS the progress bar, and it reaches
 * 100% exactly on the drop downbeat.
 */
export const meterBuild: EffectDef = {
	id: 'meterBuild',
	name: 'Meter Build',
	role: 'rhythm',
	blurb: 'The ring and the beam fill to 100% exactly at the drop, segment ticks marking progress.',
	taste: {
		energy: 4,
		sections: ['build'],
		minBars: 2,
		maxBars: 16,
		peakReserved: false,
		activity: 0.3
	},
	params: [INTENSITY],
	create(g) {
		const rings = ringsFor(g);
		const ring = rings.perimeter;
		const beam = rings.beam;
		// The bar's colour follows the arrangement opening up, latched so it steps on a beat
		// rather than shimmering with the spectrum's own frame-to-frame noise.
		const tilt = new BeatHold(0.25);
		let fill = 0;

		return {
			reset() {
				tilt.reset();
				fill = 0;
			},
			render(out, ctx) {
				const { f, p, palette, hueShift } = ctx;
				out.fill(0);

				// Slew in beats, not seconds, so the same build reads the same at any tempo: it
				// may only climb smoothly, but it collapses fast when the build ends.
				const perBeat = f.dt / Math.max(0.05, f.beatPeriod);
				fill = clamp(fill + clamp(f.buildProgress - fill, -perBeat * 2, perBeat * 0.3));
				if (fill < 0.01) return;

				const warm = tilt.update(spectralTilt(f), f.beat, f.dt, f.beatPeriod);
				const gain = 0.7 + p.intensity * 1.5;
				// Build progress may bleach toward white; spectral tint stays within
				// base..glow.
				const body = lerp(lerp(SLOT.base, SLOT.glow, clamp(warm)), SLOT.white, clamp(fill * fill * 0.6));

				fillBar(out, ring.map, ring.length, fill, palette, body, hueShift, gain);
				fillBar(out, beam.map, beam.length, fill, palette, body, hueShift, gain);
			}
		};
	}
};
