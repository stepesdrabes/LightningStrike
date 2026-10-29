import { afterEach, describe, expect, it } from 'vitest';
import { cpSync, existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import {
	bundledModels, externalsIn, runtimeFilter, serverDependencies, targetPlatform, withDependencies
} from './bundle-support.js';

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
	it('bundles only the models the app reads, and refuses to bundle without Striker 2.0', () => {
		const root = fixture();
		const retired = ['htdemucs.onnx', 'drumsep-mdx23c.onnx', 'drumsep-mdx23c.NOTICE', 'adtof_frame_rnn.onnx',
			'beat_this.onnx', 'mel-filterbank.bin', 'striker.json', 'README.md'];
		for (const name of retired) write(root, name);
		expect(() => bundledModels(root)).toThrow('no striker2.json');
		write(root, 'striker2.json', JSON.stringify({ file: 'striker2.onnx' }));
		expect(() => bundledModels(root)).toThrow('striker2.onnx');
		for (const name of ['striker2.onnx', 'striker2.NOTICE', 'discogs-effnet-bsdynamic-1.onnx']) write(root, name);
		expect(bundledModels(root)).toEqual(['striker2.json', 'striker2.onnx', 'striker2.NOTICE', 'discogs-effnet-bsdynamic-1.onnx']);
		write(root, 'striker2-small.json', JSON.stringify({ file: 'striker2-small.onnx' }));
		write(root, 'striker2-small.onnx');
		expect(bundledModels(root)).toEqual(['striker2.json', 'striker2.onnx', 'striker2-small.json', 'striker2-small.onnx',
			'striker2.NOTICE', 'discogs-effnet-bsdynamic-1.onnx']);
	});
	it('bundles the golden chunks each manifest lists beside its graph, and refuses a missing one', () => {
		const root = fixture();
		const golden = (prefix: string) => ({ chunks: [0, 1].map((n) => ({
			features: { file: `${prefix}.golden${n}.features.f32` }, outputs: { file: `${prefix}.golden${n}.outputs.f32` }
		})) });
		write(root, 'striker2.json', JSON.stringify({ file: 'striker2.onnx', golden: golden('striker2') }));
		write(root, 'striker2-small.json', JSON.stringify({ file: 'striker2-small.onnx', golden: golden('striker2-small') }));
		for (const name of ['striker2.onnx', 'striker2-small.onnx', 'striker2.golden0.features.f32',
			'striker2.golden0.outputs.f32', 'striker2.golden1.features.f32']) write(root, name);
		expect(() => bundledModels(root)).toThrow('golden file that is not there: striker2.golden1.outputs.f32');
		for (const name of ['striker2.golden1.outputs.f32', ...[0, 1].flatMap((n) =>
			[`striker2-small.golden${n}.features.f32`, `striker2-small.golden${n}.outputs.f32`])]) write(root, name);
		write(root, 'striker2.golden9.outputs.f32');
		expect(bundledModels(root)).toEqual(['striker2.json', 'striker2.onnx', 'striker2.golden0.features.f32',
			'striker2.golden0.outputs.f32', 'striker2.golden1.features.f32', 'striker2.golden1.outputs.f32',
			'striker2-small.json', 'striker2-small.onnx', 'striker2-small.golden0.features.f32',
			'striker2-small.golden0.outputs.f32', 'striker2-small.golden1.features.f32',
			'striker2-small.golden1.outputs.f32']);
		write(root, 'striker2.json', JSON.stringify({ file: 'striker2.onnx', golden: { chunks: [{
			features: { file: '../escape.f32' }, outputs: { file: 'striker2.golden0.outputs.f32' }
		}] } }));
		expect(() => bundledModels(root)).toThrow('golden file');
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
