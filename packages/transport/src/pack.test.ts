import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { LENGTH_PREFIX, Packer } from './pack.ts';

/** The board decodes these same lines in firmware/wire/src/pack.rs. */
const VECTORS = new URL('../../../firmware/wire/src/pack-vectors.txt', import.meta.url);

/** The board's decoder, written out here so a round trip proves the format and not the encoder. */
function unpack(src: Uint8Array): Uint8Array | null {
	const SMALL = [0, 1, 255, 2, 254, 3, 253, 4, 252, 5, 251, 6, 250];
	const len = (src[0] << 8) | src[1];
	if (len % 3 !== 0) return null;
	const out = new Uint8Array(len);
	const pixels = len / 3;

	let nibble = 0;
	const next = (): number | null => {
		const at = LENGTH_PREFIX + (nibble >> 1);
		if (at >= src.length) return null;
		const value = (nibble & 1) === 0 ? src[at] >> 4 : src[at] & 0x0f;
		nibble++;
		return value;
	};
	const byte = (): number | null => {
		const hi = next();
		const lo = next();
		return hi === null || lo === null ? null : (hi << 4) | lo;
	};

	let value = 0;
	let written = 0;
	let plane = 0;
	let k = 0;
	let at = 0;
	while (written < len) {
		const code = next();
		if (code === null) return null;
		let delta = 0;
		let count = 1;
		if (code === 13) {
			const n = next();
			if (n === null) return null;
			count = n + 3;
		} else if (code === 14) {
			const n = byte();
			if (n === null) return null;
			count = n + 19;
		} else if (code === 15) {
			const n = byte();
			if (n === null) return null;
			delta = n;
		} else {
			delta = SMALL[code];
		}
		if (written + count > len) return null;
		value = (value + delta) & 0xff;
		for (let i = 0; i < count; i++) {
			if (plane >= 3) return null;
			out[at] = value;
			k++;
			if (k === pixels) {
				plane++;
				k = 0;
				at = plane;
			} else {
				at += 3;
			}
		}
		written += count;
	}
	return out;
}

const packer = new Packer(3 * 673);
const scratch = new Uint8Array(1440);

function roundTrip(rgb: Uint8Array): { size: number; back: Uint8Array | null } {
	const size = packer.pack(rgb, 0, rgb.length / 3, scratch);
	return { size, back: size > 0 ? unpack(scratch.subarray(0, size)) : null };
}

describe('the vectors the board is pinned against', () => {
	it('is still what this encoder emits', () => {
		const out = new Uint8Array(8192);
		const wide = new Packer(3 * 673);
		let cases = 0;
		for (const line of readFileSync(VECTORS, 'utf8').split('\n')) {
			if (line.startsWith('#') || line === '') continue;
			const [why, rgbHex, packedHex] = line.split(' | ');
			const rgb = Buffer.from(rgbHex as string, 'hex');
			const n = wide.pack(new Uint8Array(rgb), 0, rgb.length / 3, out);
			expect(Buffer.from(out.subarray(0, n)).toString('hex'), why).toBe(packedHex);
			cases++;
		}
		// Regenerating the file must not quietly empty it.
		expect(cases).toBeGreaterThanOrEqual(30);
	});
});

describe('pack', () => {
	/** Pinned against firmware/wire/src/pack.rs; both sides encode this format. */
	it('encodes the bytes the board is pinned to', () => {
		const rgb = new Uint8Array([0, 0, 0, 1, 0, 0, 2, 0, 0, 2, 0, 0]);
		const size = packer.pack(rgb, 0, 4, scratch);
		expect([...scratch.subarray(0, size)]).toEqual([0x00, 0x0c, 0x01, 0x10, 0x4d, 0x40]);
	});

	it('returns what went in', () => {
		const flat = new Uint8Array(300).fill(17);
		expect(roundTrip(flat).back).toEqual(flat);

		const ramp = new Uint8Array(300).map((_, i) => i % 251);
		expect(roundTrip(ramp).back).toEqual(ramp);

		const sparkle = new Uint8Array(3 * 200);
		sparkle[3 * 137] = 255;
		sparkle[3 * 137 + 1] = 90;
		expect(roundTrip(sparkle).back).toEqual(sparkle);
	});

	it('puts a whole dark fixture in a handful of bytes', () => {
		const dark = new Uint8Array(3 * 673);
		const { size, back } = roundTrip(dark);
		expect(size).toBeLessThan(32);
		expect(back).toEqual(dark);
	});

	it('packs a show-shaped frame into one datagram', () => {
		const rgb = new Uint8Array(3 * 673);
		for (let k = 0; k < 673; k++) {
			rgb[k * 3] = (k / 3) | 0;
			rgb[k * 3 + 1] = (k / 8) | 0;
			rgb[k * 3 + 2] = k % 97 === 0 ? 200 : 4;
		}
		const { size, back } = roundTrip(rgb);
		expect(size).toBeGreaterThan(0);
		expect(size).toBeLessThan(1440);
		expect(back).toEqual(rgb);
	});

	it('gives up rather than overrunning a datagram', () => {
		// Every byte its own literal: three nibbles each, far past what one datagram holds.
		const noise = new Uint8Array(3 * 673).map((_, i) => (i * 97) & 0xff);
		expect(packer.pack(noise, 0, 673, scratch)).toBe(0);
	});

	it('packs a slice of a larger buffer', () => {
		const whole = new Uint8Array(3 * 40).map((_, i) => i & 0xff);
		const size = packer.pack(whole, 3 * 10, 20, scratch);
		expect(size).toBeGreaterThan(0);
		expect(unpack(scratch.subarray(0, size))).toEqual(whole.subarray(3 * 10, 3 * 30));
	});
});
