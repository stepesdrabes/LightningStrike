import { describe, expect, it } from 'vitest';
import { benchmarkCache, desktopCache } from './cache.ts';

describe('benchmark cache selection', () => {
	const windows = {
		platform: 'win32' as const,
		home: 'C:\\Users\\Listener',
		env: {
			LOCALAPPDATA: 'D:\\Local Data',
			APPDATA: 'R:\\Roaming',
			MV_CACHE_DIR: 'E:\\review cache'
		}
	};

	it('preserves an explicit CLI path over the environment and platform default', () => {
		expect(benchmarkCache('../frozen review/', windows)).toBe('../frozen review/');
	});

	it('honors MV_CACHE_DIR without resolving or rewriting it', () => {
		expect(benchmarkCache(undefined, windows)).toBe('E:\\review cache');
		expect(benchmarkCache(undefined, { ...windows, env: { MV_CACHE_DIR: '../review/' } }))
			.toBe('../review/');
	});

	it('retains explicit empty paths instead of selecting another cache', () => {
		expect(benchmarkCache('', windows)).toBe('');
		expect(benchmarkCache(undefined, { ...windows, env: { MV_CACHE_DIR: '' } })).toBe('');
	});

	it('uses Windows local app data, never roaming app data', () => {
		expect(benchmarkCache(undefined, {
			...windows,
			env: { LOCALAPPDATA: 'D:\\Local Data', APPDATA: 'R:\\Roaming' }
		})).toBe('D:\\Local Data\\cz.drabek.lightningstrike\\cache');
	});

	it('falls back to the Windows home local-data directory', () => {
		expect(benchmarkCache(undefined, { ...windows, env: {} }))
			.toBe('C:\\Users\\Listener\\AppData\\Local\\cz.drabek.lightningstrike\\cache');
	});

	it('preserves the existing macOS desktop location', () => {
		expect(benchmarkCache(undefined, {
			platform: 'darwin', home: '/Users/listener', env: {}
		})).toBe('/Users/listener/Library/Application Support/cz.drabek.lightningstrike/cache');
	});

	it('uses XDG data on Linux, with a home-directory fallback', () => {
		expect(benchmarkCache(undefined, {
			platform: 'linux', home: '/home/listener', env: { XDG_DATA_HOME: '/data' }
		})).toBe('/data/cz.drabek.lightningstrike/cache');
		expect(benchmarkCache(undefined, {
			platform: 'linux', home: '/home/listener', env: {}
		})).toBe('/home/listener/.local/share/cz.drabek.lightningstrike/cache');
	});

	it('keeps the secondary desktop cache separate from the primary override', () => {
		expect(desktopCache('cache-C', windows))
			.toBe('D:\\Local Data\\cz.drabek.lightningstrike\\cache-C');
		expect(desktopCache('cache-C', {
			platform: 'darwin', home: '/Users/listener', env: { MV_CACHE_DIR: '/review' }
		})).toBe('/Users/listener/Library/Application Support/cz.drabek.lightningstrike/cache-C');
	});
});
