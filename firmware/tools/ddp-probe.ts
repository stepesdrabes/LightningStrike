// DDP bring-up timing probe:
// node --experimental-strip-types ddp-probe.ts <host|loopback> [pixels] [seconds] [pacer]
// loopback isolates sender/OS timing from radio and board costs.

import { createSocket, type Socket } from 'node:dgram';
import { createDdpSink } from '../../packages/transport/src/index.ts';

const FRAME_MS = 1000 / 60;
const STATS_PORT = 4049;

const target = process.argv[2] ?? 'loopback';
const pixels = Number(process.argv[3] ?? 671);
const seconds = Number(process.argv[4] ?? 30);
const pacer = (process.argv[5] ?? 'paced') as 'paced' | 'interval';
const loopback = target === 'loopback';

/** Gaps over 20/50/100 ms, exclusive buckets. 16.7 ms is the frame budget they sit around. */
class Timing {
	private late = [0, 0, 0];
	private min = Infinity;
	private max = 0;
	private n = 0;
	private prev = 0;

	mark(now: number): void {
		if (this.prev) {
			const gap = now - this.prev;
			this.min = Math.min(this.min, gap);
			this.max = Math.max(this.max, gap);
			if (gap > 100) this.late[2]++;
			else if (gap > 50) this.late[1]++;
			else if (gap > 20) this.late[0]++;
		}
		this.prev = now;
		this.n++;
	}

	line(label: string, elapsed: number): string {
		const fps = (this.n / elapsed).toFixed(1);
		const min = (this.min === Infinity ? 0 : this.min).toFixed(1);
		return (
			`${label.padEnd(8)} ${fps.padStart(5)} fps  ` +
			`gap ${min}/${this.max.toFixed(1)} ms  ` +
			`late ${this.late.join('/')}  (${this.n} frames)`
		);
	}
}

const sent = new Timing();
const echoed = new Timing();

// Reuse the telemetry socket as loopback receiver; boards reply to the stream source address.
const stats = createSocket('udp4');
const boardLines: string[] = [];
stats.on('message', (m) => {
	const line = m.toString();
	boardLines.push(line);
	console.log('  [board]', line);
});
await new Promise<void>((r) => stats.bind(STATS_PORT, r));

let sink: ReturnType<typeof createDdpSink>;
let localRx: Socket | undefined;

if (loopback) {
	// Score arrivals exactly as the firmware does: PUSH closes a frame.
	localRx = createSocket('udp4');
	localRx.on('message', (m) => {
		if (m.length >= 10 && (m[0] & 0xc0) === 0x40 && (m[0] & 0x01) === 1) echoed.mark(performance.now());
	});
	await new Promise<void>((r) => localRx!.bind(0, '127.0.0.1', r));
	const port = (localRx.address() as { port: number }).port;
	sink = createDdpSink({ targets: [{ host: '127.0.0.1', port, firstLed: 0, ledCount: pixels }] });
} else {
	sink = createDdpSink({ targets: [{ host: target, firstLed: 0, ledCount: pixels }] });
}
await sink.open();

const rgb = new Uint8Array(pixels * 3);
let frames = 0;

function emit(now: number): void {
	// A moving band, so the payload is never a constant the radio could collapse.
	const head = (frames * 4) % pixels;
	rgb.fill(0);
	for (let i = 0; i < 60; i++) {
		const k = ((head + i) % pixels) * 3;
		rgb[k] = 255;
		rgb[k + 1] = 80;
		rgb[k + 2] = 10;
	}
	sink.send({ rgb, dt: 1 / 60, frameId: frames, presentAtMs: now });
	sent.mark(now);
	frames++;
}

const t0 = performance.now();
const until = t0 + seconds * 1000;

if (pacer === 'interval') {
	// What apps/web does today, kept as the baseline to measure the pacer against.
	const timer = setInterval(() => emit(performance.now()), FRAME_MS);
	await new Promise((r) => setTimeout(r, seconds * 1000));
	clearInterval(timer);
} else {
	// Absolute deadlines prevent accumulated timer rounding; sleep short, then spin to the deadline.
	let deadline = t0;
	while (performance.now() < until) {
		deadline += FRAME_MS;
		const slack = deadline - performance.now() - 2;
		if (slack > 0) await new Promise((r) => setTimeout(r, slack));
		while (performance.now() < deadline) {
			/* spin to the deadline */
		}
		emit(performance.now());
	}
}

const elapsed = (performance.now() - t0) / 1000;
await sink.close();
localRx?.close();
stats.close();

console.log();
console.log(`target ${loopback ? 'loopback (no radio)' : target}  ${pixels} px  ${pacer}  ${elapsed.toFixed(1)}s`);
console.log(sent.line('sender', elapsed));
if (loopback) console.log(echoed.line('local', elapsed));
if (boardLines.length) console.log(`board reported ${boardLines.length} lines, last: ${boardLines.at(-1)}`);
