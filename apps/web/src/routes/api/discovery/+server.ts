import { json } from '@sveltejs/kit';
import { discover } from '$lib/server/discovery.ts';
import type { RequestHandler } from './$types';

/** Listen for controllers on every local network for a couple of seconds. */
export const POST: RequestHandler = async () => json({ found: await discover() });
