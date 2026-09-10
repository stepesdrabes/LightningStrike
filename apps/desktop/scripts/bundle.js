// Assemble everything the Tauri bundler needs that is not source: the built server, the Node
// runtime that executes it, and the node_modules the build deliberately left external.
//
//   node scripts/bundle.js
//
// Wired in as `beforeBuildCommand`, so `tauri build` cannot package a stale server: nothing here
// is checked in, and on a dirty tree the build used to ship whatever `apps/web/build` happened to
// hold. Still runnable by hand as `npm run bundle`, which is what `tauri dev` needs. Idempotent.

import { execFileSync, execSync } from 'node:child_process';
import {
	cpSync,
	existsSync,
	mkdirSync,
	readFileSync,
	readdirSync,
	renameSync,
	rmSync,
	statSync
} from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const desktop = resolve(here, '..');
const root = resolve(desktop, '../..');
const modules = join(root, 'node_modules');
const runtime = join(desktop, 'src-tauri/runtime/node_modules');
const binaries = join(desktop, 'src-tauri/binaries');

/**
 * What `rustc -vV` calls this machine.
 *
 * Tauri finds a sidecar by exact target triple suffix, so a binary named for the wrong triple
 * is not a warning, it is a missing sidecar at runtime.
 */
function hostTriple() {
	const out = execFileSync('rustc', ['-vV'], { encoding: 'utf8' });
	const match = /^host: (\S+)$/m.exec(out);
	if (!match) throw new Error('could not read the host triple from rustc -vV');
	return match[1];
}

/**
 * The packages the built server still imports by bare name.
 *
 * Vite bundles what it can, but a native addon cannot be bundled and a dynamic import of one
 * stays a bare specifier in the output. Reading the output rather than the manifest is what
 * makes this correct: it ships what the build actually asks for, not what was declared.
 */
function externalsIn(dir) {
	const found = new Set();
	const BARE = /(?:require\(|import\(|from\s*)["']([^."'][^"']*)["']/g;

	const walk = (path) => {
		for (const entry of readdirSync(path, { withFileTypes: true })) {
			const full = join(path, entry.name);
			if (entry.isDirectory()) walk(full);
			else if (entry.name.endsWith('.js')) {
				const text = readFileSync(full, 'utf8');
				for (const [, spec] of text.matchAll(BARE)) {
					if (spec.startsWith('node:')) continue;
					// Scoped packages carry their org in the first segment.
					const parts = spec.split('/');
					const name = spec.startsWith('@') ? parts.slice(0, 2).join('/') : parts[0];
					if (existsSync(join(modules, name))) found.add(name);
				}
			}
		}
	};

	walk(dir);
	return found;
}

/**
 * A self-contained Node of the version this workspace is developed against.
 *
 * The obvious binary, `process.execPath`, is the wrong one on most machines: Homebrew ships a
 * 66 kB launcher against `@rpath/libnode.dylib` plus its own llhttp and libuv, so copying it
 * produces an app that runs here and dies everywhere else. The official builds are one
 * executable that needs nothing but the system libraries, and pinning the version to the
 * local one keeps the packaged runtime the same as the tested one.
 */
function officialNode(triple) {
	const version = `v${process.versions.node}`;
	const platform = triple.includes('apple-darwin')
		? 'darwin'
		: triple.includes('windows')
			? 'win'
			: 'linux';
	const arch = triple.startsWith('aarch64') ? 'arm64' : 'x64';
	const name = `node-${version}-${platform}-${arch}`;

	const cache = join(binaries, '.cache');
	mkdirSync(cache, { recursive: true });

	// Windows is the one platform nodejs.org publishes the executable on its own for, so there
	// is nothing to unpack. The archive it also offers is a .zip, which `tar -xzf` cannot read.
	if (platform === 'win') {
		const binary = join(cache, `${name}.exe`);
		if (existsSync(binary)) return binary;
		const url = `https://nodejs.org/dist/${version}/win-${arch}/node.exe`;
		console.log(`fetching    ${url}`);
		// Written beside and renamed: there is no archive to fail to unpack here, so a curl
		// that dies halfway would otherwise leave a truncated node every later run accepts.
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

/**
 * What the workspace packages declare they need at runtime.
 *
 * Scanning the output finds what a bundler left as a bare import, which misses anything
 * deliberately hidden from it: beatthis.ts resolves onnxruntime-node through createRequire
 * precisely so no bundler can inline its native addon, and that makes it invisible to the
 * scan as well. The manifests are the other half of the truth.
 */
function declaredByWorkspace() {
	const found = new Set();
	const packages = join(root, 'packages');
	for (const name of readdirSync(packages)) {
		const manifest = join(packages, name, 'package.json');
		if (!existsSync(manifest)) continue;
		const pkg = JSON.parse(readFileSync(manifest, 'utf8'));
		for (const dep of Object.keys(pkg.dependencies ?? {})) {
			// The workspace packages themselves are compiled into the server, not copied.
			if (!dep.startsWith('@mv/')) found.add(dep);
		}
	}
	return found;
}

/** Everything those packages need in turn, so the copy is self-contained. */
function withDependencies(names) {
	const closed = new Set();
	const pending = [...names];

	while (pending.length > 0) {
		const name = pending.pop();
		if (closed.has(name)) continue;
		const manifest = join(modules, name, 'package.json');
		if (!existsSync(manifest)) continue;
		closed.add(name);

		const pkg = JSON.parse(readFileSync(manifest, 'utf8'));
		// Runtime dependencies only. optionalDependencies are per-platform native builds that
		// are not installed here, and devDependencies never run.
		for (const dep of Object.keys(pkg.dependencies ?? {})) pending.push(dep);
	}

	return closed;
}

/**
 * onnxruntime-node ships every platform it supports, which is 258 MB to carry 74 MB of use.
 *
 * The directory names under `bin/napi-v*` are Node's own `process.platform` and `process.arch`,
 * so the triple maps onto them rather than needing a table.
 */
function pruneOnnx(triple) {
	const bin = join(runtime, 'onnxruntime-node/bin');
	if (!existsSync(bin)) return 0;

	const platform = triple.includes('apple-darwin')
		? 'darwin'
		: triple.includes('windows')
			? 'win32'
			: 'linux';
	const arch = triple.startsWith('aarch64') ? 'arm64' : 'x64';

	let removed = 0;
	for (const napi of readdirSync(bin)) {
		const dir = join(bin, napi);
		if (!statSync(dir).isDirectory()) continue;
		for (const os of readdirSync(dir)) {
			for (const cpu of readdirSync(join(dir, os))) {
				if (os === platform && cpu === arch) continue;
				removed += sizeOf(join(dir, os, cpu));
				rmSync(join(dir, os, cpu), { recursive: true, force: true });
			}
		}
	}
	return removed;
}

function sizeOf(path) {
	if (!existsSync(path)) return 0;
	const info = statSync(path);
	if (!info.isDirectory()) return info.size;
	return readdirSync(path).reduce((sum, entry) => sum + sizeOf(join(path, entry)), 0);
}

const mb = (bytes) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

// ---------------------------------------------------------------------------

const triple = hostTriple();
console.log(`bundling for ${triple}`);

// Built here rather than assumed, because a stale build/ is invisible: the app starts, serves
// an older UI, and answers new routes with the page fallback rather than an error.
console.log('building the server');
// Through a shell, because npm is a .cmd on Windows and Node has refused to execute one
// directly since 20.12. The command is a literal, so there is nothing here to reinterpret.
execSync('npm run build -w @mv/web', { cwd: root, stdio: 'inherit' });

const build = join(root, 'apps/web/build');
if (!existsSync(build)) throw new Error('the web build produced no apps/web/build');

// The ingest worker, bundled to one file beside the server. In dev it runs straight from
// the source tree; the app has no source tree, and without this file every ingest would
// fall back to the main thread and freeze the server for minutes per track. It lands in
// server/ so createRequire resolves onnxruntime-node from the node_modules shipped there.
console.log('building the ingest worker');
{
	const { rolldown } = await import('rolldown');
	const worker = await rolldown({
		input: join(root, 'packages/analysis/src/ingestWorker.ts'),
		platform: 'node',
		external: ['onnxruntime-node']
	});
	await worker.write({
		file: join(build, 'ingest-worker.mjs'),
		format: 'esm',
		inlineDynamicImports: true
	});
	await worker.close();
	if (!existsSync(join(build, 'ingest-worker.mjs'))) {
		throw new Error('rolldown produced no ingest-worker.mjs');
	}
}

mkdirSync(binaries, { recursive: true });
const node = officialNode(triple);
// Tauri finds a sidecar by exact filename, and on Windows that includes the .exe.
const exe = triple.includes('windows') ? '.exe' : '';
cpSync(node, join(binaries, `node-${triple}${exe}`), { dereference: true });
console.log(`node        ${mb(sizeOf(node))}  ${node}`);

// The packages the build left external, and everything they need in turn.
rmSync(runtime, { recursive: true, force: true });
mkdirSync(runtime, { recursive: true });

const direct = new Set([...externalsIn(build), ...declaredByWorkspace()]);
const all = withDependencies(direct);
for (const name of all) {
	cpSync(join(modules, name), join(runtime, name), { recursive: true, dereference: true });
}
console.log(`node_modules ${all.size} packages (${direct.size} needed directly)`);

// The one dependency whose absence is silent rather than loud: without it the analyser falls
// back to the in-repo tracker and simply produces a worse grid.
if (!existsSync(join(runtime, 'onnxruntime-node'))) {
	throw new Error('onnxruntime-node did not make it into the bundle; beat tracking would fall back');
}

// The agent SDK spawns its CLI from a per-platform optionalDependency, and the dependency
// walk above skips optionalDependencies on purpose: the other platforms' builds are not
// installed here. This is the one of them the target platform cannot author without - the
// SDK throws "Native CLI binary not found" on the first Design press - so it is copied by
// name and its absence fails the build instead of the user's evening.
{
	const platform = triple.includes('apple-darwin')
		? 'darwin'
		: triple.includes('windows')
			? 'win32'
			: 'linux';
	const arch = triple.startsWith('aarch64') ? 'arm64' : 'x64';
	const cli = `@anthropic-ai/claude-agent-sdk-${platform}-${arch}`;
	if (!existsSync(join(modules, cli))) {
		throw new Error(`${cli} is not installed; the app would have no CLI for the agent SDK to spawn`);
	}
	cpSync(join(modules, cli), join(runtime, cli), { recursive: true, dereference: true });
	console.log(`author CLI  ${mb(sizeOf(join(runtime, cli)))}  ${cli}`);
}

const saved = pruneOnnx(triple);
if (saved > 0) console.log(`pruned      ${mb(saved)} of other platforms from onnxruntime-node`);

console.log(`server      ${mb(sizeOf(build))}`);
console.log(`runtime     ${mb(sizeOf(runtime))}`);
console.log(`models      ${mb(sizeOf(join(root, 'models')))}`);
