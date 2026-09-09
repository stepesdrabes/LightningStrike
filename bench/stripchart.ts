// A picture of what the strips do over time, so an effect or a stack can be judged by eye.
//
//   node bench/stripchart.ts <track id or title substring> [--at BAR] [--bars N] [--out chart.png]
//   node bench/stripchart.ts <track> --list                  # sections, cues and their stacks
//   node bench/stripchart.ts --effect vortex [--bpm 130]     # the effect alone over the gate journey
//   node bench/stripchart.ts <track> --stack "b:wash r:vortex t:kickTunnel a:sparkle" [--at BAR]
//
// Each column is one frame at 60 fps (or `--x N` frames max-pooled per column), each row one LED
// in strip order with a gap between strips, so a flash is a vertical line, a chase a diagonal, a
// twinkle is grain and a hold is a flat band. Under the strips: the room mean, the per-pixel
// shimmer against an 80 ms average, and the grid (downbeats, kicks, snares, cue changes, hits).
// Bytes are shown through a display curve so dim values are visible the way the eye sees them;
// `--linear` shows the raw PWM duty instead. A track is composed fresh with its context, as the
// app would; `--stack` replaces the cue's layers over the charted range with the given ones.
import { readFileSync, readdirSync, existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { homedir } from 'node:os';
import { deflateSync } from 'node:zlib';
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
	scriptFrames,
	sectionBase,
	type EffectDef,
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
const positional = argv.filter((a, i) => !a.startsWith('--') && !(i > 0 && argv[i - 1].startsWith('--') && !['list', 'linear'].includes(argv[i - 1].slice(2))));

const g = buildGeometry(DEFAULT_ROOM);
const fps = 60;
const pool = Math.max(1, Number(flag('x') ?? 1));
const linear = has('linear');
const out = flag('out') ?? '/tmp/stripchart.png';

/** Section intensities the engine writes, for the single-effect journey. */
const INTENSITY: Partial<Record<SectionKind, number>> = { intro: 0.46, groove: 0.72, build: 0.62, void: 0.05, drop: 0.9, outro: 0.5 };
const PALETTE = makePalette({ base: 0, accent: 180, third: 60, sat: 0.94, shade: 0.14, white: 0.06 });

interface Column {
	bytes: Uint8Array;
	mean: number;
	shimmer: number;
	downbeat: boolean;
	beat: boolean;
	kick: boolean;
	snare: boolean;
	cue: boolean;
	hit: boolean;
	section: SectionKind;
}

const columns: Column[] = [];
const fast = new Float32Array(g.count);
const aFast = 1 - Math.exp(-1 / (fps * 0.08));
let firstFrame = true;
let lastCue = -1;

function capture(f: ShowFrame, bytes: Uint8Array, cueIndex: number, hit: boolean): void {
	let sum = 0;
	let shimmer = 0;
	for (let k = 0; k < g.count; k++) {
		const i = k * 3;
		const v = Math.max(bytes[i], bytes[i + 1], bytes[i + 2]);
		sum += v;
		if (firstFrame) fast[k] = v;
		shimmer += Math.abs(v - fast[k]);
		fast[k] += (v - fast[k]) * aFast;
	}
	firstFrame = false;
	columns.push({
		bytes: Uint8Array.from(bytes),
		mean: sum / g.count,
		shimmer: shimmer / g.count,
		downbeat: f.downbeat,
		beat: f.beat,
		kick: f.kick,
		snare: f.snare,
		cue: cueIndex !== lastCue,
		hit,
		section: f.section
	});
	lastCue = cueIndex;
}

let title = '';

if (flag('effect')) {
	const def = BUILT_IN_EFFECTS.find((e) => e.id === flag('effect'));
	if (!def) throw new Error(`no effect ${flag('effect')}`);
	title = `${def.id} alone (${def.role}, e${def.taste.energy}) over the gate journey`;
	const mixer = new Mixer(g);
	mixer.palette = PALETTE;
	mixer.floor = 0;
	const layer = mixer.layers[def.role];
	layer.setEffect(def, g);
	layer.opacity = DEFAULT_OPACITY[def.role];
	for (const f of scriptFrames(Number(flag('bpm') ?? 130))) {
		mixer.intensity = INTENSITY[f.section] ?? 0.7;
		let hit = false;
		if (def.taste.hitOnly) {
			hit = f.section === 'drop' && f.timeSinceDrop < f.beatPeriod * 4;
			layer.params.trigger = hit ? 1 : 0;
		}
		mixer.render(f);
		capture(f, mixer.bytes, sectionIndex(f.section), hit);
	}
} else {
	const want = positional[0];
	if (!want) throw new Error('name a track (id or title substring) or --effect');
	const cache = flag('cache') ?? join(homedir(), 'Library/Application Support/cz.drabek.lightningstrike/cache');
	const found = readdirSync(cache)
		.filter((f) => f.endsWith('.meta.json'))
		.map((f) => {
			const id = f.replace('.meta.json', '');
			const meta = JSON.parse(readFileSync(join(cache, f), 'utf8')) as { title: string; artHue?: number | null };
			return { id, meta };
		})
		.filter((t) => t.id === want || t.meta.title.toLowerCase().includes(want.toLowerCase()));
	if (found.length === 0) throw new Error(`no track matches ${want}`);
	if (found.length > 1 && !found.some((t) => t.id === want)) {
		console.log('several match: ' + found.map((t) => `${t.id} "${t.meta.title}"`).join(', '));
	}
	const track = found.find((t) => t.id === want) ?? found[0];
	const analysis = JSON.parse(readFileSync(join(cache, `${track.id}.analysis.json`), 'utf8')) as TrackAnalysis;
	const ctxPath = join(cache, `${track.id}.context.json`);
	const context = existsSync(ctxPath) ? (JSON.parse(readFileSync(ctxPath, 'utf8')) as TrackContext) : null;
	const show: Show = composeShow(analysis, { artHue: track.meta.artHue, context });
	const cues = [...show.cues].sort((a, b) => a.bar - b.bar);
	const stackOf = (c: Show['cues'][number]) =>
		LAYER_ROLES.filter((r) => c.layers[r]).map((r) => `${r[0]}:${c.layers[r]!.effect}`).join(' ');

	if (has('list')) {
		console.log(`${track.meta.title} (${track.id}) ${context?.genreFamily ?? 'unknown'} ${analysis.tempo.bpm.toFixed(1)} bpm`);
		console.log('sections: ' + analysis.sections.map((s) => `${s.kind}@${s.startBar}-${s.endBar}`).join(' '));
		for (let i = 0; i < cues.length; i++) {
			const c = cues[i];
			const end = cues[i + 1]?.bar ?? analysis.bars.length;
			console.log(`  bar ${String(c.bar).padStart(3)}-${String(end).padEnd(3)} ${c.section.padEnd(9)} i=${(c.intensity ?? 0.7).toFixed(2)} ${stackOf(c)}`);
		}
		console.log('hits: ' + show.hits.map((h) => `${h.kind}@${h.bar}${h.beat ? '+' + h.beat : ''}x${h.beats}`).join(' '));
		process.exit(0);
	}

	// Which bars to chart: `--at`, else the peak's opening, else the first drop-class section.
	const peak = cues.find((c) => (c.intensity ?? 0) >= 1);
	const firstDrop = analysis.sections.find((s) => sectionBase(s.kind) === 'drop');
	const at = Number(flag('at') ?? peak?.bar ?? firstDrop?.startBar ?? 0);
	const bars = Number(flag('bars') ?? 8);

	if (flag('stack')) {
		const parts = flag('stack')!.split(/\s+/).filter(Boolean);
		const roleOf: Record<string, LayerRole> = { b: 'bed', r: 'rhythm', t: 'transient', a: 'accent', m: 'master' };
		for (const c of show.cues) {
			if (c.bar >= at + bars || (cues[cues.indexOf(c) + 1]?.bar ?? Infinity) <= at) continue;
			for (const role of LAYER_ROLES) delete c.layers[role];
			for (const part of parts) {
				const role = roleOf[part[0]];
				if (!role || part[1] !== ':') throw new Error(`bad stack part ${part}`);
				const id = part.slice(2);
				if (!BUILT_IN_EFFECTS.some((e) => e.id === id)) throw new Error(`no effect ${id}`);
				c.layers[role] = { effect: id };
			}
		}
	}

	const from = barTimeAt(analysis.tempo, at);
	const to = barTimeAt(analysis.tempo, Math.min(at + bars, analysis.bars.length));
	title = `${track.meta.title} bars ${at}-${at + bars} (${context?.genreFamily ?? '?'}, ${analysis.tempo.bpm.toFixed(0)} bpm)`;
	console.log(title);
	for (let i = 0; i < cues.length; i++) {
		const c = cues[i];
		const end = cues[i + 1]?.bar ?? analysis.bars.length;
		if (end <= at || c.bar >= at + bars) continue;
		console.log(`  bar ${String(c.bar).padStart(3)}-${String(end).padEnd(3)} ${c.section.padEnd(9)} i=${(c.intensity ?? 0.7).toFixed(2)} ${stackOf(c)}`);
	}
	const hitsHere = show.hits.filter((h) => h.bar >= at - 1 && h.bar < at + bars);
	if (hitsHere.length) console.log('  hits: ' + hitsHere.map((h) => `${h.kind}@${h.bar}${h.beat ? '+' + h.beat : ''}x${h.beats}${h.params ? JSON.stringify(h.params) : ''}`).join(' '));

	const registry = new EffectRegistry();
	for (const def of BUILT_IN_EFFECTS) registry.add(def);
	const mixer = new Mixer(g);
	const player = new ShowPlayer(mixer, registry);
	player.load(analysis, show);
	player.reset();
	const dt = 1 / fps;
	const cueAt = (bar: number) => {
		let k = 0;
		while (k + 1 < cues.length && bar >= cues[k + 1].bar) k++;
		return k;
	};
	for (let t = 0; t < to; t += dt) {
		const f = player.update(t, dt);
		mixer.render(f);
		if (t < from) continue;
		const armed = mixer.layers.master.effect !== null && mixer.layers.master.params.trigger > 0.5;
		capture(f, mixer.bytes, cueAt(f.barIndex), armed || mixer.intensity < 0.1);
	}
}

function sectionIndex(s: SectionKind): number {
	return ['intro', 'groove', 'build', 'void', 'drop', 'breakdown', 'outro'].indexOf(s);
}

// Layout.
const GAP = 3;
const rows: { led: number; y: number }[] = [];
let y = 0;
for (const s of g.strips) {
	for (let k = 0; k < s.count; k++) rows.push({ led: s.offset + k, y: y++ });
	y += GAP;
}
const stripsHeight = y;
const TRACE = 40;
const GRID = 10;
const height = stripsHeight + 2 + TRACE + 2 + TRACE + 2 + GRID;
const width = Math.ceil(columns.length / pool);
const img = new Uint8Array(width * height * 3);
const put = (x: number, yy: number, r: number, gg: number, b: number) => {
	if (x < 0 || x >= width || yy < 0 || yy >= height) return;
	const o = (yy * width + x) * 3;
	img[o] = r;
	img[o + 1] = gg;
	img[o + 2] = b;
};
const display = (v: number) => (linear ? v : Math.round(255 * Math.pow(v / 255, 1 / 2.2)));

for (let x = 0; x < width; x++) {
	const lo = x * pool;
	const hi = Math.min(columns.length, lo + pool);
	// Max-pooled, so a flash one frame wide survives the pooling.
	for (const row of rows) {
		let r = 0;
		let gg = 0;
		let b = 0;
		for (let c = lo; c < hi; c++) {
			const bytes = columns[c].bytes;
			const o = row.led * 3;
			if (bytes[o] > r) r = bytes[o];
			if (bytes[o + 1] > gg) gg = bytes[o + 1];
			if (bytes[o + 2] > b) b = bytes[o + 2];
		}
		put(x, row.y, display(r), display(gg), display(b));
	}
	// Gaps between strips as a dark grey so the strips read as five things.
	for (let yy = 0; yy < stripsHeight; yy++) if (!rows.some((rw) => rw.y === yy)) put(x, yy, 28, 28, 28);
	let mean = 0;
	let shimmer = 0;
	let downbeat = false;
	let beat = false;
	let kick = false;
	let snare = false;
	let cue = false;
	let hit = false;
	for (let c = lo; c < hi; c++) {
		mean = Math.max(mean, columns[c].mean);
		shimmer = Math.max(shimmer, columns[c].shimmer);
		downbeat ||= columns[c].downbeat;
		beat ||= columns[c].beat;
		kick ||= columns[c].kick;
		snare ||= columns[c].snare;
		cue ||= columns[c].cue;
		hit ||= columns[c].hit;
	}
	// Mean trace: 0..255 bytes over TRACE px, on a dark ground.
	const y0 = stripsHeight + 2;
	for (let yy = 0; yy < TRACE; yy++) put(x, y0 + yy, 16, 16, 16);
	const h = Math.round((mean / 255) * (TRACE - 1));
	for (let yy = 0; yy <= h; yy++) put(x, y0 + TRACE - 1 - yy, 200, 200, 200);
	// Shimmer trace: 0..40 bytes over TRACE px.
	const y1 = y0 + TRACE + 2;
	for (let yy = 0; yy < TRACE; yy++) put(x, y1 + yy, 16, 16, 16);
	const hs = Math.round(Math.min(1, shimmer / 40) * (TRACE - 1));
	for (let yy = 0; yy <= hs; yy++) put(x, y1 + TRACE - 1 - yy, 255, 160, 40);
	// Grid row.
	const y2 = y1 + TRACE + 2;
	for (let yy = 0; yy < GRID; yy++) put(x, y2 + yy, 10, 10, 10);
	if (beat) for (let yy = 7; yy < GRID; yy++) put(x, y2 + yy, 90, 90, 90);
	if (downbeat) for (let yy = 0; yy < GRID; yy++) put(x, y2 + yy, 255, 255, 255);
	if (kick) for (let yy = 0; yy < 4; yy++) put(x, y2 + yy, 255, 60, 60);
	if (snare) for (let yy = 4; yy < 7; yy++) put(x, y2 + yy, 80, 140, 255);
	if (cue) for (let yy = 0; yy < height; yy += 2) put(x, yy, 255, 230, 0);
	if (hit) for (let yy = 0; yy < 3; yy++) put(x, y0 + yy, 255, 0, 255);
}

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
const raw = Buffer.alloc((width * 3 + 1) * height);
for (let yy = 0; yy < height; yy++) {
	raw[yy * (width * 3 + 1)] = 0;
	raw.set(img.subarray(yy * width * 3, (yy + 1) * width * 3), yy * (width * 3 + 1) + 1);
}
writeFileSync(
	out,
	Buffer.concat([
		Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
		chunk('IHDR', ihdr),
		chunk('IDAT', deflateSync(raw)),
		chunk('IEND', new Uint8Array(0))
	])
);
const means = columns.map((c) => c.mean);
const shims = columns.map((c) => c.shimmer);
const avg = (xs: number[]) => xs.reduce((a, b) => a + b, 0) / Math.max(1, xs.length);
console.log(`${out}: ${width}x${height}, ${columns.length} frames; room mean ${avg(means).toFixed(0)} (max ${Math.max(...means).toFixed(0)}), shimmer ${avg(shims).toFixed(1)}`);
