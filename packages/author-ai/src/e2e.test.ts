import { describe, expect, it } from 'vitest';
import {
	BUILT_IN_EFFECTS,
	DEFAULT_ROOM,
	EffectRegistry,
	Mixer,
	ShowPlayer,
	buildGeometry,
	compileGenerated,
	type Cue,
	type Show,
	type TrackAnalysis
} from '@mv/core';
import { analyzeTrack } from '@mv/analysis';
import { lintShow } from '@mv/author-engine';

const SR = 22050;

/** A short but structurally complete track, cheap enough to analyse inside a test. */
function synth(): { mono: Float32Array; duration: number; kicks: number[] } {
	const bpm = 120;
	const beat = 60 / bpm;
	const bar = beat * 4;
	const stages = [
		{ bars: 4, kick: 0, pad: 0.6, riser: false },
		{ bars: 8, kick: 0.9, pad: 0.5, riser: false },
		{ bars: 4, kick: 0.5, pad: 0.7, riser: true },
		{ bars: 8, kick: 1, pad: 0.6, riser: false },
		{ bars: 4, kick: 0, pad: 0.3, riser: false }
	];
	const totalBars = stages.reduce((n, s) => n + s.bars, 0);
	const duration = totalBars * bar;
	const mono = new Float32Array(Math.ceil(duration * SR));

	let seed = 7;
	const rand = () => {
		seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
		return seed / 4294967296 - 0.5;
	};

	const kicks: number[] = [];
	let b = 0;
	for (const s of stages) {
		for (let k = 0; k < s.bars; k++, b++) {
			const start = b * bar;
			for (let beatIdx = 0; beatIdx < 4 && s.kick > 0; beatIdx++) {
				kicks.push(start + beatIdx * beat);
				const i0 = Math.floor((start + beatIdx * beat) * SR);
				for (let i = 0; i < 0.14 * SR && i0 + i < mono.length; i++) {
					mono[i0 + i] += Math.sin((2 * Math.PI * 55 * i) / SR) * Math.exp((-i / SR) * 34) * s.kick;
				}
			}
			if (s.pad > 0) {
				const i0 = Math.floor(start * SR);
				for (let i = 0; i < bar * SR && i0 + i < mono.length; i++) {
					mono[i0 + i] += Math.sin((2 * Math.PI * 440 * i) / SR) * 0.12 * s.pad;
				}
			}
			if (s.riser) {
				const i0 = Math.floor(start * SR);
				const climb = k / Math.max(1, s.bars - 1);
				for (let i = 0; i < bar * SR && i0 + i < mono.length; i++) {
					mono[i0 + i] += rand() * 0.16 * (0.25 + climb);
				}
			}
		}
	}
	for (let i = 0; i < mono.length; i++) mono[i] = Math.max(-1, Math.min(1, mono[i]));
	return { mono, duration, kicks };
}

const track = synth();
const none = { times: [], levels: [] };
const analysis: TrackAnalysis = analyzeTrack({
	mono: track.mono,
	sampleRate: SR,
	duration: track.duration,
	hash: 'e2ehash',
	trackId: 'file-0123456789ab',
	title: 'E2E',
	// The kicks as Striker 2.0 would hear them, so the kit gates have drums to read.
	striker2: {
		name: 'Striker 2.0 (e2e)',
		drums: { kick: { times: track.kicks, levels: track.kicks.map(() => 0.8) }, snare: none, hat: none, cymbal: none, tom: none },
		bass: none,
		activity: { drums: [], bass: [], vocals: [], other: [] }
	}
});

/** The DSL exercise a generated effect is expected to survive. */
const GENERATED_SOURCE = `
function create(g) {
  const rings = ringsFor(g);
  const ring = rings.perimeter;
  const scratch = new Float32Array(ring.length * 3);
  const env = new PulseEnv();
  let pos = 0;
  return {
    reset() { pos = 0; env.reset(); scratch.fill(0); },
    render(out, ctx) {
      const f = ctx.f;
      if (f.downbeat) env.fire(1);
      const punch = env.decay(f.dt, f.beatPeriod, 0.75);
      pos = (pos + pxPerSecond(ring, 2.5) * f.dt * ctx.motion) % ring.length;
      fadeToBlack(scratch, f.dt, 0.14);
      for (let k = 0; k < 3; k++) {
        const at = (pos + (k * ring.length) / 3) % ring.length;
        const u = k === 0 ? SLOT.white : SLOT.accent;
        stampGaussian(scratch, ring.length, at, 5 + 14 * punch, 0, 0, 0, true);
        addSample(scratch, Math.round(at) % ring.length, ctx.palette, u, ctx.p.intensity * (0.4 + punch));
      }
      out.fill(0);
      scatter(ring, scratch, out);
    }
  };
}
`;

const geometry = buildGeometry(DEFAULT_ROOM);

function cue(bar: number, section: Cue['section'], layers: Cue['layers'], extra: Partial<Cue> = {}): Cue {
	return { bar, section, layers, note: `bar ${bar}`, ...extra };
}

/** Built against whatever the analyser actually reported, not against assumed bar numbers. */
function buildShow(): Show {
	const sectionAt = (kind: string) => analysis.sections.find((s) => s.kind === kind);
	const build = sectionAt('build');
	const outro = sectionAt('outro');
	// The peak by rank rather than by label: which kind the detector settles on for a given
	// fixture is its own business, and this test is about the registry, not the labelling.
	const peak = analysis.sections.find((s) => s.energyRank === 1)!;

	const cues: Cue[] = [cue(0, 'intro', { bed: { effect: 'wash' } }, { intensity: 0.3 })];
	if (build && build.startBar > 0 && build.startBar < peak.startBar) {
		cues.push(cue(build.startBar, 'build', { rhythm: { effect: 'riser' } }, { intensity: 0.8 }));
	}
	cues.push(
		cue(
			peak.startBar,
			peak.kind,
			{
				bed: { effect: 'wash' },
				rhythm: { effect: 'orbitTrio' },
				transient: { effect: 'shockwave' },
				accent: { effect: 'sparkle' }
			},
			{ intensity: 1, fadeBeats: 0, palette: 'swap' }
		)
	);
	if (outro && outro.startBar > peak.startBar) {
		cues.push(cue(outro.startBar, 'outro', { bed: { effect: 'wash' } }, { intensity: 0.25 }));
	}

	return {
		version: 1,
		trackId: analysis.trackId,
		title: analysis.title,
		analysisHash: analysis.hash,
		brief: 'Magenta room, cyan drop, one generated orbit effect carrying the drop.',
		palette: { base: 320, accent: 185, sat: 0.94, shade: 0.08, white: 0.06 },
		defaults: { intensity: 0.8, motion: 1, fadeBeats: 8 },
		generatedEffects: [
			{
				id: 'orbitTrio',
				name: 'Orbit Trio',
				role: 'rhythm',
				blurb: 'Three lights orbiting the ring, punched wider on every downbeat.',
				params: [{ key: 'intensity', label: 'Intensity', min: 0, max: 1, step: 0.01, default: 0.8 }],
				source: GENERATED_SOURCE
			}
		],
		cues,
		hits: [
			{ bar: peak.startBar, beat: 0, kind: 'slam', beats: analysis.tempo.beatsPerBar, note: 'Peak.' }
		]
	};
}

describe('generated effect', () => {
	const result = compileGenerated(buildShow().generatedEffects[0], geometry);

	it('passes the admission gate', () => {
		expect(result.failures).toEqual([]);
		expect(result.def).not.toBeNull();
	});

	it('is rejected when it reaches for Math.random', () => {
		const bad = {
			...buildShow().generatedEffects[0],
			source: GENERATED_SOURCE.replace('let pos = 0;', 'let pos = Math.random();')
		};
		const out = compileGenerated(bad, geometry);
		expect(out.def).toBeNull();
		expect(out.failures.join(' ')).toMatch(/banned construct/);
	});

	it('is rejected when it writes a non-finite pixel', () => {
		const bad = {
			...buildShow().generatedEffects[0],
			// After the scatter, or the write is simply overwritten and proves nothing.
			source: GENERATED_SOURCE.replace(
				'scatter(ring, scratch, out);',
				'scatter(ring, scratch, out); out[0] = 0 / 0;'
			)
		};
		const out = compileGenerated(bad, geometry);
		expect(out.def).toBeNull();
		expect(out.failures.join(' ')).toMatch(/non-finite/);
	});

	it('is rejected when it has no create function', () => {
		const bad = { ...buildShow().generatedEffects[0], source: 'const x = 1;' };
		expect(compileGenerated(bad, geometry).def).toBeNull();
	});
});

describe('the whole chain', () => {
	const show = buildShow();
	const registry = new EffectRegistry();
	const compiled = compileGenerated(show.generatedEffects[0], geometry);
	if (compiled.def) registry.add(compiled.def);

	const effects = new Map(BUILT_IN_EFFECTS.map((e) => [e.id, e]));
	if (compiled.def) effects.set(compiled.def.id, compiled.def);

	it('lints without errors', () => {
		const verdict = lintShow(show, { analysis, effects });
		expect(verdict.errors).toEqual([]);
	});

	it('plays the whole track producing finite bytes and real light', () => {
		const mixer = new Mixer(geometry);
		const player = new ShowPlayer(mixer, registry);
		player.load(analysis, show);

		const dt = 1 / 60;
		let litFrames = 0;
		let badBytes = 0;
		const perSection = new Map<string, { sum: number; n: number }>();

		for (let t = 0; t < analysis.duration; t += dt) {
			const frame = player.update(t, dt);
			mixer.render(frame);

			// Accumulate rather than asserting per byte: a per-byte expect() over the whole
			// track is millions of calls and dominates the runtime completely.
			let sum = 0;
			for (let i = 0; i < mixer.bytes.length; i++) {
				const v = mixer.bytes[i];
				if (!Number.isFinite(v)) badBytes++;
				sum += v;
			}
			const mean = sum / mixer.bytes.length;
			if (mean > 1) litFrames++;

			const acc = perSection.get(frame.section) ?? { sum: 0, n: 0 };
			acc.sum += mean;
			acc.n++;
			perSection.set(frame.section, acc);
		}

		expect(badBytes).toBe(0);
		expect(litFrames).toBeGreaterThan(100);

		// The perceptual property the whole pre-analysis exists for: a drop must read brighter
		// than an intro. A realtime AGC would pull them level.
		const mean = (k: string) => {
			const a = perSection.get(k);
			return a && a.n > 0 ? a.sum / a.n : 0;
		};
		const peakKind = analysis.sections.find((s) => s.energyRank === 1)!.kind;
		if (perSection.has(peakKind) && perSection.has('intro')) {
			expect(mean(peakKind)).toBeGreaterThan(mean('intro') * 1.2);
		}
	});

	it('keeps generated effects registered through load, so their cues are not black', () => {
		const mixer = new Mixer(geometry);
		const player = new ShowPlayer(mixer, registry);
		player.load(analysis, show);

		expect(registry.get('orbitTrio')).not.toBeNull();

		const peakCue = show.cues.find((c) => c.layers.rhythm?.effect === 'orbitTrio');
		expect(peakCue).toBeDefined();

		const dt = 1 / 60;
		const start = analysis.sections.find((s) => s.energyRank === 1)!.startTime;
		let lit = 0;
		for (let t = start; t < start + 4; t += dt) {
			mixer.render(player.update(t, dt));
			if (mixer.layers.rhythm.buf.some((v) => v > 0.001)) lit++;
		}
		expect(mixer.layers.rhythm.def?.id).toBe('orbitTrio');
		expect(lit).toBeGreaterThan(60);
	});

	it('renders identically after seeking back to the same point', () => {
		const mixer = new Mixer(geometry);
		const player = new ShowPlayer(mixer, registry);
		player.load(analysis, show);

		const dt = 1 / 60;
		const target = analysis.duration * 0.6;

		for (let t = 0; t < target; t += dt) mixer.render(player.update(t, dt));
		const first = Uint8Array.from(mixer.bytes);

		player.reset();
		for (let t = 0; t < target; t += dt) mixer.render(player.update(t, dt));

		expect(Array.from(mixer.bytes)).toEqual(Array.from(first));
	});
});
