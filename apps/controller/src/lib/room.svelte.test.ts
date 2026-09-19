import { beforeEach, describe, expect, it, vi } from 'vitest';
import { Room } from './room.svelte.ts';
import type { Net } from './net.ts';

const INFO = {
	name: 'room-frame',
	ip: '192.168.0.9',
	firmware: '0.3.0',
	uptimeS: 1,
	pixels: 671,
	ddpPort: 4048,
	statsPort: 4049,
	leds: 'sk6812',
	effects: ['wash', 'twinkle']
};

const STATE = {
	power: 'on',
	colour: '#ff0000',
	brightness: 10,
	effect: 'wash',
	powerOn: 'restore',
	mode: 'smart'
};

/** The page was opened at an address on the same /24 as the board. */
beforeEach(() => {
	const store = new Map<string, string>();
	Object.assign(globalThis, {
		location: { hostname: '192.168.0.9' },
		localStorage: {
			getItem: (k: string) => store.get(k) ?? null,
			setItem: (k: string, v: string) => void store.set(k, v)
		},
		document: { visibilityState: 'visible', addEventListener() {}, removeEventListener() {} }
	});
});

function netThat(answer: (host: string, path: string) => unknown): Net {
	return {
		async get(url) {
			const u = new URL(url);
			return answer(u.hostname, u.pathname);
		},
		async post() {
			return null;
		}
	};
}

describe('search', () => {
	it('leaves searching even when discovery throws', async () => {
		const room = new Room(
			netThat((host, path) => {
				if (host !== '192.168.0.9') return null;
				// The throw the audit found: an onFound consumer failing mid-sweep.
				if (path === '/api/info') return { ...INFO, get name() {
					throw new Error('boom');
				} };
				return null;
			})
		);
		await room.search();
		expect(room.phase).not.toBe('searching');
	});

	it('reports empty rather than staying on the spinner when nothing answers', async () => {
		const room = new Room(netThat(() => null));
		await room.search();
		expect(room.phase).toBe('empty');
		expect(room.sweeping).toBe(false);
	});

	it('a second search owns the phase and the first does not overwrite it', async () => {
		const room = new Room(netThat((host) => (host === '192.168.0.9' ? INFO : null)));
		const first = room.search();
		const second = room.search();
		await Promise.all([first, second]);
		expect(room.phase).toBe('ready');
	});
});

describe('a board that answers again', () => {
	it('clears "out of reach" when discovery reaches it at the host it already has', async () => {
		let stateAnswers = false;
		const room = new Room(
			netThat((host, path) => {
				if (host !== '192.168.0.9') return null;
				if (path === '/api/info') return INFO;
				return stateAnswers ? STATE : null;
			})
		);

		await room.search();
		expect(room.devices).toHaveLength(1);
		// One unanswered poll is a busy board; the second is what reads as gone.
		await room.selected?.poll();
		expect(room.selected?.online).toBe(false);

		stateAnswers = true;
		await room.search();
		// absorb re-polls a device it already holds, so a reachable board stops reading offline.
		await new Promise((r) => setTimeout(r, 0));
		expect(room.selected?.online).toBe(true);
		expect(room.selected?.state?.colour).toBe('#ff0000');
	});
});

describe('a light under a burst of taps', () => {
	function boardThat(opts: { refuseFirst: number; stateAnswers?: () => boolean }) {
		let posts = 0;
		const bodies: Record<string, unknown>[] = [];
		let held = { ...STATE };
		const net: Net = {
			async get(url) {
				const u = new URL(url);
				if (u.hostname !== '192.168.0.9') return null;
				if (u.pathname === '/api/info') return INFO;
				return (opts.stateAnswers?.() ?? true) ? held : null;
			},
			async post(_url, body) {
				if (posts++ < opts.refuseFirst) return null;
				const patch = JSON.parse(body) as Record<string, unknown>;
				bodies.push(patch);
				held = { ...held, ...patch };
				return held;
			}
		};
		return { net, bodies };
	}

	it('shows the newest tap while an older reply is still coming back', async () => {
		vi.useFakeTimers();
		const board = boardThat({ refuseFirst: 0 });
		const room = new Room(board.net);
		await room.search();
		await vi.advanceTimersByTimeAsync(0);
		const device = room.selected!;

		device.apply({ effect: 'twinkle' });
		device.apply({ effect: 'wash' });
		// The reply to the first tap lands first, and must not flip the picker back.
		await vi.advanceTimersByTimeAsync(0);
		expect(device.state?.effect).toBe('wash');
		await vi.advanceTimersByTimeAsync(100);
		expect(device.state?.effect).toBe('wash');
		expect(board.bodies.at(-1)).toEqual({ effect: 'wash' });
		vi.useRealTimers();
	});

	it('does not read as out of reach while a refused edit is being retried', async () => {
		vi.useFakeTimers();
		const board = boardThat({ refuseFirst: 2 });
		const room = new Room(board.net);
		await room.search();
		await vi.advanceTimersByTimeAsync(0);
		const device = room.selected!;

		device.apply({ effect: 'twinkle' });
		await vi.advanceTimersByTimeAsync(500);
		expect(device.online).toBe(true);
		await vi.advanceTimersByTimeAsync(2000);
		expect(board.bodies).toEqual([{ effect: 'twinkle' }]);
		expect(device.online).toBe(true);
		expect(device.state?.effect).toBe('twinkle');
		vi.useRealTimers();
	});

	it('needs two missed polls in a row before it says out of reach', async () => {
		let answers = true;
		const board = boardThat({ refuseFirst: 0, stateAnswers: () => answers });
		const room = new Room(board.net);
		await room.search();
		await new Promise((r) => setTimeout(r, 0));
		const device = room.selected!;
		expect(device.online).toBe(true);

		answers = false;
		await device.poll();
		expect(device.online).toBe(true);
		await device.poll();
		expect(device.online).toBe(false);

		answers = true;
		await device.poll();
		expect(device.online).toBe(true);
	});
});
