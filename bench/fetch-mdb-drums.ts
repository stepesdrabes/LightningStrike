/** Download the published, human-annotated MDB Drums evaluation corpus separately from app data. */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

const revision = 'b29e2d63c3a023506f4bf353c5b2e8a558eed135';
const repository = 'CarlSouthall/MDBDrums';
const output = join(import.meta.dirname, 'corpus', 'mdb-drums');
const response = await fetch(`https://api.github.com/repos/${repository}/git/trees/${revision}?recursive=1`);
if (!response.ok) throw new Error(`GitHub tree: ${response.status}`);
const tree = await response.json() as { tree: { path: string; size?: number; sha: string; type: string }[] };
const files = tree.tree.filter(({ path, type }) => type === 'blob' && (
	/^MDB Drums\/(annotations\/(class|subclass|beats)\/|audio\/(full_mix|drum_only)\/)/.test(path)
	|| path === 'README.md' || path === 'MIREX2017.md'
));
const manifest: { path: string; sha256: string; gitBlob: string; bytes: number }[] = [];
let next = 0;
await Promise.all(Array.from({ length: 4 }, async () => {
	while (next < files.length) {
		const file = files[next++];
		const destination = join(output, file.path.replace(/^MDB Drums\//, ''));
		let data: Buffer;
		if (existsSync(destination)) {
			data = readFileSync(destination);
		} else {
			const url = `https://raw.githubusercontent.com/${repository}/${revision}/${file.path.split('/').map(encodeURIComponent).join('/')}`;
			const download = await fetch(url);
			if (!download.ok) throw new Error(`${file.path}: HTTP ${download.status}`);
			data = Buffer.from(await download.arrayBuffer());
		}
		const blob = createHash('sha1').update(`blob ${data.length}\0`).update(data).digest('hex');
		if (blob !== file.sha) throw new Error(`Git blob mismatch: ${file.path}`);
		mkdirSync(dirname(destination), { recursive: true });
		writeFileSync(destination, data);
		manifest.push({ path: file.path, sha256: createHash('sha256').update(data).digest('hex'), gitBlob: blob, bytes: data.length });
	}
}));
manifest.sort((a, b) => a.path.localeCompare(b.path));
writeFileSync(join(output, 'manifest.json'), JSON.stringify({
	source: `https://github.com/${repository}`, revision,
	license: 'CC BY-NC-SA 4.0',
	citation: 'Southall, Wu, Lerch and Hockman (2017). MDB Drums: An Annotated Subset of MedleyDB for Automatic Drum Transcription. ISMIR.',
	files: manifest
}, null, 2));
console.log(`${manifest.length} verified files, ${(manifest.reduce((sum, f) => sum + f.bytes, 0) / 1e6).toFixed(1)} MB: ${output}`);
