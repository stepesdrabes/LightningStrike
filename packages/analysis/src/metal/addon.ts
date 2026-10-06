import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import type { MetalAddon } from './plan.ts';

let loaded: MetalAddon | null | undefined;

/** The binding as built in a checkout, or beside the bundled workers in the desktop app. */
export function metalAddonPath(): string | null {
	const candidates = [
		join(import.meta.dirname, '..', '..', 'native', 'build', 'mlas-metal.node'),
		join(import.meta.dirname, 'mlas-metal.node')
	];
	return candidates.find(existsSync) ?? null;
}

/** Null off Apple silicon, without a built binding, or without a Metal device. */
export function loadMetalAddon(): MetalAddon | null {
	if (loaded !== undefined) return loaded;
	loaded = null;
	if (process.platform !== 'darwin' || process.arch !== 'arm64') return loaded;
	const path = metalAddonPath();
	if (!path) return loaded;
	try {
		const addon = createRequire(import.meta.url)(path) as MetalAddon;
		if (addon.deviceName()) loaded = addon;
	} catch {
		// A binding built for another runtime or OS leaves the CPU path in charge.
	}
	return loaded;
}
