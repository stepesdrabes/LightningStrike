// node packages/analysis/native/build.ts [--out=PATH]
// Builds the Metal separation binding on macOS. N-API keeps it valid across Node versions.
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join } from 'node:path';

export const METAL_ADDON = join(import.meta.dirname, 'build', 'mlas-metal.node');

function nodeHeaders(): string {
	const version = process.versions.node;
	const candidates = [
		join(dirname(process.execPath), '..', 'include', 'node'),
		join(homedir(), 'Library', 'Caches', 'node-gyp', version, 'include', 'node'),
		join(homedir(), '.cache', 'node-gyp', version, 'include', 'node')
	];
	const found = candidates.find((dir) => existsSync(join(dir, 'node_api.h')));
	if (!found) throw new Error(`No node_api.h found; tried ${candidates.join(', ')}`);
	return found;
}

export function buildMetalAddon(out = METAL_ADDON): string {
	if (process.platform !== 'darwin') throw new Error('The Metal binding builds only on macOS.');
	mkdirSync(dirname(out), { recursive: true });
	// Contraction off: the CPU arithmetic must round exactly where ONNX Runtime's does.
	execFileSync('xcrun', [
		'clang++', '-std=c++20', '-O2', '-ffp-contract=off', '-fobjc-arc', '-shared', '-undefined', 'dynamic_lookup',
		'-mmacosx-version-min=14.0', '-DNODE_GYP_MODULE_NAME=mlas_metal', '-I', nodeHeaders(),
		'-framework', 'Metal', '-framework', 'Foundation',
		join(import.meta.dirname, 'metal.mm'), join(import.meta.dirname, 'cpu.cpp'), '-o', out
	], { stdio: 'inherit' });
	return out;
}

if (import.meta.main) {
	const out = process.argv.find((a) => a.startsWith('--out='))?.slice(6);
	console.log(buildMetalAddon(out));
}
