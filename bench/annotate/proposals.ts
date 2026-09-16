// Every onset any view proposes at thresholds far below Striker's. The annotation UI draws these so
// a real hit the shipped model misses is still on screen, and the synthetic corpus marks backing
// residue with them, so a drum left behind by stem subtraction is ignored rather than taught as a
// negative.
import { join } from 'node:path';
import { existsSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { files, readF32 } from '../drumeval/evidence.ts';

const SRC = join(import.meta.dirname, '..', '..', 'packages', 'analysis', 'src');
const load = async (file: string) => import(pathToFileURL(join(SRC, file)).href);
const { sourceOnsets } = await load('separatedDrums.ts');
const { pickPeaks, refinePeakTime } = await load('onsets.ts');
const { activationStream } = await load('adtof.ts');

const ACT_CLASSES = 5;
export const CHANNEL = { kick: 0, snare: 1, tom: 2, hat: 3, cymbal: 4 } as const;
export const SOURCES = ['kick', 'snare', 'hat', 'cymbal'] as const;
export type Source = typeof SOURCES[number];
const RATE = 22050;
/** Proposals nearer than this are the same attack seen by different views. */
const MERGE_S = 0.012;

export interface Proposal { t: number; src: string; score: number }

function channel(act: Float32Array, c: number): Float32Array {
	const out = new Float32Array(Math.floor(act.length / ACT_CLASSES));
	for (let t = 0; t < out.length; t++) out[t] = act[t * ACT_CLASSES + c];
	return out;
}

export interface ProposalInputs {
	mixAct: Float32Array;
	stemAct: Float32Array | null;
	sourceActs: Record<Source, Float32Array | null>;
	sources: Record<Source, Float32Array>;
}

export function readProposalInputs(dir: string): ProposalInputs {
	return {
		mixAct: readF32(join(dir, files.adtofMix)),
		stemAct: existsSync(join(dir, files.adtofDrums)) ? readF32(join(dir, files.adtofDrums)) : null,
		sourceActs: Object.fromEntries(SOURCES.map((k) => {
			const path = join(dir, `adtof-${k}.f32`);
			return [k, existsSync(path) ? readF32(path) : null];
		})) as Record<Source, Float32Array | null>,
		sources: Object.fromEntries(SOURCES.map((k) =>
			[k, readF32(join(dir, `${k}22.f32`))])) as Record<Source, Float32Array>
	};
}

export function proposals(kind: Source, inputs: ProposalInputs): Proposal[] {
	const out: Proposal[] = [];
	const push = (times: number[], levels: number[], src: string) =>
		times.forEach((t, i) => out.push({ t, src, score: levels[i] ?? 0 }));
	const c = CHANNEL[kind];
	const mix = activationStream(channel(inputs.mixAct, c), 0.01);
	push(mix.times, mix.levels, 'mix');
	if (inputs.stemAct) {
		const stem = activationStream(channel(inputs.stemAct, c), 0.01);
		push(stem.times, stem.levels, 'stem');
	}
	if (inputs.sourceActs[kind]) {
		const own = activationStream(channel(inputs.sourceActs[kind]!, c), 0.01);
		push(own.times, own.levels, 'src');
	}
	const onsets = sourceOnsets(inputs.sources[kind], RATE);
	const peaks = pickPeaks(onsets.odf, onsets.fps, {
		localMaxSec: 0.015, movingMeanSec: 0.15, refractorySec: 0.02, delta: 0.02
	});
	for (const peak of peaks) {
		out.push({ t: refinePeakTime(onsets.odf, peak.frame, onsets.fps), src: 'attack', score: peak.strength });
	}
	out.sort((a, b) => a.t - b.t);
	const merged: Proposal[] = [];
	for (const p of out) {
		const last = merged[merged.length - 1];
		if (last && p.t - last.t < MERGE_S) {
			if (!last.src.includes(p.src)) last.src += '+' + p.src;
			last.score = Math.max(last.score, p.score);
		} else merged.push({ ...p });
	}
	return merged;
}
