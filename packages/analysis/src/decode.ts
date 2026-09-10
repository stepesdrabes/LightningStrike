import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';

export interface DecodedAudio {
	mono: Float32Array;
	/** Interleaved is avoided on purpose: every consumer wants one side at a time. */
	left: Float32Array;
	right: Float32Array;
	sampleRate: number;
	duration: number;
	/** Of the decoded PCM, so the same file always hashes the same. */
	hash: string;
}

/**
 * 22.05 kHz. Halving the rate halves every spectral pass and, at a fixed window length,
 * doubles the frequency resolution where it is scarce: a 2048-point window puts bins 10.8 Hz
 * apart rather than 21.5, which is the difference between four and eight of them between
 * 20 and 100 Hz. What is lost is everything above 11 kHz, which is cymbal shimmer rather
 * than cymbal attack, and which a lossy source has usually thrown away already.
 */
export const ANALYSIS_RATE = 22050;

function run(cmd: string, args: string[]): Promise<{ stdout: Buffer; stderr: string }> {
	return new Promise((resolve, reject) => {
		const child = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'] });
		const out: Buffer[] = [];
		let err = '';
		child.stdout.on('data', (d: Buffer) => out.push(d));
		child.stderr.on('data', (d: Buffer) => (err += d.toString()));
		child.on('error', (e) =>
			reject(new Error(`${cmd} failed to start (is it installed?): ${e.message}`))
		);
		child.on('close', (code) => {
			if (code !== 0) reject(new Error(`${cmd} exited ${code}: ${err.slice(-2000)}`));
			else resolve({ stdout: Buffer.concat(out), stderr: err });
		});
	});
}

/**
 * Decode to f32 at the analysis rate, keeping both channels.
 *
 * Stereo is kept because where a sound sits across the room is a thing the show can use, and
 * it is the one property that a mono downmix destroys rather than merely blurs. The mono sum
 * every other stage works from is derived here rather than asked of ffmpeg, so the two can
 * never disagree.
 *
 * Deliberately does not ask for soxr. It resamples better, but it is a separate library that
 * a stock Homebrew ffmpeg is not built with, and naming an unavailable engine is a hard error
 * rather than a fallback. The built-in resampler is what every accuracy figure in this package
 * was measured through; `filter_size` buys a longer kernel from it for nothing.
 *
 */
export async function decodeAudio(path: string, sampleRate = ANALYSIS_RATE): Promise<DecodedAudio> {
	const { stdout } = await run('ffmpeg', [
		'-nostdin',
		'-hide_banner',
		'-loglevel',
		'error',
		'-i',
		path,
		'-af',
		`aresample=${sampleRate}:filter_size=64:cutoff=0.98`,
		'-ac',
		'2',
		'-f',
		'f32le',
		'-'
	]);

	const hash = createHash('sha256').update(stdout).digest('hex').slice(0, 16);
	// Buffer.concat can land on any byte offset, and a Float32Array view demands a multiple
	// of four, so the copy is not optional.
	const frames = Math.floor(stdout.byteLength / 8);
	const left = new Float32Array(frames);
	const right = new Float32Array(frames);
	const mono = new Float32Array(frames);
	for (let i = 0; i < frames; i++) {
		const l = stdout.readFloatLE(i * 8);
		const r = stdout.readFloatLE(i * 8 + 4);
		left[i] = l;
		right[i] = r;
		mono[i] = (l + r) * 0.5;
	}

	return { mono, left, right, sampleRate, duration: frames / sampleRate, hash };
}

export interface ProbeResult {
	id: string;
	title: string;
	uploader: string;
	duration: number;
	thumbnail: string;
	webpageUrl: string;
	/** From YouTube's music card or a Topic upload; authoritative when present. */
	artist?: string;
	track?: string;
	channel?: string;
	tags?: string[];
}

/**
 * yt-dlp failures that clear on their own, against the ones that never will.
 *
 * YouTube answers 403 to a share of requests under no discernible pattern: of fifty tracks
 * fetched in one sitting, twelve failed this way and a plain re-run recovered seven of them.
 * A permanent refusal looks nothing like it - a private, removed or region-locked video says
 * so - and retrying those three times only delays the queue by the length of two more
 * downloads. The permanent list is checked first, because a takedown notice can carry a 403.
 */
const PERMANENT =
	/Video unavailable|Private video|removed by the uploader|members-only|Sign in to confirm|not available in your country|account associated with this video has been terminated|violat|copyright|age-restricted|requested format is not available|out of date/i;
const TRANSIENT =
	/HTTP Error 403|HTTP Error 429|HTTP Error 5\d\d|Unable to download (?:webpage|API page|JSON)|timed out|timeout|Connection reset|Remote end closed|temporarily unavailable|EOF occurred|handshake|Network is unreachable|getaddrinfo/i;

/** Whether a failed fetch is worth asking for again. Shared with the queue, so the two agree. */
export function isTransientFetchError(message: string): boolean {
	return !PERMANENT.test(message) && TRANSIENT.test(message);
}

/** How a caller is told a fetch is being tried again, so a row can say so rather than hang. */
export type RetryNote = (attempt: number, of: number, reason: string) => void;

const ATTEMPTS = 3;
/** Short: a 403 clears in seconds or not at all, and the queue is waiting behind this. */
const BACKOFF_MS = [1500, 4000];

/**
 * How old a yt-dlp may be before its refusals are read as its own rather than YouTube's.
 *
 * Releases are date-stamped, so the age is legible from the binary itself and costs no network
 * call to learn. Set beyond the usual release cadence so a quiet month upstream is not blamed
 * on the install.
 */
const STALE_AFTER_DAYS = 45;

const VERSION_DATE = /^(\d{4})\.(\d{1,2})\.(\d{1,2})/;

let ytdlpAge: Promise<number | null> | null = null;

/**
 * Days since the installed yt-dlp was released, or null when that cannot be read.
 *
 * Asked once per process and remembered: the answer cannot change while the app runs, and it
 * is consulted on a failure path with the queue already waiting behind it.
 */
function ytdlpAgeDays(): Promise<number | null> {
	ytdlpAge ??= run('yt-dlp', ['--version'])
		.then(({ stdout }) => {
			const m = VERSION_DATE.exec(stdout.toString().trim());
			if (!m) return null;
			const released = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
			return Math.floor((Date.now() - released) / 86_400_000);
		})
		.catch(() => null);
	return ytdlpAge;
}

/**
 * The one refusal that reads as transient and is not: a 403 from a yt-dlp too old to speak
 * YouTube's current player protocol.
 *
 * YouTube moves the client its media URLs are signed for every few months, and a binary from
 * before the move is refused for every track rather than for a share of them. Retrying re-runs
 * an identical command against the same dead client, so the row spends both retry layers - up
 * to nine downloads and a few minutes - to arrive exactly where it started, and reports a
 * mysterious 403 at the end of it. Naming the binary costs one attempt and fixes the night.
 *
 * Only a 403 is read this way. A 429 or a 5xx is YouTube saying "not now" whatever the version
 * is, and those keep their retries.
 */
function staleBinaryNote(days: number): string {
	const upgrade =
		process.platform === 'win32' ? 'winget upgrade yt-dlp.yt-dlp' : 'brew upgrade yt-dlp';
	return (
		`yt-dlp is ${days} days out of date and YouTube is refusing every track it asks for. ` +
		`Run: ${upgrade}`
	);
}

async function withRetry<T>(
	what: () => Promise<T>,
	onRetry: RetryNote | undefined
): Promise<T> {
	for (let attempt = 1; ; attempt++) {
		try {
			return await what();
		} catch (e) {
			const message = e instanceof Error ? e.message : String(e);
			if (/HTTP Error 403/i.test(message) && !PERMANENT.test(message)) {
				const days = await ytdlpAgeDays();
				// The note goes first: both callers cut the report down to its opening line, and
				// the cause is more use there than the symptom.
				if (days !== null && days > STALE_AFTER_DAYS) {
					throw new Error(`${staleBinaryNote(days)}\n${message}`);
				}
			}
			if (attempt >= ATTEMPTS || !isTransientFetchError(message)) throw e;
			onRetry?.(attempt, ATTEMPTS, message);
			await new Promise((r) => setTimeout(r, BACKOFF_MS[attempt - 1] ?? 4000));
		}
	}
}

export async function probe(url: string, onRetry?: RetryNote): Promise<ProbeResult> {
	const { stdout } = await withRetry(
		() => run('yt-dlp', ['--no-playlist', '--skip-download', '--dump-single-json', '--no-warnings', url]),
		onRetry
	);
	const j = JSON.parse(stdout.toString()) as Record<string, unknown>;
	return {
		id: String(j.id ?? ''),
		title: String(j.title ?? 'Unknown'),
		uploader: String(j.uploader ?? ''),
		duration: Number(j.duration ?? 0),
		thumbnail: String(j.thumbnail ?? ''),
		webpageUrl: String(j.webpage_url ?? ''),
		artist: j.artist ? String(j.artist) : undefined,
		track: j.track ? String(j.track) : undefined,
		channel: j.channel ? String(j.channel) : undefined,
		tags: Array.isArray(j.tags) ? j.tags.map(String).slice(0, 30) : undefined
	};
}

/**
 * Downloads bestaudio without `-x --audio-format`, which would transcode a lossy source
 * into another lossy format for no benefit.
 */
export async function downloadAudio(
	url: string,
	outTemplate: string,
	onRetry?: RetryNote
): Promise<void> {
	await withRetry(
		() =>
			run('yt-dlp', [
				'--no-playlist',
				'--no-warnings',
				'-f',
				'140/251/bestaudio[ext=m4a]/bestaudio',
				'-o',
				outTemplate,
				url
			]),
		onRetry
	);
}
