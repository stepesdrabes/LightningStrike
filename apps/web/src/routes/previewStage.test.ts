import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

/**
 * The preview takes itself off stage by recognising its own show there, and that recognition
 * is object identity. `$state` wraps a plain object in a proxy PER VARIABLE, so handing the
 * same composed show to `show` and to `previewShow` gives two different proxies and the check
 * can never hold: the preview stayed on stage with the toggle reset, which is what the room
 * reported as "only the Preview remained there". Reading the stage back hands over the proxy
 * that is already there.
 *
 * A string is a poor instrument and this is why it is one anyway: the trap lives at an
 * assignment inside a component, and reaching it needs a harness that mounts the page with the
 * real runtime - which this repo does not have, the vitest environment being plain node. The
 * behaviour itself was verified by driving the app.
 */
describe('the preview stage in +page.svelte', () => {
	const source = readFileSync(new URL('./+page.svelte', import.meta.url), 'utf8');

	it('remembers the staged preview by reading the stage back', () => {
		expect(source).toContain('previewShow = show;');
	});

	it('never remembers the raw show the server sent', () => {
		expect(source).not.toMatch(/previewShow\s*=\s*data\.show/);
	});
});
