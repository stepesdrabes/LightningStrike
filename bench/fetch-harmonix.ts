import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { spawn } from 'node:child_process';
import { MAX_DURATION_DRIFT } from './kinds.ts';

/**
 * Fetch Harmonix annotations and audio. Gate decoded duration against the Rock Band master
 * edit;
 * a full single with omitted game sections cannot be repaired by a constant time offset.
 * Try the best DTW alignments first, serially. Passing files and recorded rejects survive
 * reruns.
 */

const CORPUS = join(import.meta.dirname, 'corpus');
const ROOT = join(CORPUS, 'harmonixset-main', 'dataset');
const AUDIO = join(CORPUS, 'harmonix', 'audio');
const TMP = join(CORPUS, 'harmonix', 'tmp');
const REJECTS = join(CORPUS, 'harmonix', 'rejects.json');
const TARGET = Number(process.argv[2] ?? 150);
const SLEEP_MS = 2000;

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
	if (existsSync(ROOT)) return;
	console.error('fetching harmonixset annotations');
	const r = await fetch('https://github.com/urinieto/harmonixset/archive/refs/heads/main.tar.gz');
	if (!r.ok) throw new Error(`harmonixset tarball: ${r.status}`);
	const tarball = join(CORPUS, 'harmonixset.tar.gz');
	writeFileSync(tarball, Buffer.from(await r.arrayBuffer()));
	const { code } = await sh('tar', ['xzf', tarball, '-C', CORPUS]);
	rmSync(tarball, { force: true });
	if (code !== 0 || !existsSync(ROOT)) throw new Error('harmonixset extract failed');
}

/** One CSV row, honouring quoted fields, because Harmonix titles contain commas. */
function csvRow(line: string): string[] {
	const out: string[] = [];
	let cur = '';
	let quoted = false;
	for (const ch of line) {
		if (ch === '"') quoted = !quoted;
		else if (ch === ',' && !quoted) {
			out.push(cur);
			cur = '';
		} else cur += ch;
	}
	out.push(cur);
	return out;
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

async function ytdlp(url: string, id: string): Promise<string | null> {
	const { code } = await sh('yt-dlp', [
		'--no-playlist', '--no-warnings', '-q',
		// 140 is the AAC m4a that nearly every upload carries; -x remuxes the fallback
		// formats to m4a too, so the corpus is one extension.
		'-f', '140/bestaudio',
		'-x', '--audio-format', 'm4a',
		'-o', join(TMP, `${id}.%(ext)s`),
		url
	]);
	const out = join(TMP, `${id}.m4a`);
	return code === 0 && existsSync(out) ? out : null;
}

await ensureAnnotations();
mkdirSync(AUDIO, { recursive: true });
mkdirSync(TMP, { recursive: true });

const master = new Map<string, number>();
for (const line of readFileSync(join(ROOT, 'metadata.csv'), 'utf8').trim().split('\n').slice(1)) {
	const f = csvRow(line);
	const seconds = Number(f[4]);
	if (f[0] && Number.isFinite(seconds) && seconds > 0) master.set(f[0], seconds);
}

const urls = new Map<string, string>();
for (const line of readFileSync(join(ROOT, 'youtube_urls.csv'), 'utf8').trim().split('\n').slice(1)) {
	const i = line.indexOf(',');
	urls.set(line.slice(0, i), line.slice(i + 1).trim());
}

// Best-aligned first: a low DTW score means the upload is a different edit, and no constant
// offset will rescue that.
const ranked = readFileSync(join(ROOT, 'youtube_alignment_scores.csv'), 'utf8')
	.trim()
	.split('\n')
	.slice(1)
	.map((l) => {
		const p = l.split(',');
		return [p[0], Number(p[1])] as [string, number];
	})
	.sort((a, b) => b[1] - a[1])
	.map(([id]) => id);

const rejects: Record<string, string> = existsSync(REJECTS)
	? JSON.parse(readFileSync(REJECTS, 'utf8'))
	: {};
const saveRejects = () => writeFileSync(REJECTS, JSON.stringify(rejects, null, '\t'));

let passed = 0;
for (const id of ranked) {
	if (existsSync(join(AUDIO, `${id}.m4a`))) passed++;
}
console.error(`harmonix: ${passed} already passing, target ${TARGET}`);

for (const id of ranked) {
	if (passed >= TARGET) break;
	const out = join(AUDIO, `${id}.m4a`);
	if (existsSync(out) || rejects[id]) continue;
	const url = urls.get(id);
	const want = master.get(id);
	if (!url || !want) {
		rejects[id] = !url ? 'no url' : 'no master duration';
		saveRejects();
		continue;
	}

	const tmp = await ytdlp(url, id);
	await sleep(SLEEP_MS);
	if (!tmp) {
		rejects[id] = 'download failed';
		saveRejects();
		console.error(`  ${id}: download failed (${passed}/${TARGET})`);
		continue;
	}

	const got = await probeDuration(tmp);
	const drift = Math.abs(got - want) / want;
	if (drift <= MAX_DURATION_DRIFT) {
		renameSync(tmp, out);
		passed++;
		console.error(`  ${id}: pass ${got.toFixed(1)}s vs ${want.toFixed(1)}s (${passed}/${TARGET})`);
	} else {
		rmSync(tmp, { force: true });
		rejects[id] = `duration ${got.toFixed(1)}s vs master ${want.toFixed(1)}s`;
		saveRejects();
		console.error(`  ${id}: wrong edit ${got.toFixed(1)}s vs ${want.toFixed(1)}s (${passed}/${TARGET})`);
	}
}

rmSync(TMP, { recursive: true, force: true });
const rejected = Object.keys(rejects).length;
console.error(`harmonix: ${passed} passing, ${rejected} rejected or unavailable`);
