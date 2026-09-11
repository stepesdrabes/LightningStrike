import { describe, expect, it } from 'vitest';
import type { Show, TrackAnalysis } from '@mv/core';
import {
	activeCue,
	buildTimeline,
	densityColumns,
	fractionAt,
	fractionIn,
	follow,
	panBy,
	windowSpan,
	zoomAt
} from './timeline.ts';

const beatPeriod = 60 / 120;

function analysis(): TrackAnalysis {
	return {
		version: 4,
		hash: 'h',
		trackId: 'file-000000000000',
		title: 'T',
		duration: 64 * beatPeriod * 4,
		sampleRate: 22050,
		tempo: {
			bpm: 120,
			confidence: 0.9,
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
			barTimes: Array.from({ length: 65 }, (_, i) => i * beatPeriod * 4)
		},
		key: { tonic: 0, name: 'C minor', mode: 'minor', confidence: 0.7 },
		bars: [],
		sections: [
			{
				index: 0,
				kind: 'groove',
				startBar: 0,
				endBar: 16,
				startTime: 0,
				endTime: 32,
				lengthBars: 16,
				meanEnergy: 60,
				peakEnergy: 70,
				energyRank: 2,
				group: 0,
				repeatOf: null
			},
			{
				index: 1,
				kind: 'drop',
				startBar: 16,
				endBar: 32,
				startTime: 32,
				endTime: 64,
				lengthBars: 16,
				meanEnergy: 95,
				peakEnergy: 99,
				energyRank: 1,
				group: 0,
				repeatOf: 0
			}
		],
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
		integratedLufs: -9,
		loudnessRange: 6,
		peakToLoudness: 12
	};
}

function show(): Show {
	return {
		version: 1,
		trackId: 'file-000000000000',
		title: 'T',
		analysisHash: 'h',
		brief: 'b',
		palette: { base: 200, accent: 20 },
		defaults: { intensity: 0.7, motion: 1, fadeBeats: 2 },
		generatedEffects: [],
		// Deliberately out of order: nothing promises the show stores them sorted.
		cues: [
			{ bar: 16, section: 'drop', layers: { bed: { effect: 'wash' } }, intensity: 1, note: 'drop' },
			{ bar: 0, section: 'groove', layers: { bed: { effect: 'aurora' } }, note: 'open' }
		],
		hits: [
			{ bar: 16, kind: 'slam', beats: 4, note: 'lands' },
			{ bar: 14, kind: 'strobe', beats: 8, params: { perBeat: 4 }, note: 'out of the build' }
		]
	};
}

describe('buildTimeline', () => {
	const t = buildTimeline(analysis(), show(), 128);

	it('puts cues in bar order whatever order the show stored them', () => {
		expect(t.cues.map((c) => c.bar)).toEqual([0, 16]);
	});

	it('runs each cue up to the next one, and the last to the end', () => {
		expect(t.cues[0].start).toBeCloseTo(0, 6);
		expect(t.cues[0].end).toBeCloseTo(t.cues[1].start, 6);
		expect(t.cues[1].end).toBe(128);
	});

	it('places a hit at its own bar, not at the cue that contains it', () => {
		const strobe = t.markers.find((m) => m.kind === 'strobe')!;
		// Bar 14 at 120 bpm in 4/4: 14 bars of two seconds each.
		expect(strobe.start).toBeCloseTo(28, 6);
	});

	it('gives a hit a length so a long strobe reads as long', () => {
		const strobe = t.markers.find((m) => m.kind === 'strobe')!;
		const slam = t.markers.find((m) => m.kind === 'slam')!;
		expect(strobe.end - strobe.start).toBeCloseTo(4, 6);
		expect(slam.end - slam.start).toBeCloseTo(2, 6);
	});

	it('orders markers by time', () => {
		expect(t.markers.map((m) => m.kind)).toEqual(['strobe', 'slam']);
	});

	it('names the peak in the section it belongs to', () => {
		expect(t.sections[1].lines.join(' ')).toContain('the peak');
		expect(t.sections[0].lines.join(' ')).not.toContain('the peak');
	});

	it('lists a cue’s layers and falls back to the show default intensity', () => {
		expect(t.cues[0].lines).toContain('bed: aurora');
		expect(t.cues[0].intensity).toBe(0.7);
		expect(t.cues[1].intensity).toBe(1);
	});

	it('says nothing at all without an analysis or a duration', () => {
		expect(buildTimeline(null, show(), 128).cues).toEqual([]);
		expect(buildTimeline(analysis(), show(), 0).sections).toEqual([]);
	});

	it('still describes the arrangement when no show exists yet', () => {
		const bare = buildTimeline(analysis(), null, 128);
		expect(bare.sections).toHaveLength(2);
		expect(bare.cues).toEqual([]);
	});
});

describe('activeCue', () => {
	it('finds the cue holding the room, not the one stored last', () => {
		// The fixture lists bar 16 before bar 0, which is what a reverse-and-find gets wrong.
		expect(activeCue(show(), 20)?.bar).toBe(16);
		expect(activeCue(show(), 4)?.bar).toBe(0);
	});

	it('takes the cue that starts exactly on the bar being asked about', () => {
		expect(activeCue(show(), 16)?.bar).toBe(16);
	});

	it('has no answer before the first cue, or without a show', () => {
		const early: Show = { ...show(), cues: [{ ...show().cues[0], bar: 8 }] };
		expect(activeCue(early, 4)).toBeUndefined();
		expect(activeCue(null, 4)).toBeUndefined();
	});
});

describe('densityColumns', () => {
	it('counts onsets into the column they fall in', () => {
		const counts = densityColumns([0, 0.05, 5, 9.99], 10, 10);
		expect(counts[0]).toBe(2);
		expect(counts[5]).toBe(1);
		expect(counts[9]).toBe(1);
	});

	it('drops anything outside the track rather than folding it to an edge', () => {
		const counts = densityColumns([-1, 11], 10, 10);
		expect(Array.from(counts).reduce((a, b) => a + b, 0)).toBe(0);
	});
});

describe('the time window', () => {
	const full = { start: 0, end: 1 };

	it('keeps the point under the pointer under it while zooming in', () => {
		const w = zoomAt(full, 0.4, 0.5, 0.01);
		expect(windowSpan(w)).toBeCloseTo(0.5);
		expect(fractionIn(w, 0.4)).toBeCloseTo(fractionIn(full, 0.4));
	});

	it('keeps zooming about the same point stable across repeated steps', () => {
		let w = full;
		for (let i = 0; i < 6; i++) w = zoomAt(w, 0.62, 0.8, 0.01);
		expect(fractionIn(w, 0.62)).toBeCloseTo(0.62, 5);
	});

	it('slides rather than overhangs when zooming out at an edge', () => {
		// Anchored mid-window, the span it wants would run past the end of the track.
		const w = zoomAt({ start: 0.9, end: 1 }, 0.95, 4, 0.01);
		expect(windowSpan(w)).toBeCloseTo(0.4);
		expect(w.end).toBeCloseTo(1);
		expect(w.start).toBeCloseTo(0.6);
	});

	it('will not zoom past the floor, or out past the whole track', () => {
		expect(windowSpan(zoomAt(full, 0.5, 0.001, 0.05))).toBeCloseTo(0.05);
		expect(zoomAt({ start: 0.4, end: 0.6 }, 0.5, 100, 0.05)).toEqual(full);
	});

	it('pans without changing the span, and stops at both ends', () => {
		const w = { start: 0.4, end: 0.6 };
		expect(panBy(w, 0.1).start).toBeCloseTo(0.5);
		expect(panBy(w, -9).start).toBeCloseTo(0);
		expect(panBy(w, 9).end).toBeCloseTo(1);
		for (const delta of [0.1, -9, 9]) {
			expect(windowSpan(panBy(w, delta))).toBeCloseTo(windowSpan(w));
		}
	});

	it('follows a playhead only once it leaves the window', () => {
		const w = { start: 0.4, end: 0.6 };
		expect(follow(w, 0.5)).toBe(w);
		expect(follow(full, 0.9)).toBe(full);
		const moved = follow(w, 0.75);
		expect(windowSpan(moved)).toBeCloseTo(0.2);
		expect(fractionIn(moved, 0.75)).toBeCloseTo(0.5);
	});

	it('maps a position across the window back to the track it points at', () => {
		const w = { start: 0.25, end: 0.75 };
		expect(fractionAt(w, 0)).toBeCloseTo(0.25);
		expect(fractionAt(w, 1)).toBeCloseTo(0.75);
		expect(fractionIn(w, fractionAt(w, 0.3))).toBeCloseTo(0.3);
	});

	it('buckets onsets across the window, not across the track', () => {
		const times = [0, 1, 2, 3, 4, 5, 6, 7, 8, 9];
		const zoomed = densityColumns(times, 10, 5, { start: 0.5, end: 1 });

		expect(Array.from(zoomed)).toEqual([1, 1, 1, 1, 1]);
		const whole = densityColumns(times, 10, 5);
		expect(Array.from(whole).reduce((a, b) => a + b, 0)).toBe(10);
	});
});
