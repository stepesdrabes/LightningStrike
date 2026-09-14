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

/**
 * Gate verdicts by what the gate sees. A journey takes up to seconds for a detailed effect, and
 * a show's effects are compiled again on every load, in the browser and in the output renderer.
 */
const verdicts = new Map<string, string[]>();
const VERDICTS_KEPT = 256;

/** The verdicts reached so far, so a fresh thread need not replay journeys already run. */
export function gateVerdicts(): [string, string[]][] {
	return [...verdicts];
}

/** Verdicts another thread reached; the journey is deterministic, so they hold here too. */
export function rememberGateVerdicts(entries: readonly (readonly [string, readonly string[]])[]): void {
	for (const [key, failures] of entries) {
		if (verdicts.has(key)) continue;
		if (verdicts.size >= VERDICTS_KEPT) verdicts.delete(verdicts.keys().next().value!);
		verdicts.set(key, [...failures]);
	}
}

function gateVerdict(def: EffectDef, gen: GeneratedEffect, g: Geometry): string[] {
	const key = JSON.stringify([g.count, gen.role, gen.params, gen.source]);
	const known = verdicts.get(key);
	if (known) return known;
	const gate = runGate(def, g);
	const failures = !gate.ok ? gate.failures : gate.producesLight ? [] : ['effect never emits light across the test journey'];
	if (verdicts.size >= VERDICTS_KEPT) verdicts.delete(verdicts.keys().next().value!);
	verdicts.set(key, failures);
	return failures;
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

	// The evening loader gated this effect in its worker; replaying the journey would only stall.
	const gateFailures = gen.admitted ? [] : gateVerdict(def, gen, g);
	if (gateFailures.length > 0) return { def: null, failures: gateFailures };

	return { def: guarded(def), failures: [] };
}

/**
 * The gate proves an effect on a synthetic journey, not on every song. Admitted, an effect that
 * throws goes dark instead of taking the frame down, and a pixel that is not a finite
 * non-negative number is cleared before exposure can turn it into a black room.
 */
function guarded(def: EffectDef): EffectDef {
	return {
		...def,
		create(geometry: Geometry): Effect {
			const inner = def.create(geometry);
			let broken = false;
			return {
				reset() {
					if (!broken) inner.reset();
				},
				render(out: Float32Array, ctx: RenderCtx) {
					if (broken) return;
					try {
						inner.render(out, ctx);
					} catch (e) {
						broken = true;
						out.fill(0);
						// Core runs in the browser and in Node, and knows neither; both have a console.
						(globalThis as { console?: { error(message: string): void } }).console?.error(
							`generated effect "${def.id}" stopped: ${(e as Error).message}`
						);
						return;
					}
					for (let i = 0; i < out.length; i++) {
						const v = out[i];
						if (!(v >= 0 && v < Infinity)) out[i] = 0;
					}
				}
			};
		}
	};
}
