import { error, json } from '@sveltejs/kit';
import { checkYouTubeSession, type YouTubeBrowser, type YouTubeSession } from '@mv/analysis';
import { isLocal } from '$lib/server/access.ts';
import { settings } from '$lib/server/settings.ts';
import type { RequestHandler } from './$types';

/** A check spawns yt-dlp and reads the browser's cookie store, so reopening the dialog reuses it. */
const FRESH_MS = 10 * 60_000;

let last: { browser: YouTubeBrowser; at: number; settled: boolean; session: Promise<YouTubeSession> } | null = null;

/** Whether the chosen browser holds a YouTube sign-in; null while downloads go signed out. */
export const GET: RequestHandler = async (event) => {
	if (!isLocal(event)) error(403, 'the YouTube sign-in belongs to the machine running the show');
	const { youtubeBrowser } = await settings.read();
	if (youtubeBrowser === 'none') return json(null);

	const fresh = event.url.searchParams.has('fresh');
	const reusable = last?.browser === youtubeBrowser
		&& (!last.settled || (!fresh && Date.now() - last.at < FRESH_MS));
	if (!reusable) {
		const check = {
			browser: youtubeBrowser, at: Date.now(), settled: false, session: checkYouTubeSession(youtubeBrowser)
		};
		void check.session.finally(() => (check.settled = true));
		last = check;
	}
	return json(await last!.session);
};
