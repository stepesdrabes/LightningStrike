// Top-down contact sheet of the room through the real mixer and output chain: tiles left to
// right at a fixed interval, so an effect's motion can be judged by eye.
// node bench/roomsheet.ts --effect ID [--section drop] [--bpm 128] [--every 100] [--count 24]
// node bench/roomsheet.ts --stack "b:wash r:ID" --quiet
// node bench/roomsheet.ts <track> --at BAR [--stack "..."] [--bare]
// --raw drives the layers at intensity and opacity 1; --bare drops a track's house floor.
// Exposure follows the sheet's brightest LEDs. A tile's strip shows the beat (white), the bar,
// kicks (red), snares (blue) and downbeats (yellow).
import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { deflateSync } from 'node:zlib';
import { benchmarkCache } from './cache.ts';
import {
	BUILT_IN_EFFECTS,
	DEFAULT_OPACITY,
	DEFAULT_ROOM,
	EffectRegistry,
	LAYER_ROLES,
	Mixer,
	ShowPlayer,
	barTimeAt,
	buildGeometry,
	makePalette,
	quietFrames,
	scriptFrames,
	type LayerRole,
	type SectionKind,
	type Show,
	type ShowFrame,
	type TrackAnalysis,
	type TrackContext
} from '@mv/core';
import { composeShow } from '@mv/author-engine';

const argv = process.argv.slice(2);
const flag = (n: string) => {
	const i = argv.indexOf(`--${n}`);
	return i >= 0 ? argv[i + 1] : undefined;
};
const has = (n: string) => argv.includes(`--${n}`);
const positional = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--') && !['quiet', 'raw', 'bare'].includes(argv[i - 1].slice(2))));

const g = buildGeometry(DEFAULT_ROOM);
const fps = 60;
const every = Number(flag('every') ?? 100) / 1000;
const count = Number(flag('count') ?? 24);
const cols = Number(flag('cols') ?? 6);
const out = flag('out') ?? '/tmp/roomsheet.png';
const raw = has('raw');
/** Section intensities the engine writes, for the synthetic journeys. */
const INTENSITY: Partial<Record<SectionKind, number>> = { intro: 0.46, groove: 0.68, build: 0.62, void: 0.05, drop: 0.9, breakdown: 0.5, outro: 0.5 };
const PALETTE = makePalette({ base: 320, accent: 185, third: 260 });
const roleOf: Record<string, LayerRole> = { b: 'bed', r: 'rhythm', t: 'transient', a: 'accent', m: 'master' };

const stack: { role: LayerRole; id: string }[] = [];
for (const part of (flag('stack') ?? '').split(/\s+/).filter(Boolean)) {
	const role = roleOf[part[0]];
	const id = part.slice(2);
	if (!role || part[1] !== ':' || !BUILT_IN_EFFECTS.some((e) => e.id === id)) throw new Error(`bad stack part ${part}`);
	stack.push({ role, id });
}
if (flag('effect')) {
	const def = BUILT_IN_EFFECTS.find((e) => e.id === flag('effect'));
	if (!def) throw new Error(`no effect ${flag('effect')}`);
	stack.push({ role: def.role, id: def.id });
}

const snaps: { bytes: Uint8Array; f: ShowFrame }[] = [];
const keep = (bytes: Uint8Array, f: ShowFrame) =>
	snaps.push({ bytes: Uint8Array.from(bytes), f: { ...f, bands: Float32Array.from(f.bands), spectrum: Float32Array.from(f.spectrum) } });

if (positional[0]) {
	const cache = benchmarkCache(flag('cache'));
	const want = positional[0];
	const id = existsSync(join(cache, `${want}.analysis.json`))
		? want
		: readdirSync(cache)
			.filter((f) => f.endsWith('.meta.json'))
			.map((f) => f.replace('.meta.json', ''))
			.find((t) => (JSON.parse(readFileSync(join(cache, `${t}.meta.json`), 'utf8')).title as string).toLowerCase().includes(want.toLowerCase()));
	if (!id) throw new Error(`no track matches ${want}`);
	const analysis = JSON.parse(readFileSync(join(cache, `${id}.analysis.json`), 'utf8')) as TrackAnalysis;
	const ctxPath = join(cache, `${id}.context.json`);
	const context = existsSync(ctxPath) ? (JSON.parse(readFileSync(ctxPath, 'utf8')) as TrackContext) : null;
	const meta = JSON.parse(readFileSync(join(cache, `${id}.meta.json`), 'utf8')) as { artHue?: number | null; title: string };
	const show: Show = composeShow(analysis, { artHue: meta.artHue, context });
	if (stack.length > 0) {
		for (const c of show.cues) {
			for (const role of LAYER_ROLES) delete c.layers[role];
			for (const s of stack) c.layers[s.role] = { effect: s.id };
		}
		show.hits = [];
	}
	const mixer = new Mixer(g);
	const player = new ShowPlayer(mixer, new EffectRegistry());
	player.load(analysis, show);
	player.reset();
	const start = barTimeAt(analysis.tempo, Number(flag('at') ?? 0)) + Number(flag('from') ?? 0);
	let next = start;
	for (let t = Math.max(0, start - 8); snaps.length < count && t < analysis.duration; t += 1 / fps) {
		const f = player.update(t, 1 / fps);
		if (has('bare')) mixer.floor = 0;
		mixer.render(f);
		if (t + 1e-9 >= next) {
			keep(mixer.bytes, f);
			next += every;
		}
	}
	console.log(`${meta.title}: bar ${flag('at') ?? 0}, ${analysis.tempo.bpm.toFixed(0)} bpm`);
} else {
	if (stack.length === 0) throw new Error('name a track, --effect or --stack');
	const frames = has('quiet') ? quietFrames(Number(flag('bpm') ?? 96)) : scriptFrames(Number(flag('bpm') ?? 128));
	const section = flag('section');
	const first = section ? frames.find((f) => f.section === section) : frames[0];
	if (!first) throw new Error(`no ${section} in the journey`);
	const mixer = new Mixer(g);
	mixer.palette = PALETTE;
	mixer.floor = 0;
	for (const s of stack) {
		const layer = mixer.layers[s.role];
		layer.setEffect(BUILT_IN_EFFECTS.find((e) => e.id === s.id)!, g);
		layer.opacity = raw ? 1 : DEFAULT_OPACITY[s.role];
		if (s.role === 'master') layer.params.trigger = 1;
	}
	let next = first.t + Number(flag('from') ?? 0);
	for (const f of frames) {
		mixer.intensity = raw ? 1 : (INTENSITY[f.section] ?? 0.7);
		mixer.render(f);
		if (f.t + 1e-9 >= next && snaps.length < count) {
			keep(mixer.bytes, f);
			next += every;
		}
	}
}
if (snaps.length === 0) throw new Error('nothing captured');

// Frame N at the top, Frame E to the right.
const SCALE = 92;
const PAD = 12;
const W = Math.round(3 * SCALE) + PAD * 2;
const H = Math.round(2 * SCALE) + PAD * 2 + 10;
const width = cols * W;
const height = Math.ceil(snaps.length / cols) * H;
const img = new Float32Array(width * height * 3).fill(0.0012);
const add = (x: number, y: number, r: number, gg: number, b: number) => {
	if (x < 0 || y < 0 || x >= width || y >= height) return;
	const o = (y * width + x) * 3;
	img[o] += r;
	img[o + 1] += gg;
	img[o + 2] += b;
};
const set = (x: number, y: number, v: readonly number[]) => {
	if (x < 0 || y < 0 || x >= width || y >= height) return;
	const o = (y * width + x) * 3;
	img[o] = v[0];
	img[o + 1] = v[1];
	img[o + 2] = v[2];
};

const lit = snaps.flatMap((s) => Array.from(s.bytes).filter((v) => v > 0)).sort((a, b) => a - b);
const p995 = lit.length ? lit[Math.floor(lit.length * 0.995)] / 255 : 1;
const exposure = Math.min(40, 0.9 / Math.max(1e-3, p995));

snaps.forEach((snap, k) => {
	const ox = (k % cols) * W;
	const oy = Math.floor(k / cols) * H;
	for (let i = 0; i < g.count; i++) {
		// Duty is linear light; the PNG encodes it for a monitor below.
		const r = (snap.bytes[i * 3] / 255) * exposure;
		const gg = (snap.bytes[i * 3 + 1] / 255) * exposure;
		const b = (snap.bytes[i * 3 + 2] / 255) * exposure;
		const cx = ox + PAD + (g.x[i] + DEFAULT_ROOM.fixture.width / 2) * SCALE;
		const cy = oy + PAD + (DEFAULT_ROOM.fixture.depth / 2 - g.y[i]) * SCALE;
		for (let dy = -3; dy <= 3; dy++) {
			for (let dx = -3; dx <= 3; dx++) {
				const px = Math.round(cx) + dx;
				const py = Math.round(cy) + dy;
				const w = Math.exp(-((px - cx) ** 2 + (py - cy) ** 2) / 2.2) * 0.8;
				add(px, py, r * w, gg * w, b * w);
			}
		}
	}
	const f = snap.f;
	const by = oy + H - 10;
	for (let x = 0; x < W - 4; x++) {
		const u = x / (W - 4);
		for (let y = 0; y < 3; y++) set(ox + 2 + x, by + y, u <= f.beatPhase ? [0.5, 0.5, 0.5] : [0.05, 0.05, 0.05]);
		for (let y = 4; y < 6; y++) set(ox + 2 + x, by + y, u <= f.barPhase ? [0.25, 0.25, 0.1] : [0.03, 0.03, 0.03]);
	}
	for (let x = 0; x < 30 * f.kickEnv; x++) for (let y = 7; y < 10; y++) set(ox + 2 + x, by + y, [1, 0.15, 0.15]);
	for (let x = 0; x < 30 * f.snareEnv; x++) for (let y = 7; y < 10; y++) set(ox + 40 + x, by + y, [0.2, 0.4, 1]);
	if (f.downbeat) for (let x = 0; x < 20; x++) for (let y = 7; y < 10; y++) set(ox + W - 26 + x, by + y, [1, 0.9, 0]);
	for (let y = 0; y < H; y++) set(ox + W - 1, oy + y, [0.1, 0.1, 0.1]);
	for (let x = 0; x < W; x++) set(ox + x, oy + H - 1, [0.1, 0.1, 0.1]);
});

const rgb = new Uint8Array(width * height * 3);
for (let i = 0; i < img.length; i++) rgb[i] = Math.round(255 * Math.pow(Math.min(1, img[i]), 1 / 2.2));

// PNG, RGB8, no filter.
const crcTable = new Int32Array(256);
for (let n = 0; n < 256; n++) {
	let c = n;
	for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
	crcTable[n] = c;
}
const crc32 = (buf: Uint8Array) => {
	let c = -1;
	for (let i = 0; i < buf.length; i++) c = crcTable[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
	return (c ^ -1) >>> 0;
};
const chunk = (type: string, data: Uint8Array) => {
	const len = Buffer.alloc(4);
	len.writeUInt32BE(data.length);
	const body = Buffer.concat([Buffer.from(type, 'ascii'), Buffer.from(data)]);
	const crc = Buffer.alloc(4);
	crc.writeUInt32BE(crc32(body));
	return Buffer.concat([len, body, crc]);
};
const ihdr = Buffer.alloc(13);
ihdr.writeUInt32BE(width, 0);
ihdr.writeUInt32BE(height, 4);
ihdr[8] = 8;
ihdr[9] = 2;
const rows = Buffer.alloc((width * 3 + 1) * height);
for (let y = 0; y < height; y++) rows.set(rgb.subarray(y * width * 3, (y + 1) * width * 3), y * (width * 3 + 1) + 1);
writeFileSync(out, Buffer.concat([
	Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
	chunk('IHDR', ihdr), chunk('IDAT', deflateSync(rows)), chunk('IEND', new Uint8Array(0))
]));
console.log(`${out}: ${snaps.length} tiles every ${(every * 1000).toFixed(0)} ms, exposure x${exposure.toFixed(2)}`);
