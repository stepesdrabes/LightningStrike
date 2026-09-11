import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [svelte()],
	// Relative assets let the static app run under any web-root subdirectory.
	base: './',
	build: {
		target: 'es2022',
		cssCodeSplit: false
	},
	// Allow a real phone on the LAN to reach the development server.
	server: { port: 5181, host: true },
	preview: { port: 5181, host: true }
});
