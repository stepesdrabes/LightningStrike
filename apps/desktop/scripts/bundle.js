// Assemble the built server, pinned Node runtime and external dependencies for Tauri.

import { execFileSync, execSync } from 'node:child_process';
import {
	cpSync,
	existsSync,
	mkdirSync,
	readdirSync,
	renameSync,
	rmSync,
	statSync
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { NODE_VERSION, externalsIn, runtimeFilter, serverDependencies, targetPlatform, withDependencies } from './bundle-support.js';

const here = dirname(fileURLToPath(import.meta.url));
const desktop = resolve(here, '..');
const root = resolve(desktop, '../..');
const modules = join(root, 'node_modules');
const runtime = join(desktop, 'src-tauri/runtime/node_modules');
const binaries = join(desktop, 'src-tauri/binaries');

/** Tauri requires the sidecar filename to end in the exact Rust target triple. */
function hostTriple() {
	const out = execFileSync('rustc', ['-vV'], { encoding: 'utf8' });
	const match = /^host: (\S+)$/m.exec(out);
	if (!match) throw new Error('could not read the host triple from rustc -vV');
	return match[1];
}

/** Use official standalone Node builds; Homebrew launchers depend on local shared libraries. */
function officialNode({ nodePlatform: platform, arch }) {
	const version = `v${NODE_VERSION}`;
	const name = `node-${version}-${platform}-${arch}`;

	const cache = join(binaries, '.cache');
	mkdirSync(cache, { recursive: true });

	// Windows publishes node.exe directly; its archive is a zip, not a tarball.
	if (platform === 'win') {
		const binary = join(cache, `${name}.exe`);
		if (existsSync(binary)) return binary;
		const url = `https://nodejs.org/dist/${version}/win-${arch}/node.exe`;
		console.log(`fetching    ${url}`);
		// Rename only after downloading, so interrupted downloads cannot leave an accepted partial
		// binary.
		const partial = `${binary}.part`;
		execFileSync('curl', ['-fsSL', '-o', partial, url], { stdio: 'inherit' });
		renameSync(partial, binary);
		return binary;
	}

	const binary = join(cache, name, 'bin/node');
	if (existsSync(binary)) return binary;

	const url = `https://nodejs.org/dist/${version}/${name}.tar.gz`;
	console.log(`fetching    ${url}`);
	const tarball = join(cache, `${name}.tar.gz`);
	execFileSync('curl', ['-fsSL', '-o', tarball, url], { stdio: 'inherit' });
	execFileSync('tar', ['-xzf', tarball, '-C', cache, `${name}/bin/node`], { stdio: 'inherit' });
	rmSync(tarball, { force: true });

	if (!existsSync(binary)) throw new Error(`the ${name} tarball had no bin/node`);
	return binary;
}

function sizeOf(path) {
	if (!existsSync(path)) return 0;
	const info = statSync(path);
	if (!info.isDirectory()) return info.size;
	return readdirSync(path).reduce((sum, entry) => sum + sizeOf(join(path, entry)), 0);
}

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

const triple = hostTriple();
const target = targetPlatform(triple);
console.log(`bundling for ${triple}`);

// Rebuild before bundling so the packaged server cannot be stale.
console.log('building the server');
// A shell is required for npm.cmd on Windows; the command is a fixed literal.
execSync('npm run build -w @mv/web', { cwd: root, stdio: 'inherit' });

const build = join(root, 'apps/web/build');
if (!existsSync(build)) throw new Error('the web build produced no apps/web/build');

// Bundle the ingest worker beside the server so native addons resolve from its node_modules.
// Analysis looks for its ONNX and DSP workers next to the ingest bundle, and the evening
// loader for its own.
console.log('building the workers');
{
	const { rolldown } = await import('rolldown');
	for (const [input, file] of [
		['packages/analysis/src/ingestWorker.ts', 'ingest-worker.mjs'],
		['packages/analysis/src/onnxWorker.ts', 'onnx-worker.mjs'],
		['packages/analysis/src/dspWorker.ts', 'dsp-worker.mjs'],
		['apps/web/src/lib/server/evening/eveningWorker.ts', 'evening-worker.mjs']
	]) {
		const worker = await rolldown({
			input: join(root, input),
			platform: 'node',
			external: ['onnxruntime-node']
		});
		await worker.write({
			file: join(build, file),
			format: 'esm',
			codeSplitting: false
		});
		await worker.close();
		if (!existsSync(join(build, file))) throw new Error(`rolldown produced no ${file}`);
	}
}

mkdirSync(binaries, { recursive: true });
const node = officialNode(target);
// Tauri finds a sidecar by exact filename, and on Windows that includes the .exe.
cpSync(node, join(binaries, `node-${triple}${target.exe}`), { dereference: true });
console.log(`node        ${mb(sizeOf(node))}  ${node}`);

// The packages the build left external, and everything they need in turn.
rmSync(runtime, { recursive: true, force: true });
mkdirSync(runtime, { recursive: true });

const direct = new Set([...externalsIn(build, modules), ...serverDependencies(root)]);
const all = withDependencies(direct, modules);
for (const name of all) {
	const source = join(modules, name);
	cpSync(source, join(runtime, name), {
		recursive: true, dereference: true, filter: runtimeFilter(source, name, target)
	});
}
console.log(`node_modules ${all.size} packages (${direct.size} needed directly)`);

// Fail if ONNX is missing; otherwise analysis silently falls back to the weaker tracker.
if (!existsSync(join(runtime, 'onnxruntime-node'))) {
	throw new Error('onnxruntime-node did not make it into the bundle; beat tracking would fall back');
}

// The SDK needs its platform-specific optional CLI package to author; fail the build if absent.
{
	const cli = `@anthropic-ai/claude-agent-sdk-${target.platform}-${target.arch}`;
	if (!existsSync(join(modules, cli))) {
		throw new Error(`${cli} is not installed; the app would have no CLI for the agent SDK to spawn`);
	}
	cpSync(join(modules, cli), join(runtime, cli), { recursive: true, dereference: true });
	console.log(`author CLI  ${mb(sizeOf(join(runtime, cli)))}  ${cli}`);
}

console.log(`server      ${mb(sizeOf(build))}`);
console.log(`runtime     ${mb(sizeOf(runtime))}`);
console.log(`models      ${mb(sizeOf(join(root, 'models')))}`);
