import type { Striker2Model, Striker2Result } from './striker2.ts';
import {
	markFailed, openChecked, type AnalysisProvider, type CheckedStriker2, type ProviderDeps
} from './striker2Provider.ts';

/** An idle session goes after this long: Striker 2.0's arena holds a gigabyte or more. */
export const STRIKER2_IDLE_MS = 90_000;

export interface Striker2Lease {
	/** The provider's label, such as `coreml:56` or `cpu`. */
	provider: string;
	/** The check key's id. */
	check: string;
	warnings: string[];
	run(mono: Float32Array): Promise<Striker2Result>;
}

interface Held {
	graph: string;
	sha256: string;
	setting: AnalysisProvider;
	checked: CheckedStriker2;
}

let held: Held | null = null;
let queue: Promise<unknown> = Promise.resolve();
let idle: ReturnType<typeof setTimeout> | null = null;

function serialized<T>(work: () => Promise<T>): Promise<T> {
	const run = queue.then(work);
	queue = run.catch(() => {});
	return run;
}

async function drop(): Promise<void> {
	if (idle) clearTimeout(idle);
	idle = null;
	const was = held;
	held = null;
	await was?.checked.striker.close().catch(() => {});
}

/** Releases the session once the run holding it, if any, is done. */
export function releaseStriker2(): Promise<void> {
	return serialized(drop);
}

export interface PoolOptions extends ProviderDeps {
	idleMs?: number;
}

const message = (e: unknown) => (e instanceof Error ? e.message : String(e));

/**
 * Runs `work` with the one Striker 2.0 session, opened and checked on first use and kept for the
 * songs after it. Runs wait their turn, so two sessions of the model never exist at once; another
 * model or provider setting releases the session first. A provider that fails on a song is marked
 * failed and the song runs again on the CPU, which then serves the songs after it.
 */
export function withStriker2<T>(
	model: Striker2Model, setting: AnalysisProvider, work: (lease: Striker2Lease) => Promise<T>,
	options: PoolOptions = {}
): Promise<T> {
	return serialized(async () => {
		if (idle) clearTimeout(idle);
		idle = null;
		const same = held?.graph === model.graph && held.sha256 === model.sha256 && held.setting === setting;
		if (held && !same) {
			await drop();
		}
		held ??= {
			graph: model.graph, sha256: model.sha256, setting, checked: await openChecked(model, setting, options)
		};
		const lease: Striker2Lease = {
			provider: held.checked.label,
			check: held.checked.check,
			warnings: [...held.checked.warnings],
			async run(mono) {
				const current = held!.checked;
				try {
					return await current.striker.run(mono);
				} catch (error) {
					if (current.provider.name === 'cpu') throw error;
					const reason = message(error);
					const line = `${current.label} failed on this song (${reason}), so it ran again on the CPU`;
					options.log?.(`Striker 2.0: ${line}`);
					await markFailed(current, reason);
					await drop();
					const cpu = await openChecked(model, 'cpu', options);
					cpu.warnings.unshift(`${current.label} is not used: it failed on a song (${reason})`);
					held = { graph: model.graph, sha256: model.sha256, setting, checked: cpu };
					lease.provider = cpu.label;
					lease.check = cpu.check;
					lease.warnings.push(line, ...cpu.warnings.slice(1));
					return cpu.striker.run(mono);
				}
			}
		};
		try {
			return await work(lease);
		} finally {
			if (held) {
				idle = setTimeout(() => void releaseStriker2(), options.idleMs ?? STRIKER2_IDLE_MS);
				idle.unref?.();
			}
		}
	});
}
