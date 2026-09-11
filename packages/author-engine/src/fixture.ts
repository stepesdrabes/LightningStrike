import type { BarRow, SectionSpan, TrackAnalysis } from '@mv/core';

/**
 * Shared planner/linter/measurement fixture. Void starts may be off-phrase; their drop ends
 * are on-grid.
 */
const PLAN: [number, number, SectionSpan['kind']][] = [
	[0, 8, 'intro'],
	[8, 24, 'groove'],
	[24, 32, 'breakdown'],
	[32, 38, 'build'],
	[38, 40, 'void'],
	[40, 72, 'drop'],
	[72, 88, 'groove'],
	[88, 96, 'build'],
	[96, 120, 'drop'],
	[120, 128, 'outro']
];

export function fixture(bpm = 128, drift = 0): TrackAnalysis {
	const beatPeriod = 60 / bpm;
	const barLength = beatPeriod * 4;
	// Deterministic, and irrational enough per bar that no two neighbours are alike.
	const barTimeOf = (bar: number) => {
		let t = 0;
		for (let i = 0; i < bar; i++) t += barLength * (1 + drift * Math.sin(i * 2.399));
		return t;
	};
	const energyOf = (kind: SectionSpan['kind']): number =>
		({
			intro: 20,
			groove: 62,
			verse: 58,
			breakdown: 30,
			build: 55,
			void: 4,
			drop: 92,
			chorus: 88,
			outro: 18
		})[kind];

	const bars: BarRow[] = [];
	for (const [from, to, kind] of PLAN) {
		for (let b = from; b < to; b++) {
			bars.push({
				bar: b,
				t: barTimeOf(b),
				section: kind,
				energy: energyOf(kind),
				sub: energyOf(kind),
				low: energyOf(kind),
				mid: 40,
				air: kind === 'build' ? 80 : 35,
				kicks: kind === 'drop' || kind === 'groove' ? 4 : 0,
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
		startTime: barTimeOf(from),
		endTime: barTimeOf(to),
		lengthBars: to - from,
		meanEnergy: energyOf(kind),
		peakEnergy: energyOf(kind),
		// The second drop is the peak; the first is the same kind but ranks below it.
		energyRank: kind === 'drop' ? (from === 96 ? 1 : 2) : 5,
		group: 0,
		repeatOf: null
	}));

	return {
		version: 2,
		hash: 'deadbeefcafe0001',
		trackId: 'file-000000000000',
		title: 'Engine Fixture',
		duration: 128 * barLength,
		sampleRate: 22050,
		tempo: {
			bpm,
			confidence: 0.8,
			firstBeat: 0,
			beatPeriod,
			beatsPerBar: 4,
			downbeatPhase: 0,
			phraseAnchorBar: 0,
			barsPerPhrase: 8,
			constant: true,
			meterConfidence: 0.9,
			ambiguous: false,
			alternativeBpm: [],
			// Jitter puts neighboring bars on opposite sides of duration caps, exposing placement-time
			// mismatches.
			barTimes: Array.from({ length: 129 }, (_, i) => barTimeOf(i))
		},
		key: { tonic: 9, name: 'A minor', mode: 'minor', confidence: 0.8 },
		bars,
		sections,
		moments: [],
		beats: [],
		envelopes: { energy: [], bands: [] },
		spectrum: { fps: 50, bands: 0, centreHz: [], data: '' },
		stereo: { fps: 25, pan: [], width: [] },
		onsets: {
			kick: { times: [], levels: [] },
			snare: { times: [], levels: [] },
			hat: { times: [], levels: [] }
		},
		integratedLufs: -8,
		loudnessRange: 5,
		peakToLoudness: 11
	};
}
