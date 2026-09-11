import { readdir, readFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { Show, TrackContext } from '@mv/core';
import { CACHE_DIR } from '@mv/analysis';

/** Measure within-family effect-set Jaccard similarity and the most-common peak master's share. */
const metas = (await readdir(CACHE_DIR)).filter((f) => f.endsWith('.meta.json'));

interface Row {
	family: string;
	effects: Set<string>;
	peak: string;
}
const rows: Row[] = [];

for (const f of metas) {
	const meta = JSON.parse(await readFile(join(CACHE_DIR, f), 'utf8')) as { id: string };
	let show: Show;
	let ctx: TrackContext | null = null;
	try {
		show = JSON.parse(await readFile(join(CACHE_DIR, `${meta.id}.show.json`), 'utf8')) as Show;
		ctx = JSON.parse(await readFile(join(CACHE_DIR, `${meta.id}.context.json`), 'utf8')) as TrackContext;
	} catch {
		continue;
	}
	// Screen time, not membership: a long show cycles most of the pool eventually, so the
	// set of everything used is alike by construction. What a listener notices is the
	// handful of effects that hold the room longest.
	const held = new Map<string, number>();
	let peak = '-';
	let best = -1;
	const cues = [...show.cues].sort((a, b) => a.bar - b.bar);
	for (let i = 0; i < cues.length; i++) {
		const cue = cues[i];
		const bars = (cues[i + 1]?.bar ?? cue.bar + 8) - cue.bar;
		for (const layer of Object.values(cue.layers)) {
			if (layer?.effect) held.set(layer.effect, (held.get(layer.effect) ?? 0) + bars);
		}
		const intensity = cue.intensity ?? show.defaults.intensity;
		if (cue.layers.master && intensity > best) {
			best = intensity;
			peak = cue.layers.master.effect;
		}
	}
	const top = [...held.entries()].sort((a, b) => b[1] - a[1]).slice(0, 6);
	rows.push({ family: ctx?.genreFamily ?? 'unknown', effects: new Set(top.map(([id]) => id)), peak });
}

const byFamily = new Map<string, Row[]>();
for (const r of rows) {
	const list = byFamily.get(r.family) ?? [];
	list.push(r);
	byFamily.set(r.family, list);
}

let weightedSim = 0;
let pairs = 0;
console.log('family    n  pairwiseJaccard  peaks');
for (const [family, list] of [...byFamily.entries()].sort()) {
	if (list.length < 2) continue;
	let sim = 0;
	let n = 0;
	for (let i = 0; i < list.length; i++) {
		for (let j = i + 1; j < list.length; j++) {
			const a = list[i].effects;
			const b = list[j].effects;
			let inter = 0;
			for (const x of a) if (b.has(x)) inter++;
			sim += inter / (a.size + b.size - inter);
			n++;
		}
	}
	weightedSim += sim;
	pairs += n;
	const peaks = new Map<string, number>();
	for (const r of list) peaks.set(r.peak, (peaks.get(r.peak) ?? 0) + 1);
	const peakList = [...peaks.entries()].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k}:${v}`).join(' ');
	console.log(family.padEnd(8), String(list.length).padStart(2), (sim / n).toFixed(3).padStart(15), ' ', peakList);
}
console.log(`\noverall within-family similarity: ${(weightedSim / Math.max(1, pairs)).toFixed(3)} (lower is more varied)`);
