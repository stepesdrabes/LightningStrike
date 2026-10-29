// Striker 2.0's hearing of an audio file, for the harnesses that replay analyzeTrack: the beats and
// downbeats that set the grid and the transcription analysis takes. Runs the model the settings
// choose in MV_MODEL_DIR (or models/) on the CPU, once per audio and model: results are kept under
// bench/corpus/.striker2/<model name>/<audio hash>.json, with the drum heads beside them when asked.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodeAudio } from '../packages/analysis/src/decode.ts';
import {
	Striker2, decodeStriker2, STRIKER2_OUTPUTS, type Striker2Model, type Striker2Outputs,
	type Striker2Result
} from '../packages/analysis/src/striker2.ts';
import { STRIKER2_CLASSES } from '../packages/analysis/src/striker2Decode.ts';
import { striker2Features } from '../packages/analysis/src/striker2Frontend.ts';
import { CPU, providerSession } from '../packages/analysis/src/striker2Provider.ts';
import {
	chosenAnalysisModel, readInstalledStriker2, striker2Problem
} from '../packages/analysis/src/strikerModel.ts';

const ROOT = join(import.meta.dirname, 'corpus', '.striker2');
const cacheDir = (model: Striker2Model) => join(ROOT, model.name.replace(/[^\w.-]+/g, '_'));

/** The coarse drum heads at 100 fps, [frames, 5] each in STRIKER2_CLASSES order, as float32. */
export interface DrumHeads {
	frames: number;
	/** Onset logits. */
	onset: Float32Array;
	/** Offsets in frames, before the decoder clips them. */
	offset: Float32Array;
}

let open: { name: string; striker: Striker2 } | null = null;

async function installed(): Promise<Striker2Model> {
	const choice = await chosenAnalysisModel();
	const found = await readInstalledStriker2(choice);
	if (!('model' in found)) throw new Error(striker2Problem(choice, found));
	return found.model;
}

async function session(model: Striker2Model): Promise<Striker2> {
	if (open?.name !== model.name) {
		await open?.striker.close();
		const striker = await Striker2.create(model, { session: providerSession(CPU) });
		open = { name: model.name, striker };
	}
	return open.striker;
}

function coarse(outputs: Striker2Outputs): DrumHeads {
	const width = STRIKER2_OUTPUTS.drum_onset;
	const first = width - STRIKER2_CLASSES.length;
	const frames = outputs.drum_onset.length / width;
	const pick = (all: Float32Array) => {
		const out = new Float32Array(frames * STRIKER2_CLASSES.length);
		for (let t = 0; t < frames; t++) {
			out.set(all.subarray(t * width + first, (t + 1) * width), t * STRIKER2_CLASSES.length);
		}
		return out;
	};
	return { frames, onset: pick(outputs.drum_onset), offset: pick(outputs.drum_offset) };
}

/** A whole song through an open session: what `Striker2.run` returns and the drum heads behind it. */
export async function listen(
	striker: Striker2, model: Striker2Model, mono: Float32Array
): Promise<{ heard: Striker2Result; heads: DrumHeads }> {
	const outputs = await striker.outputs(striker2Features(mono, model.taps));
	return { heard: decodeStriker2(model, outputs), heads: coarse(outputs) };
}

export async function hearing(audio: string): Promise<Striker2Result> {
	const model = await installed();
	const wide = await decodeAudio(audio, 44100);
	const dir = cacheDir(model);
	const file = join(dir, `${wide.hash}.json`);
	if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8')) as Striker2Result;
	const heard = await (await session(model)).run(wide.mono);
	mkdirSync(dir, { recursive: true });
	writeFileSync(file, JSON.stringify(heard));
	return heard;
}

/** hearing() of audio decoded at 44.1 kHz, and the drum heads that hearing() does not keep. */
export async function hearingWithHeads(
	wide: { mono: Float32Array; hash: string }
): Promise<{ model: Striker2Model; heard: Striker2Result; heads: DrumHeads }> {
	const model = await installed();
	const dir = cacheDir(model);
	const file = join(dir, `${wide.hash}.json`);
	const raw = join(dir, `${wide.hash}.heads.f32`);
	if (existsSync(file) && existsSync(raw)) {
		const bytes = readFileSync(raw);
		const all = new Float32Array(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
		const half = all.length / 2;
		const frames = half / STRIKER2_CLASSES.length;
		const heads = { frames, onset: all.slice(0, half), offset: all.slice(half) };
		return { model, heard: JSON.parse(readFileSync(file, 'utf8')) as Striker2Result, heads };
	}
	const { heard, heads } = await listen(await session(model), model, wide.mono);
	mkdirSync(dir, { recursive: true });
	writeFileSync(file, JSON.stringify(heard));
	writeFileSync(raw, Buffer.concat([Buffer.from(heads.onset.buffer), Buffer.from(heads.offset.buffer)]));
	return { model, heard, heads };
}

/** Releases the model's session so a harness can exit. */
export async function stopHearing(): Promise<void> {
	await open?.striker.close();
	open = null;
}
