import { createHash } from 'node:crypto';
import { createReadStream } from 'node:fs';

/** SHA-256 of a file, hex. */
export async function hashFile(path: string): Promise<string> {
	const hash = createHash('sha256');
	// Large reads verify the multi-hundred-megabyte models much faster than the default size.
	for await (const chunk of createReadStream(path, { highWaterMark: 8 * 1024 ** 2 })) hash.update(chunk);
	return hash.digest('hex');
}
