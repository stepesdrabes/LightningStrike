// node bench/annotate/server.ts [--port=5190]
// Serves the drum annotation app over bench/reports/annotate: clips from prepare.ts in, one
// annotation file per clip out. export.ts turns those into a drumeval corpus.
import { createReadStream, existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { extname, join, normalize, sep } from 'node:path';
import { EVAL_ROOT } from '../drumeval/evidence.ts';

const port = Number(process.argv.slice(2).find((a) => a.startsWith('--port='))?.slice(7) ?? 5190);
const ROOT = join(EVAL_ROOT, '..', 'annotate');
const CLIPS = join(ROOT, 'clips');
const SAVED = join(ROOT, 'annotations');
const UI = import.meta.dirname;
mkdirSync(SAVED, { recursive: true });

const TYPES: Record<string, string> = {
	'.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8',
	'.json': 'application/json', '.wav': 'audio/wav'
};

/** Nothing outside the two served roots, whatever the request path says. */
function resolveUnder(root: string, rest: string): string | null {
	const path = normalize(join(root, decodeURIComponent(rest)));
	const inside = path === root || path.startsWith(root + sep);
	return inside && existsSync(path) ? path : null;
}

createServer((req, res) => {
	const url = new URL(req.url ?? '/', 'http://localhost');
	const path = url.pathname;

	if (req.method === 'POST' && path.startsWith('/save/')) {
		const id = path.slice(6);
		if (!/^[\w.-]+$/.test(id)) {
			res.writeHead(400).end('bad id');
			return;
		}
		const chunks: Buffer[] = [];
		req.on('data', (c) => chunks.push(c));
		req.on('end', () => {
			const body = Buffer.concat(chunks).toString('utf8');
			try {
				JSON.parse(body);
			} catch {
				res.writeHead(400).end('bad json');
				return;
			}
			writeFileSync(join(SAVED, `${id}.json`), body);
			res.writeHead(200, { 'content-type': 'application/json' }).end('{"ok":true}');
		});
		return;
	}

	if (path === '/annotations') {
		const out = Object.fromEntries(readdirSync(SAVED).filter((f) => f.endsWith('.json'))
			.map((f) => [f.slice(0, -5), JSON.parse(readFileSync(join(SAVED, f), 'utf8'))]));
		res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(out));
		return;
	}

	const file = path === '/' ? join(UI, 'index.html')
		: path.startsWith('/clips/') ? resolveUnder(CLIPS, path.slice(7))
		: resolveUnder(UI, path.slice(1));
	if (!file) {
		res.writeHead(404).end('not found');
		return;
	}
	res.writeHead(200, { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'cache-control': 'no-cache' });
	createReadStream(file).pipe(res);
}).listen(port, () => {
	console.log(`drum annotation: http://localhost:${port}`);
	console.log(`clips ${CLIPS}`);
	console.log(`saving to ${SAVED}`);
});
