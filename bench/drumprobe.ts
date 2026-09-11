/** node bench/drumprobe.ts <track-id> ... [--cache <directory>] [--out <report.json>] */
import { readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { Adtof, activationStream } from '../packages/analysis/src/adtof.ts';
import { decodeAudio } from '../packages/analysis/src/decode.ts';
import { quantiseOnsets } from '../packages/analysis/src/quantise.ts';
import type { DrumStream } from '../packages/analysis/src/drums.ts';
import type { TrackAnalysis } from '../packages/core/src/index.ts';
import { benchmarkCache } from './cache.ts';

const args = process.argv.slice(2);
const option = (flag: string): string | undefined => {
	const i = args.indexOf(flag);
	return i >= 0 ? args.splice(i, 2)[1] : undefined;
};
const cache = benchmarkCache(option('--cache'));
const output = option('--out');
if (args.length === 0) throw new Error('Pass one or more cached track ids.');
const files = readdirSync(cache);
const model = await Adtof.create();
if (!model) throw new Error('ADTOF model is unavailable.');
const report = [];

try {
	for (const id of args) {
		const analysis = JSON.parse(readFileSync(join(cache, `${id}.analysis.json`), 'utf8')) as TrackAnalysis;
		const file = files.find((name) => name.startsWith(`${id}.`) && /\.(m4a|mp3|opus|webm|wav|flac)$/.test(name));
		if (!file) throw new Error(`Audio missing for ${id}`);
		const decoded = await decodeAudio(join(cache, file), 44100);
		const probe: { activations?: Float32Array } = {};
		await model.run(decoded.mono, probe);
		const act = probe.activations!;
		const frames = act.length / 5;
		const rows = [];
		for (const [kind, channel, threshold] of [['kick', 0, 0.22], ['snare', 1, 0.24]] as const) {
			const curve = Float32Array.from({ length: frames }, (_, i) => act[i * 5 + channel]);
			const stream = activationStream(curve, threshold);
			const heights = stream.times.map((time) => stream.curve[Math.round(time * stream.fps)]);
			const sorted = heights.slice().sort((a, b) => a - b);
			const top = sorted[Math.floor(sorted.length * 0.9)] || 1;
			const before: DrumStream = {
				...stream,
				curve,
				levels: heights.map((height) => Math.min(1, height / top))
			};
			const quantise = (value: DrumStream) => quantiseOnsets(value, {
				beats: Float64Array.from(analysis.beats),
				beatsPerBar: analysis.tempo.beatsPerBar,
				duration: analysis.duration
			});
			const old = quantise(before);
			const current = quantise(stream);
			const row = {
				kind,
				detected: stream.times.length,
				inventedBefore: old.invented.filter(Boolean).length,
				inventedAfter: current.invented.filter(Boolean).length,
				meanLevelBefore: before.levels.reduce((a, b) => a + b, 0) / Math.max(1, before.levels.length),
				meanLevelAfter: stream.levels.reduce((a, b) => a + b, 0) / Math.max(1, stream.levels.length),
				changed: old.times.flatMap((time, i) => old.invented[i] && !current.times.includes(time) ? [{ time, change: 'removed completion' }] : []),
				weak: stream.times.flatMap((time, i) => stream.levels[i] < 0.35 ? [{ time, level: stream.levels[i] }] : [])
			};
			rows.push(row);
			console.log(`${id} ${kind}: ${row.detected} detected; completed ${row.inventedBefore} -> ${row.inventedAfter}; mean level ${row.meanLevelBefore.toFixed(3)} -> ${row.meanLevelAfter.toFixed(3)}`);
		}
		report.push({ id, title: analysis.title, drums: rows });
		if (output) writeFileSync(output, JSON.stringify(report, null, 2));
	}
} finally {
	await model.close();
}
