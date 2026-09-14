// node bench/drumeval/judge/server.ts --session=DIR [--port=5199]
// Serves a listening session built by build.ts and appends each verdict to DIR/answers.jsonl.
import { createReadStream, existsSync, statSync } from 'node:fs';
import { appendFile, readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { extname, join, normalize, resolve } from 'node:path';

const args = process.argv.slice(2);
const flag = (name: string) => args.find((a) => a.startsWith(`--${name}=`))?.slice(name.length + 3);
const session = resolve(flag('session') ?? '');
const port = Number(flag('port') ?? 5199);
if (!existsSync(join(session, 'session.json'))) throw new Error('Pass --session=DIR containing session.json.');

const TYPES: Record<string, string> = {
	'.html': 'text/html; charset=utf-8', '.json': 'application/json', '.m4a': 'audio/mp4', '.mp3': 'audio/mpeg',
	'.wav': 'audio/wav', '.js': 'text/javascript'
};

createServer(async (req, res) => {
	try {
		const url = new URL(req.url ?? '/', `http://localhost:${port}`);
		if (req.method === 'POST' && url.pathname === '/answer') {
			const chunks: Buffer[] = [];
			for await (const chunk of req) chunks.push(chunk as Buffer);
			const answer = JSON.parse(Buffer.concat(chunks).toString('utf8'));
			if (typeof answer?.question !== 'string') throw new Error('Missing question id.');
			await appendFile(join(session, 'answers.jsonl'), JSON.stringify({ ...answer, savedAt: new Date().toISOString() }) + '\n');
			res.writeHead(204).end();
			return;
		}
		if (url.pathname === '/answers') {
			const text = existsSync(join(session, 'answers.jsonl')) ? await readFile(join(session, 'answers.jsonl'), 'utf8') : '';
			res.writeHead(200, { 'content-type': 'application/json' });
			res.end(JSON.stringify(text.split('\n').filter(Boolean).map((line) => JSON.parse(line))));
			return;
		}
		const path = url.pathname === '/' ? join(import.meta.dirname, 'index.html')
			: url.pathname === '/session.json' ? join(session, 'session.json')
				: join(session, normalize(decodeURIComponent(url.pathname)).replace(/^([\\/])+/, ''));
		if (!path.startsWith(session) && !path.startsWith(import.meta.dirname)) throw new Error('Outside the session.');
		if (!existsSync(path) || !statSync(path).isFile()) {
			res.writeHead(404).end();
			return;
		}
		const size = statSync(path).size;
		const range = /bytes=(\d*)-(\d*)/.exec(req.headers.range ?? '');
		const type = TYPES[extname(path)] ?? 'application/octet-stream';
		if (range) {
			const start = range[1] ? Number(range[1]) : 0;
			const end = range[2] ? Number(range[2]) : size - 1;
			res.writeHead(206, { 'content-type': type, 'content-range': `bytes ${start}-${end}/${size}`, 'accept-ranges': 'bytes',
				'content-length': end - start + 1 });
			createReadStream(path, { start, end }).pipe(res);
			return;
		}
		res.writeHead(200, { 'content-type': type, 'content-length': size, 'cache-control': 'no-store' });
		createReadStream(path).pipe(res);
	} catch (error) {
		res.writeHead(400, { 'content-type': 'text/plain' }).end(error instanceof Error ? error.message : String(error));
	}
}).listen(port, '127.0.0.1', () => console.log(`Judging ${session} at http://127.0.0.1:${port}/`));
