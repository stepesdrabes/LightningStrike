import { expect, it } from 'vitest';
import { pickPeaks } from './onsets.ts';

it('keeps the more prominent attack when the local floor falls inside a refractory window', () => {
	const curve = new Float32Array(100);
	curve.fill(1, 20, 50);
	curve[35] = 2;
	curve[55] = 1.6;
	const peaks = pickPeaks(curve, 100, {
		localMaxSec: 0.01,
		movingMeanSec: 0.1,
		delta: 0.06,
		refractorySec: 0.25
	});
	const nearby = peaks.filter((peak) => peak.frame >= 30 && peak.frame <= 60);
		expect(nearby).toHaveLength(1);
		expect(nearby[0].frame).toBe(55);
		expect(nearby[0].strength).toBeGreaterThan(1);
});
