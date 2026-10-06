/**
 * How ONNX Runtime 1.27's MLAS splits the K dimension of a float GEMM on ARM64. Each output is
 * an fma chain over k that restarts at every block boundary; block partials are added in order.
 * Thread partitions choose the blocks, so they are reproduced here exactly.
 */

import { execFileSync } from 'node:child_process';

/**
 * MlasGetMaximumThreadCount: the intra-op pool's threads plus the caller, times
 * TaskGranularityFactor 4 on hybrid CPUs, which cpuinfo detects as several performance levels.
 */
export function mlasParallelism(intraOpThreads: number): number {
	if (intraOpThreads <= 1) return 1;
	let levels = 1;
	try {
		levels = Number(execFileSync('sysctl', ['-n', 'hw.nperflevels'], { encoding: 'utf8' }).trim()) || 1;
	} catch {
		// Not macOS: no performance levels to report.
	}
	return intraOpThreads * (levels > 1 ? 4 : 1);
}

const STRIDE_N = 128;
const STRIDE_K = 128;
const PACKED_STRIDE_K = 256;
const THREAD_ALIGN = 16;
const THREAD_COMPLEXITY = 64 * 1024;
const MAXIMUM_THREADS = 16;

/** One column range of an operation and the K block its outputs were summed in. */
export interface ColumnBlocks { start: number; end: number; kBlock: number }

/** StrideK that MlasSgemmOperation settles on for an N-by-K slice. */
export function sgemmStrideK(n: number, k: number, transA = false): number {
	let strideN = STRIDE_N;
	let strideK = STRIDE_K;
	if (n >= k) {
		while (strideK / 2 >= k) { strideN *= 2; strideK /= 2; }
	} else if (!transA) {
		while (strideN > 16 && strideN / 2 >= n) { strideK *= 2; strideN /= 2; }
	}
	return strideK;
}

function partition(id: number, count: number, total: number): [number, number] {
	const per = Math.floor(total / count);
	const extra = total % count;
	return id < extra ? [(per + 1) * id, per + 1] : [per * id + extra, per];
}

function merge(ranges: ColumnBlocks[]): ColumnBlocks[] {
	const out: ColumnBlocks[] = [];
	for (const r of ranges) {
		if (r.end <= r.start) continue;
		const last = out.at(-1);
		if (last && last.kBlock === r.kBlock && last.end === r.start) last.end = r.end;
		else out.push({ ...r });
	}
	return out;
}

/** MlasGemmBatch for one GEMM: returns the K blocks of every column range. */
export function gemmBlocks(
	m: number, n: number, k: number, parallelism: number, { transA = false, packedB = false, batch = 1 } = {}
): ColumnBlocks[] {
	if (m === 1 && !transA) throw new Error('MLAS runs single-row GEMMs through a GEMV kernel.');
	if (packedB) return [{ start: 0, end: n, kBlock: PACKED_STRIDE_K }];
	let threads = Math.floor((m * n * k) / THREAD_COMPLEXITY) + 1;
	threads = Math.min(threads, parallelism);
	// A batch shares the threads: each GEMM gets ceil(threads / batch).
	threads = Math.ceil(threads / batch);
	if (n <= m) {
		const threadsM = Math.min(threads, m);
		const rows = Array.from({ length: threadsM }, (_, id) => partition(id, threadsM, m)[1]);
		if (!transA && rows.includes(1)) throw new Error('MLAS would run part of this GEMM as a GEMV.');
		return [{ start: 0, end: n, kBlock: sgemmStrideK(n, k, transA) }];
	}
	const blocked = Math.ceil(n / THREAD_ALIGN);
	const threadsN = Math.min(threads, blocked);
	const ranges: ColumnBlocks[] = [];
	for (let id = 0; id < threadsN; id++) {
		const [first, count] = partition(id, threadsN, blocked);
		const start = first * THREAD_ALIGN;
		const width = Math.min(n - start, count * THREAD_ALIGN);
		ranges.push({ start, end: start + width, kBlock: sgemmStrideK(width, k, transA) });
	}
	return merge(ranges);
}

/** MlasConvPrepare and MlasConv for one batch and group. */
export function convBlocks(
	filters: number, outputSize: number, k: number, inputChannels: number, parallelism: number,
	{ stridesOne, paddingZero, batch = 1 }: { stridesOne: boolean; paddingZero: boolean; batch?: number }
): ColumnBlocks[] {
	const direct = stridesOne && paddingZero && k === inputChannels;
	// Batches spread over threads whole: each entry is one single-threaded operation.
	if (batch > 1 && direct) {
		if (filters === 1) throw new Error('MLAS would run this convolution as a GEMV.');
		return [{ start: 0, end: outputSize, kBlock: sgemmStrideK(outputSize, k) }];
	}
	if (direct) return gemmBlocks(filters, outputSize, k, parallelism);
	if (filters > outputSize) return gemmBlocks(filters, outputSize, k, parallelism);
	if (filters === 1) throw new Error('MLAS would run this convolution as a GEMV.');
	if (batch > 1) return [{ start: 0, end: outputSize, kBlock: segmentStrideK(outputSize, k) }];
	const complexity = filters * outputSize * k;
	let threads = complexity < THREAD_COMPLEXITY * MAXIMUM_THREADS
		? Math.floor(complexity / THREAD_COMPLEXITY) + 1 : MAXIMUM_THREADS;
	threads = Math.min(threads, parallelism);
	let stride = Math.floor(outputSize / threads);
	if (stride * threads !== outputSize) stride++;
	if (threads > 1) {
		stride = (stride + THREAD_ALIGN - 1) & ~(THREAD_ALIGN - 1);
		if (stride >= outputSize) threads = 1;
		else if (stride * (threads - 1) >= outputSize) threads--;
	}
	const segments: [number, number][] = [];
	if (stride >= outputSize) segments.push([0, outputSize]);
	else for (let start = 0; start < outputSize; start += stride) segments.push([start, Math.min(outputSize, start + stride)]);
	return merge(segments.map(([start, end]) => ({ start, end, kBlock: segmentStrideK(end - start, k) })));
}

/**
 * MlasConvOperation's StrideK for one segment. Each StrideN slice then runs MlasSgemmOperation
 * on at most StrideK of K, and its own strides never split that again (its N is at most StrideN).
 */
function segmentStrideK(count: number, k: number): number {
	let strideN = STRIDE_N;
	let strideK = STRIDE_K;
	if (count >= k) {
		while (strideK / 2 >= k) { strideN *= 2; strideK /= 2; }
	} else {
		while (strideN > 16 && strideN / 2 >= count) { strideK *= 2; strideN /= 2; }
	}
	return strideK;
}
