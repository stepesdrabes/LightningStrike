import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { benchmarkCache } from './cache.ts';
import { join } from 'node:path';
import { sectionBase, type TrackContext } from '@mv/core';
import { decodeAudio, publishedLevel } from '@mv/analysis';
import { BeatThis } from '../packages/analysis/src/beatthis.ts';
import { Adtof } from '../packages/analysis/src/adtof.ts';
import { analyzeTrack } from '../packages/analysis/src/analyze.ts';
import { hookStarts } from '../packages/analysis/src/vocabulary.ts';
import type { DrumStream } from '../packages/analysis/src/drums.ts';

/**
 * Compare judged chorus starts with synced lyric hooks and owner targets.
 * node bench/hooksnap.ts --label before
 * Read the desktop cache without modifying it; cache model output in bench/reports/hooksnap.
 * The annotated corpora lack lyric contexts and cannot test this signal.
 */

interface Mark {
	bar: number;
	note: string;
}
interface Judged {
	id: string;
	title: string;
	/** Owner-marked complaint bars, from the judge files of 2026-08-12/13. */
	marks: Mark[];
	/** No section complaint: the snap must not move anything here. */
	sentinel?: boolean;
}

const TRACKS: Judged[] = [
	{
		id: '1zDf6Ddpc40',
		title: 'Safír',
		marks: [
			{ bar: 11, note: 'chorus starts a bit late (hook at 9 per handover)' },
			{ bar: 43, note: 'chorus off by one (hook at 42 per handover)' }
		]
	},
	{ id: '1PHnrxXKzlc', title: 'Running', marks: [{ bar: 4, note: 'first drop starts a bit off' }] },
	{
		id: '6lYgPmP7fsk',
		title: 'VYZEE',
		marks: [
			{ bar: 12, note: 'drop starts a bit too late' },
			{ bar: 39, note: 'drop starts a bit too late' }
		]
	},
	{ id: '7N9D_QRRBKM', title: 'Q&A', marks: [{ bar: 83, note: 'drop starts a bit too late' }] },
	{
		id: '9PFQixQRU8s',
		title: 'Disturbia x Where Them Girls At',
		marks: [{ bar: 46, note: 'drop starts a bit too early' }]
	},
	{
		id: 'AivZyTEFZQA',
		title: 'Měls mě vůbec rád',
		marks: [{ bar: 88, note: 'last chorus a bit too late' }]
	},
	{
		id: 'Bcql4IeA-Z8',
		title: 'Cikády',
		marks: [{ bar: 24, note: 'drop starts too early, solved by the end drops' }]
	},
	{
		id: 'Cslh3-p6pDg',
		title: 'In And Out Of Love',
		marks: [
			{ bar: 34, note: 'drop starts too early' },
			{ bar: 94, note: 'drop starts too early' }
		]
	},
	{
		id: 'ZiJWFrSJ7Gk',
		title: 'Vítej mezi náma',
		marks: [{ bar: 81, note: 'end drop starts too early' }]
	},
	{
		id: '5w9PwObNqFo',
		title: 'Růže',
		marks: [{ bar: 32, note: 'chorus too early; later choruses correct' }]
	},
	{
		id: 'AHaIdOXzzuE',
		title: 'Summertime Sadness (hardstyle)',
		marks: [{ bar: 0, note: 'sections at the start are a bit wrong (no bar marked)' }]
	},
	// Out of the snap's scope (verse/build/groove starts, a drop END): here to prove the
	// mechanism leaves them alone, not to be fixed by it.
	{ id: '2am1tocSigY', title: 'Bude líp', marks: [{ bar: 9, note: 'first build a bit late (out of scope)' }] },
	{ id: '2hz30sd2gIA', title: 'Zlato', marks: [{ bar: 6, note: 'first verse a bit late (out of scope)' }] },
	{ id: '5dKMWX7xOUE', title: 'Up All Night', marks: [{ bar: 8, note: 'groove too early (out of scope)' }] },
	{ id: '2smUiqlBHFM', title: 'Ibiza Aura', marks: [{ bar: 47, note: 'drop ENDS too early (out of scope)' }] },
	// Judged near-perfect: any boundary that moves on these is a regression.
	{ id: '5d9hqbs_hFA', title: 'Letím Tmou', marks: [], sentinel: true },
	{ id: '7YGq_AwqQcQ', title: 'Až na měsíc', marks: [], sentinel: true },
	{ id: 'y9fwZvB84r8', title: 'Pistácie', marks: [], sentinel: true },
	{ id: '5lYN0OYHfVY', title: 'Svoboda', marks: [], sentinel: true }
];

const argv = process.argv.slice(2);
const flag = (n: string, d: string) => {
	const i = argv.indexOf(`--${n}`);
	return i >= 0 ? argv[i + 1] : d;
};
const label = flag('label', 'run');
const only = flag('only', '');
const cacheDir = flag('cache', benchmarkCache());
const modelCacheDir = join(import.meta.dirname, 'reports', 'hooksnap');
await mkdir(modelCacheDir, { recursive: true });

interface CachedModels {
	beats: number[];
	downbeats: number[];
	drums: {
		kick: SerialStream;
		snare: SerialStream;
		hat: SerialStream;
	} | null;
}
interface SerialStream {
	times: number[];
	levels: number[];
	curve: number[];
	fps: number;
}

const serial = (s: DrumStream): SerialStream => ({
	times: s.times,
	levels: s.levels,
	curve: Array.from(s.curve),
	fps: s.fps
});
const revive = (s: SerialStream): DrumStream => ({
	times: s.times,
	levels: s.levels,
	curve: Float32Array.from(s.curve),
	fps: s.fps
});

let beatModel: BeatThis | null = null;
let drumModel: Adtof | null | undefined;

async function models(id: string, audioPath: string): Promise<CachedModels> {
	const cached = join(modelCacheDir, `${id}.models.json`);
	if (existsSync(cached)) {
		return JSON.parse(await readFile(cached, 'utf8')) as CachedModels;
	}
	beatModel ??= await BeatThis.create();
	drumModel ??= await Adtof.create();
	const decoded = await decodeAudio(audioPath);
	const tracked = await beatModel.run(decoded.mono);
	const drums = drumModel ? await drumModel.run((await decodeAudio(audioPath, 44100)).mono) : null;
	const out: CachedModels = {
		beats: tracked.beats,
		downbeats: tracked.downbeats,
		drums: drums
			? { kick: serial(drums.kick), snare: serial(drums.snare), hat: serial(drums.hat) }
			: null
	};
	await writeFile(cached, JSON.stringify(out));
	return out;
}

interface Report {
	id: string;
	title: string;
	sections: string[];
	chorusStarts: number[];
	hooks: number[];
	marks: { bar: number; note: string; boundary: number | null; hook: number | null }[];
}
const reports: Report[] = [];

for (const t of TRACKS) {
	if (only && t.id !== only) continue;
	const audioPath = join(cacheDir, `${t.id}.m4a`);
	if (!existsSync(audioPath)) {
		console.log(`-- ${t.title}: no audio at ${audioPath}`);
		continue;
	}
	const context = JSON.parse(
		await readFile(join(cacheDir, `${t.id}.context.json`), 'utf8')
	) as TrackContext;

	const m = await models(t.id, audioPath);
	const decoded = await decodeAudio(audioPath);
	let metricalLevel: number | undefined;
	if (context.publishedBpm) {
		const level = publishedLevel(m.beats, context.publishedBpm, context.genreFamily);
		if (level !== null) metricalLevel = level;
	}

	const analysis = analyzeTrack({
		mono: decoded.mono,
		left: decoded.left,
		right: decoded.right,
		sampleRate: decoded.sampleRate,
		duration: decoded.duration,
		hash: decoded.hash,
		trackId: t.id,
		title: t.title,
		beats: m.beats,
		downbeats: m.downbeats,
		drums: m.drums
			? { kick: revive(m.drums.kick), snare: revive(m.drums.snare), hat: revive(m.drums.hat) }
			: undefined,
		metricalLevel,
		context
	});

	const barTimes = analysis.tempo.barTimes;
	const barCount = analysis.bars.length;
	// The hook floor-bars, so a printed window is {bar, bar+1} - the snap's own view.
	const starts = context.lyrics && !context.instrumental ? hookStarts(context.lyrics) : [];
	const hookList: number[] = [];
	for (const h of starts) {
		let b = 0;
		while (b < barCount - 1 && barTimes[b + 1] <= h.t) b++;
		hookList.push(b);
	}

	const chorusStarts = analysis.sections
		.filter((s) => sectionBase(s.kind) === 'drop')
		.map((s) => s.startBar);

	const nearest = (bars: number[], to: number, reach: number): number | null => {
		let best: number | null = null;
		for (const b of bars) {
			if (Math.abs(b - to) > reach) continue;
			if (best === null || Math.abs(b - to) < Math.abs(best - to)) best = b;
		}
		return best;
	};

	const marks = t.marks.map((mark) => ({
		...mark,
		boundary: nearest(chorusStarts, mark.bar, 3),
		hook: nearest(hookList, mark.bar, 3)
	}));

	reports.push({
		id: t.id,
		title: t.title,
		sections: analysis.sections.map((s) => `${s.kind}@${s.startBar}`),
		chorusStarts,
		hooks: hookList,
		marks
	});

	console.log(`\n== ${t.title}${t.sentinel ? ' [sentinel]' : ''} (${context.genreFamily})`);
	console.log(`   sections: ${analysis.sections.map((s) => `${s.kind}@${s.startBar}`).join(' ')}`);
	console.log(`   hooks:    ${hookList.join(' ') || '(none)'}`);
	for (const mark of marks) {
		const off =
			mark.boundary !== null && mark.hook !== null
				? mark.boundary === mark.hook
					? 'ON HOOK'
					: `boundary ${mark.boundary} vs hook ${mark.hook} (off ${mark.boundary - mark.hook})`
				: `boundary ${mark.boundary ?? 'none'}, hook ${mark.hook ?? 'none'}`;
		console.log(`   mark ${String(mark.bar).padStart(3)}: ${off}  | ${mark.note}`);
	}
}

// The regression view: every section table held against the saved baseline. A sentinel
// track that differs is a failure whatever the complaint tracks gained.
if (label !== 'before' && existsSync(join(modelCacheDir, 'report-before.json'))) {
	const before = JSON.parse(
		await readFile(join(modelCacheDir, 'report-before.json'), 'utf8')
	) as Report[];
	console.log('\n-- against report-before:');
	for (const r of reports) {
		const b = before.find((x) => x.id === r.id);
		if (!b) continue;
		const same = JSON.stringify(b.sections) === JSON.stringify(r.sections);
		if (same) {
			console.log(`   ${r.title}: unchanged`);
		} else {
			console.log(`   ${r.title}:`);
			console.log(`     was ${b.sections.join(' ')}`);
			console.log(`     now ${r.sections.join(' ')}`);
		}
	}
}

await writeFile(
	join(modelCacheDir, `report-${label}.json`),
	JSON.stringify(reports, null, '\t')
);
console.log(`\nreport-${label}.json written (${reports.length} tracks)`);
await beatModel?.close();
await drumModel?.close();
