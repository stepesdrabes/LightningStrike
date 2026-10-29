import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

export const NODE_VERSION = '24.11.0';

export function targetPlatform(triple) {
	const platform = triple.includes('apple-darwin')
		? 'darwin'
		: triple.includes('windows') ? 'win32' : 'linux';
	return {
		platform,
		nodePlatform: platform === 'win32' ? 'win' : platform,
		arch: triple.startsWith('aarch64') ? 'arm64' : 'x64',
		exe: platform === 'win32' ? '.exe' : ''
	};
}

export function externalsIn(dir, modules) {
	const found = new Set();
	const bare = /(?:require\(|import\(|from\s*)["']([^."'][^"']*)["']/g;
	const walk = (path) => {
		for (const entry of readdirSync(path, { withFileTypes: true })) {
			const full = join(path, entry.name);
			if (entry.isDirectory()) walk(full);
			else if (/\.[cm]?js$/.test(entry.name)) {
				for (const [, spec] of readFileSync(full, 'utf8').matchAll(bare)) {
					if (spec.startsWith('node:')) continue;
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

// Native addons and the author SDK also resolve packages through createRequire.
export function serverDependencies(root) {
	const found = new Set();
	for (const name of ['analysis', 'author-ai']) {
		const pkg = JSON.parse(readFileSync(join(root, 'packages', name, 'package.json'), 'utf8'));
		for (const dep of Object.keys(pkg.dependencies ?? {})) {
			if (!dep.startsWith('@mv/')) found.add(dep);
		}
	}
	return found;
}

export function withDependencies(names, modules) {
	const closed = new Set();
	const pending = [...names];
	while (pending.length > 0) {
		const name = pending.pop();
		if (closed.has(name)) continue;
		const manifest = join(modules, name, 'package.json');
		if (!existsSync(manifest)) continue;
		closed.add(name);
		const pkg = JSON.parse(readFileSync(manifest, 'utf8'));
		for (const dep of Object.keys(pkg.dependencies ?? {})) pending.push(dep);
	}
	return closed;
}

/** Striker 2.0's manifests; each names its graph. The first one is required. */
const STRIKER2_MANIFESTS = ['striker2.json', 'striker2-small.json'];
/** Read beside the manifests when present: the weights' notices and the genre model. */
const OPTIONAL_MODELS = ['striker2.NOTICE', 'striker2-small.NOTICE', 'discogs-effnet-bsdynamic-1.onnx'];

/**
 * The files of `models/` the app reads. Anything else there (retired separators, local
 * experiments) stays out of the bundle; without Striker 2.0 the app could prepare nothing.
 */
export function bundledModels(dir) {
	const files = [];
	for (const manifest of STRIKER2_MANIFESTS) {
		if (!existsSync(join(dir, manifest))) continue;
		const { file } = JSON.parse(readFileSync(join(dir, manifest), 'utf8'));
		if (typeof file !== 'string' || !existsSync(join(dir, file))) {
			throw new Error(`models/${manifest} names a graph that is not there: ${file}`);
		}
		files.push(manifest, file);
	}
	if (!files.includes(STRIKER2_MANIFESTS[0])) {
		throw new Error('models/ has no striker2.json: copy Striker 2.0 in before bundling');
	}
	return [...files, ...OPTIONAL_MODELS.filter((name) => existsSync(join(dir, name)))];
}

export function runtimeFilter(packageRoot, name, target) {
	return (source) => {
		const path = relative(packageRoot, source).split(sep);
		if (/\.d\.[cm]?ts(?:\.map)?$/.test(path.at(-1) ?? '')) return false;
		if (name === 'onnxruntime-node' && path[0] === 'bin' && /^napi-v\d+$/.test(path[1] ?? '')) {
			if (path.length >= 3 && path[2] !== target.platform) return false;
			if (path.length >= 4 && path[3] !== target.arch) return false;
		}
		return true;
	};
}
