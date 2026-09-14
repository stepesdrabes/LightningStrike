import type { GenreFamily } from '@mv/core';
import { signatureOf, titleKeyOf } from '../queueModel.ts';

/** What the planner knows about one library track. */
export interface LibraryTrack {
	id: string;
	title: string;
	artist: string;
	thumbnail: string;
	source: string;
	/** Seconds; 0 when unknown. */
	duration: number;
	/** Analysed and composed at this build's versions, so it plays without preparing. */
	ready: boolean;
	genre: GenreFamily | null;
	bpm: number | null;
	/** Cross-track heat, 1 still to 5 peak. */
	heat: number;
	loungeOnly: boolean;
}

/** What an analysis says about a track's drive, for heat. */
export interface DriveSummary {
	bpm: number;
	integratedLufs: number;
	loudnessRange: number;
	/** Detected kicks per bar in the loud half of the track. */
	kicksPerLoudBar: number;
}

/** Genre carries most of what a room feels as heat; measurements only nudge within it. */
const FAMILY_HEAT: Record<GenreFamily, number> = {
	ambient: 0.05,
	ballad: 0.1,
	rnb: 0.3,
	pop: 0.5,
	hiphop: 0.5,
	latin: 0.55,
	disco: 0.6,
	house: 0.62,
	rock: 0.62,
	trance: 0.75,
	techno: 0.8,
	edm: 0.82,
	punk: 0.85,
	metal: 0.9,
	bass: 0.95
};

const clamp01 = (v: number) => Math.max(0, Math.min(1, v));

/** Heat from 1 to 5, to one decimal. Unanalysed tracks fall back to their family alone. */
export function heatOf(genre: GenreFamily | null, drive: DriveSummary | null): number {
	const family = genre ? FAMILY_HEAT[genre] : 0.5;
	if (!drive) return Math.round((1 + 4 * family) * 10) / 10;
	// A half-time rap reading still has its hats at double speed.
	const felt = drive.bpm < 100 && (genre === 'hiphop' || genre === 'rnb') ? drive.bpm * 1.5 : drive.bpm;
	const tempo = clamp01((felt - 90) / 80);
	const loud = clamp01((drive.integratedLufs + 16) / 10);
	const kick = clamp01(drive.kicksPerLoudBar / 8);
	const dense = clamp01((12 - drive.loudnessRange) / 10);
	const score = 0.55 * family + 0.2 * tempo + 0.1 * loud + 0.1 * kick + 0.05 * dense;
	return Math.round((1 + 4 * clamp01(score)) * 10) / 10;
}

const VERSION_CLAUSE = /\b(?:remix|mix|edit|version|live|remaster(?:ed)?|acoustic|instrumental|slowed|sped)\b/i;

/**
 * Keys one song is known by: its title, and for an upload titled "Act - Song" the song alone,
 * so another upload of a song already in the evening is recognised.
 */
export function songKeysOf(title: string): string[] {
	const keys = new Set([titleKeyOf(title)]);
	const bare = title.replace(/[([{][^)\]}]*[)\]}]/g, ' ');
	const dash = /\s[-\u2013\u2014]\s/.exec(bare);
	if (dash) {
		const song = bare.slice(dash.index + dash[0].length);
		if (!VERSION_CLAUSE.test(song)) keys.add(titleKeyOf(song));
	}
	return [...keys].filter((k) => k.length >= 5);
}

export type SongMatch =
	| { kind: 'found'; track: LibraryTrack }
	| { kind: 'ambiguous'; tracks: LibraryTrack[] }
	| { kind: 'missing' };

/** Find a named song: by id when given, otherwise by title and, if written, artist. */
export function matchSong(
	library: readonly LibraryTrack[],
	title: string,
	by?: string,
	id?: string
): SongMatch {
	if (id) {
		const track = library.find((t) => t.id === id);
		return track ? { kind: 'found', track } : { kind: 'missing' };
	}
	const key = titleKeyOf(title);
	const byKey = by ? signatureOf(by, title) : null;
	const exact = library.filter((t) => titleKeyOf(t.title) === key || titleKeyOf(`${t.artist} - ${t.title}`) === key);
	const narrowed = byKey ? exact.filter((t) => signatureOf(t.artist, t.title) === byKey) : exact;
	const hits = narrowed.length > 0 ? narrowed : byKey ? [] : exact;
	if (hits.length === 1) return { kind: 'found', track: hits[0] };
	if (hits.length > 1) return { kind: 'ambiguous', tracks: hits };
	// A title written with its act in front, or an upload title with extra words.
	const loose = library.filter((t) => {
		const full = titleKeyOf(`${t.artist} ${t.title}`);
		return key.length >= 4 && (full.includes(key) || titleKeyOf(t.title).includes(key));
	});
	const looseBy = byKey ? loose.filter((t) => signatureOf(t.artist, t.title) === byKey) : loose;
	if (looseBy.length === 1) return { kind: 'found', track: looseBy[0] };
	if (looseBy.length > 1) return { kind: 'ambiguous', tracks: looseBy };
	return { kind: 'missing' };
}
