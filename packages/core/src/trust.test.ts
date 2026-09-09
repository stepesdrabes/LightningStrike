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
		// cool (Grey256): 16 sections in 180 s at 160 bpm, 5.33 a minute, 4/4 at meter
		// confidence 1.00. The rate is counted in wall-clock minutes and a fast track cuts
		// more bars into one, which is not fragmentation.
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
		// HUMBLE.: 16 sections in 177 s are its stop-time drops, at meter confidence 0.99 and
		// 150 bpm against Deezer's 149.8. Without the catalogue it reads as a wreck.
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
