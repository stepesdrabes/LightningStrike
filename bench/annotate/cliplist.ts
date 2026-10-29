// A clip list: audio files and where in each a clip starts, for clips from outside the library.
//
// [{ "file": "brushes/song.mp3", "start": 63.2, "id": "song", "tags": ["jazz", "heldOut"],
//    "title": "Song", "artist": "Band", "genre": "jazz", "seconds": 30, "align": true }]
//
// Only `file` and `start` are required; a relative file is read from the list's folder. A listed
// clip is for validation, so its review starts empty unless the entry says `"prefill": true`.
import { readFileSync } from 'node:fs';
import { basename, dirname, extname, resolve } from 'node:path';

export interface ListedClip {
	id: string;
	file: string;
	start: number;
	tags: string[];
	title: string;
	artist: string;
	genre: string;
	seconds?: number;
	align?: boolean;
	/** Whether its review starts from Striker's hits: false unless the entry asks. */
	prefill: boolean;
}

/** The server saves a review under its clip id, so an id is a file-safe word. */
export const CLIP_ID = /^[\w.-]+$/;

/** A listed clip's id when the list names none: the file's name and the start, to 0.1 s. */
export function defaultId(file: string, start: number): string {
	const name = basename(file, extname(file)).replace(/[^\w.-]+/g, '_').replace(/^_+|_+$/g, '');
	return `${name || 'clip'}__${start.toFixed(1)}s`;
}

export function readClipList(path: string): ListedClip[] {
	const json = JSON.parse(readFileSync(path, 'utf8')) as unknown;
	if (!Array.isArray(json)) throw new Error(`${path}: a clip list is a JSON array`);
	const seen = new Set<string>();
	return json.map((entry: Record<string, unknown>, i) => {
		const what = `${path} entry ${i}`;
		if (typeof entry.file !== 'string' || !entry.file) throw new Error(`${what}: no file`);
		const start = entry.start;
		if (typeof start !== 'number' || !Number.isFinite(start) || start < 0) {
			throw new Error(`${what}: start is ${JSON.stringify(start)}, not seconds`);
		}
		const file = resolve(dirname(path), entry.file);
		const id = typeof entry.id === 'string' ? entry.id : defaultId(file, start);
		if (!CLIP_ID.test(id)) {
			throw new Error(`${what}: the id ${JSON.stringify(id)} is not a file-safe word`);
		}
		if (seen.has(id)) throw new Error(`${what}: the id ${id} is listed twice`);
		seen.add(id);
		const tags = Array.isArray(entry.tags) ? entry.tags.map(String) : [];
		const text = (key: string, fallback: string) => {
			const value = entry[key];
			return typeof value === 'string' ? value : fallback;
		};
		const seconds = entry.seconds;
		if (seconds !== undefined && (typeof seconds !== 'number' || !(seconds > 0))) {
			throw new Error(`${what}: seconds is ${JSON.stringify(seconds)}`);
		}
		return {
			id, file, start, tags, title: text('title', basename(file, extname(file))),
			artist: text('artist', ''), genre: text('genre', tags[0] ?? ''),
			prefill: entry.prefill === true,
			...(seconds !== undefined ? { seconds } : {}),
			...(typeof entry.align === 'boolean' ? { align: entry.align } : {})
		};
	});
}
