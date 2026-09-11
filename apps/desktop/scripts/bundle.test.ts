import { afterEach, describe, expect, it } from 'vitest';
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { externalsIn, runtimeFilter, serverDependencies, targetPlatform, withDependencies } from './bundle-support.js';

const fixtures: string[] = [];
afterEach(() => {
	for (const path of fixtures.splice(0)) rmSync(path, { recursive: true, force: true });
});
function fixture() {
	const root = mkdtempSync(join(tmpdir(), 'lightningstrike-bundle-'));
	fixtures.push(root);
	return root;
}
function write(root: string, path: string, content = '') {
	const file = join(root, path);
	mkdirSync(dirname(file), { recursive: true });
	writeFileSync(file, content);
}

describe('desktop runtime packaging', () => {
	it.each([
		['x86_64-pc-windows-msvc', 'win32', 'win', 'x64', '.exe'],
		['aarch64-apple-darwin', 'darwin', 'darwin', 'arm64', ''],
		['x86_64-apple-darwin', 'darwin', 'darwin', 'x64', ''],
		['aarch64-unknown-linux-gnu', 'linux', 'linux', 'arm64', ''],
		['x86_64-unknown-linux-gnu', 'linux', 'linux', 'x64', '']
	])('selects the matching runtime for %s', (triple, platform, nodePlatform, arch, exe) => {
		expect(targetPlatform(triple)).toEqual({ platform, nodePlatform, arch, exe });
	});
	it('includes built externals and hidden server dependencies without client packages', () => {
		const root = fixture();
		const modules = join(root, 'node_modules');
		for (const [name, dependencies] of [
			['server', { transitive: '*' }], ['transitive', { server: '*' }],
			['native', {}], ['@vendor/sdk', {}], ['three', {}], ['postprocessing', {}]
		] as const) write(modules, `${name}/package.json`, JSON.stringify({ dependencies }));
		write(root, 'packages/analysis/package.json', JSON.stringify({ dependencies: { '@mv/core': '*', native: '*' } }));
		write(root, 'packages/author-ai/package.json', JSON.stringify({ dependencies: { '@vendor/sdk': '*' } }));
		write(root, 'packages/preview3d/package.json', JSON.stringify({ dependencies: { three: '*', postprocessing: '*' } }));
		write(root, 'build/server/index.js', "import x from 'server'; import 'node:fs';");
		write(root, 'build/worker.mjs', "const x = import('@vendor/sdk/subpath');");
		write(root, 'build/entry.cjs', "const x = require('server/subpath');");
		const direct = new Set([...externalsIn(join(root, 'build'), modules), ...serverDependencies(root)]);
		expect([...withDependencies(direct, modules)].sort()).toEqual(['@vendor/sdk', 'native', 'server', 'transitive']);
	});
	it('copies code, licenses and matching native binaries while omitting declarations', () => {
		const root = fixture();
		const source = join(root, 'source');
		const output = join(root, 'output');
		const keep = ['package.json', 'LICENSE', 'lib/index.js', 'lib/index.js.map', 'src/runtime.js', 'bin/napi-v3/win32/x64/onnxruntime.dll'];
		const omit = ['lib/index.d.ts', 'lib/index.d.ts.map', 'lib/index.d.mts', 'lib/index.d.cts.map', 'bin/napi-v3/win32/arm64/onnxruntime.dll', 'bin/napi-v3/linux/x64/libonnxruntime.so'];
		for (const file of [...keep, ...omit]) write(source, file, 'fixture');
		cpSync(source, output, { recursive: true, filter: runtimeFilter(source, 'onnxruntime-node', targetPlatform('x86_64-pc-windows-msvc')) });
		for (const file of keep) expect(existsSync(join(output, file)), file).toBe(true);
		for (const file of omit) expect(existsSync(join(output, file)), file).toBe(false);
	});
});
