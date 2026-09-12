// node bench/lab/exp-habibi.ts
// Habibi (tWEaUKCQ8Fg) anchor run: where the kicks the worktree quantise no longer invents were,
// and whether a kick is audible there, judged by the 20-90 Hz band in the library audio.
// Writes lab/completion-habibi.{md,json}. The library cache is read only.
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodeAudio } from '../../packages/analysis/src/decode.ts';
import { benchmarkCache } from '../cache.ts';
import { ROOT, dirs, fmt, nearestDistance, quantileOf, read, signed, writeJson } from './mdb.ts';

const ID = 'tWEaUKCQ8Fg';
const anchor = join(ROOT, 'bench', 'reports', 'audio-reliability', 'anchor-run');
interface Analysis {
	duration: number;
	beats: number[];
	tempo: { barTimes: number[]; beatPeriod: number; bpm: number };
	sections: { kind: string; startBar: number; endBar: number }[];
	onsets: Record<'kick' | 'snare' | 'hat', { times: number[]; levels: number[] }>;
}
interface Probe {
	detected: { kick: { times: number[]; levels: number[] } };
	final: { kick: { times: number[]; levels: number[]; invented: boolean[] } };
}
const before = read<Analysis>(join(anchor, `${ID}.before.analysis.json`));
const after = read<Analysis>(join(anchor, `${ID}.after.analysis.json`));
const probe = read<Probe>(join(anchor, `${ID}.probe.json`));
const evidencePath = join(ROOT, 'bench', 'reports', 'audio-reliability', 'model-evidence', `${ID}.json`);
const modelPeaks = existsSync(evidencePath)
	? read<{ drums: { kick: { times: number[]; levels: number[] } } }>(evidencePath).drums.kick
	: { times: [] as number[], levels: [] as number[] };

const barTimes = before.tempo.barTimes;
const barOf = (t: number) => {
	let b = 0;
	while (b + 1 < barTimes.length && barTimes[b + 1] <= t) b++;
	return b;
};
const sectionOf = (bar: number) => before.sections.find((s) => bar >= s.startBar && bar < s.endBar);
const sectionName = (bar: number) => {
	const s = sectionOf(bar);
	return s ? `${s.kind}@${s.startBar}-${s.endBar}` : 'none';
};
const nearestSigned = (sorted: readonly number[], t: number): number => {
	let best = Infinity;
	for (const x of sorted) if (Math.abs(x - t) < Math.abs(best)) best = x - t;
	return best;
};

const beforeKicks = before.onsets.kick;
const afterKicks = after.onsets.kick.times;
const detected = [...probe.detected.kick.times].sort((a, b) => a - b);
const near = (list: readonly number[], t: number, tol: number) => nearestDistance(list, t) <= tol;
const removed = beforeKicks.times.flatMap((t, i) => (near(afterKicks, t, 0.0015) ? [] : [{
	time: t, level: beforeKicks.levels[i], bar: barOf(t), section: sectionName(barOf(t)), detected: near(detected, t, 0.002)
}]));
const added = afterKicks.filter((t) => !near(beforeKicks.times, t, 0.0015));
const afterInvented = probe.final.kick.times.filter((_, i) => probe.final.kick.invented[i]);

// 20-90 Hz, second-order Butterworth high and low pass, run forward then backward for zero phase.
function biquad(x: Float32Array, fs: number, fc: number, kind: 'hp' | 'lp'): Float32Array {
	const w0 = 2 * Math.PI * fc / fs;
	const alpha = Math.sin(w0) / (2 * Math.SQRT1_2);
	const cos = Math.cos(w0);
	const [b0, b1, b2] = kind === 'lp'
		? [(1 - cos) / 2, 1 - cos, (1 - cos) / 2]
		: [(1 + cos) / 2, -(1 + cos), (1 + cos) / 2];
	const a0 = 1 + alpha;
	const a1 = -2 * cos;
	const a2 = 1 - alpha;
	const run = (input: Float32Array): Float32Array => {
		const y = new Float32Array(input.length);
		let x1 = 0;
		let x2 = 0;
		let y1 = 0;
		let y2 = 0;
		for (let i = 0; i < input.length; i++) {
			const v = input[i];
			const out = (b0 * v + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2) / a0;
			x2 = x1;
			x1 = v;
			y2 = y1;
			y1 = out;
			y[i] = out;
		}
		return y;
	};
	return run(run(x).reverse()).reverse();
}
const decoded = await decodeAudio(join(benchmarkCache(), `${ID}.m4a`), 22050);
const fs = decoded.sampleRate;
const low = biquad(biquad(decoded.mono, fs, 20, 'hp'), fs, 90, 'lp');
const rms = (x: Float32Array, from: number, to: number) => {
	const a = Math.max(0, Math.round(from * fs));
	const b = Math.min(x.length, Math.round(to * fs));
	let acc = 0;
	for (let i = a; i < b; i++) acc += x[i] * x[i];
	return b > a ? Math.sqrt(acc / (b - a)) : 0;
};
const dB = (v: number) => 20 * Math.log10(Math.max(1e-9, v));
// Windows chosen on this track: they separate the 296 detected kicks from empty sixteenth slots
// (rise AUC .945, level AUC .982); a 50-60 Hz fundamental needs tens of ms to build.
const rise = (t: number) => dB(rms(low, t + 0.01, t + 0.1)) - dB(rms(low, t - 0.15, t - 0.05));
const levelAt = (t: number) => dB(rms(low, t, t + 0.06));
const hops: number[] = [];
for (let t = 0; t < before.duration - 0.1; t += 0.05) hops.push(levelAt(t));
const medianLevel = quantileOf(hops, 0.5);
const levelRel = (t: number) => levelAt(t) - medianLevel;

const period = before.tempo.beatPeriod;
const emptySlots: number[] = [];
for (let t = barTimes[0]; t < before.duration - 0.2; t += period / 4) {
	if (!near(afterKicks, t, 0.1) && !near(beforeKicks.times, t, 0.1)) emptySlots.push(t);
}
const q = (xs: number[]) => [0.1, 0.25, 0.5, 0.75, 0.9].map((p) => quantileOf(xs, p));
const qs = (xs: number[]) => q(xs).map((v) => fmt(v, 1)).join(' / ');

/** Offset from the nearest sixteenth of the analysis beat grid, ms. */
const slotOffsetMs = (t: number): number => {
	const beats = before.beats;
	let i = 0;
	while (i + 1 < beats.length && beats[i + 1] <= t) i++;
	const span = (i + 1 < beats.length ? beats[i + 1] - beats[i] : period) / 4;
	const k = Math.round((t - beats[i]) / span);
	return (t - (beats[i] + k * span)) * 1000;
};
/** Band level in a short window at the time itself, so a kick 50 ms away is not credited to it. */
const shortLevel = (t: number) => dB(rms(low, t - 0.005, t + 0.03));
/** Broadband 30 ms transient: a kick attack shows here even when the low band is already busy. */
const transient = (t: number) => dB(rms(decoded.mono, t - 0.005, t + 0.025)) - dB(rms(decoded.mono, t - 0.04, t - 0.005));
type Verdict = 'kick audible' | 'ambiguous' | 'no kick' | 'duplicate, in kept kick decay' | 'duplicate, precedes kept kick';
interface Judgement {
	verdict: Verdict;
	rise: number;
	levelDb: number;
	transientDb: number;
	keptMs: number;
	/** Short-window band level at the time against the same window at the nearest kept kick. */
	vsKeptDb: number;
	modelMs: number;
	modelLevel: number;
}
const judge = (t: number): Judgement => {
	const r = rise(t);
	const l = levelRel(t);
	const kept = nearestSigned(afterKicks, t);
	const vsKept = Number.isFinite(kept) ? shortLevel(t) - shortLevel(t + kept) : NaN;
	const mi = modelPeaks.times.reduce((best, x, i) => (Math.abs(x - t) < Math.abs(modelPeaks.times[best] - t) ? i : best), 0);
	const modelMs = modelPeaks.times.length ? (modelPeaks.times[mi] - t) * 1000 : Infinity;
	const verdict: Verdict = Math.abs(kept) <= 0.08
		? (kept < 0 ? 'duplicate, in kept kick decay' : 'duplicate, precedes kept kick')
		: r >= 5 && l >= 3 ? 'kick audible'
		: l < 0 || r < 2 ? 'no kick'
		: 'ambiguous';
	return {
		verdict, rise: r, levelDb: l, transientDb: transient(t), keptMs: kept * 1000, vsKeptDb: vsKept, modelMs,
		modelLevel: modelPeaks.levels[mi] ?? 0
	};
};
const judged = removed.map((r) => ({ ...r, ...judge(r.time) }));
const inventions = judged.filter((r) => !r.detected);
const tally = (rows: typeof judged) => {
	const n = (v: Verdict) => rows.filter((r) => r.verdict === v).length;
	return {
		audible: n('kick audible'), ambiguous: n('ambiguous'), none: n('no kick'),
		duplicate: n('duplicate, in kept kick decay') + n('duplicate, precedes kept kick'), decay: n('duplicate, in kept kick decay')
	};
};

const lines: string[] = [];
lines.push('# completion-habibi', '');
lines.push(`Habibi ${ID}, disco, ${fmt(before.tempo.bpm, 1)} bpm: before ${beforeKicks.times.length} kicks (baseline-source quantise), `
	+ `after ${afterKicks.length} (worktree). ${removed.length} removed, ${added.length} added, net ${beforeKicks.times.length - afterKicks.length}. `
	+ `${inventions.length} of the removed are not within 2 ms of any snapped model kick (inventions of the old quantise); `
	+ `${removed.length - inventions.length} were detections. The worktree run itself invents ${afterInvented.length} kicks.`, '');
lines.push('Old evidenceAt took the curve maximum within half a slot (51 ms here) with no local-peak or same-slot check, so a '
	+ 'detected kick in the neighbouring sixteenth counted as evidence for the empty slot; "duplicate" below marks a removed '
	+ 'invention within 80 ms of a kick the worktree kept.', '');
const total = tally(inventions);
const dup = inventions.filter((r) => Math.abs(r.keptMs) <= 80);
lines.push(`Removed inventions: ${total.duplicate} within 80 ms of a kept kick (${total.decay} in that kick's decay, ${total.duplicate - total.decay} just before it), `
	+ `${total.audible} kick audible, ${total.ambiguous} ambiguous, ${total.none} no kick. `
	+ `Broadband 30 ms transient at the invented times: ${qs(dup.map((r) => r.transientDb))} dB against ${qs(detected.map(transient))} dB at the snapped model kicks `
	+ `and ${qs(emptySlots.map(transient))} dB at empty slots (p10 / p25 / p50 / p75 / p90): no separate attack at the invented times.`, '');
lines.push(`Kept-kick offset from the removed inventions, ms: ${qs(dup.map((r) => r.keptMs))} (p10 / p25 / p50 / p75 / p90); `
	+ `${dup.filter((r) => r.keptMs > 0).length} have the kept kick after them, ${dup.filter((r) => r.keptMs < 0).length} before.`, '');
lines.push(`Offset of kicks from the nearest sixteenth of the analysis grid, ms: kept kicks ${qs(afterKicks.map(slotOffsetMs))}; `
	+ `snapped model kicks ${qs(detected.map(slotOffsetMs))}; removed inventions ${qs(inventions.map((r) => slotOffsetMs(r.time)))}; `
	+ `|offset| > 51 ms (unquantised at tolerance 0.5) for ${detected.filter((t) => Math.abs(slotOffsetMs(t)) > 51).length} of ${detected.length} snapped model kicks.`, '');
lines.push(`Kicks the worktree still invents: ${afterInvented.length}; nearest snapped model kick ${qs(afterInvented.map((t) => Math.abs(nearestSigned(detected, t)) * 1000))} ms.`, '');
lines.push('## Removed inventions by section', '');
lines.push('| Section | bars with removals | removed | duplicate | audible | ambiguous | no kick | kept kicks in section | before level p50 |');
lines.push('|---|---|---:|---:|---:|---:|---:|---:|---:|');
for (const s of before.sections) {
	const rows = inventions.filter((r) => r.bar >= s.startBar && r.bar < s.endBar);
	if (rows.length === 0) continue;
	const bars = [...new Set(rows.map((r) => r.bar))].sort((a, b) => a - b);
	const ranges: string[] = [];
	for (let i = 0; i < bars.length; i++) {
		let j = i;
		while (j + 1 < bars.length && bars[j + 1] === bars[j] + 1) j++;
		ranges.push(i === j ? `${bars[i]}` : `${bars[i]}-${bars[j]}`);
		i = j;
	}
	const kept = afterKicks.filter((t) => t >= barTimes[s.startBar] && t < barTimes[Math.min(s.endBar, barTimes.length - 1)]).length;
	const c = tally(rows);
	lines.push(`| ${s.kind}@${s.startBar}-${s.endBar} | ${ranges.join(', ')} | ${rows.length} | ${c.duplicate} | ${c.audible} | ${c.ambiguous} | ${c.none} | ${kept} `
		+ `| ${fmt(quantileOf(rows.map((r) => r.level), 0.5), 3)} |`);
}
const perBar = new Map<number, number>();
for (const r of inventions) perBar.set(r.bar, (perBar.get(r.bar) ?? 0) + 1);
lines.push('', `Bars with 3+ removed inventions: ${[...perBar.entries()].filter(([, n]) => n >= 3).map(([b, n]) => `${b} (${n})`).join(', ') || 'none'}.`);
lines.push('', '## 20-90 Hz calibration, dB, p10 / p25 / p50 / p75 / p90', '');
lines.push('rise = band RMS over [t+10, t+100] ms against [t-150, t-50] ms; level = band RMS over [t, t+60] ms against the track median of that window.', '');
lines.push('| Set | n | rise | level vs median |', '|---|---:|---|---|');
const calib: Record<string, number[]> = {
	'detected model kicks (snapped)': detected,
	'empty sixteenth slots (no kick within 100 ms)': emptySlots,
	'removed old inventions, all': inventions.map((r) => r.time),
	'removed old inventions, not within 80 ms of a kept kick': inventions.filter((r) => Math.abs(r.keptMs) > 80).map((r) => r.time),
	'kicks the worktree still invents': afterInvented
};
for (const [name, times] of Object.entries(calib)) {
	lines.push(`| ${name} | ${times.length} | ${qs(times.map(rise))} | ${qs(times.map(levelRel))} |`);
}
lines.push('', 'Verdict: duplicate when a kept kick is within 80 ms (in its decay when the kept kick comes first); '
	+ 'otherwise kick audible when rise >= 5 dB and level >= 3 dB, no kick when level < 0 dB or rise < 2 dB, else ambiguous.');

const picks = Array.from({ length: 12 }, (_, i) => inventions[Math.floor((i + 0.5) * inventions.length / 12)]);
lines.push('', '## Twelve removed inventions, evenly spaced in time', '');
lines.push('rise and level are the calibrated 100 ms measures and credit a kick up to 100 ms later; "vs kept" is a 35 ms window at the invented time against the same window at the kept kick.', '');
lines.push('| Time s | Section | Bar | before level | rise dB | level vs median dB | transient dB | kept kick ms | vs kept dB | model peak ms (level) | Verdict |');
lines.push('|---:|---|---:|---:|---:|---:|---:|---:|---:|---:|---|');
for (const e of picks) {
	lines.push(`| ${fmt(e.time, 3)} | ${e.section} | ${e.bar} | ${fmt(e.level, 3)} | ${signed(e.rise, 1)} | ${signed(e.levelDb, 1)} | ${signed(e.transientDb, 1)} | ${signed(e.keptMs, 0)} | ${signed(e.vsKeptDb, 1)} `
		+ `| ${signed(e.modelMs, 0)} (${fmt(e.modelLevel, 2)}) | ${e.verdict} |`);
}
lines.push('', '## Added by the worktree run', '');
lines.push('| Time s | Section | Bar | invented | rise dB | level vs median dB | nearest model peak ms (level) |', '|---:|---|---:|---|---:|---:|---:|');
for (const t of added) {
	const j = judge(t);
	lines.push(`| ${fmt(t, 3)} | ${sectionName(barOf(t))} | ${barOf(t)} | ${near(afterInvented, t, 0.0015) ? 'yes' : 'no'} | ${signed(j.rise, 1)} | ${signed(j.levelDb, 1)} | ${signed(j.modelMs, 0)} (${fmt(j.modelLevel, 2)}) |`);
}
const md = lines.join('\n') + '\n';
writeFileSync(join(dirs.lab, 'completion-habibi.md'), md);
writeJson(join(dirs.lab, 'completion-habibi.json'), {
	id: ID, before: beforeKicks.times.length, after: afterKicks.length, medianLevel, tally: total,
	removed: judged, added: added.map((t) => ({ time: t, ...judge(t) })),
	calibration: Object.fromEntries(Object.entries(calib).map(([k, times]) => [k, { rise: q(times.map(rise)), level: q(times.map(levelRel)) }]))
});
console.log(md);
