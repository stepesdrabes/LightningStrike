import { spawn } from 'node:child_process';
import { ingest } from '@mv/analysis';

/**
 * Download and analyse a corpus into `MV_CACHE_DIR`. Every entry names its YouTube id
 * outright where one is known, so the track ingested is the one that was listened to and
 * chosen, not whatever a search ranks first on the day; a `query` is resolved with yt-dlp
 * for the rest. The list below is the 2026-09-09 addition to review corpus 3, the owner's
 * last analysis corpus: current hits across the families they judge, plus the structures
 * the sixty-five did not hold (a 6/8 ballad, a three-part song with tempo changes, garage's
 * swing, hard techno at 155, jump-up at 174, a drum-and-bass verse under a rock chorus).
 * The original tuning corpus this bench fetched in 2026-08 lives in git history.
 *
 * Serial on purpose: the beat tracker is an ONNX graph that takes every core it is offered,
 * so two at once is slower than the same two in sequence.
 */
const TRACKS: { id?: string; query?: string; note?: string }[] = [
	// Current hits, September 2026
	{ id: 'v1t4MTqdfyI', note: 'Ariana Grande, hate that i made you love me: the most streamed song of summer 2026' },
	{ id: 'hLOheGDwD_0', note: 'Ella Langley, Choosin Texas: 21 weeks at Hot 100 number one, the first country track in the corpus' },
	{ id: 'X9CsK_nuqdE', note: 'Shakira and Burna Boy, Dai Dai: the 2026 World Cup song, latin over afrobeats' },
	{ id: 'yynqCKDI7kQ', note: 'Yung Miami, Spend Dat: the summer\'s viral rap dance' },
	{ id: 'h5u4dKq8C2w', note: 'Drake, Janice STFU: 2026 Drake' },
	{ id: '3triLkS0nq4', note: 'Sam Fender and Olivia Dean, Rein Me In: 75 days at UK number one, five and a half minutes' },
	{ id: 'k7JitOG5wVo', note: 'BLACKPINK, GO: 2026 K-pop, the section-dense form' },
	{ id: 'SOJpE1KMUbo', note: 'Dave and Tems, Raindance: afrobeats under UK rap' },
	{ id: '9OBPTq-NgL0', note: 'Saul and Hasan with Yzomandias, Nejsem sam: Czech rap, 2026' },
	{ id: 'jojRxf2qvqs', note: 'Yzomandias, Melanz: the owner queued it themselves on 2026-09-09' },
	// Club
	{ id: 'rjXMBZJo-VA', note: 'Green Velvet and MEDUZA, La La Land: 2026 tech house' },
	{ id: 'tkFceKEWnqg', note: 'Sammy Virji and Issey Cross, Nostalgia: UK garage, the swung two-step the corpus never had' },
	{ id: 'j8VRLPa1za4', note: 'Sara Landry and Alt8, Hands Up: hard techno at 155, June 2026' },
	{ id: 'mbWOIqlrqFU', note: 'Hedex, MHITR: jump-up drum and bass at 174 that still owns 2026 sets' },
	// Rock and metal
	{ id: 'MEb49Q9ZRGo', note: 'Lamb of God, Sepsis: 2026 metal' },
	{ id: 'JxlnKVj2IWA', note: 'Poppy, Unravel: drum-and-bass verses under rock choruses, a double-time switch' },
	// Structures the corpus did not hold
	{ id: 'iKzRIweSBLA', note: 'Ed Sheeran, Perfect: a 6/8 ballad whose kit arrives late' },
	{ id: 'Lt8AfIeJOxw', note: 'Radiohead, Paranoid Android: three parts, tempo and meter changes' }
];

function resolveId(query: string): Promise<string | null> {
	return new Promise((resolve) => {
		const child = spawn('yt-dlp', [
			`ytsearch1:${query}`,
			'--flat-playlist',
			'--dump-json',
			'--no-warnings'
		]);
		let out = '';
		child.stdout.on('data', (d: Buffer) => (out += d.toString()));
		child.on('close', () => {
			try {
				resolve(String(JSON.parse(out.split('\n')[0]).id ?? '') || null);
			} catch {
				resolve(null);
			}
		});
		child.on('error', () => resolve(null));
	});
}

let done = 0;
for (const track of TRACKS) {
	const at = `[${++done}/${TRACKS.length}]`;
	const label = track.note ?? track.query ?? track.id ?? '?';
	try {
		const id = track.id ?? (track.query ? await resolveId(track.query) : null);
		if (!id) {
			console.log(`${at} ${label}: search failed`);
			continue;
		}
		const result = await ingest(`https://www.youtube.com/watch?v=${id}`, {
			onProgress: (stage) => console.log(`${at} ${label}: ${stage}`)
		});
		console.log(
			`${at} ${label} -> ${result.id} ${result.fromCache ? '(cached)' : ''} ` +
				`${result.analysis.tempo.bpm} bpm, ${result.analysis.sections.length} sections`
		);
	} catch (e) {
		console.log(`${at} ${label}: ${(e as Error).message.split('\n')[0]}`);
	}
}
console.log('corpus fetch complete');
