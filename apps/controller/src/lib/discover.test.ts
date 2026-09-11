import { describe, expect, it, vi } from 'vitest';
import { discover, hostsInSubnet, subnetOf } from './discover.ts';
import type { Net } from './net.ts';

function info(name: string, ip: string): unknown {
	return {
		name,
		ip,
		firmware: '0.2.0',
		uptimeS: 1,
		pixels: 1,
		ddpPort: 4048,
		statsPort: 4049,
		leds: 'lamp',
		effects: ['wash']
	};
}

/** Answers for the hosts it was given and stays silent everywhere else, like the subnet does. */
function fakeNet(answers: Record<string, unknown>): Net & { asked: string[] } {
	const asked: string[] = [];
	return {
		asked,
		async get(url) {
			const host = new URL(url).hostname;
			asked.push(host);
			return answers[host] ?? null;
		},
		async post() {
			return null;
		}
	};
}

describe('subnetOf', () => {
	it('takes the /24 off an address', () => {
		expect(subnetOf('192.168.0.106')).toBe('192.168.0');
		expect(subnetOf('10.0.0.7')).toBe('10.0.0');
	});

	it('has nothing to say about a name', () => {
		expect(subnetOf('room-bounce.local')).toBeNull();
		expect(subnetOf('localhost')).toBeNull();
		expect(subnetOf('999.1.1.1')).toBeNull();
		expect(subnetOf('')).toBeNull();
	});
});

describe('hostsInSubnet', () => {
	it('covers the whole range and skips what is already known', () => {
		expect(hostsInSubnet('192.168.0')).toHaveLength(254);
		expect(hostsInSubnet('192.168.0')[0]).toBe('192.168.0.1');
		expect(hostsInSubnet('192.168.0').at(-1)).toBe('192.168.0.254');
		expect(hostsInSubnet('192.168.0', new Set(['192.168.0.5']))).toHaveLength(253);
	});
});

describe('discover', () => {
	it('finds the board the page was served by without scanning', async () => {
		const net = fakeNet({ '192.168.0.106': info('room-bounce', '192.168.0.106') });
		const onFound = vi.fn();
		const sweeping = vi.fn();

		const found = await discover({
			net,
			origin: '192.168.0.106',
			onFound,
			onSweeping: sweeping
		});

		expect(found.map((f) => f.info.name)).toEqual(['room-bounce']);
		expect(onFound).toHaveBeenCalledTimes(1);
		// It still sweeps for siblings, but the light was in hand before it started.
		expect(sweeping).toHaveBeenCalledWith(true);
	});

	it('sweeps the subnet the origin sits on and finds the other board', async () => {
		const net = fakeNet({
			'192.168.0.106': info('room-bounce', '192.168.0.106'),
			'192.168.0.57': info('room-frame', '192.168.0.57')
		});

		const found = await discover({ net, origin: '192.168.0.106', onFound: () => {} });

		expect(found.map((f) => f.info.name).sort()).toEqual(['room-bounce', 'room-frame']);
		expect(net.asked).toContain('192.168.0.57');
	});

	it('takes the subnet from the board when the page was opened at a name', async () => {
		const net = fakeNet({
			'room-bounce.local': info('room-bounce', '192.168.4.20'),
			'192.168.4.99': info('room-frame', '192.168.4.99')
		});

		const found = await discover({ net, origin: 'room-bounce.local', onFound: () => {} });

		expect(found.map((f) => f.info.name).sort()).toEqual(['room-bounce', 'room-frame']);
	});

	it('does not list one board twice for answering to both its name and its address', async () => {
		const net = fakeNet({
			'room-bounce.local': info('room-bounce', '192.168.0.106'),
			'192.168.0.106': info('room-bounce', '192.168.0.106')
		});

		const found = await discover({ net, origin: '192.168.0.106', onFound: () => {} });

		expect(found).toHaveLength(1);
	});

	it('sweeps the subnet of a remembered address that no longer answers', async () => {
		const net = fakeNet({ '192.168.9.31': info('room-bounce', '192.168.9.31') });

		const found = await discover({
			net,
			origin: 'pi.local',
			remembered: ['192.168.9.12'],
			onFound: () => {}
		});

		expect(found.map((f) => f.info.name)).toEqual(['room-bounce']);
	});

	it('gives up quietly when the origin is not an address and nothing answers', async () => {
		const net = fakeNet({});
		const found = await discover({ net, origin: 'localhost', onFound: () => {} });
		expect(found).toEqual([]);
	});
});
