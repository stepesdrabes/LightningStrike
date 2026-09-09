import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { addSample } from '../color/palette.ts';
import { clamp, lerp } from '../dsl/math.ts';
import { Presence } from '../dsl/env.ts';
import { ringsFor } from '../dsl/space.ts';
import { INTENSITY, param } from './helpers.ts';

/**
 * The lattice steps exactly one pixel per step, the wave equation's own time step, which is
 * the one setting where a bump travels without dispersing. Any slower and a stone breaks
 * into a train of short ripples that cross each other for a second, and that lattice of
 * crossings is what the room read as noise. Wave speed is therefore the STEP RATE.
 */
const MAX_STEPS = 12;
/** Half-widths in pixels. A kick is a hand slapping the water, a snare a fingertip. */
const KICK_WIDTH = 20;
const SNARE_WIDTH = 12;

/**
 * A ripple tank the size of the room: the kit drops stones and real waves carry the hit
 * away along the walls. Kicks land at the corners, snares at the wall centres, and the hats
 * drop nothing: a pin every eighth kept the water rough all bar, and a wave only reads as
 * the consequence of a hit when the water was still before it. Light that travels as a
 * CONSEQUENCE of a hit rather than a drawing of one is what a wave equation buys over any
 * envelope.
 */
export const rippleTank: EffectDef = {
	id: 'rippleTank',
	name: 'Ripple Tank',
	role: 'transient',
	blurb: 'Kicks drop stones at the corners; smooth waves carry each hit away along the walls.',
	taste: {
		// Measured as one of the hardest-hitting transients in the catalog, and the top band's
		// transient pool was two effects without it.
		energy: 4,
		sections: ['groove', 'breakdown', 'build', 'drop'],
		minBars: 2,
		maxBars: 32,
		peakReserved: false,
		activity: 0.5,
		kit: 'any'
	},
	params: [
		INTENSITY,
		param('viscosity', 'Ripple decay', 0.35),
		param('spread', 'Wave speed', 0.5)
	],
	create(g) {
		const ring = ringsFor(g).perimeter;
		const n = ring.length;
		const cur = new Float32Array(n);
		const prev = new Float32Array(n);
		const next = new Float32Array(n);

		// The corners are where consecutive ring positions belong to different strips; a
		// 5 x 4 room has them off the quarter marks, so they are found rather than assumed.
		const corners: number[] = [];
		for (let i = 0; i < n; i++) {
			const here = g.strip[ring.map[i]];
			const before = g.strip[ring.map[(i - 1 + n) % n]];
			if (here !== before) corners.push(i);
		}
		if (corners.length === 0) corners.push(0);
		const centres = corners.map((c, k) => {
			const nextCorner = corners[(k + 1) % corners.length];
			const span = (nextCorner - c + n) % n || n;
			return (c + (span >> 1)) % n;
		});

		const kickHome = new Presence();
		const snareHome = new Presence();
		let debt = 0;
		let kickSeq = 0;
		let snareSeq = 0;
		let lastKick = -Infinity;
		let lastSnare = -Infinity;

		// A raised cosine, so the stone has no corner for the lattice to ring on. Written into
		// both frames, which is a stone at rest on the surface: it leaves as two crests of half
		// its height, one along each wall from the corner. Written into the current frame alone
		// it would be a stone thrown UP, and the velocity integrates into a lit plateau that
		// spreads between the crests until the whole ring glows.
		const drop = (at: number, amp: number, width: number) => {
			for (let d = -width; d <= width; d++) {
				const i = (at + d + n) % n;
				const h = amp * (0.5 + 0.5 * Math.cos((Math.PI * d) / (width + 1)));
				cur[i] += h;
				prev[i] += h;
			}
		};

		return {
			reset() {
				cur.fill(0);
				prev.fill(0);
				next.fill(0);
				kickHome.reset();
				snareHome.reset();
				debt = 0;
				kickSeq = 0;
				snareSeq = 0;
				lastKick = -Infinity;
				lastSnare = -Infinity;
			},
			render(out, ctx) {
				const { f, p, palette, hueShift, motion } = ctx;

				const kicking = kickHome.update(f.kickEnv, f.dt, f.beatPeriod);
				const snaring = snareHome.update(f.snareEnv, f.dt, f.beatPeriod);
				// One stone per hit and none for a roll: a second stone inside a third of a beat
				// lands on water the first is still lifting.
				const refractory = f.beatPeriod * 0.3;
				// Stone height goes with the square of the envelope (LedFx's water measure:
				// linear reads flat, squared reads like weight), and each voice owns a home.
				if (f.kick && kicking > 0.15 && f.t - lastKick > refractory) {
					lastKick = f.t;
					// A soft kick is a glow on the corner and only an accented one reaches white.
					drop(corners[kickSeq++ % corners.length], (0.7 + 0.9 * f.kickEnv * f.kickEnv) * kicking, KICK_WIDTH);
				}
				if (f.snare && snaring > 0.15 && f.t - lastSnare > refractory) {
					lastSnare = f.t;
					drop(centres[snareSeq++ % centres.length], (0.4 + 0.6 * f.snareEnv * f.snareEnv) * snaring, SNARE_WIDTH);
				}

				// Speed in ring per beat, so a slow record gets slow water; the decay is in beats
				// too, applied per step so viscosity means the same thing at every speed. Motion
				// scales TIME here, a legal use because the sim is not a clock: pausing it holds
				// the water still.
				const pxPerSecond = (n * (0.06 + p.spread * 0.08)) / Math.max(0.05, f.beatPeriod);
				const tau = Math.max(0.1, f.beatPeriod * (1.7 - p.viscosity * 1.5));
				const damp = Math.exp(-1 / Math.max(1, pxPerSecond * tau));
				debt += f.dt * pxPerSecond * Math.max(0.05, motion);
				let steps = 0;
				while (debt >= 1 && steps < MAX_STEPS) {
					debt -= 1;
					steps++;
					for (let i = 0; i < n; i++) {
						next[i] = cur[(i - 1 + n) % n] + cur[(i + 1) % n] - prev[i];
					}
					// The decay scales both frames together, so the crest keeps its exact shape
					// and only its height leaves; damping the new frame alone breaks the
					// translation and sheds a small counter-running wake at every step.
					for (let i = 0; i < n; i++) {
						prev[i] = cur[i] * damp;
						cur[i] = next[i] * damp;
					}
				}
				// More than a frame's worth of queued steps is a stall, not a debt worth paying.
				if (debt > MAX_STEPS) debt = 0;

				const gain = 0.6 + p.intensity * 0.85;
				out.fill(0);
				for (let r = 0; r < n; r++) {
					const h = cur[r];
					if (h < 0.01) continue;
					// One colour family: the crest heats toward white with its height and only
					// its level moves, which is the owner's rule for anything that hits.
					addSample(out, ring.map[r], palette, lerp(SLOT.base, SLOT.white, clamp(h * 0.8)) + hueShift, clamp(h) * gain);
				}
			}
		};
	}
};
