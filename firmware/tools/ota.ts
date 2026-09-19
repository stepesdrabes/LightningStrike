// Firmware upload for The Frame:
// node --experimental-strip-types ota.ts <host> [elf]
// The board cannot tell a wrong image from a right one until it has already swapped to it, so
// every check that can be made here is made here.
import { readFile } from 'node:fs/promises';

/** Must match ACTIVE and DFU in firmware/boot/memory.x and firmware/node/memory.x. */
const ACTIVE = 0x10007000;
const ACTIVE_LEN = 768 * 1024;
const PARTITIONS = {
	__bootloader_state_start: 0x006000,
	__bootloader_state_end: 0x007000,
	__bootloader_dfu_start: 0x0c7000,
	__bootloader_dfu_end: 0x188000
};

const RAM = 0x20000000;
const RAM_LEN = 264 * 1024;

/** The fixture this build drives. A bench build links identically and boots into a reset loop. */
const HOSTNAME = 'room-frame';

const DEFAULT_ELF = new URL('../target/thumbv6m-none-eabi/release/room-node', import.meta.url);

const hex = (n: number) => `0x${n.toString(16)}`;

/** The PT_LOAD segments, flattened into one image based at the lowest physical address. */
function flatten(elf: Buffer) {
	if (elf.readUInt32BE(0) !== 0x7f454c46) throw new Error('not an ELF');
	const phoff = elf.readUInt32LE(0x1c);
	const phentsize = elf.readUInt16LE(0x2a);
	const phnum = elf.readUInt16LE(0x2c);

	const segments = [];
	for (let i = 0; i < phnum; i++) {
		const o = phoff + i * phentsize;
		if (elf.readUInt32LE(o) !== 1) continue;
		const offset = elf.readUInt32LE(o + 4);
		const paddr = elf.readUInt32LE(o + 12);
		const filesz = elf.readUInt32LE(o + 16);
		if (filesz > 0) segments.push({ paddr, bytes: elf.subarray(offset, offset + filesz) });
	}
	if (segments.length === 0) throw new Error('no loadable segments');

	const base = Math.min(...segments.map((s) => s.paddr));
	const end = Math.max(...segments.map((s) => s.paddr + s.bytes.length));
	// Gaps between segments are alignment padding, and erased flash reads as 0xff.
	const image = Buffer.alloc(end - base, 0xff);
	for (const s of segments) s.bytes.copy(image, s.paddr - base);
	return { base, image };
}

/** Linker symbol values, which is where the image records the flash map it was built against. */
function symbols(elf: Buffer) {
	const shoff = elf.readUInt32LE(0x20);
	const shentsize = elf.readUInt16LE(0x2e);
	const shnum = elf.readUInt16LE(0x30);

	const found = new Map<string, number>();
	for (let i = 0; i < shnum; i++) {
		const sh = shoff + i * shentsize;
		if (elf.readUInt32LE(sh + 4) !== 2) continue; // SHT_SYMTAB
		const offset = elf.readUInt32LE(sh + 16);
		const size = elf.readUInt32LE(sh + 20);
		const strtab = shoff + elf.readUInt32LE(sh + 24) * shentsize;
		const strOffset = elf.readUInt32LE(strtab + 16);

		for (let e = offset; e < offset + size; e += 16) {
			const nameAt = strOffset + elf.readUInt32LE(e);
			const end = elf.indexOf(0, nameAt);
			found.set(elf.toString('utf8', nameAt, end), elf.readUInt32LE(e + 4));
		}
	}
	return found;
}

/** Everything that separates an image this board can boot from one that strands it. */
function check(base: number, image: Buffer, elf: Buffer) {
	if (base !== ACTIVE) {
		throw new Error(
			`linked at ${hex(base)}, not the ACTIVE slot ${hex(ACTIVE)}. A bootloader, or a ` +
				'build made before the A/B split, would be swapped in and never boot.'
		);
	}
	if (image.length > ACTIVE_LEN) {
		throw new Error(`image is ${image.length} bytes, over the ${ACTIVE_LEN} byte slot`);
	}

	// A Cortex-M image begins with its vector table: initial stack pointer, then reset vector.
	const sp = image.readUInt32LE(0);
	const reset = image.readUInt32LE(4);
	if (sp <= RAM || sp > RAM + RAM_LEN) {
		throw new Error(`stack pointer ${hex(sp)} is outside RAM, so this is not a vector table`);
	}
	if ((reset & 1) === 0) throw new Error(`reset vector ${hex(reset)} is not a thumb address`);
	if (reset < ACTIVE || reset >= ACTIVE + image.length) {
		throw new Error(`reset vector ${hex(reset)} points outside the image`);
	}

	// An image built against a different flash map writes the swap magic somewhere the running
	// bootloader does not read.
	const found = symbols(elf);
	for (const [name, want] of Object.entries(PARTITIONS)) {
		const got = found.get(name);
		if (got === undefined) throw new Error(`${name} is missing; this is not an A/B build`);
		if (got !== want) throw new Error(`${name} is ${hex(got)}, expected ${hex(want)}`);
	}

	if (!image.includes(HOSTNAME)) {
		throw new Error(`no "${HOSTNAME}" in the image: this looks like the bench build`);
	}
}

const host = process.argv[2];
const elfPath = process.argv[3] ?? DEFAULT_ELF;
if (!host) {
	console.error('usage: node --experimental-strip-types ota.ts <host> [elf]');
	process.exit(2);
}

const elf = await readFile(elfPath);
const { base, image } = flatten(elf);
try {
	check(base, image, elf);
} catch (err) {
	console.error(`refusing to upload: ${(err as Error).message}`);
	process.exit(1);
}

const url = `http://${host}/api/ota`;
console.log(`${image.length} bytes at ${hex(base)} -> ${url}`);

let res;
try {
	res = await fetch(url, {
		method: 'POST',
		headers: {
			'content-type': 'application/octet-stream',
			'content-length': String(image.length)
		},
		body: image
	});
} catch (err) {
	// Nothing is staged: the slot is only armed by a reply this never received.
	const cause = (err as { cause?: Error }).cause ?? (err as Error);
	console.error(`${url}: ${cause.message}`);
	process.exit(1);
}

console.log(`${res.status} ${await res.text()}`);
if (!res.ok) process.exit(1);
console.log('staged. The board reboots into it, and reverts itself if it cannot reach the network.');
