import { defineConfig } from 'vitest/config';

export default defineConfig({
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
