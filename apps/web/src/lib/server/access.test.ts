import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, sep } from 'node:path';
import type { RequestEvent } from '@sveltejs/kit';
import { describe, expect, it } from 'vitest';
import { handle } from '../../hooks.server.ts';
import { crossSite, guestAllowed, isLocal } from './access.ts';

function request(url: string, init: { method?: string; host?: string; origin?: string } = {}): Request {
	const headers = new Headers();
	headers.set('host', init.host ?? new URL(url).host);
	if (init.origin !== undefined) headers.set('origin', init.origin);
	return new Request(url, { method: init.method ?? 'GET', headers });
}

function eventFor(
	routeId: string | null,
	req: Request,
	address: string
): RequestEvent {
	return {
		request: req,
		route: { id: routeId },
		url: new URL(req.url),
		getClientAddress: () => address
	} as unknown as RequestEvent;
}

const LAN = '192.168.0.23';

describe('isLocal', () => {
	it('accepts the machine itself under the names it answers to', () => {
		for (const host of ['localhost:5180', '127.0.0.1:61234', '[::1]:5180', 'LOCALHOST']) {
			const req = request('http://127.0.0.1/api/settings', { host });
			expect(isLocal(eventFor('/api/settings', req, '127.0.0.1')), host).toBe(true);
		}
	});

	it('refuses a rebound domain even though its requests arrive over loopback', () => {
		const req = request('http://127.0.0.1/api/settings', { host: 'attacker.example:5180' });
		expect(isLocal(eventFor('/api/settings', req, '127.0.0.1'))).toBe(false);
	});

	it('refuses the LAN', () => {
		const req = request('http://192.168.0.10:5180/api/settings');
		expect(isLocal(eventFor('/api/settings', req, LAN))).toBe(false);
	});

	it('refuses a request that has no client address', () => {
		const event = {
			request: request('http://localhost/api/settings'),
			getClientAddress: () => {
				throw new Error('prerendering');
			}
		} as unknown as RequestEvent;
		expect(isLocal(event)).toBe(false);
	});
});

describe('crossSite', () => {
	it('lets a tool that names no origin through, and the app itself', () => {
		expect(crossSite(request('http://localhost:5180/api/queue', { method: 'POST' }))).toBe(false);
		expect(
			crossSite(request('http://localhost:5180/api/queue', { method: 'POST', origin: 'http://localhost:5180' }))
		).toBe(false);
	});

	it('refuses another site and an opaque origin', () => {
		for (const origin of ['http://evil.example', 'http://localhost:9999', 'null']) {
			const req = request('http://localhost:5180/api/queue', { method: 'POST', origin });
			expect(crossSite(req), origin).toBe(true);
		}
	});
});

/** Every API route on disk with the methods it exports. */
function apiRoutes(): { id: string; method: string }[] {
	const root = join(import.meta.dirname, '..', '..', 'routes');
	const found: { id: string; method: string }[] = [];
	const walk = (dir: string): void => {
		for (const entry of readdirSync(dir, { withFileTypes: true })) {
			const path = join(dir, entry.name);
			if (entry.isDirectory()) walk(path);
			else if (entry.name === '+server.ts') {
				const id = `/${relative(root, dir).split(sep).join('/')}`;
				const source = readFileSync(path, 'utf8');
				for (const m of source.matchAll(/export const (GET|POST|PUT|PATCH|DELETE)\b/g)) {
					found.push({ id, method: m[1] });
				}
			}
		}
	};
	walk(join(root, 'api'));
	return found;
}

describe('guestAllowed', () => {
	it('opens exactly what a guest phone calls, and nothing a new route adds', () => {
		const open = apiRoutes()
			.filter((r) => guestAllowed(r.id, r.method))
			.map((r) => `${r.method} ${r.id}`)
			.sort();
		expect(open).toEqual([
			'GET /api/queue',
			'GET /api/queue/stream',
			'GET /api/search',
			'POST /api/guest'
		]);
	});
});

describe('handle', () => {
	const pass = async () => new Response('resolved');

	async function run(routeId: string | null, req: Request, address: string): Promise<Response> {
		return handle({ event: eventFor(routeId, req, address), resolve: pass });
	}

	it('refuses a host route from the LAN', async () => {
		const res = await run('/api/settings', request('http://192.168.0.10:5180/api/settings'), LAN);
		expect(res.status).toBe(403);
	});

	it('serves a guest route from the LAN', async () => {
		const req = request('http://192.168.0.10:5180/api/guest', {
			method: 'POST',
			origin: 'http://192.168.0.10:5180'
		});
		expect(await (await run('/api/guest', req, LAN)).text()).toBe('resolved');
	});

	it('refuses a write another site sends to the host, even over loopback', async () => {
		const req = request('http://localhost:5180/api/queue', {
			method: 'POST',
			origin: 'http://evil.example'
		});
		expect((await run('/api/queue', req, '127.0.0.1')).status).toBe(403);
	});

	it('serves the host its own routes', async () => {
		const req = request('http://localhost:5180/api/settings');
		expect(await (await run('/api/settings', req, '127.0.0.1')).text()).toBe('resolved');
	});

	it('sends a guest who opens the host page to the guest page', async () => {
		const outcome = run('/', request('http://192.168.0.10:5180/'), LAN);
		await expect(outcome).rejects.toMatchObject({ status: 303, location: '/guest' });
	});
});
