// node bench/drumeval/prepare.ts [--corpus=mdb,rbma] [--stages=beats,adtof,separation,adtof-drums]
//   [--provider=dml|cpu] [--force=stage] [--batch=N]
// Caches every model input analyzeTrack takes for each corpus track under
// bench/reports/drumeval/evidence. Separation runs in child processes, N tracks each (default 1); a
// cached stereo drum stem from the same HTDemucs export and provider is reused (--force=drums reruns it).
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { performance } from 'node:perf_hooks';
import { Adtof } from '../../packages/analysis/src/adtof.ts';
import { BeatThis } from '../../packages/analysis/src/beatthis.ts';
import { decodeAudio, resamplePcm } from '../../packages/analysis/src/decode.ts';
import { DrumSeparator, SEPARATION_VERSION } from '../../packages/analysis/src/separation.ts';
import { tracks, trackKey, type CorpusTrack } from './corpus.ts';
import {
	evidenceDir, files, pcmHash, readF32, readJson, sha256File, writeF32, writeJson,
	type AudioRecord, type BeatsRecord, type ModelRecord, type SeparationRecord
} from './evidence.ts';

const args = process.argv.slice(2);
const flag = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const provider = (flag('provider') ?? (process.platform === 'win32' ? 'dml' : 'cpu')) as 'cpu' | 'dml';
const force = new Set(flag('force')?.split(',') ?? []);
const STAGES = ['beats', 'adtof', 'separation', 'adtof-drums'] as const;
const stages = new Set(flag('stages')?.split(',') ?? STAGES);
const batch = Number(flag('batch') ?? 1);

async function audioRecord(track: CorpusTrack): Promise<AudioRecord> {
	const dir = evidenceDir(track);
	const path = join(dir, files.audio);
	const sha = sha256File(track.audio);
	const have = readJson<AudioRecord>(path);
	if (have && have.audioSha256 === sha) return have;
	const [narrow, wide] = await Promise.all([decodeAudio(track.audio), decodeAudio(track.audio, 44100)]);
	const record: AudioRecord = {
		audioSha256: sha, hash22: narrow.hash, hash44: wide.hash, duration: narrow.duration, frames44k: wide.left.length
	};
	writeJson(path, record);
	return record;
}

const DRUMS_MODEL = SEPARATION_VERSION.split('-').slice(0, 2).join('-');

async function separateOne(key: string, separator: DrumSeparator, transcriber: Adtof): Promise<void> {
	const track = tracks([key.split('/')[0]]).find((t) => trackKey(t) === key);
	if (!track) throw new Error(`Unknown track ${key}`);
	const dir = evidenceDir(track);
	const audio = await audioRecord(track);
	const previous = readJson<SeparationRecord>(join(dir, files.separation));
	const reuse = !force.has('drums') && previous?.hash44 === audio.hash44
		&& previous.version.startsWith(`${DRUMS_MODEL}-`) && previous.actualProviders.drums === provider
		&& existsSync(join(dir, files.drumsStereo44)) && existsSync(join(dir, files.drums44));
	const actualProviders: Record<string, string> = reuse ? { drums: previous!.actualProviders.drums } : {};
	const report = (p: { stage: string; provider: string }) => { actualProviders[p.stage] = p.provider; };
	const at = performance.now();
	let planar: Float32Array;
	let kit: Record<'kick' | 'snare' | 'hat' | 'cymbal', Float32Array>;
	if (reuse) {
		planar = readF32(join(dir, files.drumsStereo44));
		const length = planar.length / 2;
		kit = await separator.runKit(planar.subarray(0, length), planar.subarray(length), report);
	} else {
		const wide = await decodeAudio(track.audio, 44100);
		if (wide.hash !== audio.hash44) throw new Error(`${key}: 44.1 kHz decode changed.`);
		// Keep the stereo first-stage estimate so a later kit model can reuse it.
		const internal = separator as unknown as { stage: (...p: unknown[]) => Promise<[Float32Array, Float32Array][]> };
		const stage = internal.stage.bind(separator);
		let stereo: Float32Array | undefined;
		internal.stage = async (...parameters: unknown[]) => {
			const result = await stage(...parameters);
			if (parameters[1] === 'drums') {
				stereo = new Float32Array(result[0][0].length * 2);
				stereo.set(result[0][0]);
				stereo.set(result[0][1], result[0][0].length);
			}
			return result;
		};
		const out = await separator.run(wide.left, wide.right, report);
		if (!stereo) throw new Error(`${key}: the drum stage did not run.`);
		planar = stereo;
		kit = out;
		writeF32(join(dir, files.drumsStereo44), planar);
		writeF32(join(dir, files.drums44), out.drums);
	}
	for (const [name, file] of [['kick', files.adtofKick], ['snare', files.adtofSnare], ['hat', files.adtofHat],
		['cymbal', files.adtofCymbal]] as const) {
		const probe: { activations?: Float32Array } = {};
		await transcriber.run(kit[name], probe);
		writeF32(join(dir, file), probe.activations!);
	}
	const [kick, snare, hat, cymbal] = await Promise.all([kit.kick, kit.snare, kit.hat, kit.cymbal]
		.map((pcm) => resamplePcm(pcm, 44100)));
	writeF32(join(dir, files.kick22), kick);
	writeF32(join(dir, files.snare22), snare);
	writeF32(join(dir, files.hat22), hat);
	writeF32(join(dir, files.cymbal22), cymbal);
	const record: SeparationRecord = {
		hash44: audio.hash44, version: SEPARATION_VERSION, drums: pcmHash(planar), provider, actualProviders,
		seconds: (performance.now() - at) / 1000
	};
	writeJson(join(dir, files.separation), record);
}

async function separateMany(keys: string[]): Promise<void> {
	const separator = await DrumSeparator.create(undefined, { provider });
	if (!separator) throw new Error('Separation models are not installed.');
	const transcriber = await Adtof.create();
	try {
		if (!transcriber) throw new Error('ADTOF model is not installed.');
		for (const key of keys) await separateOne(key, separator, transcriber);
	} finally {
		await transcriber?.close();
		await separator.close();
	}
}

/** Track names never contain commas, so a child takes its tracks as one comma-separated flag. */
function spawnSeparation(list: CorpusTrack[]): Promise<void> {
	const keys = list.map(trackKey).join(',');
	return new Promise((accept, reject) => {
		const child = spawn(process.execPath, [import.meta.filename, `--separate-one=${keys}`, `--provider=${provider}`],
			{ stdio: 'inherit', windowsHide: true });
		child.once('error', reject);
		child.once('exit', (code) => (code === 0 ? accept() : reject(new Error(`${keys} separation exited ${code}`))));
	});
}

async function needsSeparation(track: CorpusTrack, audio: AudioRecord): Promise<boolean> {
	const dir = evidenceDir(track);
	const separation = readJson<SeparationRecord>(join(dir, files.separation));
	return stages.has('separation') && (force.has('separation') || !separation
		|| separation.hash44 !== audio.hash44 || separation.version !== SEPARATION_VERSION
		|| !existsSync(join(dir, files.adtofCymbal)));
}

let beatModel = null as BeatThis | null;
let adtofModel = null as Adtof | null;

async function prepare(track: CorpusTrack): Promise<string[]> {
	const dir = evidenceDir(track);
	const done: string[] = [];
	const audio = await audioRecord(track);
	const needSeparation = await needsSeparation(track, audio);
	const separating = needSeparation ? spawnSeparation([track]) : Promise.resolve();

	if (stages.has('beats')) {
		const have = readJson<BeatsRecord>(join(dir, files.beats));
		if (force.has('beats') || !have || have.hash22 !== audio.hash22) {
			const narrow = await decodeAudio(track.audio);
			beatModel ??= await BeatThis.create();
			const result = await beatModel.run(narrow.mono);
			writeJson(join(dir, files.beats), { hash22: narrow.hash, ...result } satisfies BeatsRecord);
			done.push('beats');
		}
	}
	if (stages.has('adtof')) {
		const have = readJson<ModelRecord>(join(dir, files.adtofMixMeta));
		if (force.has('adtof') || !have || have.input !== audio.hash44 || !existsSync(join(dir, files.adtofMix))) {
			const wide = await decodeAudio(track.audio, 44100);
			adtofModel ??= await Adtof.create();
			if (!adtofModel) throw new Error('ADTOF model is not installed.');
			const probe: { activations?: Float32Array } = {};
			const at = performance.now();
			await adtofModel.run(wide.mono, probe);
			writeF32(join(dir, files.adtofMix), probe.activations!);
			writeJson(join(dir, files.adtofMixMeta), {
				input: wide.hash, frames: probe.activations!.length / 5, model: 'adtof_frame_rnn', seconds: (performance.now() - at) / 1000
			} satisfies ModelRecord);
			done.push('adtof');
		}
	}
	await separating;
	if (needSeparation) done.push('separation');
	if (stages.has('adtof-drums') && existsSync(join(dir, files.drums44))) {
		const drums = readF32(join(dir, files.drums44));
		const input = pcmHash(drums);
		const have = readJson<ModelRecord>(join(dir, files.adtofDrumsMeta));
		if (force.has('adtof-drums') || !have || have.input !== input || !existsSync(join(dir, files.adtofDrums))) {
			adtofModel ??= await Adtof.create();
			if (!adtofModel) throw new Error('ADTOF model is not installed.');
			const probe: { activations?: Float32Array } = {};
			const at = performance.now();
			await adtofModel.run(drums, probe);
			writeF32(join(dir, files.adtofDrums), probe.activations!);
			writeJson(join(dir, files.adtofDrumsMeta), {
				input, frames: probe.activations!.length / 5, model: 'adtof_frame_rnn', seconds: (performance.now() - at) / 1000
			} satisfies ModelRecord);
			done.push('adtof-drums');
		}
	}
	return done;
}

const one = flag('separate-one');
if (one) {
	await separateMany(one.split(','));
	// A process that ran CPU sessions on its main thread can hang in native teardown.
	process.exit(0);
} else {
	const list = tracks(flag('corpus')?.split(',') ?? []);
	console.log(`${list.length} tracks, stages ${[...stages].join(',')}, provider ${provider}`);
	const started = performance.now();
	if (batch > 1) {
		const pending: CorpusTrack[] = [];
		for (const track of list) {
			// Unseparated tracks need no decode here; their child records the audio itself.
			const unseparated = stages.has('separation') && !existsSync(join(evidenceDir(track), files.separation));
			if (unseparated || await needsSeparation(track, await audioRecord(track))) pending.push(track);
		}
		for (let i = 0; i < pending.length; i += batch) {
			await spawnSeparation(pending.slice(i, i + batch));
			console.log(`separated ${Math.min(pending.length, i + batch)}/${pending.length} `
				+ `(${((performance.now() - started) / 60000).toFixed(1)} min)`);
		}
	}
	try {
		for (const [i, track] of list.entries()) {
			const at = performance.now();
			const done = await prepare(track);
			console.log(`[${i + 1}/${list.length}] ${trackKey(track)}: ${done.length ? done.join(', ') : 'cached'} `
				+ `(${((performance.now() - at) / 1000).toFixed(1)} s)`);
		}
	} finally {
		await beatModel?.close();
		await adtofModel?.close();
	}
	console.log(`Done in ${((performance.now() - started) / 60000).toFixed(1)} min.`);
}
