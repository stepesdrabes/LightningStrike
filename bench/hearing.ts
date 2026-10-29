// Striker 2.0's hearing of an audio file, for the harnesses that replay analyzeTrack: the beats and
// downbeats that set the grid and the transcription analysis takes. Runs the model the settings
// choose in MV_MODEL_DIR (or models/), once per audio and model: results are kept under
// bench/corpus/.striker2/<model name>/<audio hash>.json.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodeAudio } from '../packages/analysis/src/decode.ts';
import { Striker2, type Striker2Result } from '../packages/analysis/src/striker2.ts';
import {
	chosenAnalysisModel, readInstalledStriker2, striker2Problem
} from '../packages/analysis/src/strikerModel.ts';

const ROOT = join(import.meta.dirname, 'corpus', '.striker2');

let open: { name: string; striker: Striker2 } | null = null;

export async function hearing(audio: string): Promise<Striker2Result> {
	const choice = await chosenAnalysisModel();
	const installed = await readInstalledStriker2(choice);
	if (!('model' in installed)) throw new Error(striker2Problem(choice, installed));
	const { model } = installed;
	const wide = await decodeAudio(audio, 44100);
	const dir = join(ROOT, model.name.replace(/[^\w.-]+/g, '_'));
	const file = join(dir, `${wide.hash}.json`);
	if (existsSync(file)) return JSON.parse(readFileSync(file, 'utf8')) as Striker2Result;
	if (open?.name !== model.name) {
		await open?.striker.close();
		open = { name: model.name, striker: await Striker2.create(model) };
	}
	const heard = await open.striker.run(wide.mono);
	mkdirSync(dir, { recursive: true });
	writeFileSync(file, JSON.stringify(heard));
	return heard;
}

/** Releases the model's session so a harness can exit. */
export async function stopHearing(): Promise<void> {
	await open?.striker.close();
	open = null;
}
