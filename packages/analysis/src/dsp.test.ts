import { describe, expect, it } from 'vitest';
import { analyzeTrack } from './analyze.ts';
import { onsetsBeside, preludeBeside } from './dsp.ts';
import { synthesise } from './fixture.ts';
import { analysisPrelude } from './prelude.ts';
import { sourceOnsets } from './separatedDrums.ts';

const fixture = synthesise(124, [
	{ bars: 4, kick: 1, snare: 0.8, hat: 0.6, bass: 0.9, pad: 0.6, riser: false },
	{ bars: 4, kick: 0.6, snare: 0.9, hat: 0.4, bass: 0.5, pad: 0.4, riser: false }
]);
const left = Float32Array.from(fixture.mono, (v, i) => v * (1 + 0.2 * Math.sin(i / 5000)));
const right = Float32Array.from(fixture.mono, (v, i) => v * (1 - 0.2 * Math.sin(i / 5000)));
const bytes = (array: Float32Array) => Buffer.from(array.buffer, array.byteOffset, array.byteLength);

describe('analysis steps computed beside other work', () => {
	it('returns the same prelude from a worker, frame clocks included', async () => {
		const direct = analysisPrelude(fixture.mono, left, right, fixture.sampleRate);
		const remote = await preludeBeside(fixture.mono, left, right, fixture.sampleRate);
		expect(remote).toBeDefined();
		expect(bytes(remote!.mono).equals(bytes(direct.mono))).toBe(true);
		expect(bytes(remote!.features.spec.mag).equals(bytes(direct.features.spec.mag))).toBe(true);
		expect(bytes(remote!.features.odf).equals(bytes(direct.features.odf))).toBe(true);
		expect(bytes(remote!.features.chroma.values).equals(bytes(direct.features.chroma.values))).toBe(true);
		expect(bytes(remote!.stereo.pan).equals(bytes(direct.stereo.pan))).toBe(true);
		expect(remote!.loudness.integrated).toBe(direct.loudness.integrated);
		expect(remote!.features.spec.timeOf(37)).toBe(direct.features.spec.timeOf(37));
		expect(remote!.features.spec.frameOf(1.234)).toBe(direct.features.spec.frameOf(1.234));
		expect(remote!.features.chroma.timeOf(11)).toBe(direct.features.chroma.timeOf(11));
	});

	it('returns the same separated onset curve from a worker', async () => {
		const remote = await onsetsBeside(fixture.mono, fixture.sampleRate);
		const direct = sourceOnsets(fixture.mono, fixture.sampleRate);
		expect(remote?.fps).toBe(direct.fps);
		expect(bytes(remote!.odf).equals(bytes(direct.odf))).toBe(true);
	});

	it('analyses identically with precomputed steps', () => {
		const separatedDrums = {
			kick: fixture.mono.slice(), snare: right.slice(), cymbal: left.slice(), sampleRate: 22050
		};
		const input = {
			mono: fixture.mono, left, right, sampleRate: fixture.sampleRate, duration: fixture.duration,
			hash: 'fixture', trackId: 'abcdefghijk', title: 'Fixture', separatedDrums
		};
		const plain = analyzeTrack(input);
		const ahead = analyzeTrack({
			...input,
			prelude: analysisPrelude(fixture.mono, left, right, fixture.sampleRate),
			separatedOnsets: {
				kick: sourceOnsets(separatedDrums.kick, 22050),
				snare: sourceOnsets(separatedDrums.snare, 22050)
			}
		});
		expect(JSON.stringify(ahead)).toBe(JSON.stringify(plain));
	});
});
