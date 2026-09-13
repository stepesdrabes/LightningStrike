import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ANALYSIS_RATE } from './decode.ts';
import { MEL_BANDS, melSpectrogram96, resampleTo16k } from './dsp/mel.ts';
import { QUIET_THREADS, openSession, type OnnxSession, type OnnxTensor } from './onnxSession.ts';
import { MODEL_DIR } from './paths.ts';

/**
 * Discogs-EffNet (MTG/UPF): 400 style activations feed mapGenres. Weights are CC BY-NC-SA 4.0
 * for non-commercial use. The 16 kHz frontend constants in dsp/mel.ts are model contracts.
 */

const MODEL_NAME = 'discogs-effnet-bsdynamic-1.onnx';
const MODEL_URL = `https://essentia.upf.edu/models/feature-extractors/discogs-effnet/${MODEL_NAME}`;
const MODEL_BYTES = 18027718;
/** Digest computed from the 2026-08-10 download; pin later fetches to the measured model bytes. */
const MODEL_SHA256 = 'a280825b334797cf677939db8cd5762c0392aedd0ca6415dbc1cd083f045e43c';

const STYLE_COUNT = 400;
/** 128 frames x 96 bands per patch, hopped 62 frames: the geometry the model was trained on. */
const PATCH_FRAMES = 128;
const PATCH_HOP = 62;
/** Cap classification duration to bound resampling, mel, and inference costs. */
const MAX_SECONDS = 180;
/** Ten keeps the result readable for a vote; the other 390 heads are noise floor. */
const TOP_COUNT = 10;

/** The 400 styles in graph output order, from genre_discogs400-discogs-effnet-1.json. */
const GENRE_STYLES: readonly string[] = [
	'Blues---Boogie Woogie',
	'Blues---Chicago Blues',
	'Blues---Country Blues',
	'Blues---Delta Blues',
	'Blues---Electric Blues',
	'Blues---Harmonica Blues',
	'Blues---Jump Blues',
	'Blues---Louisiana Blues',
	'Blues---Modern Electric Blues',
	'Blues---Piano Blues',
	'Blues---Rhythm & Blues',
	'Blues---Texas Blues',
	'Brass & Military---Brass Band',
	'Brass & Military---Marches',
	'Brass & Military---Military',
	'Children\'s---Educational',
	'Children\'s---Nursery Rhymes',
	'Children\'s---Story',
	'Classical---Baroque',
	'Classical---Choral',
	'Classical---Classical',
	'Classical---Contemporary',
	'Classical---Impressionist',
	'Classical---Medieval',
	'Classical---Modern',
	'Classical---Neo-Classical',
	'Classical---Neo-Romantic',
	'Classical---Opera',
	'Classical---Post-Modern',
	'Classical---Renaissance',
	'Classical---Romantic',
	'Electronic---Abstract',
	'Electronic---Acid',
	'Electronic---Acid House',
	'Electronic---Acid Jazz',
	'Electronic---Ambient',
	'Electronic---Bassline',
	'Electronic---Beatdown',
	'Electronic---Berlin-School',
	'Electronic---Big Beat',
	'Electronic---Bleep',
	'Electronic---Breakbeat',
	'Electronic---Breakcore',
	'Electronic---Breaks',
	'Electronic---Broken Beat',
	'Electronic---Chillwave',
	'Electronic---Chiptune',
	'Electronic---Dance-pop',
	'Electronic---Dark Ambient',
	'Electronic---Darkwave',
	'Electronic---Deep House',
	'Electronic---Deep Techno',
	'Electronic---Disco',
	'Electronic---Disco Polo',
	'Electronic---Donk',
	'Electronic---Downtempo',
	'Electronic---Drone',
	'Electronic---Drum n Bass',
	'Electronic---Dub',
	'Electronic---Dub Techno',
	'Electronic---Dubstep',
	'Electronic---Dungeon Synth',
	'Electronic---EBM',
	'Electronic---Electro',
	'Electronic---Electro House',
	'Electronic---Electroclash',
	'Electronic---Euro House',
	'Electronic---Euro-Disco',
	'Electronic---Eurobeat',
	'Electronic---Eurodance',
	'Electronic---Experimental',
	'Electronic---Freestyle',
	'Electronic---Future Jazz',
	'Electronic---Gabber',
	'Electronic---Garage House',
	'Electronic---Ghetto',
	'Electronic---Ghetto House',
	'Electronic---Glitch',
	'Electronic---Goa Trance',
	'Electronic---Grime',
	'Electronic---Halftime',
	'Electronic---Hands Up',
	'Electronic---Happy Hardcore',
	'Electronic---Hard House',
	'Electronic---Hard Techno',
	'Electronic---Hard Trance',
	'Electronic---Hardcore',
	'Electronic---Hardstyle',
	'Electronic---Hi NRG',
	'Electronic---Hip Hop',
	'Electronic---Hip-House',
	'Electronic---House',
	'Electronic---IDM',
	'Electronic---Illbient',
	'Electronic---Industrial',
	'Electronic---Italo House',
	'Electronic---Italo-Disco',
	'Electronic---Italodance',
	'Electronic---Jazzdance',
	'Electronic---Juke',
	'Electronic---Jumpstyle',
	'Electronic---Jungle',
	'Electronic---Latin',
	'Electronic---Leftfield',
	'Electronic---Makina',
	'Electronic---Minimal',
	'Electronic---Minimal Techno',
	'Electronic---Modern Classical',
	'Electronic---Musique Concrète',
	'Electronic---Neofolk',
	'Electronic---New Age',
	'Electronic---New Beat',
	'Electronic---New Wave',
	'Electronic---Noise',
	'Electronic---Nu-Disco',
	'Electronic---Power Electronics',
	'Electronic---Progressive Breaks',
	'Electronic---Progressive House',
	'Electronic---Progressive Trance',
	'Electronic---Psy-Trance',
	'Electronic---Rhythmic Noise',
	'Electronic---Schranz',
	'Electronic---Sound Collage',
	'Electronic---Speed Garage',
	'Electronic---Speedcore',
	'Electronic---Synth-pop',
	'Electronic---Synthwave',
	'Electronic---Tech House',
	'Electronic---Tech Trance',
	'Electronic---Techno',
	'Electronic---Trance',
	'Electronic---Tribal',
	'Electronic---Tribal House',
	'Electronic---Trip Hop',
	'Electronic---Tropical House',
	'Electronic---UK Garage',
	'Electronic---Vaporwave',
	'Folk, World, & Country---African',
	'Folk, World, & Country---Bluegrass',
	'Folk, World, & Country---Cajun',
	'Folk, World, & Country---Canzone Napoletana',
	'Folk, World, & Country---Catalan Music',
	'Folk, World, & Country---Celtic',
	'Folk, World, & Country---Country',
	'Folk, World, & Country---Fado',
	'Folk, World, & Country---Flamenco',
	'Folk, World, & Country---Folk',
	'Folk, World, & Country---Gospel',
	'Folk, World, & Country---Highlife',
	'Folk, World, & Country---Hillbilly',
	'Folk, World, & Country---Hindustani',
	'Folk, World, & Country---Honky Tonk',
	'Folk, World, & Country---Indian Classical',
	'Folk, World, & Country---Laïkó',
	'Folk, World, & Country---Nordic',
	'Folk, World, & Country---Pacific',
	'Folk, World, & Country---Polka',
	'Folk, World, & Country---Raï',
	'Folk, World, & Country---Romani',
	'Folk, World, & Country---Soukous',
	'Folk, World, & Country---Séga',
	'Folk, World, & Country---Volksmusik',
	'Folk, World, & Country---Zouk',
	'Folk, World, & Country---Éntekhno',
	'Funk / Soul---Afrobeat',
	'Funk / Soul---Boogie',
	'Funk / Soul---Contemporary R&B',
	'Funk / Soul---Disco',
	'Funk / Soul---Free Funk',
	'Funk / Soul---Funk',
	'Funk / Soul---Gospel',
	'Funk / Soul---Neo Soul',
	'Funk / Soul---New Jack Swing',
	'Funk / Soul---P.Funk',
	'Funk / Soul---Psychedelic',
	'Funk / Soul---Rhythm & Blues',
	'Funk / Soul---Soul',
	'Funk / Soul---Swingbeat',
	'Funk / Soul---UK Street Soul',
	'Hip Hop---Bass Music',
	'Hip Hop---Boom Bap',
	'Hip Hop---Bounce',
	'Hip Hop---Britcore',
	'Hip Hop---Cloud Rap',
	'Hip Hop---Conscious',
	'Hip Hop---Crunk',
	'Hip Hop---Cut-up/DJ',
	'Hip Hop---DJ Battle Tool',
	'Hip Hop---Electro',
	'Hip Hop---G-Funk',
	'Hip Hop---Gangsta',
	'Hip Hop---Grime',
	'Hip Hop---Hardcore Hip-Hop',
	'Hip Hop---Horrorcore',
	'Hip Hop---Instrumental',
	'Hip Hop---Jazzy Hip-Hop',
	'Hip Hop---Miami Bass',
	'Hip Hop---Pop Rap',
	'Hip Hop---Ragga HipHop',
	'Hip Hop---RnB/Swing',
	'Hip Hop---Screw',
	'Hip Hop---Thug Rap',
	'Hip Hop---Trap',
	'Hip Hop---Trip Hop',
	'Hip Hop---Turntablism',
	'Jazz---Afro-Cuban Jazz',
	'Jazz---Afrobeat',
	'Jazz---Avant-garde Jazz',
	'Jazz---Big Band',
	'Jazz---Bop',
	'Jazz---Bossa Nova',
	'Jazz---Contemporary Jazz',
	'Jazz---Cool Jazz',
	'Jazz---Dixieland',
	'Jazz---Easy Listening',
	'Jazz---Free Improvisation',
	'Jazz---Free Jazz',
	'Jazz---Fusion',
	'Jazz---Gypsy Jazz',
	'Jazz---Hard Bop',
	'Jazz---Jazz-Funk',
	'Jazz---Jazz-Rock',
	'Jazz---Latin Jazz',
	'Jazz---Modal',
	'Jazz---Post Bop',
	'Jazz---Ragtime',
	'Jazz---Smooth Jazz',
	'Jazz---Soul-Jazz',
	'Jazz---Space-Age',
	'Jazz---Swing',
	'Latin---Afro-Cuban',
	'Latin---Baião',
	'Latin---Batucada',
	'Latin---Beguine',
	'Latin---Bolero',
	'Latin---Boogaloo',
	'Latin---Bossanova',
	'Latin---Cha-Cha',
	'Latin---Charanga',
	'Latin---Compas',
	'Latin---Cubano',
	'Latin---Cumbia',
	'Latin---Descarga',
	'Latin---Forró',
	'Latin---Guaguancó',
	'Latin---Guajira',
	'Latin---Guaracha',
	'Latin---MPB',
	'Latin---Mambo',
	'Latin---Mariachi',
	'Latin---Merengue',
	'Latin---Norteño',
	'Latin---Nueva Cancion',
	'Latin---Pachanga',
	'Latin---Porro',
	'Latin---Ranchera',
	'Latin---Reggaeton',
	'Latin---Rumba',
	'Latin---Salsa',
	'Latin---Samba',
	'Latin---Son',
	'Latin---Son Montuno',
	'Latin---Tango',
	'Latin---Tejano',
	'Latin---Vallenato',
	'Non-Music---Audiobook',
	'Non-Music---Comedy',
	'Non-Music---Dialogue',
	'Non-Music---Education',
	'Non-Music---Field Recording',
	'Non-Music---Interview',
	'Non-Music---Monolog',
	'Non-Music---Poetry',
	'Non-Music---Political',
	'Non-Music---Promotional',
	'Non-Music---Radioplay',
	'Non-Music---Religious',
	'Non-Music---Spoken Word',
	'Pop---Ballad',
	'Pop---Bollywood',
	'Pop---Bubblegum',
	'Pop---Chanson',
	'Pop---City Pop',
	'Pop---Europop',
	'Pop---Indie Pop',
	'Pop---J-pop',
	'Pop---K-pop',
	'Pop---Kayōkyoku',
	'Pop---Light Music',
	'Pop---Music Hall',
	'Pop---Novelty',
	'Pop---Parody',
	'Pop---Schlager',
	'Pop---Vocal',
	'Reggae---Calypso',
	'Reggae---Dancehall',
	'Reggae---Dub',
	'Reggae---Lovers Rock',
	'Reggae---Ragga',
	'Reggae---Reggae',
	'Reggae---Reggae-Pop',
	'Reggae---Rocksteady',
	'Reggae---Roots Reggae',
	'Reggae---Ska',
	'Reggae---Soca',
	'Rock---AOR',
	'Rock---Acid Rock',
	'Rock---Acoustic',
	'Rock---Alternative Rock',
	'Rock---Arena Rock',
	'Rock---Art Rock',
	'Rock---Atmospheric Black Metal',
	'Rock---Avantgarde',
	'Rock---Beat',
	'Rock---Black Metal',
	'Rock---Blues Rock',
	'Rock---Brit Pop',
	'Rock---Classic Rock',
	'Rock---Coldwave',
	'Rock---Country Rock',
	'Rock---Crust',
	'Rock---Death Metal',
	'Rock---Deathcore',
	'Rock---Deathrock',
	'Rock---Depressive Black Metal',
	'Rock---Doo Wop',
	'Rock---Doom Metal',
	'Rock---Dream Pop',
	'Rock---Emo',
	'Rock---Ethereal',
	'Rock---Experimental',
	'Rock---Folk Metal',
	'Rock---Folk Rock',
	'Rock---Funeral Doom Metal',
	'Rock---Funk Metal',
	'Rock---Garage Rock',
	'Rock---Glam',
	'Rock---Goregrind',
	'Rock---Goth Rock',
	'Rock---Gothic Metal',
	'Rock---Grindcore',
	'Rock---Grunge',
	'Rock---Hard Rock',
	'Rock---Hardcore',
	'Rock---Heavy Metal',
	'Rock---Indie Rock',
	'Rock---Industrial',
	'Rock---Krautrock',
	'Rock---Lo-Fi',
	'Rock---Lounge',
	'Rock---Math Rock',
	'Rock---Melodic Death Metal',
	'Rock---Melodic Hardcore',
	'Rock---Metalcore',
	'Rock---Mod',
	'Rock---Neofolk',
	'Rock---New Wave',
	'Rock---No Wave',
	'Rock---Noise',
	'Rock---Noisecore',
	'Rock---Nu Metal',
	'Rock---Oi',
	'Rock---Parody',
	'Rock---Pop Punk',
	'Rock---Pop Rock',
	'Rock---Pornogrind',
	'Rock---Post Rock',
	'Rock---Post-Hardcore',
	'Rock---Post-Metal',
	'Rock---Post-Punk',
	'Rock---Power Metal',
	'Rock---Power Pop',
	'Rock---Power Violence',
	'Rock---Prog Rock',
	'Rock---Progressive Metal',
	'Rock---Psychedelic Rock',
	'Rock---Psychobilly',
	'Rock---Pub Rock',
	'Rock---Punk',
	'Rock---Rock & Roll',
	'Rock---Rockabilly',
	'Rock---Shoegaze',
	'Rock---Ska',
	'Rock---Sludge Metal',
	'Rock---Soft Rock',
	'Rock---Southern Rock',
	'Rock---Space Rock',
	'Rock---Speed Metal',
	'Rock---Stoner Rock',
	'Rock---Surf',
	'Rock---Symphonic Rock',
	'Rock---Technical Death Metal',
	'Rock---Thrash',
	'Rock---Twist',
	'Rock---Viking Metal',
	'Rock---Yé-Yé',
	'Stage & Screen---Musical',
	'Stage & Screen---Score',
	'Stage & Screen---Soundtrack',
	'Stage & Screen---Theme',
];

export function genreModelPresent(): boolean {
	return existsSync(join(MODEL_DIR, MODEL_NAME));
}

export async function ensureGenreModel(): Promise<void> {
	mkdirSync(MODEL_DIR, { recursive: true });
	const path = join(MODEL_DIR, MODEL_NAME);
	if (existsSync(path)) {
		const have = createHash('sha256').update(readFileSync(path)).digest('hex');
		if (have === MODEL_SHA256) return;
	}

	// Bounded, because this runs inside the ingest queue: a connection that neither answers
	// nor dies would wedge every later track behind it until a restart.
	const res = await fetch(MODEL_URL, { signal: AbortSignal.timeout(120_000) });
	if (!res.ok) throw new Error(`${MODEL_NAME}: ${res.status} ${res.statusText}`);
	const buf = Buffer.from(await res.arrayBuffer());
	if (buf.byteLength !== MODEL_BYTES) {
		throw new Error(`${MODEL_NAME}: ${buf.byteLength} bytes, expected ${MODEL_BYTES}`);
	}
	const got = createHash('sha256').update(buf).digest('hex');
	if (got !== MODEL_SHA256) {
		throw new Error(`${MODEL_NAME}: sha256 ${got}, expected ${MODEL_SHA256}`);
	}
	// Temporary name plus rename, so an interrupted download cannot pass the existence check.
	const tmp = `${path}.part`;
	writeFileSync(tmp, buf);
	renameSync(tmp, path);
}

interface GenreActivation {
	label: string;
	/** Sigmoid activation 0..1. The 400 heads are independent, so scores do not sum to one. */
	score: number;
}

interface AudioGenreResult {
	/** Top style activations, mean-pooled over patches, descending. */
	top: GenreActivation[];
}

export class GenreClassifier {
	private session!: OnnxSession;
	private inputName!: string;
	private rank4 = false;

	static async create(): Promise<GenreClassifier> {
		if (!genreModelPresent()) await ensureGenreModel();
		const session = await openSession(join(MODEL_DIR, MODEL_NAME), {
			executionProviders: ['cpu'],
			graphOptimizationLevel: 'all',
			...QUIET_THREADS
		});

		// Essentia's own conversions call this 'serving_default_melspectrogram'; the dynamic
		// batch one trims the TF serving prefix to plain 'melspectrogram'. Match the suffix,
		// and fail loudly if the graph is not the expected one.
		const input = session.inputNames.find((n) => n.endsWith('melspectrogram'));
		if (!input) {
			await session.release();
			throw new Error(`no melspectrogram input, graph has: ${session.inputNames.join(', ')}`);
		}

		const self = new GenreClassifier();
		self.session = session;
		self.inputName = input;
		// Some conversions keep a channel axis, [n, 1, 128, 96]: same bytes, one more dim.
		const shape = session.inputMetadata?.find((m) => m.name === input)?.shape;
		self.rank4 = shape?.length === 4;
		return self;
	}

	async close(): Promise<void> {
		await this.session.release();
	}

	/** `mono22k` is mono at 22050 Hz; only the first three minutes are read. */
	async run(mono22k: Float32Array): Promise<AudioGenreResult> {
		const cap = MAX_SECONDS * ANALYSIS_RATE;
		const mono16k = resampleTo16k(mono22k.length > cap ? mono22k.subarray(0, cap) : mono22k);
		const { frames, data } = melSpectrogram96(mono16k);

		// A track shorter than one patch zero-pads up to it rather than failing; otherwise
		// the trailing partial patch is discarded, matching Essentia's patch cutter.
		const n = frames >= PATCH_FRAMES ? 1 + Math.floor((frames - PATCH_FRAMES) / PATCH_HOP) : 1;
		const patchLen = PATCH_FRAMES * MEL_BANDS;
		const batch = new Float32Array(n * patchLen);
		for (let p = 0; p < n; p++) {
			const src = p * PATCH_HOP * MEL_BANDS;
			batch.set(data.subarray(src, Math.min(src + patchLen, data.length)), p * patchLen);
		}

		const dims = this.rank4 ? [n, 1, PATCH_FRAMES, MEL_BANDS] : [n, PATCH_FRAMES, MEL_BANDS];
		const out = await this.session.run({ [this.inputName]: { data: batch, dims } }, { transfer: true });

		// Resolved by shape rather than name: the activations head is the [n, 400] output,
		// and the [n, 1280] one is the embedding this module has no use for.
		let acts: OnnxTensor | null = null;
		for (const name of Object.keys(out)) {
			if (out[name].dims[out[name].dims.length - 1] === STYLE_COUNT) acts = out[name];
		}
		if (!acts) throw new Error(`no [n, ${STYLE_COUNT}] output in the genre graph`);

		const sum = new Float64Array(STYLE_COUNT);
		for (let p = 0; p < n; p++) {
			for (let s = 0; s < STYLE_COUNT; s++) sum[s] += acts.data[p * STYLE_COUNT + s];
		}

		const order = Array.from({ length: STYLE_COUNT }, (_, i) => i);
		order.sort((a, b) => sum[b] - sum[a]);
		const top = order.slice(0, TOP_COUNT).map((i) => ({
			label: GENRE_STYLES[i],
			score: sum[i] / n
		}));
		return { top };
	}
}
