import { describe, expect, it } from 'vitest';
import type { LedFrame, LedSink } from '@mv/core';
import { createArtnetSink, createDdpSink, createSacnSink } from './index.ts';

const frame: LedFrame = { rgb: new Uint8Array(30), frameId: 1, dt: 1 / 60, presentAtMs: 0 };
const nowhere = 'no-such-host.invalid';

describe('a controller whose name stops resolving', () => {
	it.each<[string, () => LedSink]>([
		['ddp', () => createDdpSink({ targets: [{ host: nowhere, firstLed: 0, ledCount: 10 }] })],
		['sacn', () => createSacnSink({ targets: [{ host: nowhere, firstLed: 0, ledCount: 10, universe: 1 }] })],
		['artnet', () => createArtnetSink({ targets: [{ host: nowhere, universe: 0, ledCount: 10 }] })]
	])('costs %s a readout, not the process', async (_, make) => {
		const sink = make();
		await sink.open();
		sink.send(frame);
		await new Promise((r) => setTimeout(r, 400));
		expect(sink.stats().lastError).toMatch(/ENOTFOUND|EAI_AGAIN|getaddrinfo/);
		await sink.close();
	});
});
