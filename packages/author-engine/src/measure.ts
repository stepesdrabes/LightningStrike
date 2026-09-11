import type { EffectDef, Geometry, SectionKind, Show, TrackAnalysis } from '@mv/core';
import { EffectRegistry, Mixer, ShowPlayer, barTimeAt } from '@mv/core';
import { MAX_VOID_BARS } from './lint.ts';

/**
 * Per-cue measurements from the actual player and mixer. Visibility is measured after byte
 * encoding.
 */
interface CueReading {
	bar: number;
	endBar: number;
	/** The cue's own label, which may disagree with the detector's. */
	section: SectionKind;
	/** Mean delivered byte over the cue, across the whole room. */
	level: number;
	/** Share of LEDs above byte 8, roughly where a pixel stops reading as off in a dark room. */
	lit: number;
	/** Dimmest/brightest strip mean, 0..1; unlike pixel variance, this detects an unlit wall. */
	spread: number;
	/**
	 * Mean (max-min)/max over lit pixels, 0 grey to 1 saturated. Dim cues need chroma to offset
	 * the Hunt effect.
	 */
	chroma: number;
	/** Movement across a phrase, with frame-rate shimmer already removed. */
	drift: number;
	/** Movement at frame scale: the room shimmering rather than moving. */
	ripple: number;
}

interface HitReading {
	bar: number;
	kind: Show['hits'][number]['kind'];
	/** False when the room never did what the hit asked inside its own span. */
	fired: boolean;
}

interface ShowReading {
	fps: number;
	cues: CueReading[];
	/** Mean delivered byte in the drops against the mean in the intro, outro and breakdowns. */
	contrast: number;
	hits: HitReading[];
	/** Unrequested dark bars, excluding valid voids and blackouts. */
	darkBars: number[];
	/** Frames exceeding color/level jump caps outside cue changes and punctuation. */
	hueJumps: number;
	levelJumps: number;
}

/** Where a pixel stops reading as off in a dark room. */
const VISIBLE = 8;
/** Fast and slow averages separate phrase movement (~0.3-2 Hz) from frame-scale shimmer. */
const FAST_TAU = 0.08;
const SLOW_TAU = 0.5;

/** Which kinds the contrast ratio is taken between: the loudest against the three quiet ones. */
const LOUD: ReadonlySet<SectionKind> = new Set<SectionKind>(['drop', 'chorus']);
const QUIET: ReadonlySet<SectionKind> = new Set<SectionKind>(['breakdown', 'intro', 'outro']);

interface Accumulator {
	level: number;
	lit: number;
	spread: number;
	chroma: number;
	drift: number;
	ripple: number;
	n: number;
}

interface MeasureOptions {
	/**
	 * Frames/second, default 60. Lower rates change integrated envelopes and levels; use 60 to
	 * judge motion.
	 */
	fps?: number;
}

export function measureShow(
	show: Show,
	analysis: TrackAnalysis,
	effects: Map<string, EffectDef>,
	geometry: Geometry,
	opts: MeasureOptions = {}
): ShowReading {
	const fps = opts.fps ?? 60;
	const dt = 1 / fps;

	const registry = new EffectRegistry();
	for (const def of effects.values()) registry.add(def);

	const mixer = new Mixer(geometry);
	const player = new ShowPlayer(mixer, registry);
	player.load(analysis, show);
	player.reset();

	const cues = [...show.cues].sort((a, b) => a.bar - b.bar);
	const lastBar = analysis.bars.length - 1;
	const cueAt = cueIndexPerBar(cues, analysis.bars.length);

	const pixels = geometry.count;
	const fast = new Float32Array(pixels);
	const slow = new Float32Array(pixels);
	const level = new Float32Array(pixels);

	const totals: Accumulator[] = cues.map(() => ({
		level: 0,
		lit: 0,
		spread: 0,
		chroma: 0,
		drift: 0,
		ripple: 0,
		n: 0
	}));
	const barLevel = new Float64Array(analysis.bars.length);
	const barFrames = new Float64Array(analysis.bars.length);

	// A hit has fired when the room does what it asks inside its own span: a blackout when the
	// intensity collapses, anything else when its effect is the one installed in the master.
	const windows = show.hits.map((h) => {
		const start = barTimeAt(analysis.tempo, h.bar);
		const beat = (barTimeAt(analysis.tempo, h.bar + 1) - start) / analysis.tempo.beatsPerBar;
		const from = start + (h.beat ?? 0) * beat;
		return { from, to: from + h.beats * beat, kind: h.kind, bar: h.bar };
	});
	const fired = new Set<number>();

	const aFast = 1 - Math.exp(-dt / FAST_TAU);
	const aSlow = 1 - Math.exp(-dt / SLOW_TAU);
	let first = true;

	// Scale the reference 10 Hz caps (100 degrees hue, 20% intensity per step) to this rate;
	// events are exempt.
	const HUE_CAP = (100 / (0.1 * fps)) * 1.0;
	const LEVEL_CAP = (0.2 / (0.1 * fps)) * 255;
	let hueJumps = 0;
	let levelJumps = 0;
	let prevHue = Number.NaN;
	let prevMean = Number.NaN;
	let prevCue = -1;
	let licensedUntil = -1;

	for (let t = 0; t < analysis.duration; t += dt) {
		const f = player.update(t, dt);
		mixer.render(f);

		let sum = 0;
		let lit = 0;
		let chroma = 0;
		let drift = 0;
		let ripple = 0;
		let sumR = 0;
		let sumG = 0;
		let sumB = 0;

		for (let k = 0; k < pixels; k++) {
			const i = k * 3;
			const r = mixer.bytes[i];
			const g = mixer.bytes[i + 1];
			const b = mixer.bytes[i + 2];
			const v = Math.max(r, g, b);
			level[k] = v;
			sum += v;
			sumR += r;
			sumG += g;
			sumB += b;
			if (v >= VISIBLE) {
				lit++;
				chroma += (v - Math.min(r, g, b)) / v;
			}
			if (first) {
				fast[k] = v;
				slow[k] = v;
			} else {
				fast[k] += (v - fast[k]) * aFast;
				slow[k] += (v - slow[k]) * aSlow;
			}
			drift += Math.abs(fast[k] - slow[k]);
			ripple += Math.abs(v - fast[k]);
		}
		first = false;

		{
			const barNow = Math.min(Math.max(f.barIndex, 0), lastBar);
			const cueNow = cueAt[barNow];
			if (cueNow !== prevCue) {
				prevCue = cueNow;
				licensedUntil = t + f.beatPeriod;
			}
			for (const w of windows) {
				if (t >= w.from && t < w.to + 0.5) licensedUntil = Math.max(licensedUntil, w.to + 0.5);
			}
			const mean = sum / pixels;
			const hue = meanHue(sumR, sumG, sumB);
			if (t > licensedUntil && !Number.isNaN(prevHue) && mean > VISIBLE && prevMean > VISIBLE) {
				const dHue = circularDelta(hue, prevHue);
				if (dHue > HUE_CAP) hueJumps++;
				if (Math.abs(mean - prevMean) > LEVEL_CAP) levelJumps++;
			}
			prevHue = hue;
			prevMean = mean;
		}

		let dimmest = Infinity;
		let brightest = 0;
		for (const strip of geometry.strips) {
			let total = 0;
			for (let k = 0; k < strip.count; k++) total += level[strip.offset + k];
			const mean = total / Math.max(1, strip.count);
			if (mean < dimmest) dimmest = mean;
			if (mean > brightest) brightest = mean;
		}

		const bar = Math.min(Math.max(f.barIndex, 0), lastBar);
		const cell = totals[cueAt[bar]];
		if (cell) {
			cell.level += sum / pixels;
			cell.lit += lit / pixels;
			cell.spread += brightest > 0 ? dimmest / brightest : 1;
			cell.chroma += lit > 0 ? chroma / lit : 0;
			cell.drift += drift / pixels;
			cell.ripple += ripple / pixels;
			cell.n++;
		}

		barLevel[bar] += sum / pixels;
		barFrames[bar]++;

		for (let i = 0; i < windows.length; i++) {
			const w = windows[i];
			if (t < w.from || t >= w.to || fired.has(i)) continue;
			const master = mixer.layers.master;
			const ok =
				w.kind === 'blackout'
					? mixer.intensity < 0.1
					: master.effect !== null && master.params.trigger > 0.5;
			if (ok) fired.add(i);
		}
	}

	const readings: CueReading[] = cues.map((cue, i) => {
		const cell = totals[i];
		const n = Math.max(1, cell.n);
		return {
			bar: cue.bar,
			endBar: cues[i + 1]?.bar ?? lastBar + 1,
			section: cue.section,
			level: cell.level / n,
			lit: cell.lit / n,
			spread: cell.spread / n,
			chroma: cell.chroma / n,
			drift: cell.drift / n,
			ripple: cell.ripple / n
		};
	});

	const asked = darknessAskedFor(analysis, show, cues);
	const darkBars: number[] = [];
	for (let bar = 0; bar < barLevel.length; bar++) {
		if (barFrames[bar] === 0 || asked[bar]) continue;
		if (barLevel[bar] / barFrames[bar] < VISIBLE) darkBars.push(bar);
	}

	return {
		fps,
		cues: readings,
		contrast: ratio(readings, LOUD, QUIET),
		hits: windows.map((w, i) => ({ bar: w.bar, kind: w.kind, fired: fired.has(i) })),
		darkBars,
		hueJumps,
		levelJumps
	};
}

/** Hue in degrees, or NaN below 10% chroma where an almost-grey mean would jitter. */
function meanHue(r: number, g: number, b: number): number {
	const max = Math.max(r, g, b);
	const min = Math.min(r, g, b);
	const c = max - min;
	if (max < 1e-6 || c < max * 0.25) return Number.NaN;
	let h: number;
	if (max === r) h = ((g - b) / c) % 6;
	else if (max === g) h = (b - r) / c + 2;
	else h = (r - g) / c + 4;
	return ((h * 60) % 360 + 360) % 360;
}

function circularDelta(a: number, b: number): number {
	if (Number.isNaN(a) || Number.isNaN(b)) return 0;
	const d = Math.abs(a - b) % 360;
	return Math.min(d, 360 - d);
}

/** Weighted by how long each cue holds the room, or a one-bar drop counts as much as a chorus. */
function ratio(
	cues: readonly CueReading[],
	loud: ReadonlySet<SectionKind>,
	quiet: ReadonlySet<SectionKind>
): number {
	const mean = (which: ReadonlySet<SectionKind>) => {
		let sum = 0;
		let bars = 0;
		for (const c of cues) {
			if (!which.has(c.section)) continue;
			const length = Math.max(1, c.endBar - c.bar);
			sum += c.level * length;
			bars += length;
		}
		return bars > 0 ? sum / bars : 0;
	};
	const lo = mean(quiet);
	return lo > 0 ? mean(loud) / lo : 0;
}

/** Which cue covers each bar. Cues tile the track, so this is a walk rather than a search. */
function cueIndexPerBar(cues: Show['cues'], bars: number): Int32Array {
	const out = new Int32Array(bars);
	let cursor = 0;
	for (let bar = 0; bar < bars; bar++) {
		while (cursor + 1 < cues.length && bar >= cues[cursor + 1].bar) cursor++;
		out[bar] = bar < cues[0].bar ? 0 : cursor;
	}
	return out;
}

/** Excuse measured voids, cue voids up to MAX_VOID_BARS, and bars touched by blackouts. */
function darknessAskedFor(analysis: TrackAnalysis, show: Show, cues: Show['cues']): Uint8Array {
	const out = new Uint8Array(analysis.bars.length);
	for (const span of analysis.sections) {
		if (span.kind !== 'void') continue;
		for (let bar = span.startBar; bar < span.endBar && bar < out.length; bar++) out[bar] = 1;
	}
	for (const [i, cue] of cues.entries()) {
		if (cue.section !== 'void') continue;
		const end = Math.min(cues[i + 1]?.bar ?? out.length, cue.bar + MAX_VOID_BARS);
		for (let bar = cue.bar; bar < end && bar < out.length; bar++) if (bar >= 0) out[bar] = 1;
	}
	for (const hit of show.hits) {
		if (hit.kind !== 'blackout') continue;
		const from = hit.bar;
		const to = hit.bar + Math.ceil(((hit.beat ?? 0) + hit.beats) / analysis.tempo.beatsPerBar);
		for (let bar = from; bar < to && bar < out.length; bar++) if (bar >= 0) out[bar] = 1;
	}
	return out;
}

/** The reading as the author reads it: one line per cue, then what needs answering. */
export function formatReading(reading: ShowReading): string {
	const lines: string[] = [
		`Rendered at ${reading.fps} fps through the same mixer that feeds the wire.`,
		'',
		'bars       section     level   lit  spread  chroma  drift  ripple'
	];

	for (const c of reading.cues) {
		lines.push(
			`${`${c.bar}-${c.endBar}`.padEnd(10)} ${c.section.padEnd(10)} ${c.level
				.toFixed(1)
				.padStart(6)} ${`${Math.round(100 * c.lit)}%`.padStart(5)} ${c.spread
				.toFixed(2)
				.padStart(7)} ${c.chroma.toFixed(2).padStart(7)} ${c.drift
				.toFixed(2)
				.padStart(6)} ${c.ripple.toFixed(2).padStart(7)}`
		);
	}

	const missed = reading.hits.filter((h) => !h.fired);
	lines.push('');
	lines.push(
		`drop-to-quiet contrast ${reading.contrast.toFixed(2)}x · ${
			reading.hits.length - missed.length
		}/${reading.hits.length} hits fire`
	);
	if (missed.length > 0) {
		lines.push(
			`never reaches the room: ${missed
				.map((h) => `${h.kind} at bar ${h.bar}`)
				.join(', ')} - a bigger gesture is masking it, or nothing is installed under it`
		);
	}
	if (reading.darkBars.length > 0) {
		lines.push(`dark outside a void, bars: ${summariseRuns(reading.darkBars)}`);
	}
	if (reading.hueJumps > 0 || reading.levelJumps > 0) {
		lines.push(
			`the room's overall look jumps outside any cue or hit: ${reading.hueJumps} hue jump(s), ` +
				`${reading.levelJumps} level jump(s) - smoothness inside sections is what separates designed from assembled`
		);
	}

	lines.push('');
	lines.push('level is the mean byte 0-255 and lit the share of LEDs over byte 8. spread is the');
	lines.push('dimmest strip against the brightest, so 1.0 lights every wall and 0.2 leaves three of');
	lines.push('them out. drift is movement across a phrase, ripple is shimmer at frame rate: a quiet');
	lines.push('passage wants drift and not ripple.');
	return lines.join('\n');
}

/** 4, 5, 6, 9 as "4-6, 9". A list of ninety bar numbers is not a finding anyone can act on. */
function summariseRuns(bars: readonly number[]): string {
	const runs: string[] = [];
	let start = bars[0];
	let prev = bars[0];
	for (let i = 1; i <= bars.length; i++) {
		const bar = bars[i];
		if (bar === prev + 1) {
			prev = bar;
			continue;
		}
		runs.push(start === prev ? `${start}` : `${start}-${prev}`);
		start = bar;
		prev = bar;
	}
	return runs.join(', ');
}
