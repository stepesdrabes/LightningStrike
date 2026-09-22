import { fileURLToPath } from 'node:url';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vitest/config';

export default defineConfig({
	// apps/controller's room store is a .svelte.ts module: without the compiler its runes are
	// undefined names and the tests pinning its recovery from a frozen state cannot run at all.
	plugins: [svelte({ configFile: false })],
	resolve: {
		alias: { $lib: fileURLToPath(new URL('./apps/web/src/lib', import.meta.url)) }
	},
	test: {
		include: [
			'packages/*/src/**/*.test.ts',
			'apps/*/src/**/*.test.ts',
			'apps/desktop/scripts/*.test.ts',
			'bench/*.test.ts'
		],
		environment: 'node',
		testTimeout: 60000
	}
});
