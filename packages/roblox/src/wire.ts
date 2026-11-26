import { constants, zstdCompressSync, zstdDecompressSync } from 'node:zlib';

/** A pack is under a megabyte even for Roblox's 7-minute audio cap; this bounds a corrupt frame. */
const MAX_PACK_BYTES = 16 << 20;
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

/**
 * One standard zstd frame with a checksum, the format Roblox's EncodingService:DecompressBuffer
 * reads. Compressed in one call, the frame also states its content size.
 */
export function compressPack(pack: Uint8Array, level = 19): Uint8Array {
	return new Uint8Array(
		zstdCompressSync(pack, {
			params: {
				[constants.ZSTD_c_compressionLevel]: level,
				[constants.ZSTD_c_checksumFlag]: 1
			}
		})
	);
}

export function decompressPack(frame: Uint8Array): Uint8Array {
	return new Uint8Array(zstdDecompressSync(frame, { maxOutputLength: MAX_PACK_BYTES }));
}

/** The compressed pack as standard padded base64, the box's wire text for EncodingService:Base64Decode. */
export function packToWire(pack: Uint8Array): string {
	return Buffer.from(compressPack(pack)).toString('base64');
}

export function packFromWire(text: string): Uint8Array {
	if (!BASE64.test(text)) throw new Error('a pack on the wire is standard padded base64');
	return decompressPack(Buffer.from(text, 'base64'));
}
