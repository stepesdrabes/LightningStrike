import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';

/**
 * Fetch Raveform's DJ-annotated EDM structures and beats (mir-aidj.github.io/raveform).
 * Keep the annotation subset and index, then fetch a seeded sample of the referenced YouTube
 * IDs.
 * Gate duration against replaced or edited uploads; passing files and rejects survive reruns.
 */

const CORPUS = join(import.meta.dirname, 'corpus');
const ROOT = join(CORPUS, 'raveform');
const AUDIO = join(ROOT, 'audio');
const TMP = join(ROOT, 'tmp');
const REJECTS = join(ROOT, 'rejects.json');
const ZIP_URL = 'https://huggingface.co/datasets/taejunkim/raveform/resolve/main/raveform.zip';
const TARGET = Number(process.argv[2] ?? 120);
const SLEEP_MS = 2000;
const SEED = 0x1223;
const MAX_DURATION_DRIFT = 0.02;

function sh(cmd: string, args: string[]): Promise<{ code: number; out: string }> {
	return new Promise((resolve) => {
		const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'ignore'] });
		let out = '';
		child.stdout.on('data', (d) => (out += d));
		child.on('error', () => resolve({ code: -1, out }));
		child.on('close', (code) => resolve({ code: code ?? -1, out }));
	});
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function ensureAnnotations(): Promise<void> {
	if (existsSync(join(ROOT, 'structures', 'segments.json'))) return;
	const zip = join(CORPUS, 'raveform.zip');
	if (!existsSync(zip)) {
		console.error('fetching raveform.zip (~480 MB)');
		const r = await fetch(ZIP_URL);
		if (!r.ok) throw new Error(`raveform.zip: ${r.status}`);
		writeFileSync(zip, Buffer.from(await r.arrayBuffer()));
	}
	console.error('extracting annotations');
	const { code } = await sh('unzip', [
		'-o', '-q', zip,
		'raveform/structures/*',
		'raveform/tracks.jsonl',
		'-d', CORPUS
	]);
	if (code !== 0 || !existsSync(join(ROOT, 'structures', 'segments.json'))) {
		throw new Error('raveform extract failed');
	}
	rmSync(zip, { force: true });
}

/** mulberry32: seeded shuffle so a rerun samples the same 120 tracks. */
function rng(seed: number): () => number {
	let a = seed >>> 0;
	return () => {
		a = (a + 0x6d2b79f5) | 0;
		let t = Math.imul(a ^ (a >>> 15), 1 | a);
		t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
		return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
	};
}

interface RaveformTrack {
	key: string;
	id: string;
	duration: number;
}

async function probeDuration(file: string): Promise<number> {
	const { code, out } = await sh('ffprobe', [
		'-v', 'error',
		'-show_entries', 'format=duration',
		'-of', 'csv=p=0',
		file
	]);
	const d = Number(out.trim());
	return code === 0 && Number.isFinite(d) ? d : 0;
}

async function ytdlp(id: string, key: string): Promise<string | null> {
	const { code } = await sh('yt-dlp', [
		'--no-playlist', '--no-warnings', '-q',
		'-f', '140/bestaudio',
		'-x', '--audio-format', 'm4a',
		'-o', join(TMP, `${key}.%(ext)s`),
		`https://www.youtube.com/watch?v=${id}`
	]);
	const out = join(TMP, `${key}.m4a`);
	return code === 0 && existsSync(out) ? out : null;
}

await ensureAnnotations();
mkdirSync(AUDIO, { recursive: true });
mkdirSync(TMP, { recursive: true });

const tracks: RaveformTrack[] = JSON.parse(
	readFileSync(join(ROOT, 'structures', 'segments.json'), 'utf8')
);
const order = [...tracks].sort((a, b) => a.key.localeCompare(b.key));
const rand = rng(SEED);
for (let i = order.length - 1; i > 0; i--) {
	const j = Math.floor(rand() * (i + 1));
	[order[i], order[j]] = [order[j], order[i]];
}

const rejects: Record<string, string> = existsSync(REJECTS)
	? JSON.parse(readFileSync(REJECTS, 'utf8'))
	: {};
const saveRejects = () => writeFileSync(REJECTS, JSON.stringify(rejects, null, '\t'));

let passed = 0;
for (const t of order) {
	if (existsSync(join(AUDIO, `${t.key}.m4a`))) passed++;
}
console.error(`raveform: ${tracks.length} annotated, ${passed} already fetched, target ${TARGET}`);

for (const t of order) {
	if (passed >= TARGET) break;
	const out = join(AUDIO, `${t.key}.m4a`);
	if (existsSync(out) || rejects[t.key]) continue;

	const tmp = await ytdlp(t.id, t.key);
	await sleep(SLEEP_MS);
	if (!tmp) {
		rejects[t.key] = 'download failed';
		saveRejects();
		console.error(`  ${t.key}: download failed (${passed}/${TARGET})`);
		continue;
	}

	const got = await probeDuration(tmp);
	const drift = Math.abs(got - t.duration) / t.duration;
	if (drift <= MAX_DURATION_DRIFT) {
		renameSync(tmp, out);
		passed++;
		console.error(`  ${t.key}: pass ${got.toFixed(1)}s (${passed}/${TARGET})`);
	} else {
		rmSync(tmp, { force: true });
		rejects[t.key] = `duration ${got.toFixed(1)}s vs annotated ${t.duration.toFixed(1)}s`;
		saveRejects();
		console.error(`  ${t.key}: replaced upload ${got.toFixed(1)}s vs ${t.duration.toFixed(1)}s (${passed}/${TARGET})`);
	}
}

rmSync(TMP, { recursive: true, force: true });
console.error(`raveform: ${passed} passing, ${Object.keys(rejects).length} rejected or unavailable`);
