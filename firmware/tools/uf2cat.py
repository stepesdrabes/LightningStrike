# Join UF2 files into one the RP2040 bootloader accepts in a single copy:
#   python uf2cat.py <out.uf2> <in.uf2> [in.uf2 ...]
# Needed only for the first A/B install, where flashing the bootloader on its own would reboot
# into an ACTIVE slot that does not hold an application yet.
import struct
import sys

BLOCK = 512
MAGIC0 = 0x0A324655
MAGIC_END = 0x0AB16F30

out_path, *sources = sys.argv[1:]
blocks = []
for path in sources:
	data = open(path, 'rb').read()
	if len(data) % BLOCK:
		raise SystemExit(f'{path}: not a whole number of UF2 blocks')
	for i in range(0, len(data), BLOCK):
		block = bytearray(data[i:i + BLOCK])
		if struct.unpack_from('<I', block, 0)[0] != MAGIC0:
			raise SystemExit(f'{path}: block {i // BLOCK} is not a UF2 block')
		if struct.unpack_from('<I', block, 508)[0] != MAGIC_END:
			raise SystemExit(f'{path}: block {i // BLOCK} has no end magic')
		blocks.append(block)

# blockNo and numBlocks are how the bootloader knows the transfer is complete, so both have to
# be renumbered across the joined set rather than kept per source file.
for n, block in enumerate(blocks):
	struct.pack_into('<I', block, 20, n)
	struct.pack_into('<I', block, 24, len(blocks))

open(out_path, 'wb').write(b''.join(blocks))
addrs = [struct.unpack_from('<I', b, 12)[0] for b in blocks]
print(f'{out_path}: {len(blocks)} blocks, 0x{min(addrs):08x}..0x{max(addrs):08x}')
