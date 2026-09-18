// Check an evening file the way the app loads it, and render its scored moments.
//   node bench/eveningcheck.ts [evening.ts] [--moment id] [--step 0.25] [--events] [--sub]
// Prints loader findings and gate admission, the night's shape with pause lengths, songs named
// twice, and for each sting, narration or moment a timeline of delivered room light, lit pixels
// and Bounce Lamp duty. Rows render standalone, so a look that fades up from black shows dither
// murk here even where the night dissolves into it from a lit room: read it where `enter` cuts.
// --events instead lists every event the timing table scores with the sound's onset strength and
// the light's own move in the same 100 ms window, so a gesture missing on either side shows up.
// --sub instead plots each narration's 20-60 Hz level per second, where the weight of a hit is.
import { spawnSync } from 'node:child_process';
import { readFile, readdir } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import {
	DEFAULT_ROOM,
	EffectRegistry,
	RoomDirector,
	buildGeometry,
	compileGenerated,
	silentAnalysis,
	silentShow,
	type EveningScript,
	type Finding,
	type NarrationPlan,
	type SegmentSpec,
	type ShowPalette,
	type SilentPlan
} from '@mv/core';
import { loadEvening } from '../apps/web/src/lib/server/evening/loader.ts';
import { planEvening, EMPTY_MEMORY } from '../apps/web/src/lib/evening/plan.ts';
import type { LibraryTrack } from '../apps/web/src/lib/evening/library.ts';
import { EMPTY_QUEUE } from '../apps/web/src/lib/queueModel.ts';
import {
	BLACK_ICE,
	CHARGE,
	HOMECOMING,
	LIGHTS_OUT,
	OPENING,
	OPEN_SKY,
	RETURN_STROKE,
	SUNDOWN,
	WALL_CLOUD,
	collisions,
	crossings,
	crystals,
	debris,
	drips,
	dubDelay,
	glitter,
	hail,
	lapCorners,
	laps,
	lubTimes,
	restingLubs,
	shards,
	shootingStars,
	stars,
	sundownRoll,
	type Homecoming,
	type Opening
} from '../evenings/light-before-thunder/timing.ts';

const argv = process.argv.slice(2);
const flag = (name: string): string | null => {
	const at = argv.indexOf(`--${name}`);
	return at >= 0 ? (argv[at + 1] ?? '') : null;
};
const positional = argv.filter((a, i) => !a.startsWith('--') && !argv[i - 1]?.startsWith('--'));
const file = resolve(positional[0] ?? 'evenings/light-before-thunder.ts');
const only = flag('moment');
const step = Number(flag('step') ?? 0.25);
const events = argv.includes('--events');
const sub = argv.includes('--sub');

const FPS = 60;
const DT = 1 / FPS;
/** Under this byte a lit pixel cannot hold its colour; the LEDs sparkle instead of glowing. */
const MURK = 12;
const geometry = buildGeometry(DEFAULT_ROOM);

function show(findings: Finding[]): void {
	for (const f of findings) {
		const where = f.line ? ` (${f.line.file.split(/[\\/]/).pop()}:${f.line.line})` : '';
		console.log(`  ${f.severity}: ${f.message}${where}`);
	}
}

/**
 * Duration and genre of every cached track, so the plan places rows with the real night's lengths
 * and a fill's `where.families` can actually match. The duration is in the meta file and the
 * family only in the context file beside it, which is why both are read: with `genre` left null a
 * fill matches nothing and its block silently plans as zero length.
 */
async function library(): Promise<LibraryTrack[]> {
	const dir = join(process.env.LOCALAPPDATA ?? '', 'cz.drabek.lightningstrike', 'cache');
	let names: string[];
	try {
		names = await readdir(dir);
	} catch {
		return [];
	}
	const out: LibraryTrack[] = [];
	for (const name of names) {
		if (!name.endsWith('.meta.json')) continue;
		try {
			const meta = JSON.parse(await readFile(join(dir, name), 'utf8')) as {
				id: string;
				title: string;
				uploader?: string;
				duration: number;
			};
			let genre: string | null = null;
			try {
				const context = JSON.parse(await readFile(join(dir, `${meta.id}.context.json`), 'utf8')) as {
					genreFamily?: string;
				};
				genre = context.genreFamily ?? null;
			} catch {
				// Downloaded but not enriched yet: the planner treats it as unclassified.
			}
			out.push({
				id: meta.id,
				title: meta.title,
				artist: meta.uploader ?? '',
				duration: meta.duration,
				thumbnail: '',
				source: '',
				ready: true,
				genre: genre as LibraryTrack['genre'],
				bpm: null,
				heat: 3,
				loungeOnly: false
			});
		} catch {
			// A half-written meta file is not a library entry.
		}
	}
	return out;
}

const clock = (ms: number): string =>
	new Date(ms).toLocaleTimeString('en-GB', { hour: '2-digit', minute: '2-digit' });
const mmss = (seconds: number): string =>
	`${Math.floor(seconds / 60)}:${Math.round(seconds % 60).toString().padStart(2, '0')}`;

/** The room a silent row or narration draws, sampled every `step` seconds. */
function render(plan: SilentPlan | NarrationPlan, length: number): void {
	const analysis = silentAnalysis(plan.title, {
		title: plan.title,
		length,
		clock: plan.clock,
		timeline: plan.timeline,
		calm: plan.kind === 'silent' ? plan.calm : false
	});
	const registry = new EffectRegistry();
	for (const gen of plan.effects) {
		const compiled = compileGenerated(gen, geometry);
		if (compiled.def) registry.add(compiled.def);
		else console.log(`  effect "${gen.id}" rejected: ${compiled.failures.join('; ')}`);
	}
	const director = new RoomDirector(geometry, registry);
	director.load(analysis, silentShow(analysis, plan), 0);
	const state = { playing: true, hasShow: true, lounge: false, rest: false };

	console.log('     t  mean peak  lit murk lamp  section   bar');
	let next = 0;
	for (let n = 0; n * DT <= length; n++) {
		const t = n * DT;
		const f = director.update(t, DT, state);
		if (t + 1e-9 < next) continue;
		next += step;
		const px = director.bytes;
		let lit = 0;
		let murk = 0;
		let sum = 0;
		let peak = 0;
		for (let i = 0; i < px.length; i += 3) {
			const v = Math.max(px[i], px[i + 1], px[i + 2]);
			if (v > MURK) lit++;
			// Bytes in the dither codes: too dim to hold a colour, where the LEDs sparkle.
			else if (v > 0) murk++;
			sum += v;
			if (v > peak) peak = v;
		}
		const mean = sum / (px.length / 3);
		const lamp = Math.max(director.bounce[0], director.bounce[1], director.bounce[2]);
		console.log(
			`${t.toFixed(2).padStart(6)} ${mean.toFixed(0).padStart(4)} ${peak.toString().padStart(4)} ${lit
				.toString()
				.padStart(4)} ${murk.toString().padStart(4)} ${lamp.toString().padStart(4)}  ${f.section.padEnd(9)} ${(f.barIndex + f.barPhase).toFixed(2)}`
		);
	}
}

const palette: ShowPalette = { name: 'fallback', base: 24, accent: 200, third: 320, sat: 0.94, shade: 0.12 };

function planOf(script: EveningScript, segment: SegmentSpec): { plan: SilentPlan | NarrationPlan; length: number } | null {
	const effects = script.effects;
	if (segment.kind === 'narration') {
		return {
			plan: {
				kind: 'narration',
				title: segment.name,
				length: 0,
				clock: segment.clock,
				timeline: segment.timeline,
				palette: segment.palette ?? script.palette ?? palette,
				volume: segment.volume,
				end: segment.end,
				effects
			},
			// The audio's own length; the timeline is written against it.
			length: 0
		};
	}
	if (segment.kind === 'moment') {
		return {
			plan: {
				kind: 'silent',
				title: segment.name,
				length: segment.length,
				clock: segment.clock,
				timeline: segment.timeline,
				palette: segment.palette ?? script.palette ?? palette,
				calm: false,
				effects
			},
			length: segment.length
		};
	}
	// A hold or a pause is one look on a silent grid; sample a minute of it to read its levels.
	if (segment.kind === 'hold' || segment.kind === 'pause') {
		const look = segment.look;
		if (!look) return null;
		return {
			plan: {
				kind: 'silent',
				title: segment.name,
				length: 60,
				clock: { bpm: 40, beatsPerBar: 4, pulse: 'none' },
				timeline: [{ at: 0, section: 'outro', look }],
				palette: segment.palette ?? script.palette ?? palette,
				calm: true,
				effects
			},
			length: 60
		};
	}
	return null;
}

/** Seconds of audio in a rendered moment, from ffprobe. */
function audioLength(path: string): number {
	const probe = spawnSync(
		'ffprobe',
		['-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', path],
		{ encoding: 'utf8' }
	);
	return Number(probe.stdout.trim()) || 0;
}

const ENV_HZ = 200;

/** Per-second RMS of a moment's 20-60 Hz band, in dB: where a hit puts its weight. */
function lowBand(path: string): number[] {
	const rate = 8000;
	const pcm = spawnSync(
		'ffmpeg',
		['-v', 'error', '-nostdin', '-i', path, '-af', 'highpass=f=20,lowpass=f=60', '-ac', '1', '-ar', String(rate), '-f', 's16le', '-'],
		{ encoding: 'buffer', maxBuffer: 256 * 1024 * 1024 }
	).stdout;
	const samples = Math.floor(pcm.length / 2);
	const out: number[] = [];
	for (let s = 0; s * rate < samples; s++) {
		let sum = 0;
		let count = 0;
		for (let i = s * rate; i < Math.min(samples, (s + 1) * rate); i++) {
			const v = pcm.readInt16LE(i * 2) / 32768;
			sum += v * v;
			count++;
		}
		out.push(20 * Math.log10(Math.max(Math.sqrt(sum / Math.max(1, count)), 1e-6)));
	}
	return out;
}

/** Peak amplitude of the moment's audio in 5 ms slots, 0..1. */
function envelope(path: string): Float32Array {
	const rate = 16000;
	const decode = spawnSync(
		'ffmpeg',
		['-v', 'error', '-nostdin', '-i', path, '-ac', '1', '-ar', String(rate), '-f', 's16le', '-'],
		{ encoding: 'buffer', maxBuffer: 512 * 1024 * 1024 }
	);
	const pcm = decode.stdout;
	const samples = Math.floor(pcm.length / 2);
	const per = rate / ENV_HZ;
	const out = new Float32Array(Math.ceil(samples / per));
	for (let n = 0; n < samples; n++) {
		const v = Math.abs(pcm.readInt16LE(n * 2)) / 32768;
		const slot = Math.floor(n / per);
		if (v > out[slot]) out[slot] = v;
	}
	return out;
}

/** The strongest value a track reaches around `at`: is anything happening there at all. */
function peakNear(track: ArrayLike<number>, hz: number, at: number, before = 0.03, after = 0.12): number {
	const from = Math.max(0, Math.round((at - before) * hz));
	const to = Math.min(track.length - 1, Math.round((at + after) * hz));
	let peak = 0;
	for (let i = from; i <= to; i++) peak = Math.max(peak, track[i]);
	return peak;
}

/** The largest single-frame move a track makes around `at`, either way. */
function moveNear(track: ArrayLike<number>, hz: number, at: number, before = 0.05, after = 0.14): number {
	const from = Math.max(1, Math.round((at - before) * hz));
	const to = Math.min(track.length - 1, Math.round((at + after) * hz));
	let move = 0;
	for (let i = from; i <= to; i++) move = Math.max(move, Math.abs(track[i] - track[i - 1]));
	return move;
}

/** The largest move any pixel makes each frame, 0..1: does the room do anything at a given moment. */
function lightTrack(plan: SilentPlan | NarrationPlan, length: number): Float32Array {
	const analysis = silentAnalysis(plan.title, {
		title: plan.title,
		length,
		clock: plan.clock,
		timeline: plan.timeline,
		calm: false
	});
	const registry = new EffectRegistry();
	for (const gen of plan.effects) {
		const compiled = compileGenerated(gen, geometry);
		if (compiled.def) registry.add(compiled.def);
	}
	const director = new RoomDirector(geometry, registry);
	director.load(analysis, silentShow(analysis, plan), 0);
	const state = { playing: true, hasShow: true, lounge: false, rest: false };
	const frames = Math.ceil(length * FPS) + 1;
	const out = new Float32Array(frames);
	const previous = new Uint8Array(director.bytes.length);
	for (let n = 0; n < frames; n++) {
		director.update(n * DT, DT, state);
		let move = 0;
		for (let i = 0; i < director.bytes.length; i++) {
			const d = Math.abs(director.bytes[i] - previous[i]);
			if (d > move) move = d;
			previous[i] = director.bytes[i];
		}
		out[n] = move / 255;
	}
	return out;
}

const result = await loadEvening(file);
console.log(`${file}`);
console.log(`findings: ${result.findings.length}`);
show(result.findings);
const script = result.script;
if (!script) process.exit(1);
console.log(
	`effects: ${script.effects.map((e) => `${e.id}${e.admitted ? '' : ' NOT ADMITTED'}`).join(', ')}`
);

const tracks = await library();
const narrations: Record<string, number> = {};
for (const segment of script.segments) {
	if (segment.kind !== 'narration') continue;
	narrations[segment.audio] = await audioLength(segment.audio);
}

const now = new Date();
now.setHours(19, 55, 0, 0);
const plan = planEvening({
	script,
	run: 'check',
	library: tracks,
	queue: EMPTY_QUEUE,
	now: now.getTime(),
	offsetMinutes: now.getTimezoneOffset(),
	running: false,
	progress: null,
	hold: null,
	timedEndsAt: null,
	memory: EMPTY_MEMORY,
	narrations
});
console.log('\nThe night');
for (const s of plan.segments) {
	const length = (s.endAt - s.startAt) / 1000;
	const mark = s.kind === 'pause' ? '  <- pause' : '';
	console.log(
		`  ${clock(s.startAt)}-${clock(s.endAt)} ${mmss(length).padStart(6)} ${s.kind.padEnd(9)} ${s.name}${mark}`
	);
}
if (plan.findings.length > 0) {
	console.log('\nplan findings');
	show(plan.findings);
}

// A song named twice plays twice; nothing else in the app says so.
const named: { title: string; id: string | undefined; segment: string }[] = [];
for (const segment of script.segments) {
	const items = segment.kind === 'block' ? segment.items : segment.kind === 'pause' ? segment.music : [];
	for (const item of items) {
		if (item.kind !== 'fill') named.push({ title: item.title, id: item.id, segment: segment.name });
	}
}
console.log(`\n${named.length} songs named across ${script.segments.length} segments`);
for (const key of ['id', 'title'] as const) {
	const seen = new Map<string, string>();
	for (const song of named) {
		const value = key === 'id' ? song.id : song.title.toLowerCase();
		if (value === undefined) continue;
		const first = seen.get(value);
		if (first) console.log(`  warning: ${key} repeated, "${song.title}" in ${first} and ${song.segment}`);
		else seen.set(value, song.segment);
	}
}

interface Scored {
	t: number;
	what: string;
}

/** Every gesture the storm's table scores, light and sound together. */
function stormEvents(o: Opening): Scored[] {
	const out: Scored[] = [{ t: 0, what: 'power cut' }];
	const lubs = lubTimes(o);
	lubs.slice(0, -1).forEach((t, k) => {
		out.push({ t, what: `lub ${k}` });
		out.push({ t: t + dubDelay(lubs[k + 1] - t), what: `dub ${k}` });
	});
	for (const [n, t] of [o.flash1, o.flash2, o.flash3, o.flash4].entries()) {
		if (t >= 0) out.push({ t, what: `flash ${n + 1} (silent by design)` });
	}
	for (const [n, t] of [o.thunder1, o.thunder2, o.thunder3, o.thunder4].entries()) {
		if (t >= 0) out.push({ t, what: `thunder ${n + 1}` });
	}
	out.push({ t: o.ignite, what: 'ignition' });
	laps(o).forEach((t, k) => out.push({ t, what: `lap ${k + 1}` }));
	crossings(o).forEach((c, k) => out.push({ t: c.t, what: `beam crossing ${k + 1} ${c.end}` }));
	out.push({ t: o.collide - ((480 - 390) * o.lap) / 600, what: 'twin born' });
	collisions(o).forEach((c, k) => out.push({ t: c.t, what: `collision ${k + 1} ${c.end}` }));
	out.push({ t: o.gather, what: 'gather' });
	for (let k = 0; k < 3; k++) out.push({ t: o.point + k * o.pulse, what: `point beat ${k + 1}` });
	for (let k = 0; k < 3; k++) out.push({ t: o.strike + k * o.stroke, what: `stroke ${k + 1}` });
	return out.sort((a, b) => a.t - b.t);
}

function homeEvents(o: Homecoming): Scored[] {
	const out: Scored[] = [];
	for (const [n, t] of [o.flash1, o.flash2, o.flash3, o.flash4].entries()) {
		out.push({ t, what: `flash ${n + 1} (silent by design)` });
	}
	for (const [n, t] of [o.thunder1, o.thunder2, o.thunder3, o.thunder4].entries()) {
		out.push({ t, what: `thunder ${n + 1}` });
	}
	restingLubs(o).forEach((t, k) => out.push({ t, what: `lub ${k}` }));
	drips(o).forEach((d, k) => out.push({ t: d.t, what: `drip ${k}` }));
	out.push({ t: o.leave, what: 'the spark leaves' }, { t: o.home, what: 'home' });
	lapCorners(o).forEach((t, k) => out.push({ t, what: `corner ${k}` }));
	stars(o).forEach((s, k) => out.push({ t: s.t, what: `star ${k}` }));
	shootingStars(o).forEach((s, k) => out.push({ t: s.t, what: `falling star ${k}` }));
	out.push({ t: o.off, what: 'the set switches off' });
	return out.sort((a, b) => a.t - b.t);
}

const EVENTS: Record<string, Scored[]> = {
	'first-strike': stormEvents(OPENING),
	'return-stroke': stormEvents(RETURN_STROKE),
	homecoming: homeEvents(HOMECOMING),
	'wall-cloud': [
		...debris(WALL_CLOUD).map((d, k) => ({ t: d.t, what: `debris ${k}` })),
		{ t: WALL_CLOUD.pulse1, what: 'pressure 1' },
		{ t: WALL_CLOUD.pulse2, what: 'pressure 2' },
		{ t: WALL_CLOUD.pulse3, what: 'pressure 3' },
		{ t: WALL_CLOUD.touch, what: 'touchdown' },
		{ t: WALL_CLOUD.eye, what: 'the eye' },
		{ t: WALL_CLOUD.crack, what: 'crack' }
	].sort((a, b) => a.t - b.t),
	'lights-out': [
		{ t: 0, what: 'the breaker' },
		{ t: LIGHTS_OUT.glint1, what: 'glint 1' },
		{ t: LIGHTS_OUT.glint2, what: 'glint 2' },
		{ t: LIGHTS_OUT.glint3, what: 'glint 3' },
		{ t: LIGHTS_OUT.snap, what: 'the snap' },
		...hail(LIGHTS_OUT).map((h, k) => ({ t: h.t, what: `stone ${k}` }))
	],
	charge: [
		{ t: 0, what: 'the front leaves' },
		{ t: CHARGE.round, what: 'the front meets itself' },
		{ t: CHARGE.end - 0.02, what: 'the block lands' }
	],
	'black-ice': [
		...crystals(BLACK_ICE).map((c, k) => ({ t: c.t, what: `crystal ${k}` })),
		{ t: BLACK_ICE.frozen, what: 'frozen' },
		{ t: BLACK_ICE.crack, what: 'the ice lets go' },
		...shards(BLACK_ICE).map((c, k) => ({ t: c.t, what: `shard ${k}` }))
	].sort((a, b) => a.t - b.t),
	sundown: [
		...sundownRoll(SUNDOWN).map((t, k) => ({ t, what: `roll ${k}` })),
		{ t: SUNDOWN.crest, what: 'the crest' }
	],
	'open-sky': [
		{ t: OPEN_SKY.flash, what: 'flash (silent by design)' },
		{ t: OPEN_SKY.thunder, what: 'last thunder' },
		{ t: OPEN_SKY.bloom, what: 'bloom' },
		{ t: OPEN_SKY.spill, what: 'spill' },
		{ t: OPEN_SKY.glitter, what: 'glitter' },
		...glitter(OPEN_SKY).map((g, k) => ({ t: g.t, what: `glint ${k}` }))
	]
};

for (const spec of script.stings) {
	if (only && spec.id !== only) continue;
	if (events || sub) continue;
	console.log(`\n${spec.name} (sting)  ${spec.length.toFixed(2)} s`);
	render(
		{
			kind: 'silent',
			title: spec.name,
			length: spec.length,
			clock: spec.clock,
			timeline: spec.timeline,
			palette: spec.palette ?? script.palette ?? palette,
			calm: false,
			effects: script.effects
		},
		spec.length
	);
}

for (const segment of script.segments) {
	const built = planOf(script, segment);
	if (!built) continue;
	const id =
		segment.kind === 'narration'
			? (/([^\\/]+)\.m4a$/.exec(segment.audio)?.[1] ?? segment.id)
			: segment.id;
	if (only && segment.id !== only && id !== only) continue;
	const length = segment.kind === 'narration' ? narrations[segment.audio] : built.length;
	if (built.plan.kind === 'narration') built.plan.length = length;
	console.log(`\n${segment.name}  ${length.toFixed(2)} s`);
	if (sub) {
		if (segment.kind !== 'narration') continue;
		for (const [second, db] of lowBand(segment.audio).entries()) {
			console.log(`${String(second).padStart(4)}s ${db.toFixed(1).padStart(7)} dB  ${'#'.repeat(Math.max(0, Math.round((db + 60) / 2)))}`);
		}
		continue;
	}
	if (!events) {
		render(built.plan, length);
		continue;
	}
	const scored = EVENTS[id];
	if (!scored || segment.kind !== 'narration') continue;
	const sound = envelope(segment.audio);
	const light = lightTrack(built.plan, length);
	console.log('      t  sound  light  event');
	let quiet = 0;
	let still = 0;
	for (const e of scored) {
		const s = peakNear(sound, ENV_HZ, e.t);
		const l = peakNear(light, FPS, e.t, 0.05, 0.14);
		const silent = s < 0.05 && !e.what.includes('silent');
		const dark = l < 0.05;
		if (silent) quiet++;
		if (dark) still++;
		console.log(
			`${e.t.toFixed(2).padStart(7)} ${s.toFixed(3).padStart(6)}${silent ? '!' : ' '}${l.toFixed(3).padStart(6)}${dark ? '!' : ' '} ${e.what}`
		);
	}
	console.log(`  ${scored.length} events, ${quiet} silent, ${still} with a still room`);
}
