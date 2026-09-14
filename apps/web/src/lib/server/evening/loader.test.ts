import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { loadEvening } from './loader.ts';

const dir = mkdtempSync(join(tmpdir(), 'evening-loader-'));
afterAll(() => rmSync(dir, { recursive: true, force: true }));

function write(name: string, text: string): string {
	const path = join(dir, name);
	writeFileSync(path, text);
	return path;
}

const GOOD = `import { block, effect, evening, hold, look, moment, song, clamp, setSample, SLOT } from 'lightningstrike';
import type { Scene } from 'lightningstrike';
import { doors } from './parts.ts';

const breath = effect({
	id: 'breath',
	role: 'bed',
	params: { depth: 0.5 },
	create(g) {
		let t = 0;
		return {
			reset(): void {
				t = 0;
			},
			render(out: Float32Array, ctx): void {
				t += ctx.f.dt;
				const v: number = clamp(0.3 + ctx.p.depth * Math.sin(t));
				for (let i = 0; i < g.count; i++) setSample(out, i, ctx.palette, SLOT.glow, v);
			}
		};
	}
});

const calm: Scene = 'dusk';

export default evening('Test night', {
	palette: 'ember',
	segments: [
		hold('Doors', { look: calm, note: doors }),
		moment('Spark', { length: '8s', timeline: [{ at: 0, section: 'build', look: look({ bed: breath }) }] }),
		block('Opening', { songs: [song('poster boy', { id: 'jOLT6ukrQSg' })] })
	]
});
`;

describe('loading an evening file', () => {
	it('compiles a typed file with relative imports and a custom effect, keeping source lines', async () => {
		write('parts.ts', "export const doors: string = 'Spotify until Go';\n");
		const file = write('good.ts', GOOD);
		const result = await loadEvening(file);
		expect(result.findings.filter((f) => f.severity === 'error')).toEqual([]);
		expect(result.script?.name).toBe('Test night');
		expect(result.script?.effects.map((e) => e.id)).toEqual(['breath']);
		expect(result.script?.segments.map((s) => [s.id, s.line?.line])).toEqual([
			['doors', 29],
			['spark', 30],
			['opening', 31]
		]);
		const doors = result.script?.segments[0];
		expect(doors?.kind === 'hold' && doors.note).toBe('Spotify until Go');
	});

	it('reports a syntax error with its line', async () => {
		const file = write('syntax.ts', "import { evening } from 'lightningstrike';\n\nexport default evening('x', { segments: [ ;\n");
		const result = await loadEvening(file);
		expect(result.script).toBeNull();
		expect(result.findings[0].severity).toBe('error');
		expect(result.findings[0].line?.line).toBe(3);
	});

	it('reports a throw while loading with its line', async () => {
		const file = write(
			'throws.ts',
			"import { evening } from 'lightningstrike';\nconst broken = (): never => {\n\tthrow new Error('no segments today');\n};\nbroken();\nexport default evening('x', { segments: [] });\n"
		);
		const result = await loadEvening(file);
		expect(result.findings[0].message).toBe('no segments today');
		expect(result.findings[0].line?.line).toBe(3);
	});

	it('refuses imports other than lightningstrike and relative files', async () => {
		const file = write('fs.ts', "import { readFileSync } from 'node:fs';\nimport { evening } from 'lightningstrike';\nreadFileSync;\nexport default evening('x', { segments: [] });\n");
		const result = await loadEvening(file);
		expect(result.script).toBeNull();
		expect(result.findings[0].message).toContain("not 'node:fs'");
	});

	it('stops a file that never finishes loading', async () => {
		const file = write('loop.ts', "import { evening } from 'lightningstrike';\nwhile (true) {}\nexport default evening('x', { segments: [] });\n");
		const result = await loadEvening(file, 1500);
		expect(result.script).toBeNull();
		expect(result.findings[0].message).toContain('endless loop');
	});

	it('names an effect that reaches for a module constant', async () => {
		const file = write(
			'scope.ts',
			`import { effect, evening, hold, look } from 'lightningstrike';
const LEVEL = 0.4;
const flat = effect({ id: 'flat', role: 'bed', create() { return { render(out) { out.fill(LEVEL); } }; } });
export default evening('x', { segments: [hold('Doors', { look: look({ bed: flat }) })] });
`
		);
		const result = await loadEvening(file);
		const gate = result.findings.find((f) => f.message.includes('failed the effect gate'));
		expect(gate?.message).toContain('LEVEL is not defined');
		expect(gate?.line?.line).toBe(3);
	});

	it('refuses something that is not an evening file', async () => {
		expect((await loadEvening(join(dir, 'missing.ts'))).findings[0].message).toContain('No evening file');
		expect((await loadEvening(write('notes.txt', 'hi'))).findings[0].message).toContain('.ts file');
	});
});
