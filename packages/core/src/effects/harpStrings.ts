import type { EffectDef } from '../contracts/effect.ts';
import { SPECTRUM_BANDS } from '../contracts/frame.ts';
import { SLOT } from '../contracts/palette.ts';
import { setSample } from '../color/palette.ts';
import { alphaFor, clamp, lerp } from '../dsl/math.ts';
import { INTENSITY, param } from './helpers.ts';

/** Modes per string. Eight rebuild a pluck's corner closely enough to read as a point. */
const MODES = 8;
/** Spectrum span the strings divide between them, 0..1, lowest register first. */
const LOWEST = 0.06;
const HIGHEST = 0.94;
/** Rise in a register, above its own recent level, that counts as a new note. */
const ONSET = 0.05;
/** A register plucks again only after its last pluck has rung this long, seconds. */
const REFRACTORY = 0.16;

/**
 * Each strip is a string tuned to a register: the long walls the low end, the beam the middle,
 * the short walls the top. A note plucks its string where the note sits in the register, a
 * sharp peak that softens into one slow lobe as the higher modes ring out first. A sustained
 * register hums faintly on the fundamental, so a held chord is still visible.
 */
export const harpStrings: EffectDef = {
	id: 'harpStrings',
	name: 'Harp Strings',
	role: 'rhythm',
	blurb: 'Every strip is a string: a note plucks it where it sits in the register, and the bright point rings out into one slow glow.',
	taste: {
		energy: 2,
		sections: ['intro', 'breakdown', 'outro'],
		minBars: 2,
		maxBars: 64,
		peakReserved: false,
		activity: 0.25,
		noteReactive: true,
		carries: false
	},
	params: [INTENSITY, param('ring', 'Ring time', 0.5)],
	create(g) {
		const strings = g.strips.length;
		const shape = new Float32Array(g.count * MODES);
		for (let i = 0; i < g.count; i++) {
			for (let n = 0; n < MODES; n++) shape[i * MODES + n] = Math.sin((n + 1) * Math.PI * g.local[i]);
		}
		// Registers ascend from the longest strip to the shortest; the beam, off the ring, takes
		// the middle so the voice sits over the room's centre line.
		const order = g.strips
			.map((s, k) => ({ k, rank: s.inPerimeter ? s.count : -1 }))
			.sort((a, b) => b.rank - a.rank || a.k - b.k)
			.map((s) => s.k);
		const beam = order.indexOf(g.strips.findIndex((s) => !s.inPerimeter));
		if (beam >= 0) order.splice(Math.floor(strings / 2), 0, order.splice(beam, 1)[0]);
		const register = new Uint8Array(strings);
		for (let r = 0; r < strings; r++) register[order[r]] = r;

		const amp = new Float32Array(strings * MODES);
		const hum = new Float32Array(strings);
		const now = new Float32Array(SPECTRUM_BANDS);
		const recent = new Float32Array(SPECTRUM_BANDS);
		const armed = new Uint8Array(strings);
		const lastPluck = new Float64Array(strings);
		let started = false;

		return {
			reset() {
				amp.fill(0);
				hum.fill(0);
				now.fill(0);
				recent.fill(0);
				started = false;
			},
			render(out, ctx) {
				const { f, p, palette, hueShift, motion } = ctx;
				const bands = Math.min(SPECTRUM_BANDS, f.spectrum.length);
				if (!started) {
					started = true;
					for (let b = 0; b < bands; b++) {
						now[b] = f.spectrum[b];
						recent[b] = f.spectrum[b];
					}
					armed.fill(1);
					lastPluck.fill(-Infinity);
				}
				const fast = alphaFor(f.dt, 0.02);
				const slow = alphaFor(f.dt, 0.45);
				for (let b = 0; b < bands; b++) {
					now[b] += (f.spectrum[b] - now[b]) * fast;
					recent[b] += (f.spectrum[b] - recent[b]) * slow;
				}

				// The fundamental rings for one to three beats; each higher mode proportionally less.
				const ring = Math.max(0.25, f.beatPeriod * (0.9 + 2 * p.ring)) / Math.max(0.2, motion);
				for (let k = 0; k < amp.length; k++) amp[k] *= 1 - alphaFor(f.dt, ring / ((k % MODES) + 1));

				for (let s = 0; s < strings; s++) {
					const r = register[s];
					const from = LOWEST + ((HIGHEST - LOWEST) * r) / strings;
					const to = LOWEST + ((HIGHEST - LOWEST) * (r + 1)) / strings;
					const lo = Math.round(from * (bands - 1));
					const hi = Math.max(lo + 1, Math.round(to * (bands - 1)));
					let rise = 0;
					let at = 0;
					let level = 0;
					for (let b = lo; b < hi; b++) {
						const d = Math.max(0, now[b] - recent[b]);
						rise += d;
						at += d * (b - lo);
						level += now[b];
					}
					const width = hi - lo;
					hum[s] += (level / width - hum[s]) * alphaFor(f.dt, 0.6);
					// Where the note sits in its register is where the string is plucked.
					const where = width > 1 && rise > 1e-6 ? at / rise / (width - 1) : 0.5;
					rise /= width;
					if (rise < ONSET * 0.5) armed[s] = 1;
					if (!armed[s] || rise < ONSET || f.t - lastPluck[s] < REFRACTORY) continue;
					armed[s] = 0;
					lastPluck[s] = f.t;
					const x = 0.18 + 0.64 * clamp(where);
					// A dense mix moves a register less than a sparse one, so a small rise still
					// plucks visibly; a louder note plucks harder.
					const strength = clamp(0.45 + rise * 6);
					// Mode amplitudes of a triangle with its apex at x and unit height.
					const norm = (2 * strength) / (Math.PI * Math.PI * x * (1 - x));
					for (let n = 0; n < MODES; n++) {
						const m = n + 1;
						amp[s * MODES + n] += (norm * Math.sin(m * Math.PI * x)) / (m * m);
					}
				}

				const gain = 0.32 + p.intensity * 0.6;
				for (let i = 0; i < g.count; i++) {
					const s = g.strip[i];
					const base = s * MODES;
					const o = i * MODES;
					let y = 0;
					for (let n = 0; n < MODES; n++) y += amp[base + n] * shape[o + n];
					const v = Math.min(1.2, Math.max(0, y) + 0.22 * hum[s] * shape[o]);
					setSample(out, i, palette, lerp(SLOT.base, SLOT.white, clamp(v * 0.7)) + hueShift, v * gain);
				}
			}
		};
	}
};
