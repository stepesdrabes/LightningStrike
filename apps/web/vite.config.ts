import { sveltekit } from '@sveltejs/kit/vite';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [sveltekit()],
	// Bundle Lucide so the Svelte plugin compiles its .svelte sources before Node SSR.
	ssr: { noExternal: ['lucide-svelte'] },
	// Allow phones on the LAN to reach the shared queue.
	server: { port: 5180, host: true }
});
