/** xorshift32. Deterministic so recordings and exports reproduce exactly. */
export class Rng {
	private state: number;

	constructor(seed = 0x9e3779b9) {
		this.state = seed >>> 0 || 1;
	}

	seed(v: number): void {
		this.state = v >>> 0 || 1;
	}

	next(): number {
		let s = this.state;
		s ^= s << 13;
		s ^= s >>> 17;
		s ^= s << 5;
		this.state = s >>> 0;
		return this.state;
	}

	float(): number {
		return this.next() / 4294967296;
	}

	int(n: number): number {
		return this.next() % n;
	}

	range(lo: number, hi: number): number {
		return lo + this.float() * (hi - lo);
	}
}

/**
 * Stateless hash in 0..1. Re-coerce each XOR to unsigned to avoid negative brightness or
 * indices.
 */
export function hash01(k: number): number {
	let h = (k | 0) >>> 0;
	h = ((h ^ 61) ^ (h >>> 16)) >>> 0;
	h = (h + (h << 3)) >>> 0;
	h = (h ^ (h >>> 4)) >>> 0;
	h = Math.imul(h, 0x27d4eb2d) >>> 0;
	h = (h ^ (h >>> 15)) >>> 0;
	return h / 4294967296;
}
