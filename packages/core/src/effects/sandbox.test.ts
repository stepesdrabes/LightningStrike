import { describe, expect, it, vi } from 'vitest';
import type { GeneratedEffect } from '../contracts/show.ts';
import { createShowFrame } from '../contracts/frame.ts';
import { makePalette } from '../color/palette.ts';
import { buildGeometry, DEFAULT_ROOM } from '../geometry.ts';
import { compileGenerated, gateVerdicts, roomKey } from './sandbox.ts';

const g = buildGeometry(DEFAULT_ROOM);
/** Core compiles without DOM or Node types; the sandbox logs through whichever console exists. */
const host = globalThis as unknown as { console: { error(message: string): void } };

const generated = (source: string, overrides: Partial<GeneratedEffect> = {}): GeneratedEffect => ({
	id: 'probe',
	name: 'Probe',
	role: 'bed',
	blurb: '',
	params: [],
	source,
	...overrides
});

function frameAt(t: number) {
	const f = createShowFrame();
	f.t = t;
	f.dt = 1 / 60;
	return { g, f, p: {}, palette: makePalette({ base: 200, accent: 30 }), hueShift: 0, motion: 1 };
}

describe('generated effects', () => {
	it('goes dark for good when a gated effect later throws, and clears impossible pixels', () => {
		const throwing = compileGenerated(
			generated('function create(g) { return { render(out, ctx) { if (ctx.f.t > 100) throw new Error("late"); out.fill(0.4); } }; }'),
			g
		);
		const effect = throwing.def!.create(g);
		const out = new Float32Array(g.count * 3);
		const errors = host.console.error;
		host.console.error = () => {};
		try {
			effect.render(out, frameAt(1));
			expect(out[0]).toBeCloseTo(0.4);
			effect.render(out, frameAt(101));
			expect(out.every((v) => v === 0)).toBe(true);
			effect.render(out, frameAt(1));
			expect(out.every((v) => v === 0)).toBe(true);
		} finally {
			host.console.error = errors;
		}

		const impossible = compileGenerated(
			generated('function create(g) { return { render(out, ctx) { out.fill(0.3); if (ctx.f.t > 100) { out[0] = NaN; out[1] = -1; out[2] = Infinity; } } }; }'),
			g
		);
		const bad = impossible.def!.create(g);
		bad.render(out, frameAt(101));
		expect([out[0], out[1], out[2], out[3]]).toEqual([0, 0, 0, expect.closeTo(0.3)]);
	});

	it('runs the gate unless the evening loader already admitted the effect in this room', () => {
		const dark = 'function create(g) { return { render(out) { out.fill(0); } }; }';
		expect(compileGenerated(generated(dark), g).failures).toEqual(['effect never emits light across the test journey']);
		// The same verdict again, from memory.
		expect(compileGenerated(generated(dark, { id: 'other' }), g).failures).toEqual(['effect never emits light across the test journey']);
		expect(compileGenerated(generated(dark, { admittedOn: roomKey(g) }), g).def).not.toBeNull();
		// Admission never lets a banned construct through.
		expect(compileGenerated(generated('function create(g) { return { render(out) { out.fill(Date.now()); } }; }', { admittedOn: roomKey(g) }), g).def).toBeNull();
	});

	it('gates again in a room other than the one it was admitted in', () => {
		const dark = generated('function create(g) { return { render(out) { out.fill(0); } }; }', { id: 'moved' });
		const strip = buildGeometry({
			...DEFAULT_ROOM,
			lights: [{ id: 's', name: 'Strip', kind: 'path', points: [[-1, 0, 2], [1, 0, 2]], counts: [60], closed: false, density: 30, mount: 'ceiling', role: 'auto' }]
		});
		expect(roomKey(strip)).not.toBe(roomKey(g));
		expect(compileGenerated({ ...dark, admittedOn: roomKey(g) }, strip).def).toBeNull();
	});

	it('takes verdicts reached on another thread instead of replaying the journey', async () => {
		const dark = generated('function create(g) { return { render(out) { out.fill(0); } }; }', { id: 'carried' });
		compileGenerated(dark, g);
		const carried = gateVerdicts().map(([key]) => [key, ['remembered']] as [string, string[]]);
		vi.resetModules();
		const fresh = await import('./sandbox.ts');
		fresh.rememberGateVerdicts(carried);
		expect(fresh.compileGenerated(dark, g).failures).toEqual(['remembered']);
	});
});
