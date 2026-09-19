/**
 * The packed DDP payload, the other half of `firmware/wire/src/pack.rs`. Both sides are pinned
 * to the same vector; change one and the other has to move with it.
 *
 * The fixture's 2013 bytes are split into colour planes, each plane is differenced along the
 * strip, and the result is coded in nibbles. It is lossless, so the room shows the same bytes,
 * and it puts most frames in a single datagram rather than two that both have to arrive.
 */

/** What the board names in its hello line when it can decode this. */
export const PACK_VERSION = 1;

/** Differences the small codes carry, as they wrap: 0, +-1 .. +-6. */
const SMALL = [0, 1, 255, 2, 254, 3, 253, 4, 252, 5, 251, 6, 250];

const CODE_OF = (() => {
	const table = new Int8Array(256).fill(-1);
	SMALL.forEach((delta, code) => (table[delta] = code));
	return table;
})();

const RUN_SHORT = 13;
const RUN_LONG = 14;
const LITERAL = 15;

/** Shortest run worth a code of its own: two zeros already cost two nibbles as themselves. */
const RUN_MIN = 3;
const RUN_SHORT_MAX = RUN_MIN + 15;
const RUN_LONG_MAX = RUN_SHORT_MAX + 1 + 255;

/** Big-endian decoded length, ahead of the nibbles. */
export const LENGTH_PREFIX = 2;

/** Reused across frames: the sink packs sixty times a second and must not allocate to do it. */
export class Packer {
	private readonly planed: Uint8Array;
	private nibble = 0;
	private out: Uint8Array = new Uint8Array(0);
	private full = false;

	constructor(maxBytes: number) {
		this.planed = new Uint8Array(maxBytes);
	}

	private put(value: number): void {
		const at = LENGTH_PREFIX + (this.nibble >> 1);
		if (at >= this.out.length) {
			this.full = true;
			return;
		}
		if ((this.nibble & 1) === 0) this.out[at] = value << 4;
		else this.out[at] |= value;
		this.nibble++;
	}

	/**
	 * Packs `count` pixels from `rgb[start..]` into `out`. Returns the byte length, or 0 when it
	 * would not fit, which is the caller's signal to send the pixels as they are.
	 */
	pack(rgb: Uint8Array, start: number, count: number, out: Uint8Array): number {
		const len = count * 3;
		// The header is a u16, so a fixture past 21845 pixels has to go as pixels.
		if (len > 0xffff || len > this.planed.length || out.length < LENGTH_PREFIX) return 0;

		const planed = this.planed;
		for (let c = 0; c < 3; c++) {
			const base = c * count;
			for (let k = 0; k < count; k++) planed[base + k] = rgb[start + k * 3 + c];
		}

		this.out = out;
		this.nibble = 0;
		this.full = false;
		out[0] = (len >> 8) & 0xff;
		out[1] = len & 0xff;

		let previous = 0;
		let i = 0;
		while (i < len && !this.full) {
			const delta = (planed[i] - previous) & 0xff;
			previous = planed[i];
			const code = CODE_OF[delta];
			if (code >= 0) {
				this.put(code);
			} else {
				this.put(LITERAL);
				this.put(delta >> 4);
				this.put(delta & 0x0f);
			}
			i++;

			// A run code carries the repeats after that byte, which is why they are zero runs.
			let repeats = 0;
			while (repeats < RUN_LONG_MAX && i + repeats < len && planed[i + repeats] === previous) {
				repeats++;
			}
			if (repeats < RUN_MIN) continue;
			if (repeats <= RUN_SHORT_MAX) {
				this.put(RUN_SHORT);
				this.put(repeats - RUN_MIN);
			} else {
				const n = repeats - RUN_SHORT_MAX - 1;
				this.put(RUN_LONG);
				this.put(n >> 4);
				this.put(n & 0x0f);
			}
			i += repeats;
		}

		if (this.full) return 0;
		return LENGTH_PREFIX + ((this.nibble + 1) >> 1);
	}
}
