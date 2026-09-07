import { svelte } from '@sveltejs/vite-plugin-svelte';
import { defineConfig } from 'vite';

export default defineConfig({
	plugins: [svelte()],
	// Relative, so `dist/` works dropped into a web root or into a subdirectory of one. The app
	// is a folder of static files: any server on the network can hold it, and it needs no
	// backend of its own.
	base: './',
	build: {
		target: 'es2022',
		cssCodeSplit: false
	},
	// Bound to every interface, like apps/web: the app is developed against a real board from a
	// real phone, and localhost can reach neither.
	server: { port: 5181, host: true },
	preview: { port: 5181, host: true }
});
