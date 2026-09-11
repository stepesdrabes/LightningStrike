// Compare current analysis and shows with owner-drawn maps and hit marks. Times are
// authoritative.
// MV_CACHE_DIR=<cache> node bench/judgemap.ts
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { benchmarkCache } from './cache.ts';
import { BUILT_IN_EFFECTS, sectionBase } from '@mv/core';
import type { SectionKind } from '@mv/core';
import { composeShow } from '@mv/author-engine';

const cache = benchmarkCache();
const judgeDir = join(cache, 'judge');
if (!existsSync(judgeDir)) throw new Error(`no judge dir at ${judgeDir}`);
void BUILT_IN_EFFECTS;

interface JudgedSection { kind: string; startTime: number; endTime: number }
interface Note { t: number; hit?: string | null; text: string }
interface Judgement { trackId: string; title: string; sections?: JudgedSection[] | null; notes: Note[]; analysisHash: string | null }

const files = readdirSync(judgeDir).filter((f) => f.endsWith('.json'));
for (const f of files) {
	const j = JSON.parse(readFileSync(join(judgeDir, f), 'utf8')) as Judgement;
	const hitNotes = j.notes?.filter((n) => n.hit) ?? [];
	if (!j.sections?.length && hitNotes.length === 0) continue;
	const blobPath = join(cache, `${j.trackId}.analysis.json`);
	if (!existsSync(blobPath)) {
		console.log(`${j.title}: no analysis blob in this cache, skipped`);
		continue;
	}
	const analysis = JSON.parse(readFileSync(blobPath, 'utf8'));
	console.log(`\n=== ${j.title} (blob v${analysis.version}${j.analysisHash === analysis.hash ? '' : ', drawn on a DIFFERENT analysis - times still valid'})`);

	if (j.sections?.length) {
		// Time agreement, sampled per second: exact kind, and base-kind (a drop and a chorus
		// are the same energy class read through two vocabularies - sectionBase folds them).
		const duration = analysis.duration ?? j.sections[j.sections.length - 1].endTime;
		const kindAt = (secs: { kind: string; startTime: number; endTime: number }[], t: number) =>
			secs.find((s) => t >= s.startTime && t < s.endTime)?.kind ?? null;
		const model = analysis.sections.map((s: { kind: string; startTime: number; endTime: number }) => s);
		let exact = 0;
		let base = 0;
		let n = 0;
		for (let t = 0.5; t < duration; t += 1) {
			const a = kindAt(j.sections, t);
			const b = kindAt(model, t);
			if (!a || !b) continue;
			n++;
			if (a === b) exact++;
			if (sectionBase(a as SectionKind) === sectionBase(b as SectionKind)) base++;
		}
		console.log(`  kind agreement: exact ${((100 * exact) / Math.max(1, n)).toFixed(0)}%  base ${((100 * base) / Math.max(1, n)).toFixed(0)}%  over ${n}s`);
		for (let i = 1; i < j.sections.length; i++) {
			const t = j.sections[i].startTime;
			let best = Infinity;
			for (const s of model) best = Math.min(best, Math.abs(s.startTime - t));
			const mark = best <= 0.35 ? 'on' : best <= 2 ? `off by ${best.toFixed(1)}s` : `MISSED (${best.toFixed(1)}s)`;
			console.log(`  hand boundary ${t.toFixed(1)}s (${j.sections[i - 1].kind} -> ${j.sections[i].kind}): ${mark}`);
		}
	}

	if (hitNotes.length) {
		const meta = JSON.parse(readFileSync(join(cache, `${j.trackId}.meta.json`), 'utf8'));
		const ctxPath = join(cache, `${j.trackId}.context.json`);
		const context = existsSync(ctxPath) ? JSON.parse(readFileSync(ctxPath, 'utf8')) : undefined;
		const show = composeShow(analysis, { artHue: meta.artHue, context });
		const bt = analysis.tempo.barTimes;
		for (const note of hitNotes) {
			let best: { d: number; bar: number } | null = null;
			for (const h of show.hits ?? []) {
				if (h.kind !== note.hit) continue;
				const d = Math.abs(bt[h.bar] - note.t);
				if (!best || d < best.d) best = { d, bar: h.bar };
			}
			const where = best ? `nearest composed ${note.hit} at ${best.d.toFixed(1)}s (bar ${best.bar})` : `no ${note.hit} anywhere in the show`;
			console.log(`  hit mark ${note.hit} @${note.t.toFixed(1)}s "${note.text}": ${where}`);
		}
	}
}
