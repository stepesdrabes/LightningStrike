import type { BarRow, SectionSpan, TrackAnalysis } from '../contracts/analysis.ts';
import { ANALYSIS_VERSION } from '../contracts/analysis.ts';
import type { Show } from '../contracts/show.ts';
import { SHOW_VERSION } from '../contracts/show.ts';
import { NUM_BANDS, SPECTRUM_BANDS } from '../contracts/frame.ts';
import { encodeBase64 } from '../base64.ts';

const PLAN: [number, number, SectionSpan['kind']][] = [
	[0, 8, 'intro'],
	[8, 24, 'groove'],
	[24, 32, 'breakdown'],
	[32, 40, 'build'],
	[40, 72, 'drop'],
	[72, 80, 'outro']
];

/** Player fixture kept in core so its tests do not import the upstream author-engine. */
export function fixtureAnalysis(bpm = 120): TrackAnalysis {
	const beatPeriod = 60 / bpm;
	const barLength = beatPeriod * 4;
	const barCount = PLAN[PLAN.length - 1][1];
	const duration = barCount * barLength;

	const energyOf = (kind: SectionSpan['kind']): number =>
		({ intro: 20, groove: 62, breakdown: 30, build: 55, drop: 92, outro: 18 })[
			kind as 'intro' | 'groove' | 'breakdown' | 'build' | 'drop' | 'outro'
		] ?? 40;

	const bars: BarRow[] = [];
	for (const [from, to, kind] of PLAN) {
		for (let b = from; b < to; b++) {
			bars.push({
				bar: b,
				t: b * barLength,
				section: kind,
				energy: energyOf(kind),
				sub: energyOf(kind),
				low: energyOf(kind),
				mid: 40,
				air: 35,
				kicks: 4,
				snares: 2,
				hats: 8,
				vocal: 0,
				events: []
			});
		}
	}

	const sections: SectionSpan[] = PLAN.map(([from, to, kind], index) => ({
		index,
		kind,
		startBar: from,
		endBar: to,
		startTime: from * barLength,
		endTime: to * barLength,
		lengthBars: to - from,
		meanEnergy: energyOf(kind),
		peakEnergy: energyOf(kind),
		energyRank: index + 1,
		group: index,
		repeatOf: null
	}));

	const beats: number[] = [];
	for (let i = 0; i < barCount * 4; i++) beats.push(i * beatPeriod);

	const fps = 50;
	const frames = Math.ceil(duration * fps);
	const spectrum = new Uint8Array(frames * SPECTRUM_BANDS);
	for (let i = 0; i < frames; i++) {
		for (let b = 0; b < SPECTRUM_BANDS; b++) {
			spectrum[i * SPECTRUM_BANDS + b] = (i * 7 + b * 29) % 200;
		}
	}

	return {
		version: ANALYSIS_VERSION,
		hash: 'fixture',
		trackId: 'fixture',
		title: 'Fixture',
		duration,
		sampleRate: 44100,
		tempo: {
			bpm,
			confidence: 1,
			firstBeat: 0,
			beatPeriod,
			beatsPerBar: 4,
			downbeatPhase: 0,
			phraseAnchorBar: 0,
			barsPerPhrase: 8,
			constant: true,
			meterConfidence: 1,
			ambiguous: false,
			alternativeBpm: [],
			barTimes: Array.from({ length: barCount + 1 }, (_, i) => i * barLength)
		},
		key: { tonic: 0, name: 'C major', mode: 'major', confidence: 0.9 },
		bars,
		sections,
		moments: [],
		beats,
		envelopes: {
			energy: beats.map((_, i) => 40 + (i % 8) * 4),
			bands: beats.flatMap((_, i) => Array.from({ length: NUM_BANDS }, (_, b) => (i * 3 + b * 11) % 90))
		},
		spectrum: {
			fps,
			bands: SPECTRUM_BANDS,
			centreHz: Array.from({ length: SPECTRUM_BANDS }, (_, i) => 40 * Math.pow(1.35, i)),
			data: encodeBase64(spectrum)
		},
		stereo: { fps: 25, pan: [0, 0], width: [0.4, 0.4] },
		onsets: {
			kick: { times: beats.filter((_, i) => i % 2 === 0), levels: [] },
			snare: { times: beats.filter((_, i) => i % 4 === 2), levels: [] },
			hat: { times: beats, levels: [] }
		},
		integratedLufs: -9,
		loudnessRange: 6,
		peakToLoudness: 10
	};
}

export function fixtureShow(analysis: TrackAnalysis): Show {
	return {
		version: SHOW_VERSION,
		trackId: analysis.trackId,
		title: analysis.title,
		analysisHash: analysis.hash,
		brief: 'fixture',
		authoredBy: 'engine',
		palette: { base: 200, accent: 30, third: 240, sat: 0.94, shade: 0.08 },
		// Keep the fixture show brighter than the resting scenes for the handover test.
		defaults: { intensity: 1, motion: 1, fadeBeats: 2 },
		generatedEffects: [],
		cues: analysis.sections.map((s) => ({
			bar: s.startBar,
			section: s.kind,
			layers: { bed: { effect: 'wash' }, rhythm: { effect: 'sweep' } },
			note: s.kind
		})),
		hits: []
	};
}
