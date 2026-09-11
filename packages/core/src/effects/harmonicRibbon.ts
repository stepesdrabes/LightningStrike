import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { addSample } from '../color/palette.ts';
import { clamp, lerp } from '../dsl/math.ts';
import { ringU } from '../dsl/space.ts';
import { bandBetween, spectralTilt, spectrumFocus } from '../dsl/spectrum.ts';
import { Follower } from '../dsl/env.ts';
import { INTENSITY, param } from './helpers.ts';

/** A broad coloured ribbon follows note level above the room's carrying bed. */
export const harmonicRibbon: EffectDef = {
	id: 'harmonicRibbon',
	name: 'Harmonic Ribbon',
	role: 'accent',
	blurb: 'A soft band tracking the brightest voice in the mix, tightening as it stands alone.',
	taste: {
		energy: 2,
		// Limit to quiet sections; drops already have a sustained floor.
		sections: ['intro', 'groove', 'breakdown', 'outro'],
		minBars: 2,
		maxBars: 32,
		peakReserved: false,
		activity: 0.1,
		noteReactive: true,
		// A gentle note voice still needs the bed to provide room-wide visible light.
		carries: false,
		quiet: 5.33
	},
	params: [INTENSITY, param('travel', 'How far it walks', 0.7), param('width', 'Band width', 0.5)],
	create(g) {
		// How loud the passage is, which is a level and belongs slow.
		const level = new Follower(0.1, 0.7);
		// Smooth position and width more slowly than level to avoid jumps while retaining
		// between-beat motion.
		const centroid = new Follower(0.35, 0.75);
		const width = new Follower(0.28, 0.6);
		const voice = new Follower(0.035, 0.18);
		const baseline = new Follower(0.75, 1.2);

		return {
			reset() {
				level.reset();
				centroid.reset();
				width.reset();
				voice.reset();
				baseline.reset();
			},
			render(out, ctx) {
				const { f, p, palette, hueShift, motion } = ctx;
				// Rewrite the band each frame; accumulating over decay would leave lagging,
				// rippling edges.
				out.fill(0);

				const at = centroid.update(spectralTilt(f), f.dt);
				const spread = width.update(1 - spectrumFocus(f), f.dt);
				const heard = level.update(f.energy, f.dt);
				const note = Math.max(
					bandBetween(f, 0.15, 0.42),
					bandBetween(f, 0.42, 0.67),
					bandBetween(f, 0.67, 0.85)
				);
				const sounding = voice.update(note, f.dt);
				// Both followers measure the same spectrum range; passage energy has a different scale.
				const played = clamp((sounding - baseline.update(note, f.dt)) * 5);

				// Let the sounding note carry quiet music, with short articulation above it.
				const gain = (0.24 + p.intensity * 0.58)
					* (0.4 + sounding * 0.45 + played * 0.4) * (0.75 + heard * 0.25);
				// The note should cover a region rather than a narrow stripe.
				const sigma = 0.07 + spread * 0.1 + p.width * 0.08;
				const slot = lerp(SLOT.base, SLOT.glow, at);
				// Move around the perimeter so the melody crosses the room; cue motion sets the
				// travel range.
				const centre = 0.5 + (at - 0.5) * (0.4 + p.travel * 1.2) * clamp(0.25 + motion * 0.75);

				for (let i = 0; i < g.count; i++) {
					const d = Math.abs(ringU(g, i) - centre);
					const wrapped = Math.min(d, 1 - d);
					const v = Math.exp(-(wrapped * wrapped) / (2 * sigma * sigma));
					// Keep a faint continuation under the brightest part of the ribbon.
					addSample(out, i, palette, slot + hueShift, (0.28 + v * 0.72) * gain);
				}
			}
		};
	}
};
