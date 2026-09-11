import { homedir } from 'node:os';
import { posix, win32 } from 'node:path';

interface CacheSystem {
	platform?: NodeJS.Platform;
	env?: NodeJS.ProcessEnv;
	home?: string;
}

export function desktopCache(name = 'cache', system: CacheSystem = {}): string {
	const platform = system.platform ?? process.platform;
	const env = system.env ?? process.env;
	const home = system.home ?? homedir();
	const path = platform === 'win32' ? win32 : posix;
	const data = platform === 'win32'
		? env.LOCALAPPDATA || path.join(home, 'AppData', 'Local')
		: platform === 'darwin'
			? path.join(home, 'Library', 'Application Support')
			: env.XDG_DATA_HOME || path.join(home, '.local', 'share');
	return path.join(data, 'cz.drabek.lightningstrike', name);
}

export function benchmarkCache(explicit?: string, system: CacheSystem = {}): string {
	return explicit ?? (system.env ?? process.env).MV_CACHE_DIR ?? desktopCache('cache', system);
}
