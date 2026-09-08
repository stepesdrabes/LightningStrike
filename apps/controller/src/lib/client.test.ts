import { describe, expect, it, vi } from 'vitest';
import { DeviceClient, type Link } from './client.ts';
import type { Net } from './net.ts';
import type { LightState, Patch } from './protocol.ts';

const STATE = {
	power: 'on',
	colour: '#ffb46e',
	brightness: 160,
	effect: 'wash',
	powerOn: 'restore',
	mode: 'smart'
};

/**
 * A board that serves one connection at a time: it records the bodies it was given and can be
 * told to drop the next few requests the way a busy board drops a SYN.
 */
function fakeBoard(options: { dropFirst?: number } = {}) {
	let drop = options.dropFirst ?? 0;
	const bodies: Patch[] = [];
	let open = 0;

	const net: Net = {
		async get() {
			return STATE;
		},
		async post(_url, body) {
			if (++open > 1) throw new Error('two requests in flight at once');
			await Promise.resolve();
			open--;
			if (drop > 0) {
				drop--;
				return null;
			}
			const patch = JSON.parse(body === '' ? '{}' : body) as Patch;
			bodies.push(patch);
			return { ...STATE, ...patch };
		}
	};
	return { net, bodies };
}

function client(net: Net) {
	const states: LightState[] = [];
	const links: Link[] = [];
	const c = new DeviceClient('192.168.0.106', net, {
		onState: (s) => states.push(s),
		onLink: (l) => links.push(l)
	});
	return { c, states, links };
}

describe('DeviceClient.send', () => {
	it('takes the board answer as the truth rather than the patch it sent', async () => {
		const board = fakeBoard();
		const { c, states } = client(board.net);

		c.send({ brightness: 40 });
		await vi.waitFor(() => expect(states).toHaveLength(1));

		expect(states[0]?.brightness).toBe(40);
		expect(board.bodies).toEqual([{ brightness: 40 }]);
	});

	/**
	 * The reason the queue exists: a drag emits a value per frame, and a board that serves one
	 * connection at a time would be metres behind by the time a finger lifted.
	 */
	it('coalesces a drag into one request per round trip', async () => {
		const board = fakeBoard();
		const { c } = client(board.net);

		for (const brightness of [10, 20, 30, 40, 50]) c.send({ brightness });
		await vi.waitFor(() => expect(board.bodies.length).toBeGreaterThan(0));
		await vi.waitFor(() => expect(board.bodies.at(-1)).toEqual({ brightness: 50 }));

		// Never every value, and the last one always arrives.
		expect(board.bodies.length).toBeLessThan(5);
	});

	/**
	 * Coalescing must not turn into dropping: two different fields touched while a request is in
	 * the air have to arrive together, not one instead of the other.
	 */
	it('folds everything queued during a request into a single follow-up', async () => {
		const board = fakeBoard();
		const { c } = client(board.net);

		c.send({ brightness: 90 });
		c.send({ colour: '#112233' });
		c.send({ brightness: 120 });
		await vi.waitFor(() => expect(board.bodies).toHaveLength(2));

		expect(board.bodies[0]).toEqual({ brightness: 90 });
		expect(board.bodies[1]).toEqual({ colour: '#112233', brightness: 120 });
	});

	it('retries once, because the usual failure is the last socket still closing', async () => {
		const board = fakeBoard({ dropFirst: 1 });
		const { c, states } = client(board.net);

		c.send({ power: 'off' });
		await vi.waitFor(() => expect(states).toHaveLength(1));

		expect(board.bodies).toEqual([{ power: 'off' }]);
	});

	it('reports the link lost and stops rather than hammering a board that is gone', async () => {
		const board = fakeBoard({ dropFirst: 99 });
		const { c, links } = client(board.net);

		c.send({ power: 'on' });
		await vi.waitFor(() => expect(links).toContain('lost'));

		expect(board.bodies).toEqual([]);
	});

	/** What the poll stands aside on, so an edit never has to share the board's two listeners. */
	it('reads busy for as long as a patch is unanswered', async () => {
		const board = fakeBoard();
		const { c, states } = client(board.net);

		expect(c.busy).toBe(false);
		c.send({ colour: '#112233' });
		expect(c.busy).toBe(true);

		await vi.waitFor(() => expect(states).toHaveLength(1));
		expect(c.busy).toBe(false);
	});
});

describe('DeviceClient.readState', () => {
	it('publishes what the board holds', async () => {
		const board = fakeBoard();
		const { c, states, links } = client(board.net);

		expect(await c.readState()).not.toBeNull();
		expect(states).toHaveLength(1);
		// A poll is not an edit, so it must not colour the status of the last one.
		expect(links).toEqual([]);
	});
});
