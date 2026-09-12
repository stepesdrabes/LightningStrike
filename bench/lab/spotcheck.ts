// Kit plausibility from bench/audibility.ts reports: per-track counts of transient-less kicks,
// clap-shaped snares and hat agreement, plus a compact event listing for manual judging.
//   node bench/lab/spotcheck.ts [--ids a,b] [--full]
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, resolve } from 'node:path';

const ROOT = resolve(import.meta.dirname, '..', '..');
const INTRO = join(ROOT, 'bench', 'reports', 'audio-reliability', 'intro');
const LAB = join(ROOT, 'bench', 'reports', 'audio-reliability', 'lab');

export const SPANS: Record<string, { from: number; to: number; note: string }> = {
	IxJjY5T9yag: { from: 0, to: 40, note: '808 rap' },
	NQbkGDoD7B0: { from: 0, to: 45, note: 'rap, beat switch' },
	tWEaUKCQ8Fg: { from: 0, to: 30, note: 'disco/pop, chorus at bar 8' },
	UARSiWU8eoo: { from: 25, to: 60, note: 'trance build/drop' },
	bEgS_KJCxTU: { from: 95, to: 130, note: 'house drop at bar 48' },
	AHaIdOXzzuE: { from: 20, to: 50, note: 'hardstyle' },
	mbWOIqlrqFU: { from: 30, to: 60, note: 'drum and bass' },
	cOpRvLUSMiQ: { from: 0, to: 30, note: 'rock, fast drums' },
	yynqCKDI7kQ: { from: 0, to: 30, note: 'rap' },
	'-5XxjPOedc0': { from: 60, to: 90, note: 'techno' }
};

export type Kit = 'kick' | 'snare' | 'hat';
export const KIT: Kit[] = ['kick', 'snare', 'hat'];
const ADTOF = ['kick', 'snare', 'tom', 'hat', 'cymbal'] as const;

interface Mark { time: number; source: string; detail: Record<string, number> }
export interface Snapshot {
	peakTime: number; rmsDb: number; riseDb: number; centroidHz: number; lowFrac: number;
	midFrac: number; highFrac: number; airFrac: number; riseLowDb: number; riseMidDb: number;
	riseHighDb: number; riseAirDb: number; riseLowFrac: number; riseMidFrac: number;
	riseHighFrac: number; riseCentroidHz: number; decayMs: number | null;
	decayHighMs: number | null; decayAirMs: number | null; bandDb: number[]; riseBandDb: number[];
	guess: string;
}
export interface Candidate { time: number; sources: Mark[]; bar: number; beatOffset: number; snapshot: Snapshot }
export interface Report {
	id: string; title: string; span: { from: number; to: number };
	grid: { bpm: number; beatPeriod: number; beatsPerBar: number };
	bars: { bar: number; start: number; end: number; section: string | null; cachedKicks: number; cachedSnares: number; cachedHats: number }[];
	sections: { index: number; kind: string; startBar: number; endBar: number }[];
	adtof: { ship: Record<string, { time: number; activation: number; level: number }[]>; low: Record<string, { time: number; activation: number; level: number }[]> };
	dsp: Record<Kit, { time: number; level: number; curve: number }[]>;
	cached: { onsets: Record<Kit, { time: number; level: number }[]> };
	snapshotBands: { centreHz: number[] };
	candidates: Candidate[];
	curves: { fps: number; time: number[]; odf: number[]; dsp: Record<Kit, number[]>; adtof: Record<string, number[]> };
}

export const load = (id: string): Report => JSON.parse(readFileSync(join(INTRO, `${id}.json`), 'utf8'));

export type Band = 'low' | 'body' | 'crack' | 'air' | 'full';
export const BAND_NAMES: Band[] = ['low', 'body', 'crack', 'air', 'full'];
export interface Bands { id: string; fps: number; firstFrame: number; frames: number; bands: Record<Band, number[]> }
const bandCache = new Map<string, Bands | null>();
export function loadBands(id: string): Bands | null {
	if (!bandCache.has(id)) {
		const path = join(LAB, 'bands', `${id}.json`);
		bandCache.set(id, existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : null);
	}
	return bandCache.get(id) ?? null;
}
/**
 * Largest onset step of one band near t: band level at a frame in [t-20 ms, t+30 ms] minus the
 * mean of the 30-60 ms before that frame, dB. Independent of where the broadband peak sits.
 */
export function bandRiseAt(id: string, band: Band, t: number, before = 0.02, after = 0.03): number | null {
	const b = loadBands(id);
	if (!b) return null;
	const curve = b.bands[band];
	const f0 = Math.round(t * b.fps) - b.firstFrame;
	let best = -Infinity;
	for (let f = f0 - Math.round(before * b.fps); f <= f0 + Math.round(after * b.fps); f++) {
		if (f < 6 || f >= curve.length) continue;
		const prev = (curve[f - 6] + curve[f - 5] + curve[f - 4] + curve[f - 3]) / 4;
		best = Math.max(best, curve[f] - prev);
	}
	return Number.isFinite(best) ? Math.round(best * 10) / 10 : null;
}
export function bandRises(id: string, t: number): Record<Band, number | null> {
	return Object.fromEntries(BAND_NAMES.map((n) => [n, bandRiseAt(id, n, t)])) as Record<Band, number | null>;
}
/** Band level at t relative to its peak over +-window, dB (negative = below local peak). */
export function bandLevelAt(id: string, band: Band, t: number): number | null {
	const b = loadBands(id);
	if (!b) return null;
	const f = Math.round(t * b.fps) - b.firstFrame;
	return f >= 0 && f < b.frames ? b.bands[band][f] : null;
}

/** Mean rise, dB, over the snapshot bands whose centre lies in [lo, hi] Hz. */
export function bandRise(r: Report, s: Snapshot, lo: number, hi: number): number {
	const c = r.snapshotBands.centreHz;
	let acc = 0, n = 0;
	for (let b = 0; b < c.length; b++) if (c[b] >= lo && c[b] <= hi) { acc += s.riseBandDb[b]; n++; }
	return n ? acc / n : 0;
}
export const bodyRise = (r: Report, s: Snapshot) => bandRise(r, s, 150, 400);
export const crackRise = (r: Report, s: Snapshot) => bandRise(r, s, 1500, 8000);

/** Max of a 10 ms curve within +-radius s of t. */
export function curveMax(r: Report, curve: number[], t: number, radius = 0.02): number {
	const i0 = Math.round((t - radius - r.span.from) * r.curves.fps);
	const i1 = Math.round((t + radius - r.span.from) * r.curves.fps);
	let m = 0;
	for (let i = Math.max(0, i0); i <= Math.min(curve.length - 1, i1); i++) if (curve[i] > m) m = curve[i];
	return m;
}
export const modelAct = (r: Report, cls: string, t: number) => curveMax(r, r.curves.adtof[cls] ?? [], t);
export const dspCurve = (r: Report, k: Kit, t: number) => curveMax(r, r.curves.dsp[k], t);
export function cachedLevel(r: Report, k: Kit, t: number, radius = 0.03): number | null {
	let best: number | null = null, dist = radius;
	for (const e of r.cached.onsets[k]) {
		const d = Math.abs(e.time - t);
		if (d <= dist) { dist = d; best = e.level; }
	}
	return best;
}
export const nearest = (times: number[], t: number) => times.reduce((b, x) => (Math.abs(x - t) < Math.abs(b - t) ? x : b), Infinity);

const has = (c: Candidate, src: string) => c.sources.some((m) => m.source === src);
const r2 = (v: number) => Math.round(v * 100) / 100;
const pct = (a: number, b: number) => (b ? `${Math.round((100 * a) / b)}%` : '-');
const f1 = (v: number | null) => (v === null ? '>1000' : v.toFixed(0));

export interface KickFlags { transient: boolean; bassLike: boolean; softLow: boolean }
export function kickFlags(s: Snapshot): KickFlags {
	const transient = s.riseDb >= 4 && s.riseLowDb >= 4;
	const bassLike = s.riseDb < 3 && s.lowFrac >= 0.6 && (s.decayMs === null || s.decayMs >= 300);
	return { transient, bassLike, softLow: !transient && !bassLike };
}
export interface SnareFlags { clapLike: boolean; snareLike: boolean; backbeat: boolean }
export function snareFlags(r: Report, c: Candidate): SnareFlags {
	const s = c.snapshot;
	const body = bodyRise(r, s), crack = crackRise(r, s);
	const clapLike = crack >= 6 && body < 3 && (s.decayMs === null ? false : s.decayMs <= 200);
	const snareLike = body >= 3 && crack >= 3;
	const off = ((c.beatOffset % r.grid.beatsPerBar) + r.grid.beatsPerBar) % r.grid.beatsPerBar;
	const backbeat = Math.abs(off - 1) < 0.15 || Math.abs(off - 3) < 0.15 || (r.grid.beatsPerBar === 4 && Math.abs(off - 2) < 0.15);
	return { clapLike, snareLike, backbeat };
}
export interface HatFlags { hatLike: boolean; open: boolean; dull: boolean }
export function hatFlags(s: Snapshot): HatFlags {
	const bright = s.riseHighFrac >= 0.5 && s.riseAirDb >= 5;
	const hatLike = bright && s.decayAirMs !== null && s.decayAirMs <= 150;
	const open = bright && !hatLike;
	return { hatLike, open, dull: !bright };
}

export interface TrackSummary {
	id: string; title: string; bpm: number; span: string;
	kick: Record<'model' | 'dsp' | 'cached', { n: number; transient: number; bassLike: number; soft: number }>;
	snare: Record<'model' | 'dsp' | 'cached', { n: number; backbeat: number; clapLike: number; snareLike: number; other: number }>;
	hat: { model: number; low: number; dsp: number; cached: number; modelDsp: number; modelOnly: number; dspOnly: number; modelHatLike: number; dspHatLike: number; dspDull: number; modelDull: number; cachedDull: number };
}

export function summarise(r: Report): TrackSummary {
	const kick = { model: { n: 0, transient: 0, bassLike: 0, soft: 0 }, dsp: { n: 0, transient: 0, bassLike: 0, soft: 0 }, cached: { n: 0, transient: 0, bassLike: 0, soft: 0 } };
	const snare = { model: { n: 0, backbeat: 0, clapLike: 0, snareLike: 0, other: 0 }, dsp: { n: 0, backbeat: 0, clapLike: 0, snareLike: 0, other: 0 }, cached: { n: 0, backbeat: 0, clapLike: 0, snareLike: 0, other: 0 } };
	const hat = { model: 0, low: 0, dsp: 0, cached: 0, modelDsp: 0, modelOnly: 0, dspOnly: 0, modelHatLike: 0, dspHatLike: 0, dspDull: 0, modelDull: 0, cachedDull: 0 };
	for (const c of r.candidates) {
		const s = c.snapshot;
		const kf = kickFlags(s);
		for (const [key, src] of [['model', 'adtof:kick'], ['dsp', 'dsp:kick'], ['cached', 'cached:kick']] as const) {
			if (!has(c, src)) continue;
			const k = kick[key];
			k.n++;
			if (kf.transient) k.transient++;
			else if (kf.bassLike) k.bassLike++;
			else k.soft++;
		}
		const sf = snareFlags(r, c);
		for (const [key, src] of [['model', 'adtof:snare'], ['dsp', 'dsp:snare'], ['cached', 'cached:snare']] as const) {
			if (!has(c, src)) continue;
			const k = snare[key];
			k.n++;
			if (sf.backbeat) k.backbeat++;
			if (sf.clapLike) k.clapLike++;
			else if (sf.snareLike) k.snareLike++;
			else k.other++;
		}
		const hf = hatFlags(s);
		const m = has(c, 'adtof:hat'), d = has(c, 'dsp:hat'), ca = has(c, 'cached:hat');
		if (m) hat.model++;
		if (has(c, 'adtof~hat')) hat.low++;
		if (d) hat.dsp++;
		if (ca) hat.cached++;
		if (m && d) hat.modelDsp++;
		if (m && !d) hat.modelOnly++;
		if (d && !m) hat.dspOnly++;
		if (m && hf.hatLike) hat.modelHatLike++;
		if (d && hf.hatLike) hat.dspHatLike++;
		if (d && hf.dull) hat.dspDull++;
		if (m && hf.dull) hat.modelDull++;
		if (ca && hf.dull) hat.cachedDull++;
	}
	return { id: r.id, title: r.title, bpm: r.grid.bpm, span: `${r.span.from}-${r.span.to}`, kick, snare, hat };
}

function shortSources(c: Candidate): string {
	return c.sources.map((m) => {
		const d = m.detail;
		const v = d.activation !== undefined ? d.activation : d.level !== undefined ? d.level : d.height;
		const tag = m.source.replace('adtof:', 'M:').replace('adtof~', 'm:').replace('dsp:', 'D:').replace('cached:', 'C:');
		return `${tag}${v === undefined ? '' : r2(v)}`;
	}).join(' ');
}

export function eventTable(r: Report, full = false): string[] {
	const lines: string[] = [];
	lines.push('| t | bar+beat | sources (M model ship, m model 0.10, D dsp, C cached; value = activation or level) | rise all/low/mid/high/air dB | low% | body/crack rise dB | rise cen Hz | decay all/high/air | guess | act k/s/t/h/c | dsp k/s/h | band rise low/body/crack/air/full |');
	lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|');
	for (const c of r.candidates) {
		const kit = c.sources.some((m) => /(kick|snare|hat)$/.test(m.source));
		if (!kit && !full && !(has(c, 'odf') && (c.sources.find((m) => m.source === 'odf')?.detail.height ?? 0) >= 0.3)) continue;
		const s = c.snapshot;
		const act = ADTOF.map((cls) => modelAct(r, cls, c.time).toFixed(2)).join('/');
		const d = KIT.map((k) => dspCurve(r, k, c.time).toFixed(2)).join('/');
		const br = bandRises(r.id, c.time);
		const brs = BAND_NAMES.map((n) => (br[n] === null ? '-' : br[n]!.toFixed(1))).join('/');
		lines.push(`| ${c.time.toFixed(3)} | ${c.bar}+${c.beatOffset.toFixed(2)} | ${shortSources(c)} | ${s.riseDb.toFixed(1)}/${s.riseLowDb.toFixed(1)}/${s.riseMidDb.toFixed(1)}/${s.riseHighDb.toFixed(1)}/${s.riseAirDb.toFixed(1)} | ${Math.round(s.lowFrac * 100)} | ${bodyRise(r, s).toFixed(1)}/${crackRise(r, s).toFixed(1)} | ${s.riseCentroidHz} | ${f1(s.decayMs)}/${f1(s.decayHighMs)}/${f1(s.decayAirMs)} | ${s.guess} | ${act} | ${d} | ${brs} |`);
	}
	return lines;
}

/** One row per sixteenth slot: which detectors fire there, so patterns read at a glance. */
export function slotGrid(r: Report): string[] {
	const lines: string[] = [];
	const bp = r.grid.beatPeriod, bpb = r.grid.beatsPerBar;
	const mark = (src: string, t0: number, t1: number) => r.candidates.some((c) => c.time >= t0 && c.time < t1 && has(c, src));
	lines.push('| bar | section | slots (16ths): K/S/H cached, k/s/h model ship only, d dsp hat only, . nothing |');
	lines.push('|---|---|---|');
	for (const b of r.bars) {
		const cells: string[] = [];
		for (let i = 0; i < bpb * 4; i++) {
			const t0 = b.start + (i - 0.5) * bp / 4, t1 = b.start + (i + 0.5) * bp / 4;
			let cell = '';
			cell += mark('cached:kick', t0, t1) ? 'K' : mark('adtof:kick', t0, t1) ? 'k' : '';
			cell += mark('cached:snare', t0, t1) ? 'S' : mark('adtof:snare', t0, t1) ? 's' : '';
			cell += mark('cached:hat', t0, t1) ? 'H' : mark('adtof:hat', t0, t1) ? 'h' : mark('dsp:hat', t0, t1) ? 'd' : '';
			cells.push(cell || '.');
		}
		const beats: string[] = [];
		for (let q = 0; q < bpb; q++) beats.push(cells.slice(q * 4, q * 4 + 4).map((c) => c.padEnd(3)).join(''));
		lines.push(`| ${b.bar} | ${b.section ?? '-'} | \`${beats.join('  ')}\` |`);
	}
	return lines;
}

export function summaryTable(rows: TrackSummary[]): string[] {
	const lines: string[] = [];
	lines.push('| track | bpm | kick model n (transient/bass-like/soft) | kick dsp | kick cached | snare model n (backbeat, clap-like/snare-like/other) | snare dsp | snare cached | hat model / 0.10 / dsp / cached | model&dsp / model only / dsp only | hat-like: model / dsp | dull: model / dsp / cached |');
	lines.push('|---|---|---|---|---|---|---|---|---|---|---|---|');
	for (const s of rows) {
		const k = (x: TrackSummary['kick']['model']) => `${x.n} (${x.transient}/${x.bassLike}/${x.soft})`;
		const sn = (x: TrackSummary['snare']['model']) => `${x.n} (${x.backbeat}, ${x.clapLike}/${x.snareLike}/${x.other})`;
		const h = s.hat;
		lines.push(`| ${s.title.slice(0, 22)} ${s.span} | ${s.bpm.toFixed(0)} | ${k(s.kick.model)} | ${k(s.kick.dsp)} | ${k(s.kick.cached)} | ${sn(s.snare.model)} | ${sn(s.snare.dsp)} | ${sn(s.snare.cached)} | ${h.model} / ${h.low} / ${h.dsp} / ${h.cached} | ${h.modelDsp} / ${h.modelOnly} / ${h.dspOnly} | ${h.modelHatLike} / ${h.dspHatLike} | ${h.modelDull} / ${h.dspDull} / ${h.cachedDull} |`);
	}
	return lines;
}

if (process.argv[1] && resolve(process.argv[1]) === resolve(import.meta.filename)) {
	const args = process.argv.slice(2);
	const idsArg = args.find((a) => a.startsWith('--ids='));
	const ids = idsArg ? idsArg.slice(6).split(',') : Object.keys(SPANS);
	const full = args.includes('--full');
	const probe = args.find((a) => a.startsWith('--probe='));
	if (probe) {
		// --probe=ID:t1,t2,... prints band rises and detector values at arbitrary times.
		const [pid, list] = probe.slice(8).split(':');
		const r = load(pid);
		console.log('| t | band rise low/body/crack/air/full | act k/s/t/h/c | dsp k/s/h | cached k/s/h |');
		for (const t of list.split(',').map(Number)) {
			const br = bandRises(pid, t);
			const brs = BAND_NAMES.map((n) => (br[n] === null ? '-' : br[n]!.toFixed(1))).join('/');
			const act = ADTOF.map((cls) => modelAct(r, cls, t).toFixed(2)).join('/');
			const d = KIT.map((k) => dspCurve(r, k, t).toFixed(2)).join('/');
			const ca = KIT.map((k) => { const v = cachedLevel(r, k, t); return v === null ? '-' : v.toFixed(2); }).join('/');
			console.log(`| ${t.toFixed(3)} | ${brs} | ${act} | ${d} | ${ca} |`);
		}
		process.exit(0);
	}
	const rows: TrackSummary[] = [];
	const out: string[] = ['# Rap/EDM spot checks: kit plausibility', ''];
	const perTrack: string[] = [];
	for (const id of ids) {
		const r = load(id);
		rows.push(summarise(r));
		perTrack.push(`## ${r.title} (${id}) ${r.span.from}-${r.span.to} s, ${r.grid.bpm.toFixed(1)} bpm, ${SPANS[id]?.note ?? ''}`, '');
		perTrack.push('Sections: ' + r.sections.map((s) => `${s.kind} bars ${s.startBar}-${s.endBar}`).join('; '), '');
		perTrack.push(...slotGrid(r), '');
		perTrack.push(...eventTable(r, full), '');
	}
	out.push('Flags: kick transient = rise >= 4 dB and low rise >= 4 dB; bass-like = rise < 3 dB, low share >= 60%, decay >= 300 ms; soft = neither. Snare clap-like = 1.5-8 kHz rise >= 6 dB, 150-400 Hz rise < 3 dB, decay <= 200 ms; snare-like = body and crack rise >= 3 dB. Hat-like = high rise share >= 50%, air rise >= 5 dB, air decay <= 150 ms; dull = high rise share < 50% or air rise < 5 dB.', '');
	out.push(...summaryTable(rows), '', ...perTrack);
	mkdirSync(LAB, { recursive: true });
	writeFileSync(join(LAB, 'spotcheck.md'), out.join('\n'));
	writeFileSync(join(LAB, 'spotcheck.json'), JSON.stringify(rows, null, '\t'));
	console.log(summaryTable(rows).join('\n'));
	console.log(`wrote ${join(LAB, 'spotcheck.md')}`);
}
