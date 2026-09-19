// What a frame costs on the wire, and what each candidate encoding would cost instead.
// node bench/wireprobe.ts [--stacks N]
// node bench/wireprobe.ts --to <board> [--seconds N] [--swap N]
// --to streams real mixer frames at the board and alternates packed against raw, reading the
// board's own stats line back. Interleaved rather than batched: 2.4 GHz drifts enough over
// minutes to invent a difference.
// Frames come from real layer stacks over the scripted journey, so the distribution is the
// room's, not a synthetic gradient's. 1440 B is the number that matters: a frame over it needs
// two datagrams and both have to arrive, and the second one's wait is pure latency.
import { createSocket } from 'node:dgram';
import { deflateRawSync } from 'node:zlib';
import { createDdpSink, type DdpTarget } from '@mv/transport';
import {
	BUILT_IN_EFFECTS,
	DEFAULT_OPACITY,
	DEFAULT_ROOM,
	LAYER_ROLES,
	Mixer,
	buildGeometry,
	makePalette,
	scriptFrames,
	type EffectDef,
	type LayerRole,
	type SectionKind
} from '@mv/core';

const MAX_DATA = 1440;
const g = buildGeometry(DEFAULT_ROOM);
const N = g.count;
const RAW = N * 3;

const argv = process.argv.slice(2);
const flag = (n: string) => {
	const i = argv.indexOf(`--${n}`);
	return i >= 0 ? argv[i + 1] : undefined;
};

const PALETTE = makePalette({ base: 0, accent: 180, third: 60, sat: 0.94, shade: 0.14, white: 0.06 });
const INTENSITY: Partial<Record<SectionKind, number>> = {
	intro: 0.46,
	groove: 0.68,
	build: 0.62,
	void: 0.05,
	drop: 0.9,
	outro: 0.5
};

const byRole = new Map<LayerRole, EffectDef[]>();
for (const role of LAYER_ROLES) byRole.set(role, BUILT_IN_EFFECTS.filter((e) => e.role === role));

/** Deterministic stacks that look like composed cues: a bed, then whatever else fits. */
function stacks(limit: number): Partial<Record<LayerRole, EffectDef>>[] {
	const pick = (role: LayerRole, i: number) => {
		const all = byRole.get(role) ?? [];
		return all.length ? all[i % all.length] : undefined;
	};
	const out: Partial<Record<LayerRole, EffectDef>>[] = [];
	for (let i = 0; i < limit; i++) {
		out.push({
			bed: pick('bed', i),
			rhythm: pick('rhythm', i * 3),
			transient: pick('transient', i * 5),
			accent: pick('accent', i * 7),
			master: i % 4 === 0 ? pick('master', i * 11) : undefined
		});
	}
	return out;
}

// ---- candidates. Every one is lossless, stateless and decodable from its own datagram. ----

const scratch = new Uint8Array(RAW);
const scratch2 = new Uint8Array(RAW);

/** All R, then all G, then all B. Each plane is smoother than the interleaved buffer. */
function planes(b: Uint8Array, out: Uint8Array): Uint8Array {
	for (let k = 0; k < N; k++) {
		out[k] = b[k * 3];
		out[N + k] = b[k * 3 + 1];
		out[2 * N + k] = b[k * 3 + 2];
	}
	return out;
}

/** Difference from the pixel before, within each plane. A smooth ramp becomes a constant. */
function alongStrip(p: Uint8Array, out: Uint8Array): Uint8Array {
	for (let c = 0; c < 3; c++) {
		const base = c * N;
		out[base] = p[base];
		for (let k = 1; k < N; k++) out[base + k] = (p[base + k] - p[base + k - 1]) & 0xff;
	}
	return out;
}

/** Literal/repeat byte runs: 0x00..0x7f is n+1 literals, 0x80..0xff is (n-127)+2 repeats. */
function rle(b: Uint8Array): number {
	let out = 0;
	let i = 0;
	while (i < b.length) {
		let run = 1;
		while (run < 130 && i + run < b.length && b[i + run] === b[i]) run++;
		if (run >= 3) {
			out += 2;
			i += run;
			continue;
		}
		let lit = 1;
		while (lit < 128 && i + lit < b.length) {
			const ahead = i + lit;
			if (ahead + 2 < b.length && b[ahead] === b[ahead + 1] && b[ahead] === b[ahead + 2]) break;
			lit++;
		}
		out += 1 + lit;
		i += lit;
	}
	return out;
}

/**
 * LZ4 block format: byte-aligned tokens, no entropy coding, so a decoder is a few compares and
 * a copy per token. This is the ratio a Cortex-M0+ can actually afford to decode.
 */
function lz4(src: Uint8Array): number {
	const n = src.length;
	const HASH_BITS = 12;
	const table = new Int32Array(1 << HASH_BITS).fill(-1);
	const read32 = (i: number) => src[i] | (src[i + 1] << 8) | (src[i + 2] << 16) | (src[i + 3] << 24);
	const mask = (1 << HASH_BITS) - 1;
	const hash = (v: number) => ((Math.imul(v, 2654435761) >>> 0) >>> (32 - HASH_BITS)) & mask;
	const varint = (len: number) => (len < 15 ? 0 : 1 + Math.floor((len - 15) / 255));

	let out = 0;
	let anchor = 0;
	let i = 0;
	// Last 5 bytes are always literals; a match needs 4 bytes ahead of it.
	while (i + 4 <= n - 5) {
		const h = hash(read32(i));
		const ref = table[h];
		table[h] = i;
		if (ref < 0 || i - ref > 65535 || read32(ref) !== read32(i)) {
			i++;
			continue;
		}
		let len = 4;
		while (i + len < n - 5 && src[ref + len] === src[i + len]) len++;
		const lit = i - anchor;
		out += 1 + varint(lit) + lit + 2 + varint(len - 4);
		i += len;
		anchor = i;
	}
	const lit = n - anchor;
	out += 1 + varint(lit) + lit;
	return out;
}

/**
 * Nibble codec over the delta planes: small differences are one nibble, a flat stretch is a
 * run, anything else escapes to a literal byte. A decoder is a table lookup per nibble, which
 * is what a Cortex-M0+ with 4 ms of slack per frame can afford.
 */
function nib(src: Uint8Array): number {
	let nibbles = 0;
	let i = 0;
	const n = src.length;
	while (i < n) {
		if (src[i] === 0) {
			let run = 1;
			while (run < 272 && i + run < n && src[i + run] === 0) run++;
			nibbles += run <= 17 ? 2 : 4;
			i += run;
			continue;
		}
		const d = ((src[i] + 128) & 255) - 128;
		nibbles += d >= -6 && d <= 6 ? 1 : 3;
		i++;
	}
	return Math.ceil(nibbles / 2);
}

/** The ladder the shipped codec was chosen off, cheapest decoder first. */
const CANDIDATES: { name: string; size: (b: Uint8Array) => number }[] = [
	{ name: 'raw', size: () => RAW },
	{ name: 'planes+rle', size: (b) => rle(planes(b, scratch)) },
	{ name: 'planes+delta+lz4', size: (b) => lz4(alongStrip(planes(b, scratch), scratch2)) },
	{ name: 'planes+delta+nib', size: (b) => nib(alongStrip(planes(b, scratch), scratch2)) },
	{
		name: 'planes+deflate',
		size: (b) => deflateRawSync(planes(b, scratch), { level: 6 }).length
	},
	{
		name: 'planes+delta+deflate',
		size: (b) => deflateRawSync(alongStrip(planes(b, scratch), scratch2), { level: 6 }).length
	}
];

const board = flag('to');
if (board) {
	await stream(board);
	process.exit(0);
}

/** One mixer running the scripted journey on a loop, which is what the room actually sends. */
function live(): () => Uint8Array {
	const mixer = new Mixer(g);
	mixer.palette = PALETTE;
	mixer.floor = 0;
	const stack = stacks(1)[0];
	for (const role of LAYER_ROLES) {
		const def = stack[role];
		if (!def) continue;
		mixer.layers[role].setEffect(def, g);
		mixer.layers[role].opacity = DEFAULT_OPACITY[role];
	}
	const frames = scriptFrames(130);
	let at = 0;
	return () => {
		const f = frames[at++ % frames.length];
		mixer.intensity = INTENSITY[f.section] ?? 0.7;
		for (const role of LAYER_ROLES) {
			const def = stack[role];
			if (def?.taste.hitOnly) {
				mixer.layers[role].params.trigger =
					f.section === 'drop' && f.timeSinceDrop < f.beatPeriod * 4 ? 1 : 0;
			}
		}
		mixer.render(f);
		return mixer.bytes;
	};
}

async function stream(host: string): Promise<void> {
	const seconds = Number(flag('seconds') ?? 120);
	const swap = Number(flag('swap') ?? 10);
	const target: DdpTarget = { host, firstLed: 0, ledCount: N, packed: true };
	const sink = createDdpSink({ targets: [target] });
	await sink.open();

	// Board stats come back to whoever last sent DDP, on the telemetry port.
	const lines: Record<string, string[]> = { packed: [], raw: [] };
	const stats = createSocket('udp4');
	stats.on('message', (m) =>
		lines[target.packed ? 'packed' : 'raw'].push(m.toString())
	);
	await new Promise<void>((r) => stats.bind(4049, r));

	const render = live();
	const t0 = performance.now();
	const until = t0 + seconds * 1000;
	let deadline = t0;
	let frames = 0;
	while (performance.now() < until) {
		deadline += 1000 / 60;
		const delay = deadline - performance.now();
		if (delay > 0) await new Promise((r) => setTimeout(r, delay));
		// Switching mid-run rather than between runs, so both meet the same minute of radio.
		target.packed =
			Math.floor((performance.now() - t0) / (swap * 1000)) % 2 === 0;
		sink.send({
			rgb: render(),
			dt: 1 / 60,
			frameId: frames++,
			presentAtMs: performance.now()
		});
	}
	await sink.close();
	stats.close();

	const read = (line: string, re: RegExp) => {
		const m = re.exec(line);
		return m ? Number(m[1]) : 0;
	};
	console.log(
		`${frames} frames sent to ${host} over ${seconds}s, swapping every ${swap}s\n`
	);
	for (const mode of ['raw', 'packed']) {
		// The first line of each turn straddles the swap and belongs to neither.
		const got = lines[mode].slice(1);
		if (got.length === 0) {
			console.log(`${mode}: no stats lines`);
			continue;
		}
		const mean = (re: RegExp) =>
			got.reduce((a, l) => a + read(l, re), 0) / got.length;
		const total = (re: RegExp) => got.reduce((a, l) => a + read(l, re), 0);
		console.log(
			`${mode.padEnd(7)} ${mean(/([\d.]+) fps/)
				.toFixed(1)
				.padStart(5)} fps  ` +
				`${mean(/(\d+) pkt\/s/)
					.toFixed(0)
					.padStart(4)} pkt/s  ` +
				`${mean(/([\d.]+) KB\/s/)
					.toFixed(1)
					.padStart(6)} KB/s  ` +
				`asm max ${Math.max(...got.map((l) => read(l, /asm ([\d.]+) ms/)))
					.toFixed(1)
					.padStart(6)} ms  ` +
				`torn ${String(total(/torn (\d+)/)).padStart(4)}  ` +
				`late ${total(/late (\d+)\//)}/${total(/late \d+\/(\d+)\//)}/${total(/late \d+\/\d+\/(\d+)/)}  ` +
				`bad ${total(/bad (\d+)/)}  oob ${total(/oob (\d+)/)}  (${got.length}s)`
		);
		console.log(`        ${got.at(-1)}`);
	}
}

const samples = CANDIDATES.map(() => [] as number[]);
const bySection = new Map<SectionKind, number[][]>();

const frames = scriptFrames(130);
for (const stack of stacks(Number(flag('stacks') ?? 16))) {
	const mixer = new Mixer(g);
	mixer.palette = PALETTE;
	mixer.floor = 0;
	for (const role of LAYER_ROLES) {
		const def = stack[role];
		if (!def) continue;
		mixer.layers[role].setEffect(def, g);
		mixer.layers[role].opacity = DEFAULT_OPACITY[role];
	}

	for (const f of frames) {
		mixer.intensity = INTENSITY[f.section] ?? 0.7;
		for (const role of LAYER_ROLES) {
			const def = stack[role];
			if (def?.taste.hitOnly) {
				mixer.layers[role].params.trigger =
					f.section === 'drop' && f.timeSinceDrop < f.beatPeriod * 4 ? 1 : 0;
			}
		}
		mixer.render(f);

		let per = bySection.get(f.section);
		if (!per) {
			per = CANDIDATES.map(() => []);
			bySection.set(f.section, per);
		}
		for (const [i, c] of CANDIDATES.entries()) {
			const n = c.size(mixer.bytes);
			samples[i].push(n);
			per[i].push(n);
		}
	}
}

function report(label: string, per: number[][]): void {
	console.log(label);
	for (const [i, c] of CANDIDATES.entries()) {
		const v = [...per[i]].sort((a, b) => a - b);
		const at = (q: number) =>
			v[Math.min(v.length - 1, Math.floor(v.length * q))];
		const mean = v.reduce((a, b) => a + b, 0) / v.length;
		const fits = v.filter((n) => n <= MAX_DATA).length;
		console.log(
			`  ${c.name.padEnd(21)} mean ${mean.toFixed(0).padStart(5)}  p50 ${String(at(0.5)).padStart(5)}` +
				`  p99 ${String(at(0.99)).padStart(5)}  max ${String(v.at(-1)).padStart(5)}` +
				`  one datagram ${((100 * fits) / v.length).toFixed(1).padStart(5)}%`
		);
	}
}

console.log(
	`${N} px, raw ${RAW} B, one datagram holds ${MAX_DATA} B, ${samples[0].length} frames\n`
);
for (const [kind, per] of bySection) report(kind, per);
report('all', samples);
