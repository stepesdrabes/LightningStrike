// Measure the shipped movement detector and write candidate evidence to
// bench/reports/movements/<set>.json.
// node bench/movements.ts [--set=app|multisong|harmonix|raveform] [--only=<id>]
// [--no-material]
// App targets use owner marks/frozen maps; multisong uses expect.json. Every seam in a
// single-song
// annotated corpus is a false positive.
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { benchmarkCache } from './cache.ts';
import { decodeAudio } from '@mv/analysis';
import { extractFeatures } from '../packages/analysis/src/features.ts';
import { beatSynchronous } from '../packages/analysis/src/beatsync.ts';
import { chromagram } from '../packages/analysis/src/chroma.ts';
import { measureLoudness } from '../packages/analysis/src/loudness.ts';
import { barSynchronousAt, similarityMatrix } from '../packages/analysis/src/structure.ts';
import {
	judgeSeams,
	proposeSeams,
	repairGrid,
	witnessBarLines,
	type SeamCandidate
} from '../packages/analysis/src/movements.ts';

const argv = process.argv.slice(2);
const flag = (n: string): string | undefined => argv.find((a) => a.startsWith(`--${n}=`))?.slice(n.length + 3);
const set = flag('set') ?? 'app';
const only = flag('only');
const material = !argv.includes('--no-material');
const verbose = argv.includes('--verbose') || !!only;

const APP_CACHE = benchmarkCache();
const CORPUS = join(import.meta.dirname, 'corpus');
const BEATS = join(CORPUS, '.beats');
const REPORTS = join(import.meta.dirname, 'reports', 'movements');
mkdirSync(REPORTS, { recursive: true });

const AUDIO = /\.(m4a|webm|opus|mp3|ogg|oga|aac|wav|flac|mp4|mka)$/i;
/** Frozen 2026-09-01 movement targets; their original judge files are archived. */
const FROZEN_SEAMS: Record<string, number[]> = {
	NQbkGDoD7B0: [60.38, 176.56],
	jojRxf2qvqs: [169.64, 205.65]
};

/** How near an expected or marked seam an accepted one has to land. Marks lag a second or two. */
const HIT_S = 8;

interface Track {
	id: string;
	title: string;
	audio: string | null;
	beats: number[];
	downbeats: number[];
	/** Where a listener or public knowledge says a new song starts, seconds. */
	expected: number[];
	/** True when the track is known to be several songs or known to be one. */
	known: boolean;
	duration: number;
}

function loadTracks(): Track[] {
	const out: Track[] = [];
	if (set === 'app') {
		const files = readdirSync(APP_CACHE);
		for (const f of files) {
			if (!f.endsWith('.analysis.json')) continue;
			const id = f.slice(0, -'.analysis.json'.length);
			if (only && id !== only) continue;
			const a = JSON.parse(readFileSync(join(APP_CACHE, f), 'utf8')) as {
				title: string;
				duration: number;
				beats: number[];
				downbeats?: number[];
				heard?: { beats: number[]; downbeats: number[] };
			};
			if (!a.downbeats || a.downbeats.length < 4) continue;
			// The model's own count: from the blob when the analysis kept it, else from the
			// probe's cache of a fresh tracking run. The blob's `beats` are already repaired,
			// and repairing them again is not what the app does.
			const probed = join(BEATS, `app-${id}.json`);
			const heard =
				a.heard ?? (existsSync(probed) ? (JSON.parse(readFileSync(probed, 'utf8')) as { beats: number[]; downbeats: number[] }) : undefined);
			const audio = files.find((x) => x.startsWith(`${id}.`) && AUDIO.test(x));
			let marked: number[] = [];
			const judge = join(APP_CACHE, 'judge', `${id}.json`);
			if (existsSync(judge)) {
				const j = JSON.parse(readFileSync(judge, 'utf8')) as { movements?: number[] | null };
				marked = (j.movements ?? []).filter((t) => Number.isFinite(t));
			}
			if (marked.length === 0 && FROZEN_SEAMS[id]) marked = FROZEN_SEAMS[id];
			out.push({
				id,
				title: a.title,
				audio: audio ? join(APP_CACHE, audio) : null,
				beats: heard?.beats ?? a.beats,
				downbeats: heard?.downbeats ?? a.downbeats,
				expected: marked,
				known: marked.length > 0,
				duration: a.duration
			});
		}
	} else {
		const audioDir = join(CORPUS, set, 'audio');
		const expectPath = join(CORPUS, set, 'expect.json');
		const expect = existsSync(expectPath)
			? (JSON.parse(readFileSync(expectPath, 'utf8')) as Record<string, { title: string; switches: number[] }>)
			: {};
		for (const f of readdirSync(BEATS)) {
			if (!f.startsWith(`${set}-`)) continue;
			const key = f.slice(set.length + 1, -'.json'.length);
			if (only && key !== only) continue;
			const tracked = JSON.parse(readFileSync(join(BEATS, f), 'utf8')) as { beats: number[]; downbeats: number[] };
			const audio = existsSync(audioDir)
				? readdirSync(audioDir).find((x) => x.startsWith(`${key}.`) && AUDIO.test(x))
				: undefined;
			const e = expect[key];
			out.push({
				id: key,
				title: e?.title ?? key,
				audio: audio ? join(audioDir, audio) : null,
				beats: tracked.beats,
				downbeats: tracked.downbeats,
				expected: e?.switches ?? [],
				known: set !== 'app',
				duration: tracked.beats[tracked.beats.length - 1] ?? 0
			});
		}
	}
	return out;
}

/** Beats per bar from the model's commonest downbeat spacing, as the analysis reads it. */
function beatsPerBarOf(beats: readonly number[] | Float64Array, downbeats: readonly number[]): number {
	const index = (t: number) => {
		let lo = 0;
		let hi = beats.length - 1;
		while (hi - lo > 1) {
			const mid = (lo + hi) >> 1;
			if (beats[mid] <= t) lo = mid;
			else hi = mid;
		}
		return Math.abs(beats[lo] - t) <= Math.abs(beats[hi] - t) ? lo : hi;
	};
	const idx = downbeats.map(index);
	const gaps = new Map<number, number>();
	for (let i = 1; i < idx.length; i++) {
		const g = idx[i] - idx[i - 1];
		if (g >= 2 && g <= 12) gaps.set(g, (gaps.get(g) ?? 0) + 1);
	}
	let bpb = 4;
	let best = 0;
	for (const [g, c] of gaps) {
		if (c > best) {
			best = c;
			bpb = g;
		}
	}
	return bpb === 8 || bpb === 12 ? 4 : bpb === 6 ? 3 : bpb;
}

const tracks = loadTracks();
console.log(`${tracks.length} tracks in set ${set}${material ? '' : ' (no material pass)'}\n`);
const report: Record<string, unknown>[] = [];
let hits = 0;
let misses = 0;
let falseSeams = 0;
let tracksWithFalse = 0;
let expectedTotal = 0;

for (const track of tracks) {
	const repair = repairGrid(track.beats, track.downbeats);
	const bpb = beatsPerBarOf(repair.beats, repair.downbeats);
	const candidates: SeamCandidate[] = proposeSeams(repair, bpb, track.duration);
	let movements: { t: number; note: string }[] = [];
	const repairedNote = `relevelled ${repair.relevelledSeconds.toFixed(0)}s, filled ${repair.filledSeconds.toFixed(0)}s`;
	let failed: string | null = null;

	if (material && track.audio && (candidates.length > 0 || track.expected.length > 0)) {
		try {
			const decoded = await decodeAudio(track.audio);
			const loud = measureLoudness(decoded.mono, decoded.sampleRate);
			const mono = Float32Array.from(decoded.mono);
			const gain = Math.pow(10, (-14 - loud.integrated) / 20);
			if (Number.isFinite(gain) && Math.abs(gain - 1) > 0.01) {
				const g = Math.min(gain, 40);
				for (let i = 0; i < mono.length; i++) mono[i] *= g;
			}
			const features = extractFeatures(mono, decoded.sampleRate);
			const chroma = chromagram(mono, decoded.sampleRate);
			const bf = beatSynchronous(features.spec, chroma, features.curves, features.odf, repair.beats, decoded.duration);
			const bars = barSynchronousAt(bf, witnessBarLines(repair.beats, repair.downbeats, bpb));
			const sim = similarityMatrix(bars);
			movements = judgeSeams(candidates, { bars, sim, chroma }, decoded.duration);
		} catch (e) {
			failed = e instanceof Error ? e.message : String(e);
		}
	}

	// Score: an accepted seam within HIT_S of an expected one is a hit; the rest are false.
	const matched = new Set<number>();
	let trackFalse = 0;
	for (const m of movements) {
		const near = track.expected.findIndex((t, i) => !matched.has(i) && Math.abs(t - m.t) <= HIT_S);
		if (near >= 0) {
			matched.add(near);
			hits++;
		} else if (track.known) {
			trackFalse++;
		}
	}
	if (track.known) {
		expectedTotal += track.expected.length;
		misses += track.expected.length - matched.size;
		falseSeams += trackFalse;
		if (trackFalse > 0) tracksWithFalse++;
	}

	const fmt = (v: number | undefined, d = 2) => (v === undefined ? '  -  ' : v.toFixed(d).padStart(5));
	const line = (c: SeamCandidate) => {
		const near = track.expected.length ? Math.min(...track.expected.map((t) => Math.abs(t - c.t))) : undefined;
		return (
			`    ${c.t.toFixed(1).padStart(6)}s ` +
			(c.tempo
				? `tempo ${c.tempo.from.toFixed(1)}->${c.tempo.to.toFixed(1)} x${c.tempo.ratio.toFixed(2)} step ${c.tempo.step.toFixed(2)} pause x${c.tempo.pause.toFixed(1)} `
				: '                                                ') +
			(c.downbeatGap !== undefined ? `gap ${String(c.downbeatGap).padStart(2)} ` : '       ') +
			(c.reset ? 'R ' : '  ') +
			(c.pause !== undefined ? `pause ${c.pause.toFixed(1)}s ` : '            ') +
			(c.interlude ? `interlude-${c.interlude.edge} ` : '') +
			(c.chromaRatio !== undefined
				? `| chroma ${fmt(c.chromaRatio)} timbre ${fmt(c.timbreRatio)} key ${c.keyLeft} -> ${c.keyRight} (d${c.keyDist?.toFixed(1)} c${c.keyConf?.toFixed(2)}) sides ${c.leftSeconds?.toFixed(0)}+${c.rightSeconds?.toFixed(0)}s`
				: '') +
			(near !== undefined ? ` | expected ${near.toFixed(1)}s away` : '') +
			(movements.some((m) => Math.abs(m.t - c.t) < 1e-6) ? '  <== MOVEMENT' : '')
		);
	};

	const interesting = verbose || movements.length > 0 || track.expected.length > 0 || repair.filledSeconds > 8;
	if (interesting) {
		console.log(
			`${track.id}  ${track.title.slice(0, 44)}  (${Math.round(track.duration)}s, ${repair.songs.length} songs, ${repairedNote}, ${candidates.length} candidates, expected ${track.expected.map((m) => m.toFixed(0)).join('/') || '-'}, found ${movements.map((m) => m.t.toFixed(1)).join('/') || '-'})${failed ? `  MATERIAL FAILED: ${failed}` : ''}`
		);
		if (verbose) {
			for (const s of repair.songs) {
				console.log(`      song ${s.index}: ${repair.beats[s.fromBeat].toFixed(1)}-${repair.beats[s.toBeat].toFixed(1)}s ${s.bpm.toFixed(1)} bpm steady ${s.steady.toFixed(2)}${s.flippedSeconds > 0 ? ` (flipped ${s.flippedSeconds.toFixed(0)}s)` : ''}`);
			}
			for (const f of repair.zones) console.log(`      zone ${f.from.toFixed(1)}-${f.to.toFixed(1)}s${f.filled ? ' filled' : ''}`);
		}
		for (const c of candidates) {
			if (verbose || c.tempo || movements.some((m) => Math.abs(m.t - c.t) < 1e-6) || c.chromaRatio !== undefined && c.chromaRatio < 0.75) console.log(line(c));
		}
	}

	report.push({
		id: track.id,
		title: track.title,
		duration: track.duration,
		expected: track.expected,
		songs: repair.songs,
		zones: repair.zones,
		relevelledSeconds: repair.relevelledSeconds,
		filledSeconds: repair.filledSeconds,
		candidates,
		movements
	});
}

const outPath = join(REPORTS, `${set}${only ? `-${only}` : ''}.json`);
writeFileSync(outPath, JSON.stringify(report, null, '\t'));
const withMovements = report.filter((r) => (r.movements as unknown[]).length > 0).length;
console.log(
	`\n${withMovements} of ${tracks.length} tracks get a movement. Against what is known: ${hits} hit / ${misses} missed of ${expectedTotal} expected seams; ${falseSeams} false seams on ${tracksWithFalse} tracks. Report: ${outPath}`
);
