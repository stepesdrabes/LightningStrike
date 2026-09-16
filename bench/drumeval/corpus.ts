// Labelled drum corpora under bench/corpus, normalised to one event list per track.
import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';

export const ROOT = resolve(import.meta.dirname, '..', '..');
const CORPUS_ROOT = join(ROOT, 'bench', 'corpus');

export type DrumClass = 'kick' | 'snare' | 'hat' | 'tom' | 'cymbal' | 'other';
export const KIT = ['kick', 'snare', 'hat'] as const;
export type Kind = typeof KIT[number];

export interface DrumEvent {
	time: number;
	cls: DrumClass;
	/** Dataset-specific articulation, e.g. MDB SDG ghost note or PHH pedal hat. */
	sub?: string;
	/**
	 * True for articulations a light should not be required to answer (ghost notes, brushes,
	 * pedal hats). Such references are neither required nor counted against a detector.
	 */
	optional?: boolean;
}

export interface CorpusTrack {
	corpus: string;
	name: string;
	/** Stereo or mono full mix. */
	audio: string;
	events: DrumEvent[];
	genre?: string;
	/** False for corpora without drum labels, kept for listening and unlabelled diagnostics. */
	labeled?: boolean;
	/** Kept out of Striker training unless train-striker.py --train-held-out; cross-dataset runs leave it out anyway. */
	heldOut?: boolean;
	/** Classes the corpus annotates; absent means every class. */
	classes?: DrumClass[];
	/** The corpus whose recordings and labels this one renders differently, e.g. drums without accompaniment. */
	variantOf?: string;
}

/** Brush strokes, ghost notes, side sticks and pedal hats are too quiet in a mix to be lighting requirements. */
const MDB_OPTIONAL = new Set(['SDG', 'SDB', 'SST', 'PHH']);
/** Subclass labels (Southall et al. 2017); the class files file side sticks and tambourine as other. */
const MDB_SUB_CLASS: Record<string, DrumClass> = {
	KD: 'kick', SD: 'snare', SDB: 'snare', SDD: 'snare', SDF: 'snare', SDG: 'snare', SDNS: 'snare', SST: 'snare',
	CHH: 'hat', OHH: 'hat', PHH: 'hat', HIT: 'tom', HFT: 'tom', LFT: 'tom', MHT: 'tom',
	RDC: 'cymbal', RDB: 'cymbal', CRC: 'cymbal', CHC: 'cymbal', SPC: 'cymbal', TMB: 'other'
};

function readPairs(path: string): [number, string][] {
	return readFileSync(path, 'utf8').split(/\r?\n/).flatMap((line) => {
		const [time, label] = line.trim().split(/\s+/);
		return time && label ? [[Number(time), label] as [number, string]] : [];
	});
}

function mdb(audio: 'full_mix' | 'drum_only' = 'full_mix'): CorpusTrack[] {
	const dir = join(CORPUS_ROOT, 'mdb-drums');
	if (!existsSync(dir)) return [];
	return readdirSync(join(dir, 'audio', 'full_mix')).filter((f) => f.endsWith('_MIX.wav')).sort().map((file) => {
		const name = file.slice(0, -8);
		const events = readPairs(join(dir, 'annotations', 'subclass', `${name}_subclass.txt`)).map(([time, sub]): DrumEvent => {
			const cls = MDB_SUB_CLASS[sub];
			if (!cls) throw new Error(`${name}: unknown MDB subclass ${sub}`);
			// A tambourine keeps time like a hat: optional for the hat class rather than a false positive.
			if (sub === 'TMB') return { time, cls: 'hat', sub, optional: true };
			return { time, cls, sub, ...(MDB_OPTIONAL.has(sub) ? { optional: true } : {}) };
		});
		const track = { name: name.replace('MusicDelta_', ''), events };
		return audio === 'full_mix'
			? { ...track, corpus: 'mdb', audio: join(dir, 'audio', 'full_mix', file) }
			: { ...track, corpus: 'mdbsolo', variantOf: 'mdb', audio: join(dir, 'audio', 'drum_only', `${name}_Drum.wav`) };
	});
}

/** Corpora converted by bench/drumeval/convert-*.ts into tracks.json beside their audio. */
function converted(directory: string, corpus: string): CorpusTrack[] {
	const path = join(CORPUS_ROOT, directory, 'tracks.json');
	if (!existsSync(path)) return [];
	const file = JSON.parse(readFileSync(path, 'utf8')) as {
		labeled?: boolean; heldOut?: boolean; classes?: DrumClass[]; variantOf?: string; tracks: Omit<CorpusTrack, 'corpus'>[];
	};
	return file.tracks.map((track) => ({
		...track, corpus, labeled: file.labeled ?? true, heldOut: file.heldOut ?? false, classes: file.classes,
		...(file.variantOf ? { variantOf: file.variantOf } : {}),
		audio: isAbsolute(track.audio) ? track.audio : join(CORPUS_ROOT, directory, track.audio)
	}));
}

const ADAPTERS: Record<string, () => CorpusTrack[]> = {
	mdb: () => mdb(),
	mdbsolo: () => mdb('drum_only'),
	enst: () => converted('enst-drums', 'enst'),
	enstsolo: () => converted('enst-solo', 'enstsolo'),
	enst23: () => converted('enst-23', 'enst23'),
	rwc: () => converted('rwc', 'rwc'),
	a2md: () => converted('a2md', 'a2md'),
	rbma: () => converted('rbma13', 'rbma'),
	idmt: () => converted('idmt-smt-drums', 'idmt'),
	star: () => converted('star', 'star'),
	synth: () => converted('synth', 'synth'),
	owner: () => converted('owner', 'owner'),
	fsl30: () => converted('fsl30', 'fsl30'),
	grid: () => converted('grid', 'grid'),
	drumloop101: () => converted('drumloop101', 'drumloop101'),
	gmd: () => converted('gmd', 'gmd'),
	mdbpp: () => converted('mdb-drums-pp', 'mdbpp'),
	library: () => converted('library', 'library')
};

function corpusNames(): string[] {
	return Object.keys(ADAPTERS);
}

/** `select` is a list of corpus names or corpus:substring filters, e.g. mdb:Disco. */
export function tracks(select: readonly string[] = []): CorpusTrack[] {
	const wanted = select.length ? select : corpusNames();
	const out: CorpusTrack[] = [];
	for (const corpus of corpusNames()) {
		const filters = wanted.filter((w) => w === corpus || w.startsWith(`${corpus}:`)).map((w) => w.slice(corpus.length + 1));
		if (filters.length === 0) continue;
		for (const track of ADAPTERS[corpus]()) {
			if (filters.some((f) => f === '' || track.name.includes(f))) out.push(track);
		}
	}
	return out;
}

export function referenceTimes(track: CorpusTrack, cls: DrumClass, includeOptional = true): number[] {
	return track.events.filter((e) => e.cls === cls && (includeOptional || !e.optional)).map((e) => e.time).sort((a, b) => a - b);
}

export const trackKey = (track: Pick<CorpusTrack, 'corpus' | 'name'>) => `${track.corpus}/${track.name}`;
