// node bench/lab/example.ts [--tracks=Rock,Disco]
// A flat 0.20 peak threshold for the kit classes against the shipped thresholds: raw model
// peaks, and the full shipped path (snap, then pattern quantise) on cached analyzeTrack inputs.
import type { DrumStream } from '../../packages/analysis/src/drums.ts';
import { snapTimesToOnsets } from '../../packages/analysis/src/drums.ts';
import { quantiseOnsets } from '../../packages/analysis/src/quantise.ts';
import { THRESHOLDS, activations, evaluate, modelStreams, quantiseInputs, shipRound, timesOf } from './mdb.ts';

const only = process.argv.find((a) => a.startsWith('--tracks='))?.slice(9).split(',') ?? [];
const flat = [0.2, 0.2, THRESHOLDS[2], 0.2, THRESHOLDS[4]];

await evaluate('example-threshold-020', async (track) => {
	const act = await activations(track.name);
	const q = await quantiseInputs(track.name);
	const shipped = modelStreams(act);
	const low = modelStreams(act, flat);
	const snap = (s: DrumStream): DrumStream =>
		({ ...s, times: snapTimesToOnsets(s.times, q.odf, q.fps, q.snapRadius) });
	const final = (s: DrumStream) => shipRound(quantiseOnsets(snap(s), q).times);
	const hat = shipRound(quantiseOnsets(q.dsp.hat, q).times);
	return {
		model: timesOf(shipped),
		'model-0.20': timesOf(low),
		final: { kick: final(shipped.kick), snare: final(shipped.snare), hat },
		'final-0.20': { kick: final(low.kick), snare: final(low.snare), hat }
	};
}, {
	only,
	notes: [
		'model stages are unsnapped model peaks; their hat is the model hat class.',
		'final stages snap kick/snare to the odf, quantise on the cached shipped bar grid and round to the ms; hat is the DSP hat.',
		'final equals drumscore final exactly; final-0.20 is the variant.'
	]
});
