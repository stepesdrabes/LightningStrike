import { describe, expect, it } from 'vitest';
import type { BarRow, SectionKind, TrackAnalysis } from '@mv/core';
import { applyHandSections } from './previewArrangement.ts';
import type { JudgedSection } from './judge.ts';

/** Bars of two seconds each, so a bar line sits on every even second. */
const BARS = 32;

function bar(i: number, section: SectionKind): BarRow {
	return {
		bar: i,
		t: i * 2,
		section,
		energy: 40 + (i % 8) * 4,
		sub: 30,
		low: 30,
		mid: 30,
		air: 30,
		kicks: 4,
		snares: 2,
		hats: 8,
		vocal: 0,
		events: []
	};
}

/** Two sections end to end, which the map below disagrees with. */
function analysis(): TrackAnalysis {
	return {
		version: 23,
		hash: 'preview',
		trackId: 'file-000000000000',
		title: 'Preview',
		duration: BARS * 2,
		sampleRate: 44100,
		tempo: {
			bpm: 120,
			confidence: 1,
			firstBeat: 0,
			beatPeriod: 0.5,
			beatsPerBar: 4,
			downbeatPhase: 0,
			barsPerPhrase: 4,
			phraseAnchorBar: 0,
			constant: true,
			ambiguous: false,
			meterConfidence: 1,
			alternativeBpm: [],
			barTimes: Array.from({ length: BARS + 1 }, (_, i) => i * 2)
		},
		key: { tonic: 0, name: 'C', mode: 'major', confidence: 1 },
		bars: Array.from({ length: BARS }, (_, i) => bar(i, i < 16 ? 'intro' : 'groove')),
		sections: [],
		moments: [],
		// One past the last bar line, so the table has a beat to end on the way a real one does.
		beats: Array.from({ length: BARS * 4 + 1 }, (_, i) => i * 0.5),
		envelopes: { energy: [], bands: [] },
		spectrum: { fps: 0, bands: 0, centreHz: [], frames: 0, mag: '' },
		stereo: { fps: 0, pan: [], width: [] },
		onsets: {
			kick: { times: [], levels: [] },
			snare: { times: [], levels: [] },
			hat: { times: [], levels: [] }
		},
		integratedLufs: -14,
		loudnessRange: 6,
		peakToLoudness: 10
	} as unknown as TrackAnalysis;
}

/** A drop from bar 8 to 24, where the analysis heard intro then groove. */
const HAND: JudgedSection[] = [
	{ kind: 'intro', startTime: 0, endTime: 16, startBar: 0, endBar: 8 },
	{ kind: 'drop', startTime: 16, endTime: 48, startBar: 8, endBar: 24 },
	{ kind: 'outro', startTime: 48, endTime: 64, startBar: 24, endBar: 32 }
];

describe('applyHandSections', () => {
	it('re-sections the span table along the map', () => {
		const preview = applyHandSections(analysis(), HAND)!;
		expect(preview.sections.map((s) => `${s.kind}@${s.startBar}`)).toEqual([
			'intro@0',
			'drop@8',
			'outro@24'
		]);
	});

	it('rewrites the per-bar section column the player reads', () => {

		const preview = applyHandSections(analysis(), HAND)!;
		expect(preview.bars[0].section).toBe('intro');
		expect(preview.bars[8].section).toBe('drop');
		expect(preview.bars[23].section).toBe('drop');
		expect(preview.bars[24].section).toBe('outro');
	});

	it('agrees with itself: every bar carries the kind of the span covering it', () => {
		const preview = applyHandSections(analysis(), HAND)!;
		for (const s of preview.sections) {
			for (let b = s.startBar; b < s.endBar; b++) {
				expect(preview.bars[b].section).toBe(s.kind);
			}
		}
	});

	it('refuses a map that cannot resolve to two sections, as the analyser does', () => {
		expect(applyHandSections(analysis(), [HAND[0]])).toBeNull();
		// Every boundary rounding onto the same bar collapses to one span.
		const collapsed = HAND.map((h) => ({ ...h, startTime: 0.1, endTime: 64 }));
		expect(applyHandSections(analysis(), collapsed)).toBeNull();
	});

	it('drops a boundary whose time is not a number', () => {

		const bad = [HAND[0], { ...HAND[1], startTime: Number.NaN }, HAND[2]];
		const preview = applyHandSections(analysis(), bad)!;
		expect(preview).not.toBeNull();
		expect(preview.sections.every((s) => Number.isFinite(s.startTime))).toBe(true);
		expect(preview.sections.at(-1)!.endBar).toBe(BARS);
	});

	it('puts a bar line where a boundary was deliberately placed off one', () => {

		const fine = [
			{ kind: 'intro', startTime: 0, endTime: 17, startBar: 0, endBar: 8.5 },
			{ kind: 'drop', startTime: 17, endTime: 48, startBar: 8.5, endBar: 24, offGrid: true },
			{ kind: 'outro', startTime: 48, endTime: 64, startBar: 24, endBar: 32 }
		];
		const preview = applyHandSections(analysis(), fine)!;
		const drop = preview.sections[1];
		expect(drop.startTime).toBeCloseTo(17, 3);

		expect(preview.tempo.barTimes[drop.startBar]).toBeCloseTo(17, 3);
	});

	it('leaves the boundaries after a deliberate cut where they were drawn', () => {

		const fine = [
			{ kind: 'intro', startTime: 0, endTime: 17, startBar: 0, endBar: 8.5 },
			{ kind: 'drop', startTime: 17, endTime: 48, startBar: 8.5, endBar: 24, offGrid: true },
			{ kind: 'outro', startTime: 48, endTime: 64, startBar: 24, endBar: 32 }
		];
		const preview = applyHandSections(analysis(), fine)!;
		expect(preview.sections[2].startTime).toBeCloseTo(48, 3);
		expect(preview.tempo.barTimes.filter((t) => t >= 48)).toEqual(
			analysis().tempo.barTimes.filter((t) => t >= 48)
		);
	});

	it('keeps the cuts the cached grid already carries', () => {

		const piecewise = analysis();
		const at = piecewise.tempo.barTimes.indexOf(12);
		piecewise.tempo.barTimes = [
			...piecewise.tempo.barTimes.slice(0, at),
			11,
			...piecewise.tempo.barTimes.slice(at + 1).map((t) => t - 1)
		];
		const fine = [
			{ kind: 'intro', startTime: 0, endTime: 8, startBar: 0, endBar: 4 },
			{ kind: 'groove', startTime: 8, endTime: 24, startBar: 4, endBar: 12.5 },
			{ kind: 'drop', startTime: 24, endTime: 63, startBar: 12.5, endBar: 31, offGrid: true }
		];
		const preview = applyHandSections(piecewise, fine)!;
		expect(preview.tempo.barTimes).toContain(11);
		expect(preview.sections[1].startTime).toBeCloseTo(8, 3);
		expect(preview.sections[2].startTime).toBeCloseTo(24, 3);
	});

	it('rounds the same boundary when it was not deliberate', () => {

		const incidental = [
			{ kind: 'intro', startTime: 0, endTime: 17, startBar: 0, endBar: 8.5 },
			{ kind: 'drop', startTime: 17, endTime: 48, startBar: 8.5, endBar: 24 },
			{ kind: 'outro', startTime: 48, endTime: 64, startBar: 24, endBar: 32 }
		];
		const preview = applyHandSections(analysis(), incidental)!;
		expect(preview.sections[1].startTime).toBe(16);
		expect(preview.tempo.barTimes).toEqual(analysis().tempo.barTimes);
	});

	it('leaves the cached analysis untouched', () => {
		const original = analysis();
		const before = original.bars.map((b) => b.section);
		applyHandSections(original, HAND);
		expect(original.bars.map((b) => b.section)).toEqual(before);
		expect(original.sections).toEqual([]);
	});
});
