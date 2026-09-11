// Score frozen 2026-08-14 owner boundary targets against the current pipeline and arrival
// evidence.
// node bench/earlybars.ts
import { readdirSync, readFileSync, existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { benchmarkCache } from './cache.ts';
import { decodeAudio } from '@mv/analysis';
import { BeatThis } from '../packages/analysis/src/beatthis.ts';
import { analyzeTrack } from '../packages/analysis/src/analyze.ts';
import { DEFAULT_TUNING, type StructureTuning } from '../packages/analysis/src/structure.ts';
import { TARGETS, type Target } from './targets.ts';

const VARIANTS: Record<string, StructureTuning> = {
	current: { ...DEFAULT_TUNING },
	settle08: { ...DEFAULT_TUNING, settleWeight: 0.8 },
	settle12: { ...DEFAULT_TUNING, settleWeight: 1.2 },
	settle16: { ...DEFAULT_TUNING, settleWeight: 1.6 },
	settle12r2: { ...DEFAULT_TUNING, settleWeight: 1.2, refineReach: 2 },
	settle16r2: { ...DEFAULT_TUNING, settleWeight: 1.6, refineReach: 2 }
};
const variantName = process.argv.find((a) => a.startsWith('--variant='))?.slice(10) ?? 'current';
const tuning = VARIANTS[variantName];
if (!tuning) throw new Error(`unknown variant ${variantName}`);
/** Strip lyrics from the context, so the run shows where the DP and refine alone land. */
const noLyrics = process.argv.includes('--no-lyrics');


const cache = benchmarkCache();
const beatsDir = join(import.meta.dirname, 'corpus/.beats');
mkdirSync(beatsDir, { recursive: true });

let model: BeatThis | null = null;
async function beatsFor(id: string, audio: string): Promise<{ beats: number[]; downbeats: number[] }> {
	const path = join(beatsDir, `judged-${id}.json`);
	if (existsSync(path)) return JSON.parse(readFileSync(path, 'utf8'));
	const decoded = await decodeAudio(audio);
	model ??= await BeatThis.create();
	const tracked = await model.run(decoded.mono);
	writeFileSync(path, JSON.stringify(tracked));
	return tracked;
}

const byTrack = new Map<string, Target[]>();
for (const t of TARGETS) {
	const list = byTrack.get(t.id) ?? [];
	list.push(t);
	byTrack.set(t.id, list);
}

let hit = 0;
let closer = 0;
let same = 0;
let worse = 0;
for (const [id, targets] of byTrack) {
	const files = readdirSync(cache);
	const audio = files.find((x) => x.startsWith(`${id}.`) && !x.includes('.json') && !x.endsWith('.pcm'));
	if (!audio) {
		console.log(`${id}  NO AUDIO in ${cache}`);
		continue;
	}
	const tracked = await beatsFor(id, join(cache, audio));
	const decoded = await decodeAudio(join(cache, audio));
	let context = existsSync(join(cache, `${id}.context.json`))
		? JSON.parse(readFileSync(join(cache, `${id}.context.json`), 'utf8'))
		: undefined;
	if (noLyrics && context) context = { ...context, lyrics: null };
	const analysis = analyzeTrack({
		mono: decoded.mono,
		sampleRate: decoded.sampleRate,
		duration: decoded.duration,
		hash: 'earlybars',
		trackId: 'file-000000000000',
		title: id,
		context,
		beats: tracked.beats,
		downbeats: tracked.downbeats,
		tuning
	});
	// Exclude build starts: the judged seam is their following arrival.
	const bounds = analysis.sections.filter((s) => s.kind !== 'build').map((s) => s.startBar);
	for (const t of targets) {
		// The boundary this run puts nearest the judged complaint.
		let now = bounds[0];
		for (const b of bounds) if (Math.abs(b - t.judged) < Math.abs(now - t.judged)) now = b;
		const before = Math.abs(t.judged - t.trueBar);
		const after = Math.abs(now - t.trueBar);
		const verdict = after === 0 ? 'HIT' : after < before ? 'closer' : after === before ? 'same' : 'WORSE';
		if (verdict === 'HIT') hit++;
		else if (verdict === 'closer') closer++;
		else if (verdict === 'same') same++;
		else worse++;
		console.log(
			`${t.title.padEnd(22)} judged@${String(t.judged).padStart(3)} true@${String(t.trueBar).padStart(3)}` +
				`  now@${String(now).padStart(3)}  ${verdict}${t.tentative ? ' (tentative)' : ''}  - ${t.note}`
		);
	}
}
console.log(`\n${hit} hit, ${closer} closer, ${same} same, ${worse} worse of ${hit + closer + same + worse}`);
