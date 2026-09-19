// HTTP listener probe: one request at a time, a new connection each, closed the way a browser
// closes (the moment it has the body) or after the board's own FIN, with a gap between them.
// A healthy board refuses none of them at any gap.
// node --experimental-strip-types http-probe.ts <host> [early|clean] [gapMs] [count]

import net from 'node:net';

const host = process.argv[2] ?? 'room-frame.local';
const mode = (process.argv[3] ?? 'early') as 'early' | 'clean';
const gap = Number(process.argv[4] ?? 0);
const count = Number(process.argv[5] ?? 24);

const REQUEST = `GET /api/state HTTP/1.1\r\nHost: ${host}\r\nConnection: close\r\n\r\n`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

interface Timing {
	connectMs: number;
	replyMs: number;
	outcome: string;
}

function once(): Promise<Timing> {
	const t0 = performance.now();
	return new Promise((resolve) => {
		const t: Timing = { connectMs: -1, replyMs: -1, outcome: 'no reply' };
		const s = net.createConnection({ host, port: 80 });
		let data = '';
		s.setTimeout(3000, () => s.destroy(new Error('timeout')));
		s.on('connect', () => {
			t.connectMs = performance.now() - t0;
			s.write(REQUEST);
		});
		s.on('data', (chunk) => {
			data += chunk;
			const headEnd = data.indexOf('\r\n\r\n');
			const length = Number(/content-length: (\d+)\r\n/i.exec(data)?.[1] ?? NaN);
			if (headEnd < 0 || !(data.length >= headEnd + 4 + length)) return;
			if (t.replyMs < 0) {
				t.replyMs = performance.now() - t0;
				t.outcome = data.slice(9, 12);
			}
			if (mode === 'early' && !s.writableEnded) s.end();
		});
		s.on('error', (e: NodeJS.ErrnoException) => {
			t.outcome = `${e.code ?? e.message} after ${(performance.now() - t0).toFixed(0)} ms`;
		});
		s.on('close', () => resolve(t));
	});
}

let refused = 0;
let worst = 0;
for (let i = 0; i < count; i++) {
	const t = await once();
	if (t.outcome !== '200') refused++;
	worst = Math.max(worst, t.replyMs);
	console.log(
		`${String(i).padStart(3)}  connect ${t.connectMs.toFixed(0).padStart(5)} ms  reply ${t.replyMs.toFixed(0).padStart(5)} ms  ${t.outcome}`
	);
	if (gap > 0) await sleep(gap);
}
console.log(`${mode} close, ${gap} ms gap: ${refused}/${count} not answered, slowest reply ${worst.toFixed(0)} ms`);
