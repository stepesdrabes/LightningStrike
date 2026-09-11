/** Portable Base64 without browser or Node globals. */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/';

const INVERSE = /*@__PURE__*/ (() => {
	const table = new Int8Array(128).fill(-1);
	for (let i = 0; i < ALPHABET.length; i++) table[ALPHABET.charCodeAt(i)] = i;
	return table;
})();

export function encodeBase64(bytes: Uint8Array): string {
	let out = '';
	let i = 0;
	for (; i + 2 < bytes.length; i += 3) {
		const n = (bytes[i] << 16) | (bytes[i + 1] << 8) | bytes[i + 2];
		out += ALPHABET[(n >> 18) & 63] + ALPHABET[(n >> 12) & 63] + ALPHABET[(n >> 6) & 63] + ALPHABET[n & 63];
	}
	const left = bytes.length - i;
	if (left === 1) {
		const n = bytes[i] << 16;
		out += ALPHABET[(n >> 18) & 63] + ALPHABET[(n >> 12) & 63] + '==';
	} else if (left === 2) {
		const n = (bytes[i] << 16) | (bytes[i + 1] << 8);
		out += ALPHABET[(n >> 18) & 63] + ALPHABET[(n >> 12) & 63] + ALPHABET[(n >> 6) & 63] + '=';
	}
	return out;
}

/** Unknown characters are skipped, so whitespace a JSON writer inserted cannot corrupt a run. */
export function decodeBase64(text: string): Uint8Array {
	let count = 0;
	for (let i = 0; i < text.length; i++) {
		const c = text.charCodeAt(i);
		if (c < 128 && INVERSE[c] >= 0) count++;
	}
	const out = new Uint8Array((count * 3) >> 2);
	let acc = 0;
	let bits = 0;
	let at = 0;
	for (let i = 0; i < text.length; i++) {
		const c = text.charCodeAt(i);
		const v = c < 128 ? INVERSE[c] : -1;
		if (v < 0) continue;
		acc = (acc << 6) | v;
		bits += 6;
		if (bits >= 8) {
			bits -= 8;
			out[at++] = (acc >> bits) & 0xff;
		}
	}
	return out;
}
