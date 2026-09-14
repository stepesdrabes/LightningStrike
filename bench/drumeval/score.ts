// mir_eval-style onset scoring: maximum bipartite matching within a tolerance window.

/** Hopcroft-Karp matching of sorted references to sorted estimates; returns est index per ref or -1. */
export function matchEvents(ref: readonly number[], est: readonly number[], window: number): Int32Array {
	const n = ref.length;
	const m = est.length;
	const tol = window + 1e-9;
	const adj: number[][] = Array.from({ length: n }, () => []);
	let from = 0;
	for (let i = 0; i < n; i++) {
		while (from < m && est[from] < ref[i] - tol) from++;
		for (let j = from; j < m && est[j] <= ref[i] + tol; j++) adj[i].push(j);
	}
	const pairU = new Int32Array(n).fill(-1);
	const pairV = new Int32Array(m).fill(-1);
	const dist = new Int32Array(n);
	const INF = 1 << 30;
	const bfs = (): boolean => {
		const queue: number[] = [];
		let found = false;
		for (let u = 0; u < n; u++) {
			dist[u] = pairU[u] < 0 ? 0 : INF;
			if (pairU[u] < 0) queue.push(u);
		}
		for (let q = 0; q < queue.length; q++) {
			const u = queue[q];
			for (const v of adj[u]) {
				const w = pairV[v];
				if (w < 0) found = true;
				else if (dist[w] === INF) {
					dist[w] = dist[u] + 1;
					queue.push(w);
				}
			}
		}
		return found;
	};
	const dfs = (u: number): boolean => {
		for (const v of adj[u]) {
			const w = pairV[v];
			if (w < 0 || (dist[w] === dist[u] + 1 && dfs(w))) {
				pairU[u] = v;
				pairV[v] = u;
				return true;
			}
		}
		dist[u] = INF;
		return false;
	};
	while (bfs()) for (let u = 0; u < n; u++) if (pairU[u] < 0) dfs(u);
	return pairU;
}

export interface Counts {
	tp: number;
	fp: number;
	fn: number;
	/** Estimates matched only to optional references: neither credited nor penalised. */
	ignored: number;
}

export interface ScoreDetail extends Counts {
	fpTimes: number[];
	fnTimes: number[];
	/** est - ref, ms, for matched required references. */
	offsetsMs: number[];
}

/** `optional` references may absorb estimates without being required. */
export function scoreEvents(
	required: readonly number[], est: readonly number[], window: number, optional: readonly number[] = []
): ScoreDetail {
	const sortedEst = [...est].sort((a, b) => a - b);
	const pairs = matchEvents(required, sortedEst, window);
	const used = new Uint8Array(sortedEst.length);
	const offsetsMs: number[] = [];
	const fnTimes: number[] = [];
	for (let i = 0; i < required.length; i++) {
		if (pairs[i] < 0) fnTimes.push(required[i]);
		else {
			used[pairs[i]] = 1;
			offsetsMs.push((sortedEst[pairs[i]] - required[i]) * 1000);
		}
	}
	const rest = sortedEst.filter((_, j) => !used[j]);
	let ignored = 0;
	let fpTimes = rest;
	if (optional.length && rest.length) {
		const absorbed = matchEvents(optional, rest, window);
		const taken = new Uint8Array(rest.length);
		for (const j of absorbed) if (j >= 0) taken[j] = 1;
		ignored = taken.reduce((a, b) => a + b, 0);
		fpTimes = rest.filter((_, j) => !taken[j]);
	}
	return { tp: offsetsMs.length, fp: fpTimes.length, fn: fnTimes.length, ignored, fpTimes, fnTimes, offsetsMs };
}

export function prf(c: Pick<Counts, 'tp' | 'fp' | 'fn'>): { p: number; r: number; f: number } {
	const p = c.tp + c.fp > 0 ? c.tp / (c.tp + c.fp) : c.fn === 0 ? 1 : 0;
	const r = c.tp + c.fn > 0 ? c.tp / (c.tp + c.fn) : 1;
	return { p, r, f: p + r > 0 ? (2 * p * r) / (p + r) : 0 };
}

export function quantile(xs: readonly number[], q: number): number {
	if (!xs.length) return 0;
	const sorted = [...xs].sort((a, b) => a - b);
	return sorted[Math.min(sorted.length - 1, Math.floor(q * (sorted.length - 1)))];
}
