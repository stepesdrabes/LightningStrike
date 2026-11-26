import type { Cue, Hit, SectionKind, SectionSpan, Show, TrackAnalysis } from '@mv/core';
import { ANALYSIS_VERSION, NUM_BANDS, SHOW_VERSION, SPECTRUM_BANDS, encodeBase64, hash01 } from '@mv/core';
import type { PackInput } from './pack.ts';

/** Every section kind, a build into a drop through a void, and a build into a chorus. */
const PLAN: [SectionKind, number][] = [
	['intro', 4], ['verse', 8], ['build', 4], ['void', 1], ['drop', 8], ['breakdown', 4],
	['groove', 4], ['build', 3], ['chorus', 8], ['outro', 4]
];

const LOUDNESS: Partial<Record<SectionKind, number>> = {
	drop: 0.95,
	chorus: 0.9,
	build: 0.7,
	groove: 0.6,
	verse: 0.55
};

const round2 = (v: number) => Math.round(v * 100) / 100;
const round3 = (v: number) => Math.round(v * 1000) / 1000;
const byte = (v: number) => Math.max(0, Math.min(255, Math.round(v)));

/**
 * A song as analysis rounds one: a drifting grid, every curve, drums with a ghost note, and a show
 * that uses cue palettes, fades, floors, params and all four hits. Seeds vary tempo and phase;
 * an even seed also holds its ending and plays fixed exposure.
 */
export function fixtureSong(seed = 1): PackInput {
	const noise = (k: number) => hash01(seed * 7919 + k);
	const bpm = 118 + seed * 9;
	const period = 60 / bpm;
	const downbeatPhase = seed % 4;
	const firstBeat = round3(0.05 + 0.1 * noise(1));
	const barCount = PLAN.reduce((n, [, bars]) => n + bars, 0);

	const barTimes = [round3(firstBeat + downbeatPhase * period)];
	for (let b = 0; b < barCount; b++) {
		barTimes.push(round3(barTimes[b] + 4 * period * (1 + 0.006 * Math.sin(b * 0.7 + seed))));
	}
	const duration = round3(barTimes[barCount] + 1.7);

	const sections: SectionSpan[] = [];
	const kinds: SectionKind[] = [];
	for (const [kind, bars] of PLAN) {
		const startBar = kinds.length;
		for (let b = 0; b < bars; b++) kinds.push(kind);
		sections.push({
			index: sections.length,
			kind,
			startBar,
			endBar: kinds.length,
			startTime: barTimes[startBar],
			endTime: barTimes[kinds.length],
			lengthBars: bars,
			meanEnergy: 50,
			peakEnergy: 60,
			energyRank: sections.length + 1,
			group: sections.length,
			repeatOf: null
		});
	}
	const loud = (bar: number) => LOUDNESS[kinds[Math.min(Math.max(bar, 0), barCount - 1)]] ?? 0.3;

	const beats = downbeatPhase + barCount * 4 + 1;
	const energy: number[] = [];
	const bands: number[] = [];
	for (let i = 0; i < beats; i++) {
		const e = loud(Math.floor((i - downbeatPhase) / 4));
		energy.push(Math.round(100 * e * (0.85 + 0.15 * noise(100 + i))));
		for (let b = 0; b < NUM_BANDS; b++) bands.push(Math.round(100 * e * noise(5000 + i * NUM_BANDS + b)));
	}

	const spectrumFrames = Math.round(duration * 50);
	const spectrum = new Uint8Array(spectrumFrames * SPECTRUM_BANDS);
	for (let f = 0; f < spectrumFrames; f++) {
		const e = loud(Math.floor(f / 50 / (4 * period)));
		for (let b = 0; b < SPECTRUM_BANDS; b++) {
			spectrum[f * SPECTRUM_BANDS + b] = byte(255 * e * (0.6 + 0.4 * Math.sin(f * 0.09 + b * 0.8)));
		}
	}
	const levelFrames = Math.round(duration * 100);
	const level = new Uint8Array(levelFrames);
	for (let f = 0; f < levelFrames; f++) {
		const e = loud(Math.floor(f / 100 / (4 * period)));
		// The last 1.2 s are silence, so the audio ends before the analysed duration.
		level[f] = f > levelFrames - 120 ? 3 : byte(255 * e * (0.7 + 0.3 * noise(20000 + f)));
	}
	const stereoFrames = Math.ceil(duration * 25);
	const pan = Array.from({ length: stereoFrames }, (_, f) => round2(0.8 * Math.sin(f / 37 + seed)));
	const width = Array.from({ length: stereoFrames }, (_, f) => round2(0.5 + 0.45 * Math.sin(f / 53)));

	const beatTime = (i: number) => {
		const at = (i - downbeatPhase) / 4;
		const b = Math.min(Math.max(Math.floor(at), 0), barCount - 1);
		return round3(barTimes[b] + (barTimes[b + 1] - barTimes[b]) * (at - b));
	};
	const kick = { times: [] as number[], levels: [] as number[] };
	const snare = { times: [] as number[], levels: [] as number[] };
	const hat = { times: [] as number[], levels: [] as number[] };
	for (let i = 0; i < beats - 1; i++) {
		if (kinds[Math.floor((i - downbeatPhase) / 4)] === 'void') continue;
		kick.times.push(beatTime(i));
		// Every seventeenth kick is a ghost note measured at zero.
		kick.levels.push(i % 17 === 0 ? 0 : round2(0.4 + 0.6 * noise(30000 + i)));
		if ((i - downbeatPhase) % 2 === 1) {
			snare.times.push(round3(beatTime(i) + 0.003));
			snare.levels.push(round2(0.5 + 0.5 * noise(40000 + i)));
		}
		hat.times.push(round3(beatTime(i) + period / 2));
		hat.levels.push(round2(noise(50000 + i)));
	}

	const analysis: TrackAnalysis = {
		version: ANALYSIS_VERSION,
		hash: `fixture-${seed}`,
		trackId: `fixture-${seed}`,
		title: `Fixture ${seed}`,
		duration,
		sampleRate: 44100,
		tempo: {
			bpm,
			confidence: 1,
			firstBeat,
			beatPeriod: period,
			beatsPerBar: 4,
			downbeatPhase,
			phraseAnchorBar: seed % 3,
			barsPerPhrase: 8,
			constant: false,
			meterConfidence: 1,
			ambiguous: false,
			alternativeBpm: [],
			barTimes
		},
		key: { tonic: 9, name: 'A minor', mode: 'minor', confidence: 0.8 },
		bars: kinds.map((section, bar) => ({
			bar,
			t: barTimes[bar],
			section,
			energy: Math.round(100 * loud(bar)),
			sub: Math.round(100 * loud(bar) * noise(60000 + bar)),
			low: Math.round(100 * loud(bar) * noise(61000 + bar)),
			mid: Math.round(100 * noise(62000 + bar)),
			air: Math.round(100 * noise(63000 + bar)),
			kicks: 4,
			snares: 2,
			hats: 8,
			vocal: 0.4,
			events: []
		})),
		sections,
		moments: [],
		beats: Array.from({ length: beats + 1 }, (_, i) => beatTime(i)),
		envelopes: { energy, bands },
		spectrum: {
			fps: 50,
			bands: SPECTRUM_BANDS,
			centreHz: Array.from({ length: SPECTRUM_BANDS }, (_, i) => Math.round(30 * Math.pow(1.37, i))),
			data: encodeBase64(spectrum)
		},
		level: { fps: 100, data: encodeBase64(level) },
		stereo: { fps: 25, pan, width },
		onsets: { kick, snare, hat },
		integratedLufs: -8.5,
		loudnessRange: 5.2,
		peakToLoudness: 9.1
	};

	const start = (k: number) => sections[k].startBar;
	const cue = (bar: number, layers: Cue['layers'], more: Partial<Cue> = {}): Cue => {
		const section = kinds[bar];
		return { bar, section, layers, note: section, ...more };
	};
	// Some numbers are composition's long floats, which JSON has to carry to the last digit.
	const cues: Cue[] = [
		cue(0, { bed: { effect: 'wash' }, transient: { effect: 'kitTicks' } }, {
			intensity: 0.536,
			motion: 0.63,
			fadeBeats: 8
		}),
		cue(start(1), {
			bed: { effect: 'undertow' },
			rhythm: { effect: 'snapSplit', params: { hold: 0.75 } },
			transient: { effect: 'pingPong', params: { delay: 1 } }
		}, {
			palette: { base: 228.64999999999998, accent: 40, sat: 0.9814031999999999, shade: 0.22499999999999998 },
			intensity: 0.7392000000000001,
			fadeBeats: 4
		}),
		cue(start(2), {
			bed: { effect: 'spectrumBed' },
			rhythm: { effect: 'riser' },
			accent: { effect: 'buildStrobe' }
		}, { palette: 'swap', intensity: 0.8, motion: 1.1, fadeBeats: 2 }),
		cue(start(3), { bed: { effect: 'blackout' } }, { intensity: 0.05, fadeBeats: 0, floor: 0 }),
		cue(start(4), {
			bed: { effect: 'twoTone', opacity: 0.36000000000000004 },
			rhythm: { effect: 'vortex', params: { barsPerRev: 4, arms: 3, dir: 1, twist: 0.4 } },
			transient: { effect: 'snareBlade' },
			accent: { effect: 'crownSpill' },
			master: { effect: 'blinderWall' }
		}, { intensity: 1, motion: 1.2, fadeBeats: 0 }),
		cue(start(5), { bed: { effect: 'ambientDrift' }, accent: { effect: 'vocalGlow' } }, {
			palette: 'inherit',
			intensity: 0.6,
			fadeBeats: 6,
			floor: 0.5
		}),
		cue(start(6), {
			bed: { effect: 'wash' },
			rhythm: { effect: 'blockChase', params: { order: 1, half: 1 } },
			transient: { effect: 'clapAlong' },
			accent: { effect: 'pitchRibbon' }
		}, { intensity: 0.72, fadeBeats: 4 }),
		cue(start(7), { bed: { effect: 'spectrumBed' }, rhythm: { effect: 'meterBuild' } }, {
			intensity: 0.8,
			fadeBeats: 2
		}),
		cue(start(8), {
			bed: { effect: 'anthemWash' },
			rhythm: { effect: 'pump', params: { sweep: 0.8 } },
			transient: { effect: 'kitTicks' },
			accent: { effect: 'bandBloom' },
			master: { effect: 'silhouette' }
		}, { palette: { base: 300, accent: 140, third: 330, white: 0.2 }, intensity: 0.95, fadeBeats: 0 }),
		cue(start(8) + 4, {
			bed: { effect: 'chorusBloom' },
			rhythm: { effect: 'comet' },
			accent: { effect: 'harmonicRibbon' }
		}, { intensity: 0.9 }),
		cue(start(9), { bed: { effect: 'wash' }, accent: { effect: 'breathe' } }, {
			intensity: 0.5,
			motion: 0.7,
			fadeBeats: 8
		})
	];
	// Every kind, and a blackout over a slam, which outranks it.
	const hits: Hit[] = [
		{ bar: start(3) - 1, beat: 2, kind: 'strobe', beats: 2, params: { perBeat: 2 }, note: 'out of the build' },
		{ bar: start(3), kind: 'blackout', beats: 4, note: 'the held breath' },
		{ bar: start(4), kind: 'slam', beats: 4, note: 'the drop lands' },
		{ bar: start(4) + 4, kind: 'bump', beats: 4 },
		{ bar: start(8), kind: 'bump', beats: 4, note: 'the chorus arrives' },
		{ bar: start(8) + 2, kind: 'slam', beats: 4 },
		{ bar: start(8) + 2, beat: 2, kind: 'blackout', beats: 1 }
	];
	const show: Show = {
		version: SHOW_VERSION,
		trackId: analysis.trackId,
		title: analysis.title,
		analysisHash: analysis.hash,
		brief: 'a fixture',
		authoredBy: 'engine',
		...(seed % 2 === 0 ? { exposure: 'fixed' as const, ending: 'hold' as const } : {}),
		seed,
		palette: { name: 'Fixture', base: 219, accent: 29, third: 172, sat: 0.9206207999999999, shade: 0.119 },
		defaults: { intensity: 0.8, motion: 1, fadeBeats: 4 },
		generatedEffects: [],
		cues,
		hits
	};
	const meta = { trackId: `fx${seed}`, title: analysis.title, artist: 'Ensemble Číslo', gridTrusted: seed % 2 === 1 };
	return { analysis, show, meta };
}
