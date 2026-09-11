import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { CACHE_DIR, decodeAudio } from '@mv/analysis';
import { GenreClassifier } from '../packages/analysis/src/genreModel.ts';

/** Print Discogs-EffNet style activations over the cache; optional track IDs select a subset. */
const only = new Set(process.argv.slice(2));

const metas = (await readdir(CACHE_DIR)).filter((f) => f.endsWith('.meta.json'));
const model = await GenreClassifier.create();
let done = 0;

for (const f of metas) {
	const meta = JSON.parse(await readFile(join(CACHE_DIR, f), 'utf8')) as {
		id: string;
		title: string;
	};
	if (only.size > 0 && !only.has(meta.id)) continue;
	const files = await readdir(CACHE_DIR);
	const audio = files.find((x) => x.startsWith(`${meta.id}.`) && !x.includes('.json') && !x.endsWith('.pcm'));
	if (!audio) continue;

	const at = `[${++done}]`;
	try {
		const decoded = await decodeAudio(join(CACHE_DIR, audio));
		const t0 = performance.now();
		const result = await model.run(decoded.mono);
		const secs = ((performance.now() - t0) / 1000).toFixed(1);
		const top3 = result.top
			.slice(0, 3)
			.map((a) => `${a.label} ${a.score.toFixed(2)}`)
			.join('  ');
		console.log(`${at} ${meta.title.slice(0, 40).padEnd(40)} ${top3}  (${secs}s)`);
	} catch (e) {
		console.log(`${at} ${meta.title}: ${(e as Error).message.split('\n')[0]}`);
	}
}
await model.close();
