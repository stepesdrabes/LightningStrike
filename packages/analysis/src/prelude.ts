import { withChromaClock } from './chroma.ts';
import { withFrameClock } from './dsp/spectrogram.ts';
import { extractFeatures, type AnalysisFeatures } from './features.ts';
import { measureLoudness, type Loudness } from './loudness.ts';
import { analyseStereo, type StereoImage } from './stereo.ts';

const TARGET_LUFS = -14;

export interface AnalysisPrelude {
	loudness: Loudness;
	/** The analysed mono stream, normalised to the target loudness. */
	mono: Float32Array;
	stereo: StereoImage;
	features: AnalysisFeatures;
}

/** Analysis steps that need only the decoded audio, so a worker can run them during separation. */
export function analysisPrelude(
	mono: Float32Array,
	left: Float32Array | undefined,
	right: Float32Array | undefined,
	sampleRate: number
): AnalysisPrelude {
	// Loudness is measured on the mono stream that is actually analysed. Measuring the stereo
	// original instead, which is what asking ffmpeg would give, is up to 3 dB out depending on
	// how correlated the channels are.
	const loudness = measureLoudness(mono, sampleRate);

	// Normalise first so detector thresholds transfer across mastering levels.
	const normalised = Float32Array.from(mono);
	const gain = Math.pow(10, (TARGET_LUFS - loudness.integrated) / 20);
	if (Number.isFinite(gain) && Math.abs(gain - 1) > 0.01) {
		const g = Math.min(gain, 40);
		for (let i = 0; i < normalised.length; i++) normalised[i] *= g;
	}

	const stereo =
		left && right
			? analyseStereo(left, right, sampleRate)
			: { fps: 25, pan: new Float32Array(0), width: new Float32Array(0) };

	return { loudness, mono: normalised, stereo, features: extractFeatures(normalised, sampleRate) };
}

/** Worker messages cannot carry the frame-clock functions, so they are dropped and rebuilt. */
export function preludeMessage(
	prelude: AnalysisPrelude
): { message: unknown; transfer: ArrayBuffer[] } {
	const { features } = prelude;
	const { timeOf: _specTime, frameOf: _specFrame, ...spec } = features.spec;
	const { timeOf: _chromaTime, ...chroma } = features.chroma;
	const message = { ...prelude, features: { ...features, spec, chroma } };
	const { curves } = features;
	const buffers = [
		prelude.mono, prelude.stereo.pan, prelude.stereo.width, prelude.loudness.shortTerm,
		spec.mag, spec.rms, curves.flux, curves.low, curves.mid, curves.high, features.odf,
		chroma.values, chroma.energy
	].map((array) => array.buffer as ArrayBuffer);
	return { message, transfer: [...new Set(buffers)] };
}

export function restorePrelude(message: unknown): AnalysisPrelude {
	const prelude = message as AnalysisPrelude;
	const { features } = prelude;
	const spec = withFrameClock(features.spec);
	return { ...prelude, features: { ...features, spec, chroma: withChromaClock(features.chroma) } };
}
