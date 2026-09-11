// Compare cached chorus/drop starts with synced-lyric hook windows and chorus spans, without
// audio.
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { benchmarkCache } from './cache.ts';
import {
	chorusSpansFromLyrics,
	hookStarts,
	spanOverlap
} from '../packages/analysis/src/vocabulary.ts';

const cache = benchmarkCache();
const judgeDir = join(cache, 'judge');

for (const f of readdirSync(judgeDir).filter((f) => f.endsWith('.json'))) {
	const judge = JSON.parse(readFileSync(join(judgeDir, f), 'utf8'));
	const id = judge.trackId as string;
	const ctxPath = join(cache, `${id}.context.json`);
	const anaPath = join(cache, `${id}.analysis.json`);
	if (!existsSync(ctxPath) || !existsSync(anaPath)) continue;
	const ctx = JSON.parse(readFileSync(ctxPath, 'utf8'));
	const ana = JSON.parse(readFileSync(anaPath, 'utf8'));
	const lyrics = ctx.lyrics as { t: number; text: string }[] | null;
	if (!lyrics || lyrics.length === 0) continue;

	const barTimes = ana.tempo.barTimes as number[];
	const barCount = ana.bars.length as number;
	const barAt = (t: number) => {
		let b = 0;
		while (b < barCount - 1 && barTimes[b + 1] <= t) b++;
		return b;
	};

	const starts = hookStarts(lyrics);
	const HOOK_MIN_GAP_BARS = 4;
	const windows: { bar: number; restart: boolean }[] = [];
	let lastBar = -Infinity;
	for (const h of [...starts].sort((a, b) => a.t - b.t)) {
		const b = barAt(h.t);
		if (b - lastBar < HOOK_MIN_GAP_BARS) continue;
		lastBar = b;
		windows.push({ bar: b, restart: h.restart });
	}
	const spans = chorusSpansFromLyrics(lyrics, ana.duration);

	const secs = ana.sections as {
		kind: string;
		startBar: number;
		endBar: number;
	}[];
	const lines: string[] = [];
	for (const s of secs) {
		if (s.kind !== 'chorus' && s.kind !== 'drop') continue;
		const from = s.startBar;
		const w = windows.find((w) => from === w.bar || from === w.bar + 1);
		const near = windows
			.map((w) => ({ w, d: from - w.bar }))
			.filter((x) => Math.abs(x.d) <= 3)
			.map((x) => `${x.w.bar}${x.w.restart ? 'R' : ''}(${x.d >= 0 ? '+' : ''}${x.d})`)
			.join(',');
		const ov = spanOverlap(spans, barTimes[s.startBar], barTimes[Math.min(s.endBar, barCount)]);
		lines.push(
			`    ${s.kind}@${from}  ${w ? `IN window ${w.bar}${w.restart ? 'R' : ''}` : 'no window'}` +
				`${near ? `  near:[${near}]` : ''}  lyricOverlap=${ov.toFixed(2)}`
		);
	}
	console.log(`${judge.title}  (${id})  windows=[${windows.map((w) => `${w.bar}${w.restart ? 'R' : ''}`).join(' ')}]  spans=${spans.length}`);
	for (const l of lines) console.log(l);
}
