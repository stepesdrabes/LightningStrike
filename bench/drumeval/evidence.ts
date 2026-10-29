// Where drum evaluation writes its runs, and the JSON helpers its harnesses share.
import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { ROOT } from './corpus.ts';

export const EVAL_ROOT = join(ROOT, 'bench', 'reports', 'drumeval');

function atomic(path: string, data: string | Buffer): void {
	mkdirSync(dirname(path), { recursive: true });
	const temp = `${path}.${process.pid}.tmp`;
	writeFileSync(temp, data);
	renameSync(temp, path);
}

export function writeJson(path: string, value: unknown): void {
	atomic(path, JSON.stringify(value, null, '	'));
}

export function readJson<T>(path: string): T | null {
	return existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) as T : null;
}
