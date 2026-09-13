// node bench/lab/habibi-listen.ts --id=TRACK --from=39 --to=46 --times=39.594,40.410 --name=candidates
import { existsSync, mkdirSync, readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { decodeAudio } from '../../packages/analysis/src/decode.ts';
import { benchmarkCache } from '../cache.ts';

const args = process.argv.slice(2);
const option = (key: string) => args.find((arg) => arg.startsWith(`--${key}=`))?.slice(key.length + 3);
if (args.includes('--help')) {
	console.log('node bench/lab/habibi-listen.ts --id=TRACK --from=SECONDS --to=SECONDS [--times=T1,T2] [--name=preview] [--audio=PATH] [--cache=DIR] [--out=DIR]');
} else {
	const id = option('id');
	const from = Number(option('from'));
	const to = Number(option('to'));
	const name = option('name') ?? 'preview';
	if (!id || !/^[\w-]+$/.test(id)) throw new Error('Pass --id with the cached track identifier.');
	if (!Number.isFinite(from) || !Number.isFinite(to) || from < 0 || to <= from) throw new Error('Pass a valid --from and --to interval in seconds.');
	if (!/^[\w-]+$/.test(name)) throw new Error('Use letters, numbers, underscores or hyphens for --name.');
	const times = (option('times') ?? '').split(',').filter(Boolean).map(Number);
	if (times.some((time) => !Number.isFinite(time) || time < 0)) throw new Error('--times must contain nonnegative timestamps in seconds.');
	const cache = benchmarkCache(option('cache'));
	const source = option('audio') ? resolve(option('audio')!) : (() => {
		const file = readdirSync(cache).find((file) => file.startsWith(`${id}.`) && /\.(m4a|mp3|wav|flac|opus|webm)$/i.test(file));
		if (!file) throw new Error(`No cached audio found for ${id}. Pass --audio for a different source.`);
		return resolve(cache, file);
	})();
	const out = resolve(option('out') ?? join(import.meta.dirname, '../reports/audio-reliability/drum-listen', id));
	const target = join(out, `${name}.wav`);
	const manifest = join(out, `${name}.json`);
	if (existsSync(target) || existsSync(manifest)) throw new Error(`Review artifacts already exist for ${name}; choose another --name or --out.`);
	const audio = await decodeAudio(source, 44100);
	if (to > audio.duration) throw new Error(`Clip ends after the audio duration (${audio.duration.toFixed(3)} seconds).`);
	const selected = times.filter((time) => time >= from && time < to);
	const samples = Math.round((to - from) * audio.sampleRate);
	const pcm = new Float32Array(samples * 2);
	const start = Math.round(from * audio.sampleRate);
	for (let i = 0; i < samples; i++) {
		pcm[i * 2] = (audio.left[start + i] ?? 0) * 0.65;
		pcm[i * 2 + 1] = (audio.right[start + i] ?? 0) * 0.65;
	}
	for (const time of selected) {
		for (let i = 0; i < 0.035 * audio.sampleRate; i++) {
			const at = Math.round((time - from) * audio.sampleRate) + i;
			if (at >= samples) break;
			const click = 0.35 * Math.exp(-i / (0.006 * audio.sampleRate)) * Math.sin(2 * Math.PI * 1600 * i / audio.sampleRate);
			pcm[at * 2] += click;
			pcm[at * 2 + 1] += click;
		}
	}
	const wav = Buffer.alloc(44 + pcm.length * 2);
	wav.write('RIFF'); wav.writeUInt32LE(wav.length - 8, 4); wav.write('WAVEfmt ', 8);
	wav.writeUInt32LE(16, 16); wav.writeUInt16LE(1, 20); wav.writeUInt16LE(2, 22);
	wav.writeUInt32LE(audio.sampleRate, 24); wav.writeUInt32LE(audio.sampleRate * 4, 28);
	wav.writeUInt16LE(4, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36);
	wav.writeUInt32LE(pcm.length * 2, 40);
	for (let i = 0; i < pcm.length; i++) wav.writeInt16LE(Math.round(Math.max(-1, Math.min(1, pcm[i])) * 32767), 44 + i * 2);
	mkdirSync(out, { recursive: true });
	writeFileSync(target, wav);
	writeFileSync(manifest, JSON.stringify({ trackId: id, source, audioHash: audio.hash, from, to,
		times: selected, ignoredTimes: times.filter((time) => time < from || time >= to), sampleRate: audio.sampleRate, output: target }, null, 2));
	console.log(target);
}
