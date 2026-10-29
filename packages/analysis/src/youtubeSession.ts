import { readSetting } from './settingsFile.ts';

/**
 * Browsers yt-dlp can borrow a signed-in YouTube session from. Some addresses get every
 * signed-out download refused while a signed-in browser still plays.
 */
export const YOUTUBE_BROWSERS = ['brave', 'chrome', 'edge', 'firefox', 'safari'] as const;
export type YouTubeBrowser = (typeof YOUTUBE_BROWSERS)[number];

export function isYouTubeBrowser(value: unknown): value is YouTubeBrowser {
	return YOUTUBE_BROWSERS.includes(value as YouTubeBrowser);
}

/** Safari keeps its cookies only on macOS. */
export function offeredYouTubeBrowsers(platform: string = process.platform): YouTubeBrowser[] {
	return YOUTUBE_BROWSERS.filter((browser) => browser !== 'safari' || platform === 'darwin');
}

/** The browser whose session YouTube downloads use (`youtubeBrowser` in settings.json), if any. */
export async function chosenYouTubeBrowser(): Promise<YouTubeBrowser | null> {
	const browser = await readSetting('youtubeBrowser');
	return isYouTubeBrowser(browser) ? browser : null;
}

const YOUTUBE_HOST = /(?:^|\.)(?:youtube\.com|youtu\.be|youtube-nocookie\.com)$/i;

export function isYouTubeUrl(url: string): boolean {
	try {
		return YOUTUBE_HOST.test(new URL(url).hostname);
	} catch {
		return false;
	}
}

/** Only YouTube is handed the browser's cookies; every other site is fetched signed out. */
export function sessionArgs(url: string, browser: YouTubeBrowser | null): string[] {
	return browser && isYouTubeUrl(url) ? ['--cookies-from-browser', browser] : [];
}

export interface YouTubeSession {
	browser: YouTubeBrowser;
	signedIn: boolean;
	/** Why downloads cannot use the browser's session, in one line. */
	problem: string | null;
}

/** yt-dlp's verbose log names account cookies only when the browser holds a YouTube sign-in. */
export function readSessionLog(browser: YouTubeBrowser, log: string): YouTubeSession {
	const error = log.split('\n').find((line) => line.includes('ERROR:'));
	if (error) {
		return { browser, signedIn: false, problem: error.replace(/^.*?ERROR:\s*/, '').slice(0, 160) };
	}
	if (log.includes('Found YouTube account cookies')) return { browser, signedIn: true, problem: null };
	return { browser, signedIn: false, problem: 'This browser is not signed in to YouTube' };
}
