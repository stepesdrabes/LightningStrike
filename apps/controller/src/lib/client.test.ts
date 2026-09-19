import { afterEach, describe, expect, it, vi } from 'vitest';
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
 * Serial board stub. `refuse` decides per attempt whether the connection is refused, which is
 * what a board with every listener busy does; the default refuses nothing.
 */
function fakeBoard(options: { refuse?: (attempt: number) => boolean } = {}) {
	const refuse = options.refuse ?? (() => false);
	const bodies: Patch[] = [];
	let attempts = 0;
	let open = 0;

	const net: Net = {
		async get() {
			return STATE;
		},
		async post(_url, body) {
			if (++open > 1) throw new Error('two requests in flight at once');
			await Promise.resolve();
			open--;
			if (refuse(attempts++)) return null;
			const patch = JSON.parse(body === '' ? '{}' : body) as Patch;
			bodies.push(patch);
			return { ...STATE, ...patch };
		}
	};
	return { net, bodies, attempts: () => attempts };
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

afterEach(() => {
	vi.useRealTimers();
});

describe('DeviceClient.send', () => {
	it('takes the board answer as the truth rather than the patch it sent', async () => {
		const board = fakeBoard();
		const { c, states } = client(board.net);

		c.send({ brightness: 40 });
		await vi.waitFor(() => expect(states).toHaveLength(1));

		expect(states[0]?.brightness).toBe(40);
		expect(board.bodies).toEqual([{ brightness: 40 }]);
	});

	it('coalesces a drag into one request per round trip', async () => {
		const board = fakeBoard();
		const { c } = client(board.net);

		for (const brightness of [10, 20, 30, 40, 50]) c.send({ brightness });
		await vi.waitFor(() => expect(board.bodies.length).toBeGreaterThan(0));
		await vi.waitFor(() => expect(board.bodies.at(-1)).toEqual({ brightness: 50 }));

		// Never every value, and the last one always arrives.
		expect(board.bodies.length).toBeLessThan(5);
	});

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

	/**
	 * The failure this pins: three taps in two seconds, and the board refusing the connection
	 * for the second or so its listeners are busy closing. The old client retried once after
	 * 250 ms, inside that second, then dropped the edit and called the light unreachable.
	 */
	it('keeps retrying a refused edit until it lands, and the newest tap is what lands', async () => {
		vi.useFakeTimers();
		const board = fakeBoard({ refuse: (attempt) => attempt < 3 });
		const { c, states, links } = client(board.net);

		c.send({ effect: 'fire' });
		await vi.advanceTimersByTimeAsync(100);
		c.send({ effect: 'aurora' });
		await vi.advanceTimersByTimeAsync(200);
		c.send({ effect: 'chase' });
		await vi.advanceTimersByTimeAsync(5000);

		expect(board.bodies).toEqual([{ effect: 'chase' }]);
		expect(states.at(-1)?.effect).toBe('chase');
		expect(links).not.toContain('lost');
		expect(links.at(-1)).toBe('ok');
		expect(c.busy).toBe(false);
	});

	it('backs off between refusals rather than knocking again at once', async () => {
		vi.useFakeTimers();
		const board = fakeBoard({ refuse: () => true });
		const { c } = client(board.net);

		c.send({ power: 'off' });
		await vi.advanceTimersByTimeAsync(0);
		expect(board.attempts()).toBe(1);
		await vi.advanceTimersByTimeAsync(299);
		expect(board.attempts()).toBe(1);
		await vi.advanceTimersByTimeAsync(1);
		expect(board.attempts()).toBe(2);
		await vi.advanceTimersByTimeAsync(600);
		expect(board.attempts()).toBe(3);
		await vi.advanceTimersByTimeAsync(1200);
		expect(board.attempts()).toBe(4);
		// From here the delay repeats rather than growing without bound.
		await vi.advanceTimersByTimeAsync(2000);
		expect(board.attempts()).toBe(5);
		await vi.advanceTimersByTimeAsync(2000);
		expect(board.attempts()).toBe(6);
	});

	it('reports the link lost only after seconds of refusals, and still lands the edit', async () => {
		vi.useFakeTimers();
		const board = fakeBoard({ refuse: (attempt) => attempt < 6 });
		const { c, states, links } = client(board.net);

		c.send({ power: 'off' });
		await vi.advanceTimersByTimeAsync(4000);
		expect(links).not.toContain('lost');

		await vi.advanceTimersByTimeAsync(8000);
		expect(links).toContain('lost');

		await vi.advanceTimersByTimeAsync(4000);
		expect(board.bodies).toEqual([{ power: 'off' }]);
		expect(states.at(-1)?.power).toBe('off');
		expect(links.at(-1)).toBe('ok');
	});

	it('gives up on a board that stays silent for half a minute', async () => {
		vi.useFakeTimers();
		const board = fakeBoard({ refuse: () => true });
		const { c, links } = client(board.net);

		c.send({ power: 'on' });
		await vi.advanceTimersByTimeAsync(40000);

		expect(board.bodies).toEqual([]);
		expect(links.at(-1)).toBe('lost');
		expect(c.busy).toBe(false);
		expect(c.pending).toBeNull();
	});

	it('exposes what the board has not confirmed yet, newest value winning', async () => {
		vi.useFakeTimers();
		const board = fakeBoard({ refuse: (attempt) => attempt === 0 });
		const { c } = client(board.net);

		expect(c.pending).toBeNull();
		c.send({ effect: 'fire', brightness: 10 });
		expect(c.pending).toEqual({ effect: 'fire', brightness: 10 });
		c.send({ effect: 'candle' });
		expect(c.pending).toEqual({ effect: 'candle', brightness: 10 });

		await vi.advanceTimersByTimeAsync(5000);
		expect(c.pending).toBeNull();
		expect(board.bodies).toEqual([{ effect: 'candle', brightness: 10 }]);
	});

	/** What the poll stands aside on, so an edit never has to share the board's listeners. */
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

describe('DeviceClient.identify', () => {
	it('retries once and never calls the link lost', async () => {
		vi.useFakeTimers();
		const board = fakeBoard({ refuse: (attempt) => attempt === 0 });
		const { c, links } = client(board.net);

		const pulsed = c.identify();
		await vi.advanceTimersByTimeAsync(1000);
		expect(await pulsed).toBe(true);
		expect(links).toEqual([]);
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

	it('joins a poll already in the air rather than answering nobody', async () => {
		let gets = 0;
		let release: (() => void) | null = null;
		const net: Net = {
			async get() {
				gets++;
				await new Promise<void>((r) => (release = r));
				return STATE;
			},
			async post() {
				return null;
			}
		};
		const c = new DeviceClient('192.168.0.106', net, { onState: () => {}, onLink: () => {} });

		const first = c.readState();
		const second = c.readState();
		await Promise.resolve();
		release!();

		// One request, and both callers get the state: a second caller told null cannot tell
		// that apart from a board that went quiet, and marks a healthy light offline.
		expect(await first).toMatchObject({ brightness: 160 });
		expect(await second).toMatchObject({ brightness: 160 });
		expect(gets).toBe(1);
	});

	it('polls again once the last one has landed', async () => {
		let gets = 0;
		const net: Net = {
			async get() {
				gets++;
				return STATE;
			},
			async post() {
				return null;
			}
		};
		const c = new DeviceClient('192.168.0.106', net, { onState: () => {}, onLink: () => {} });
		await c.readState();
		await c.readState();
		expect(gets).toBe(2);
	});
});
