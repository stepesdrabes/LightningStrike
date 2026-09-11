// Tally effect usage, peak masters and punctuation across cached tracks with their genre
// contexts.
// node bench/effectusage.ts [cacheDir] [--measure] [--limit N] [--fps 30]
// --measure reports delivered level changes between consecutive cues in each section.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { benchmarkCache } from './cache.ts';
import {
	BUILT_IN_EFFECTS,
	DEFAULT_ROOM,
	LAYER_ROLES,
	buildGeometry,
	hitSeconds,
	sectionBase,
	type Show,
	type TrackAnalysis,
	type TrackContext
} from '@mv/core';
import { composeShow, measureShow } from '@mv/author-engine';

const argv = process.argv.slice(2);
const flag = (n: string) => {
	const i = argv.indexOf(`--${n}`);
	return i >= 0 ? argv[i + 1] : undefined;
};
const cache = benchmarkCache(argv.find((a) => !a.startsWith('--') && !/^\d+$/.test(a)));
const measure = argv.includes('--measure');
const limit = Number(flag('limit') ?? Infinity);
const fps = Number(flag('fps') ?? 30);

const geometry = buildGeometry(DEFAULT_ROOM);
const effects = new Map(BUILT_IN_EFFECTS.map((e) => [e.id, e]));

interface Tally {
	shows: Set<string>;
	cues: number;
	bars: number;
	peaks: number;
	bySection: Map<string, number>;
	byFamily: Map<string, number>;
}
const tally = new Map<string, Tally>();
const bump = (id: string, show: string, bars: number, section: string, family: string, peak: boolean) => {
	let t = tally.get(id);
	if (!t) {
		t = { shows: new Set(), cues: 0, bars: 0, peaks: 0, bySection: new Map(), byFamily: new Map() };
		tally.set(id, t);
	}
	t.shows.add(show);
	t.cues++;
	t.bars += bars;
	if (peak) t.peaks++;
	t.bySection.set(section, (t.bySection.get(section) ?? 0) + bars);
	t.byFamily.set(family, (t.byFamily.get(family) ?? 0) + bars);
};

/** Per role per section class: how many cues, so a share can be read. */
const slots = new Map<string, number>();
const strobes: number[] = [];
const slams: number[] = [];
const jumps: { title: string; bar: number; from: number; to: number; stackA: string; stackB: string; section: string }[] = [];
/** Delivered level per cue, by section class, so the absolute ladder can be read as well as the jumps. */
const levels = new Map<string, number[]>();
/** Per cue, how much the room shimmers at frame scale, so the busiest STACKS can be named. */
const textures: { title: string; bar: number; bars: number; section: string; level: number; shimmer: number; stack: string }[] = [];
const families = new Map<string, number>();

let tracks = 0;
for (const f of readdirSync(cache).filter((f) => f.endsWith('.analysis.json'))) {
	if (tracks >= limit) break;
	const id = f.replace('.analysis.json', '');
	let analysis: TrackAnalysis;
	let meta: { title: string; artHue?: number | null };
	try {
		analysis = JSON.parse(readFileSync(join(cache, f), 'utf8')) as TrackAnalysis;
		meta = JSON.parse(readFileSync(join(cache, `${id}.meta.json`), 'utf8')) as typeof meta;
	} catch {
		continue;
	}
	const ctxPath = join(cache, `${id}.context.json`);
	const context = existsSync(ctxPath) ? (JSON.parse(readFileSync(ctxPath, 'utf8')) as TrackContext) : null;
	const family = context?.genreFamily ?? 'unknown';
	families.set(family, (families.get(family) ?? 0) + 1);
	tracks++;

	const show: Show = composeShow(analysis, { artHue: meta.artHue, context });
	const cues = [...show.cues].sort((a, b) => a.bar - b.bar);
	for (let i = 0; i < cues.length; i++) {
		const cue = cues[i];
		const end = cues[i + 1]?.bar ?? analysis.bars.length;
		const bars = Math.max(1, end - cue.bar);
		const section = sectionBase(cue.section);
		const peak = (cue.intensity ?? 0) >= 1;
		for (const role of LAYER_ROLES) {
			const spec = cue.layers[role];
			const key = `${section}/${role}`;
			if (!spec) continue;
			slots.set(key, (slots.get(key) ?? 0) + 1);
			bump(spec.effect, id, bars, section, family, peak);
		}
	}
	for (const h of show.hits) {
		const seconds = hitSeconds(analysis.tempo, h.bar, h.beat ?? 0, h.beats);
		if (h.kind === 'strobe') strobes.push(seconds);
		if (h.kind === 'slam') slams.push(seconds);
	}

	if (measure) {
		const reading = measureShow(show, analysis, effects, geometry, { fps });
		for (const r of reading.cues) {
			const key = (r.bar >= (show.cues.find((c) => (c.intensity ?? 0) >= 1)?.bar ?? -1) && (cues.find((c) => c.bar === r.bar)?.intensity ?? 0) >= 1) ? 'peak' : sectionBase(r.section);
			const list = levels.get(key) ?? [];
			list.push(r.level);
			levels.set(key, list);
		}
		const stack = (c: Show['cues'][number]) =>
			LAYER_ROLES.filter((r) => c.layers[r]).map((r) => `${r[0]}:${c.layers[r]!.effect}`).join(' ');
		for (let i = 0; i < reading.cues.length; i++) {
			const r = reading.cues[i];
			textures.push({
				title: meta.title.slice(0, 28),
				bar: r.bar,
				bars: r.endBar - r.bar,
				section: r.section,
				level: r.level,
				shimmer: r.ripple,
				stack: stack(cues[i])
			});
		}
		for (let i = 1; i < reading.cues.length; i++) {
			const a = cues[i - 1];
			const b = cues[i];
			if (sectionBase(a.section) !== sectionBase(b.section)) continue;
			if (Math.abs((a.intensity ?? 0.7) - (b.intensity ?? 0.7)) > 0.02) continue;
			jumps.push({
				title: meta.title.slice(0, 28),
				bar: b.bar,
				from: reading.cues[i - 1].level,
				to: reading.cues[i].level,
				stackA: stack(a),
				stackB: stack(b),
				section: b.section
			});
		}
		console.error(`${meta.title.slice(0, 40).padEnd(41)} measured`);
	}
}

console.log(`${tracks} tracks: ${[...families.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ')}`);
console.log('');

const roleOrder: Record<string, number> = { bed: 0, rhythm: 1, transient: 2, accent: 3, master: 4 };
const rows = [...tally.entries()].map(([id, t]) => ({ id, role: effects.get(id)?.role ?? '?', energy: effects.get(id)?.taste.energy ?? 0, ...t }));
rows.sort((a, b) => roleOrder[a.role] - roleOrder[b.role] || b.bars - a.bars);
console.log(`${'effect'.padEnd(18)}${'role'.padEnd(10)}e${'shows'.padStart(6)}${'cues'.padStart(6)}${'bars'.padStart(6)}${'peaks'.padStart(6)}  by section (bars)`);
for (const r of rows) {
	const sections = [...r.bySection.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', ');
	console.log(
		`${r.id.padEnd(18)}${r.role.padEnd(10)}${r.energy}${String(r.shows.size).padStart(6)}${String(r.cues).padStart(6)}${String(r.bars).padStart(6)}${String(r.peaks).padStart(6)}  ${sections}`
	);
}

console.log('');
console.log('never picked: ' + BUILT_IN_EFFECTS.filter((e) => !tally.has(e.id)).map((e) => `${e.id}(${e.role[0]}${e.taste.energy})`).join(' '));

console.log('');
console.log('drop-class rhythm/accent/transient share, and the peak cue:');
for (const role of ['rhythm', 'transient', 'accent', 'bed', 'master'] as const) {
	const inDrop = rows.filter((r) => r.role === role && (r.bySection.get('drop') ?? 0) > 0).sort((a, b) => (b.bySection.get('drop') ?? 0) - (a.bySection.get('drop') ?? 0));
	const total = inDrop.reduce((a, r) => a + (r.bySection.get('drop') ?? 0), 0);
	console.log(`  ${role.padEnd(10)} drop: ${inDrop.slice(0, 8).map((r) => `${r.id} ${Math.round((100 * (r.bySection.get('drop') ?? 0)) / Math.max(1, total))}%`).join(', ')}`);
	const peaks = rows.filter((r) => r.role === role && r.peaks > 0).sort((a, b) => b.peaks - a.peaks);
	console.log(`  ${''.padEnd(10)} peak: ${peaks.map((r) => `${r.id} ${r.peaks}`).join(', ')}`);
}

console.log('');
console.log('per family, the rhythm layer in drop-class cues:');
for (const [family] of [...families.entries()].sort((a, b) => b[1] - a[1])) {
	const inFamily = rows
		.filter((r) => r.role === 'rhythm' && (r.byFamily.get(family) ?? 0) > 0)
		.sort((a, b) => (b.byFamily.get(family) ?? 0) - (a.byFamily.get(family) ?? 0));
	console.log(`  ${family.padEnd(8)} ${inFamily.slice(0, 7).map((r) => `${r.id} ${r.byFamily.get(family)}`).join(', ')}`);
}

const dist = (xs: number[]) => {
	if (xs.length === 0) return 'none';
	const s = [...xs].sort((a, b) => a - b);
	return `n=${s.length} min ${s[0].toFixed(2)} median ${s[s.length >> 1].toFixed(2)} max ${s[s.length - 1].toFixed(2)} s`;
};
console.log('');
console.log(`strobe hits: ${dist(strobes)}`);
console.log(`slam hits:   ${dist(slams)}`);

if (measure) {
	console.log('');
	console.log('delivered cue level by section class (mean byte over the cue): p10 / median / p90');
	for (const key of ['intro', 'groove', 'breakdown', 'build', 'void', 'drop', 'peak', 'outro']) {
		const xs = [...(levels.get(key) ?? [])].sort((a, b) => a - b);
		if (xs.length === 0) continue;
		const q = (u: number) => xs[Math.min(xs.length - 1, Math.floor(xs.length * u))].toFixed(0);
		console.log(`  ${key.padEnd(10)} n=${String(xs.length).padStart(4)}  ${q(0.1).padStart(4)} / ${q(0.5).padStart(4)} / ${q(0.9).padStart(4)}`);
	}
	console.log('');
	console.log('level jumps between consecutive cues of one section at the same intensity (delivered mean byte):');
	const abs = jumps.map((j) => Math.abs(j.to - j.from)).sort((a, b) => a - b);
	console.log(`  ${abs.length} pairs, median ${abs[abs.length >> 1]?.toFixed(1)}, p90 ${abs[Math.floor(abs.length * 0.9)]?.toFixed(1)}, max ${abs[abs.length - 1]?.toFixed(1)}`);
	jumps.sort((a, b) => Math.abs(b.to - b.from) - Math.abs(a.to - a.from));
	for (const j of jumps.slice(0, 40)) {
		console.log(`  ${j.title.padEnd(29)} bar ${String(j.bar).padStart(3)} ${j.section.padEnd(9)} ${j.from.toFixed(0).padStart(4)} -> ${j.to.toFixed(0).padStart(4)}   ${j.stackA}  =>  ${j.stackB}`);
	}
	// Which effects sit on the bright side of the big jumps, so the offender is named rather than the pair.
	const blame = new Map<string, { up: number; n: number }>();
	for (const j of jumps) {
		const d = j.to - j.from;
		if (Math.abs(d) < 15) continue;
		const bright = d > 0 ? j.stackB : j.stackA;
		const dim = d > 0 ? j.stackA : j.stackB;
		for (const part of bright.split(' ')) {
			if (dim.includes(part)) continue;
			const id = part.slice(2);
			const b = blame.get(id) ?? { up: 0, n: 0 };
			b.up += Math.abs(d);
			b.n++;
			blame.set(id, b);
		}
	}
	console.log('');
	console.log('effects on the bright side of a 15+ byte jump, when they were the layer that changed:');
	for (const [id, b] of [...blame.entries()].sort((a, b) => b[1].n - a[1].n).slice(0, 25)) {
		console.log(`  ${id.padEnd(18)} ${String(b.n).padStart(3)} jumps, mean ${(b.up / b.n).toFixed(0)} bytes`);
	}

	// Shimmer: the per-pixel movement against an 80 ms average, in bytes. The room mean cannot
	// see a twinkle or a jitter, so this is the number for "everything is flickering".
	console.log('');
	console.log('per-pixel shimmer by section class (bytes against an 80 ms average): p10 / median / p90');
	const bySection = new Map<string, number[]>();
	for (const t of textures) {
		const key = sectionBase(t.section as Parameters<typeof sectionBase>[0]);
		const list = bySection.get(key) ?? [];
		list.push(t.shimmer);
		bySection.set(key, list);
	}
	for (const key of ['intro', 'groove', 'breakdown', 'build', 'drop', 'outro']) {
		const xs = [...(bySection.get(key) ?? [])].sort((a, b) => a - b);
		if (xs.length === 0) continue;
		const q = (u: number) => xs[Math.min(xs.length - 1, Math.floor(xs.length * u))].toFixed(1);
		console.log(`  ${key.padEnd(10)} n=${String(xs.length).padStart(4)}  ${q(0.1).padStart(5)} / ${q(0.5).padStart(5)} / ${q(0.9).padStart(5)}`);
	}
	console.log('');
	console.log('the busiest cues (shimmer, then their delivered level and stack):');
	const busiest = [...textures].filter((t) => t.bars >= 2).sort((a, b) => b.shimmer - a.shimmer);
	for (const t of busiest.slice(0, 40)) {
		console.log(`  ${t.title.padEnd(29)} bar ${String(t.bar).padStart(3)} ${t.section.padEnd(9)} shim ${t.shimmer.toFixed(1).padStart(5)} level ${t.level.toFixed(0).padStart(4)}   ${t.stack}`);
	}
	// Per effect: the mean shimmer of the cues it sits in, against its section's median, so
	// the effects that make a stack busy are named rather than the stack.
	const carried = new Map<string, { sum: number; n: number }>();
	for (const t of textures) {
		if (t.bars < 2) continue;
		const key = sectionBase(t.section as Parameters<typeof sectionBase>[0]);
		const xs = bySection.get(key) ?? [];
		const median = [...xs].sort((a, b) => a - b)[xs.length >> 1] ?? 0;
		for (const part of t.stack.split(' ')) {
			const id = part.slice(2);
			const c = carried.get(id) ?? { sum: 0, n: 0 };
			c.sum += t.shimmer - median;
			c.n++;
			carried.set(id, c);
		}
	}
	console.log('');
	console.log('effects by the shimmer of the cues they sit in, above their section median (bytes):');
	for (const [id, c] of [...carried.entries()].filter(([, c]) => c.n >= 4).sort((a, b) => b[1].sum / b[1].n - a[1].sum / a[1].n).slice(0, 30)) {
		console.log(`  ${id.padEnd(18)} ${String(c.n).padStart(4)} cues, +${(c.sum / c.n).toFixed(1)}`);
	}
}
