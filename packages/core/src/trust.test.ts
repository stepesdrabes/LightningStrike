import { describe, expect, it } from 'vitest';
import type { TrackAnalysis } from './contracts/analysis.ts';
import { gridTrust } from './trust.ts';

/** Only what the verdict reads: duration, section count, meter. */
function sketch(input: {
	duration: number;
	sections: number;
	meterConfidence?: number;
	beatsPerBar?: number;
	bpm?: number;
}): TrackAnalysis {
	return {
		duration: input.duration,
		sections: Array.from({ length: input.sections }, (_, index) => ({ index })),
		tempo: {
			bpm: input.bpm ?? 120,
			meterConfidence: input.meterConfidence ?? 0.9,
			beatsPerBar: input.beatsPerBar ?? 4
		}
	} as unknown as TrackAnalysis;
}

describe('gridTrust', () => {
	it('routes explicitly measured silent audio to calm scenes even with a short regular grid', () => {
		const analysis = sketch({ duration: 32, sections: 2 });
		analysis.level = { fps: 100, data: 'AAAA', silent: true };
		expect(gridTrust(analysis, 120)).toEqual({ trusted: false, reasons: ['no signal in analysed audio'] });
	});

	it('does not infer silence from an absent, empty or all-zero legacy level stream', () => {
		const analysis = sketch({ duration: 32, sections: 2 });
		for (const level of [undefined, { fps: 100, data: '' }, { fps: 100, data: 'AAAA' }]) {
			analysis.level = level;
			expect(gridTrust(analysis).trusted).toBe(true);
		}
	});

	function busyTracked(): TrackAnalysis {
		const a = sketch({ duration: 158, sections: 16, meterConfidence: 0.99, bpm: 175 });
		const period = 60 / 175;
		const beats = Array.from({ length: Math.floor(a.duration / period) }, (_, i) => 0.2 + i * period);
		const downbeats = beats.filter((_, i) => i % 4 === 0);
		a.tempo = { ...a.tempo, confidence: 0.66, ambiguous: false, beatPeriod: period, barTimes: downbeats };
		a.heard = { beats, downbeats };
		return a;
	}

	it('trusts busy phrasing corroborated by raw beats and downbeats without catalogue metadata', () => {
		expect(gridTrust(busyTracked()).trusted).toBe(true);
	});

	it('keeps fragmentation warnings when the model disagrees with the bar phase', () => {
		const a = busyTracked();
		a.tempo.barTimes = a.tempo.barTimes.map((t) => t + a.tempo.beatPeriod);
		expect(gridTrust(a).trusted).toBe(false);
	});

	it('does not mistake repaired timing or a short correct excerpt for corroboration', () => {
		const repaired = busyTracked();
		repaired.downbeats = repaired.heard!.downbeats;
		delete repaired.heard;
		expect(gridTrust(repaired).trusted).toBe(false);
		const brief = busyTracked();
		brief.heard!.downbeats = brief.heard!.downbeats.slice(0, 20);
		expect(gridTrust(brief).trusted).toBe(false);
	});

	it('retains the warning for ambiguous tempo or inconsistent raw four-beat cycles', () => {
		const ambiguous = busyTracked();
		ambiguous.tempo.ambiguous = true;
		expect(gridTrust(ambiguous).trusted).toBe(false);
		const irregular = busyTracked();
		irregular.heard!.downbeats = irregular.heard!.beats.filter((_, i) => i % 7 === 0 || i % 7 === 3);
		expect(gridTrust(irregular).trusted).toBe(false);
	});

	it('requires confident audio evidence even when model times look regular', () => {
		const weak = busyTracked();
		weak.tempo.confidence = 0.35;
		expect(gridTrust(weak).trusted).toBe(false);
		const unknown = busyTracked();
		unknown.tempo.confidence = Number.NaN;
		expect(gridTrust(unknown).trusted).toBe(false);
		const halfBars = busyTracked();
		halfBars.tempo.beatsPerBar = 2;
		expect(gridTrust(halfBars).trusted).toBe(false);
	});

	it('trips on the catastrophically fragmented grid', () => {
		// I Don't Care: 23 sections in 220 s on a 2/4 grid at meter confidence 0.50.
		const verdict = gridTrust(
			sketch({ duration: 220, sections: 23, meterConfidence: 0.5, beatsPerBar: 2 })
		);
		expect(verdict.trusted).toBe(false);
		expect(verdict.reasons.length).toBeGreaterThan(0);
	});

	it('trips on heavy fragmentation even with a confident meter', () => {
		// A half-time misread chops a Czech rap track to 5.5 s sections at confidence 0.88.
		const verdict = gridTrust(
			sketch({ duration: 180, sections: 17, meterConfidence: 0.88, beatsPerBar: 2 })
		);
		expect(verdict.trusted).toBe(false);
	});

	it('lets a busy but honest structure through', () => {
		// Like a Prayer: 10 sections in 131 s (4.6 a minute) at meter confidence 0.67.
		expect(
			gridTrust(sketch({ duration: 131, sections: 10, meterConfidence: 0.67 })).trusted
		).toBe(true);
	});

	it('lets a fast honest arrangement through', () => {
		// Fast, correctly metered tracks can exceed five sections/minute without fragmentation.
		expect(
			gridTrust(sketch({ duration: 180, sections: 16, meterConfidence: 1, bpm: 160 })).trusted
		).toBe(true);
	});

	it('does not read low meter confidence alone as failure', () => {
		// Whip: clean structure at meter confidence 0.55 - confidence only ever tightens the
		// fragmentation test, it never trips on its own.
		expect(
			gridTrust(sketch({ duration: 154, sections: 9, meterConfidence: 0.55 })).trusted
		).toBe(true);
	});

	it('tightens the borderline with a shaky meter', () => {
		// 4.8 sections a minute is honest at confidence 0.97 and suspect at 0.53.
		expect(
			gridTrust(sketch({ duration: 150, sections: 12, meterConfidence: 0.97 })).trusted
		).toBe(true);
		expect(
			gridTrust(sketch({ duration: 150, sections: 12, meterConfidence: 0.53 })).trusted
		).toBe(false);
	});

	it('leaves stubs and empty analyses alone', () => {
		expect(gridTrust(sketch({ duration: 30, sections: 5 })).trusted).toBe(true);
		expect(gridTrust(sketch({ duration: 200, sections: 0 })).trusted).toBe(true);
	});

	it('trusts a fragmented grid the published tempo corroborates', () => {
		// Published BPM corroborates this busy stop-time arrangement.
		const humble = sketch({ duration: 177, sections: 16, meterConfidence: 0.99, bpm: 150 });
		expect(gridTrust(humble).trusted).toBe(false);
		expect(gridTrust(humble, 149.8).trusted).toBe(true);
		// A catalogue figure at another level corroborates nothing.
		expect(gridTrust(humble, 75).trusted).toBe(false);
		// Nor does one on a 2/4 grid: real 2/4 barely exists in this repertoire.
		expect(
			gridTrust(sketch({ duration: 177, sections: 16, meterConfidence: 0.99, bpm: 150, beatsPerBar: 2 }), 149.8).trusted
		).toBe(false);
	});
});
