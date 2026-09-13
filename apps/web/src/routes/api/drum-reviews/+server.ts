import { json } from '@sveltejs/kit';
import { isLocal } from '$lib/server/access.ts';
import { drumReviewStore, drumReviewVersions, freshDrumReview, ReviewError } from '$lib/server/drumReviews.ts';
import type { RequestHandler } from './$types';

function failure(e: unknown): Response {
	return json({ error: e instanceof ReviewError ? e.message : 'Could not read or save this review.' },
		{ status: e instanceof ReviewError ? e.status : 500 });
}

export const GET: RequestHandler = async (event) => {
	if (!isLocal(event)) return new Response('forbidden', { status: 403 });
	try {
		const trackId = event.url.searchParams.get('trackId') ?? '';
		const archived = event.url.searchParams.get('analysis');
		const fresh = await freshDrumReview(trackId, archived ?? undefined);
		return json({ review: await drumReviewStore.read(trackId, fresh.analysis.sha256) ?? fresh,
			versions: await drumReviewVersions(trackId), pinned: !!archived }, { headers: { 'cache-control': 'no-store' } });
	} catch (e) { return failure(e); }
};

export const POST: RequestHandler = async (event) => {
	if (!isLocal(event)) return new Response('forbidden', { status: 403 });
	if (event.request.headers.get('origin') !== event.url.origin) return new Response('forbidden', { status: 403 });
	try {
		if (Number(event.request.headers.get('content-length') ?? 0) > 512_000) {
			throw new ReviewError('Review is too large.', 413);
		}
		const reader = event.request.body?.getReader();
		if (!reader) throw new ReviewError('Review required.');
		const chunks: Uint8Array[] = [];
		let size = 0;
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			size += value.byteLength;
			if (size > 512_000) { reader.releaseLock(); throw new ReviewError('Review is too large.', 413); }
			chunks.push(value);
		}
		let body;
		try { body = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
		catch { throw new ReviewError('Invalid review.'); }
		const fresh = await freshDrumReview(typeof body?.trackId === 'string' ? body.trackId : '',
			typeof body?.analysisSha256 === 'string' ? body.analysisSha256 : undefined);
		return json({ review: await drumReviewStore.save(fresh, body) });
	} catch (e) { return failure(e); }
};
