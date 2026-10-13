import type { EffectDef } from '../contracts/effect.ts';
import { SLOT } from '../contracts/palette.ts';
import { setSample } from '../color/palette.ts';
import { clamp, smoothstep } from '../dsl/math.ts';
import { Presence } from '../dsl/env.ts';
import { INTENSITY, param } from './helpers.ts';

const MAX_ECHOES = 24;
/** Seconds each repeat holds at its peak before the lamp release, past the eye's integration. */
const HOLD = 0.05;
/** Repeats quieter than this are inaudible on a real delay and invisible here. */
const LAST = 0.06;

interface Echo {
	alive: boolean;
	/** When the repeat sounds, seconds. */
	at: number;
	level: number;
	/** 0 centre, 1 west, 2 east. */
	side: number;
}

/**
 * A ping-pong delay throw: the dry snare lands across the middle of the room, its repeats
 * alternate between the west and east sides on the delay grid, each quieter than the last.
 * A new throw ducks the tail of the old one, as a ducked delay does.
 */
export const pingPong: EffectDef = {
	id: 'pingPong',
	name: 'Ping-Pong',
	role: 'transient',
	blurb: 'Each snare lands across the middle of the room and echoes left, right, left on the delay, every repeat quieter.',
	taste: {
		energy: 4,
		sections: ['groove', 'breakdown', 'build', 'drop'],
		minBars: 2,
		maxBars: 32,
		peakReserved: false,
		activity: 0.45,
		kit: 'snare'
	},
	params: [
		INTENSITY,
		param('delay', 'Delay in beats', 0.75, 0.25, 1.5, 0.25),
		param('feedback', 'Feedback', 0.6, 0.2, 0.75)
	],
	create(g) {
		// Left, centre and right thirds of the room in world x; the beam is the centre line.
		const west = new Float32Array(g.count);
		const centre = new Float32Array(g.count);
		const east = new Float32Array(g.count);
		let half = 0;
		for (let i = 0; i < g.count; i++) half = Math.max(half, Math.abs(g.x[i]));
		for (let i = 0; i < g.count; i++) {
			const x = g.x[i] / Math.max(1e-6, half);
			west[i] = smoothstep(0.3, 0.95, -x);
			east[i] = smoothstep(0.3, 0.95, x);
			centre[i] = 1 - smoothstep(0.08, 0.42, Math.abs(x));
		}
		const echoes: Echo[] = [];
		for (let k = 0; k < MAX_ECHOES; k++) echoes.push({ alive: false, at: 0, level: 0, side: 0 });
		const snares = new Presence();
		let next = 0;
		let throws = 0;
		let lastThrow = -Infinity;

		const schedule = (at: number, level: number, side: number) => {
			const e = echoes[next];
			next = (next + 1) % MAX_ECHOES;
			e.alive = true;
			e.at = at;
			e.level = level;
			e.side = side;
		};

		return {
			reset() {
				for (const e of echoes) e.alive = false;
				snares.reset();
				next = 0;
				throws = 0;
				lastThrow = -Infinity;
			},
			render(out, ctx) {
				const { f, p, palette, hueShift } = ctx;
				const playing = snares.update(f.snareEnv, f.dt, f.beatPeriod);

				// A roll throws again only once the last throw's first repeat has sounded.
				if (f.snare && playing > 0.15 && f.t - lastThrow > Math.max(0.5, p.delay) * f.beatPeriod) {
					lastThrow = f.t;
					// Only repeats still to come are ducked; one already glowing fades on its own.
					for (const e of echoes) if (e.alive && e.at > f.t) e.level *= 0.5;
					const dry = clamp(0.45 + 0.55 * f.snareEnv) * playing;
					schedule(f.t, dry, 0);
					// On a fast record a short delay doubles, staying on the grid under 5 Hz.
					let delay = Math.max(0.05, p.delay * f.beatPeriod);
					while (delay < 0.2) delay *= 2;
					const first = throws % 2 === 0 ? 1 : 2;
					let level = dry;
					for (let n = 1; n <= 6; n++) {
						level *= p.feedback;
						if (level < LAST) break;
						schedule(f.t + n * delay, level, n % 2 === 1 ? first : 3 - first);
					}
					throws++;
				}

				// A lamp release under a third of a beat: repeats stay distinct at a dotted eighth.
				const tau = clamp(f.beatPeriod * 0.3, 0.06, 0.2);
				let l = 0;
				let c = 0;
				let r = 0;
				for (const e of echoes) {
					if (!e.alive) continue;
					const age = f.t - e.at;
					if (age < 0) continue;
					const env = age <= HOLD ? 1 : Math.exp(-(age - HOLD) / tau);
					if (env < 0.01) {
						e.alive = false;
						continue;
					}
					const v = e.level * env;
					if (e.side === 0) c += v;
					else if (e.side === 1) l += v;
					else r += v;
				}

				const gain = 0.4 + p.intensity * 0.65;
				const slot = SLOT.accent + hueShift;
				for (let i = 0; i < g.count; i++) {
					const v = (centre[i] * c + west[i] * l + east[i] * r) * gain;
					setSample(out, i, palette, slot, Math.min(v, 1.2));
				}
			}
		};
	}
};
