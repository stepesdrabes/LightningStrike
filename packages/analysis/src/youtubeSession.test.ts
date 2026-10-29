import { describe, expect, it } from 'vitest';
import { isYouTubeUrl, offeredYouTubeBrowsers, readSessionLog, sessionArgs } from './youtubeSession.ts';

describe('which requests carry the browser session', () => {
	it('signs YouTube and YouTube Music links in', () => {
		for (const url of [
			'https://www.youtube.com/watch?v=u0fhiNS_nZc',
			'https://music.youtube.com/watch?v=u0fhiNS_nZc',
			'https://youtu.be/u0fhiNS_nZc',
			'https://m.youtube.com/watch?v=u0fhiNS_nZc'
		]) {
			expect(sessionArgs(url, 'brave')).toEqual(['--cookies-from-browser', 'brave']);
		}
	});

	it('never hands the cookies to another site or a lookalike host', () => {
		expect(sessionArgs('https://soundcloud.com/artist/track', 'brave')).toEqual([]);
		expect(sessionArgs('https://notyoutube.com/watch?v=x', 'brave')).toEqual([]);
		expect(isYouTubeUrl('/Users/me/Music/song.m4a')).toBe(false);
	});

	it('adds nothing when downloads go signed out', () => {
		expect(sessionArgs('https://music.youtube.com/watch?v=u0fhiNS_nZc', null)).toEqual([]);
	});
});

describe('what a check reports', () => {
	it('is signed in when yt-dlp finds account cookies', () => {
		const log = '[debug] Extracting cookies from: "…/Brave-Browser/Default/Cookies"\n' +
			'[debug] [youtube] Found YouTube account cookies\n';
		expect(readSessionLog('brave', log)).toEqual({ browser: 'brave', signedIn: true, problem: null });
	});

	it('says so when the browser has no YouTube sign-in', () => {
		expect(readSessionLog('firefox', 'Extracted 45 cookies from firefox\n')).toMatchObject({
			signedIn: false, problem: 'This browser is not signed in to YouTube'
		});
	});

	it('passes on why the cookie store could not be read', () => {
		const log = 'yt-dlp exited 1: ERROR: could not find edge cookies database in "/Users/me/Library"\n';
		expect(readSessionLog('edge', log)).toMatchObject({
			signedIn: false, problem: 'could not find edge cookies database in "/Users/me/Library"'
		});
	});
});

it('offers Safari only on macOS', () => {
	expect(offeredYouTubeBrowsers('darwin')).toContain('safari');
	expect(offeredYouTubeBrowsers('win32')).toEqual(['brave', 'chrome', 'edge', 'firefox']);
});
