import { describe, expect, it } from 'vitest';
import { isTransientFetchError } from './decode.ts';

/**
 * Real yt-dlp messages pin both retry directions: permanent refusals waste retries; temporary
 * ones need another chance.
 */
describe('which fetch failures are worth asking again', () => {
	const transient = [
		'yt-dlp exited 1: ERROR: unable to download video data: HTTP Error 403: Forbidden',
		'ERROR: HTTP Error 429: Too Many Requests',
		'ERROR: HTTP Error 503: Service Unavailable',
		'ERROR: Unable to download webpage: <urlopen error timed out>',
		'ERROR: Unable to download API page',
		'ERROR: [Errno 54] Connection reset by peer',
		'ERROR: Remote end closed connection without response',
		'ERROR: [Errno 8] nodename nor servname provided: getaddrinfo failed'
	];
	for (const message of transient) {
		it(`retries: ${message.slice(0, 52)}`, () => {
			expect(isTransientFetchError(message)).toBe(true);
		});
	}

	const permanent = [
		'ERROR: Video unavailable',
		'ERROR: Private video. Sign in if you have been granted access to this video',
		'ERROR: This video has been removed by the uploader',
		'ERROR: Join this channel to get access to members-only content',
		'ERROR: Sign in to confirm your age. This video may be inappropriate for some users.',
		'ERROR: The uploader has not made this video available in your country',
		'ERROR: requested format is not available'
	];
	for (const message of permanent) {
		it(`gives up on: ${message.slice(0, 52)}`, () => {
			expect(isTransientFetchError(message)).toBe(false);
		});
	}

	it('gives up on a takedown even though it arrives as a 403', () => {
		expect(
			isTransientFetchError(
				'ERROR: HTTP Error 403: Forbidden. This video is no longer available due to a copyright claim'
			)
		).toBe(false);
	});

	it('does not retry something it simply does not recognise', () => {
		expect(isTransientFetchError('ERROR: something nobody has seen before')).toBe(false);
	});

	// The fetcher answers a 403 from an out-of-date binary with this rather than the bare
	// refusal, and the queue has to agree that it is over: retrying spends the slow layer too,
	// a minute at a time, on a client YouTube has stopped signing media for.
	it('gives up on a 403 the fetcher has blamed on a stale yt-dlp', () => {
		expect(
			isTransientFetchError(
				'yt-dlp is 55 days out of date and YouTube is refusing every track it asks for. ' +
					'Run: brew upgrade yt-dlp\n' +
					'yt-dlp exited 1: ERROR: unable to download video data: HTTP Error 403: Forbidden'
			)
		).toBe(false);
	});
});
