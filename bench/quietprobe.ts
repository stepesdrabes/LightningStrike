import { readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import {
	BUILT_IN_EFFECTS,
	DEFAULT_ROOM,
	EffectRegistry,
	Mixer,
	ShowPlayer,
	buildGeometry,
	type Show,
	type TrackAnalysis
} from '@mv/core';
import { CACHE_DIR } from '@mv/analysis';


/**
 * Generate taste.quiet by substituting each candidate into real cached quiet cues.
 * Synthetic spectra distribute energy unlike sparse recordings and can reverse effect
 * rankings.
 * node bench/quietprobe.ts [--role bed] [--limit 8]
 */

const argv = process.argv.slice(2);
const flag = (n: string) => {
	const i = argv.indexOf(`--${n}`);
	return i >= 0 ? argv[i + 1] : undefined;
};
const onlyRole = flag('role');
const limit = Number(flag('limit') ?? 8);


const QUIET = new Set(['intro', 'outro', 'breakdown']);
const g = buildGeometry(DEFAULT_ROOM);

interface Track {
	analysis: TrackAnalysis;
	show: Show;
	spans: { start: number; end: number }[];
}

const tracks: Track[] = [];
for (const file of readdirSync(CACHE_DIR).filter((f) => f.endsWith('.show.json'))) {
	if (tracks.length >= limit) break;
	const id = file.replace('.show.json', '');
	try {
		const analysis = JSON.parse(
			readFileSync(join(CACHE_DIR, `${id}.analysis.json`), 'utf8')
		) as TrackAnalysis;
		const show = JSON.parse(readFileSync(join(CACHE_DIR, file), 'utf8')) as Show;
		const spans = analysis.sections
			.filter((s) => QUIET.has(s.kind))
			.map((s) => ({ start: s.startTime, end: s.endTime }));
		if (spans.length > 0) tracks.push({ analysis, show, spans });
	} catch {
		// A half-written or stale blob is not worth failing the whole probe over.
	}
}

/** Movement of the delivered room over the quiet spans, with this effect in the given role. */
function deliver(id: string, role: string): { drift: number; byte: number; spread: number } {
	const n = g.count;
	const level = new Float32Array(n);
	const smooth = new Float32Array(n);
	let drift = 0;
	let byte = 0;
	let spread = 0;
	let frames = 0;

	for (const track of tracks) {
		const show: Show = {
			...track.show,
			cues: track.show.cues.map((c) =>
				QUIET.has(c.section) ? { ...c, layers: { ...c.layers, [role]: { effect: id } } } : c
			)
		};
		const mixer = new Mixer(g);
		const player = new ShowPlayer(mixer, new EffectRegistry(BUILT_IN_EFFECTS));
		player.load(track.analysis, show);
		player.reset();

		const dt = 1 / 60;
		let first = true;
		for (let t = 0; t < track.analysis.duration; t += dt) {
			const f = player.update(t, dt);
			mixer.render(f);
			if (!track.spans.some((s) => t >= s.start && t < s.end)) continue;

			let sum = 0;
			let lo = 1e9;
			let hi = -1e9;
			for (let k = 0; k < n; k++) {
				const v = Math.max(mixer.bytes[k * 3], mixer.bytes[k * 3 + 1], mixer.bytes[k * 3 + 2]);
				level[k] = v;
				sum += v;
				if (v < lo) lo = v;
				if (v > hi) hi = v;
			}
			const a = 1 - Math.exp(-dt / 0.5);
			let d = 0;
			for (let k = 0; k < n; k++) {
				if (first) smooth[k] = level[k];
				else smooth[k] += (level[k] - smooth[k]) * a;
				d += Math.abs(level[k] - smooth[k]);
			}
			if (!first) drift += d / n;
			byte += sum / n;
			spread += hi - lo;
			frames++;
			first = false;
		}
	}
	return frames > 0
		? { drift: drift / frames, byte: byte / frames, spread: spread / frames }
		: { drift: 0, byte: 0, spread: 0 };
}

const candidates = BUILT_IN_EFFECTS.filter(
	(e) =>
		(e.role === 'bed' || e.role === 'accent') &&
		e.taste.sections.some((s) => QUIET.has(s)) &&
		(!onlyRole || e.role === onlyRole)
);

console.error(`${tracks.length} tracks, ${candidates.length} candidates`);
const rows = candidates.map((e) => ({ id: e.id, role: e.role, ...deliver(e.id, e.role) }));
rows.sort((a, b) => a.role.localeCompare(b.role) || b.drift - a.drift);

console.log(`\n${'effect'.padEnd(20)}${'role'.padEnd(9)}${'drift'.padStart(8)}${'byte'.padStart(8)}${'spread'.padStart(8)}`);
for (const r of rows) {
	console.log(
		r.id.padEnd(20) +
			r.role.padEnd(9) +
			r.drift.toFixed(2).padStart(8) +
			r.byte.toFixed(1).padStart(8) +
			r.spread.toFixed(0).padStart(8)
	);
}

// The line to paste into the generator when `taste.quiet` is refreshed.
console.log(`\n${rows.map((r) => `${r.id}=${r.drift.toFixed(2)}`).join(' ')}`);
