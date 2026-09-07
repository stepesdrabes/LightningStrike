// Score structure-tuning variants against the owner's frozen maps, to the bar.
//
//   MV_CACHE_DIR=<cache> node bench/mapsweep.ts [--maps=bench/judged/round-2026-09-07] [--variant=name,...] [--only=<id>]
//
// Each map is the owner's word on one track: a boundary is a hit within 0.6 s (the maps are
// drawn to the frame), a miss is signed in bars so the early-late bias is visible, and a
// label counts on hits only. Every variant sees the same audio, the same heard beats and
// the same drum-model kit, decoded once per track; only `tuning` differs, so a difference
// between two rows is the dial and nothing else. The ten maps that accepted the analysis as
// it stood are regression rows: any move on them is a loss.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { CACHE_DIR, decodeAudio, publishedLevel, readContext } from '@mv/analysis';
import { analyzeTrack } from '../packages/analysis/src/analyze.ts';
import { DEFAULT_TUNING, type StructureTuning } from '../packages/analysis/src/structure.ts';
import { Adtof } from '../packages/analysis/src/adtof.ts';

const argv = process.argv.slice(2);
const flag = (n: string) => argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const mapsDir = flag('maps') ?? join(import.meta.dirname, 'judged', 'round-2026-09-07');
const only = flag('only');
const HIT_S = 0.6;

const VARIANTS: Record<string, Partial<StructureTuning>> = {
	current: {},
	'settle-0.8': { settleWeight: 0.8 },
	'settle-1.2': { settleWeight: 1.2 },
	'settle-1.2-open': { settleWeight: 1.2, settleGate: Infinity },
	'settle-1.6-open': { settleWeight: 1.6, settleGate: Infinity },
	'bass-1': { bassWeight: 1 },
	'bass-2': { bassWeight: 2 },
	'bass-2-settle-1.2-open': { bassWeight: 2, settleWeight: 1.2, settleGate: Infinity },
	'margin-1.2': { refineMargin: 1.2 },
	'margin-1.2-bass-2': { refineMargin: 1.2, bassWeight: 2 },
	// A boundary the refine kept on a decisive arrival is protected from the phrase snap at a
	// lower score than the 3 that ships; Blinding Lights' first chorus stayed at 2.72 and was
	// snapped a bar early.
	'stay-2': { stayPinScore: 2 },
	'stay-2.5': { stayPinScore: 2.5 },
	'stay-2-settle-1.2-open': { stayPinScore: 2, settleWeight: 1.2, settleGate: Infinity },
	'stay-2-bass-2': { stayPinScore: 2, bassWeight: 2 },
	'kit-2': { kitMinKicks: 2 },
	'kit-3': { kitMinKicks: 3 },
	'split-4': { splitAtArrival: 4 },
	'split-3': { splitAtArrival: 3 },
	'stay-2-kit-2-split-4': { stayPinScore: 2, kitMinKicks: 2, splitAtArrival: 4 }
};
const wanted = flag('variant')?.split(',') ?? Object.keys(VARIANTS);

interface Row {
	id: string;
	title: string;
	accepted: boolean;
	hits: number;
	total: number;
	early: number;
	late: number;
	labelWrong: number;
	deltas: number[];
}

const DRUMS = join(import.meta.dirname, 'corpus', '.drums');
mkdirSync(DRUMS, { recursive: true });
const files = readdirSync(CACHE_DIR);
const maps = readdirSync(mapsDir).filter((f) => f.endsWith('.map.json'));
const results = new Map<string, Row[]>();
let drumModel: Adtof | null | undefined;

for (const f of maps) {
	const id = f.slice(0, -'.map.json'.length);
	if (only && id !== only) continue;
	const map = JSON.parse(readFileSync(join(mapsDir, f), 'utf8')) as {
		sections: { kind: string; startTime: number }[];
		acceptedAnalysis?: unknown;
		rating?: number;
	};
	const audio = files.find((x) => x.startsWith(`${id}.`) && /\.(m4a|webm|opus|mp3|ogg|oga|aac|wav|flac|mp4|mka)$/i.test(x));
	const blobPath = join(CACHE_DIR, `${id}.analysis.json`);
	if (!audio || !existsSync(blobPath)) continue;
	const blob = JSON.parse(readFileSync(blobPath, 'utf8')) as { title: string; heard?: { beats: number[]; downbeats: number[] } };
	if (!blob.heard) continue;
	const decoded = await decodeAudio(join(CACHE_DIR, audio));
	const drumPath = join(DRUMS, `app-${id}.json`);
	let drums: Awaited<ReturnType<Adtof['run']>> | undefined;
	if (existsSync(drumPath)) drums = JSON.parse(readFileSync(drumPath, 'utf8'));
	else {
		drumModel ??= await Adtof.create();
		if (drumModel) {
			drums = await drumModel.run((await decodeAudio(join(CACHE_DIR, audio), 44100)).mono);
			writeFileSync(drumPath, JSON.stringify(drums));
		}
	}
	const context = (await readContext(id)) ?? undefined;
	const level = context?.publishedBpm ? publishedLevel(blob.heard.beats, context.publishedBpm, context.genreFamily) : null;

	for (const name of wanted) {
		const tuning = { ...DEFAULT_TUNING, ...VARIANTS[name] };
		const analysis = analyzeTrack({
			mono: decoded.mono,
			sampleRate: decoded.sampleRate,
			duration: decoded.duration,
			hash: decoded.hash,
			trackId: id,
			title: blob.title,
			beats: blob.heard.beats,
			downbeats: blob.heard.downbeats,
			drums,
			context,
			metricalLevel: level ?? undefined,
			tuning
		});
		const barSeconds = (analysis.tempo.barTimes[analysis.tempo.barTimes.length - 1] - analysis.tempo.barTimes[0]) / Math.max(1, analysis.tempo.barTimes.length - 1);
		const row: Row = { id, title: blob.title, accepted: !!map.acceptedAnalysis, hits: 0, total: map.sections.length, early: 0, late: 0, labelWrong: 0, deltas: [] };
		for (const own of map.sections) {
			const near = analysis.sections.reduce((best, s) => (Math.abs(s.startTime - own.startTime) < Math.abs(best.startTime - own.startTime) ? s : best));
			const d = near.startTime - own.startTime;
			row.deltas.push(Math.round((d / barSeconds) * 10) / 10);
			if (Math.abs(d) <= HIT_S) {
				row.hits++;
				if (near.kind !== own.kind) row.labelWrong++;
			} else if (d < 0) row.early++;
			else row.late++;
		}
		results.set(name, [...(results.get(name) ?? []), row]);
	}
	console.log(`${id}  ${blob.title.slice(0, 36)}  ${wanted.map((n) => `${n}:${results.get(n)!.at(-1)!.hits}/${map.sections.length}`).join('  ')}`);
}
if (drumModel) await drumModel.close();

console.log('\nvariant                  hits/total  early  late  label-wrong  regressions-on-accepted');
const base = results.get('current');
for (const name of wanted) {
	const rows = results.get(name) ?? [];
	const hits = rows.reduce((a, r) => a + r.hits, 0);
	const total = rows.reduce((a, r) => a + r.total, 0);
	const early = rows.reduce((a, r) => a + r.early, 0);
	const late = rows.reduce((a, r) => a + r.late, 0);
	const wrong = rows.reduce((a, r) => a + r.labelWrong, 0);
	let regressions = 0;
	for (const r of rows) {
		const b = base?.find((x) => x.id === r.id);
		if (r.accepted && b && r.hits < b.hits) regressions++;
	}
	console.log(`${name.padEnd(24)} ${String(hits).padStart(4)}/${total}   ${String(early).padStart(4)}  ${String(late).padStart(4)}  ${String(wrong).padStart(6)}       ${regressions}`);
}
const out = join(import.meta.dirname, 'reports', 'mapsweep.json');
mkdirSync(join(import.meta.dirname, 'reports'), { recursive: true });
writeFileSync(out, JSON.stringify(Object.fromEntries(results), null, '\t'));
console.log(`\nper-track rows in ${out}`);
