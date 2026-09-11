import type { Effect, EffectDef, RenderCtx } from '../contracts/effect.ts';
import type { Geometry } from '../contracts/room.ts';
import type { GeneratedEffect } from '../contracts/show.ts';
import { SLOT } from '../contracts/palette.ts';
import { addSample, sample, setSample } from '../color/palette.ts';
import * as dsl from '../dsl/index.ts';
import { runGate } from './gate.ts';

/** DSL and palette helpers injected into generated JavaScript. */
const SANDBOX_API = { ...dsl, SLOT, sample, setSample, addSample };
type SandboxApi = typeof SANDBOX_API;

// Reject obvious escapes before evaluation; the gate separately checks deterministic output.
const BANNED = [
	/\bimport\s*[({]/,
	/\brequire\s*\(/,
	/\bprocess\b/,
	/\bglobalThis\b/,
	/\beval\s*\(/,
	/\bnew\s+Function\b/,
	// constructor.constructor reaches Function without spelling its name.
	/\.\s*constructor\b/,
	/\bfetch\s*\(/,
	/\bXMLHttpRequest\b/,
	/\bWebSocket\b/,
	/\bDate\b/,
	/Math\s*\.\s*random/,
	/\bperformance\b/,
	/\b__proto__\b/
];

interface CompileResult {
	def: EffectDef | null;
	failures: string[];
}

/** Compile plain JavaScript declaring create(g), using the injected namespace without imports. */
export function compileGenerated(gen: GeneratedEffect, g: Geometry): CompileResult {
	const failures: string[] = [];

	for (const pattern of BANNED) {
		if (pattern.test(gen.source)) {
			failures.push(`source references a banned construct: ${pattern.source}`);
		}
	}
	if (!/\bfunction\s+create\s*\(/.test(gen.source)) {
		failures.push('source must declare `function create(g) { ... }`');
	}
	if (failures.length > 0) return { def: null, failures };

	let factory: (geometry: Geometry) => Partial<Effect>;
	try {
		const build = new Function(
			'mv',
			`"use strict";\nconst {${Object.keys(SANDBOX_API).join(', ')}} = mv;\n${gen.source}\n;return create;`
		) as (api: SandboxApi) => (geometry: Geometry) => Partial<Effect>;
		factory = build(SANDBOX_API);
	} catch (e) {
		return { def: null, failures: [`source failed to compile: ${(e as Error).message}`] };
	}

	if (typeof factory !== 'function') {
		return { def: null, failures: ['`create` is not a function'] };
	}

	const def: EffectDef = {
		id: gen.id,
		name: gen.name,
		role: gen.role,
		blurb: gen.blurb,
		// Song-specific effects have no section or peak restriction; the linter still bounds
		// duration.
		taste: {
			energy: 3,
			sections: ['intro', 'groove', 'breakdown', 'build', 'void', 'drop', 'outro'],
			minBars: 1,
			maxBars: 64,
			peakReserved: false
		},
		params: gen.params,
		create(geometry: Geometry): Effect {
			const instance = factory(geometry);
			if (typeof instance?.render !== 'function') {
				throw new Error(`${gen.id}: create(g) must return an object with a render method`);
			}
			const render = instance.render.bind(instance) as (out: Float32Array, ctx: RenderCtx) => void;
			const reset = typeof instance.reset === 'function' ? instance.reset.bind(instance) : null;
			return {
				reset: () => reset?.(),
				render
			};
		}
	};

	const gate = runGate(def, g);
	if (!gate.ok) return { def: null, failures: gate.failures };
	if (!gate.producesLight) {
		return { def: null, failures: ['effect never emits light across the test journey'] };
	}

	return { def, failures: [] };
}
