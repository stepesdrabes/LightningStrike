/**
 * Metal kernels that reproduce ONNX Runtime 1.27's ARM64 CPU kernels bit for bit.
 *
 * Every product sum is MLAS's: an fma chain over k from +0 per K block, blocks combined in
 * order (the first scaled by alpha, later ones fused onto it). simdgroup_multiply_accumulate
 * computes exactly that chain (k ascending), so any tiling works. Contraction is off; fma
 * appears only where the CPU code fuses.
 *
 * The GPU flushes subnormals, the CPU does not. guard[0] collects reasons a run is not provably
 * exact; guard[1 + slot] is the smallest nonzero magnitude below 2^-32 written to each value.
 * The planner turns those minima into the conditions under which no subnormal can arise.
 */
export const METAL_SOURCE = String.raw`
#include <metal_stdlib>
using namespace metal;
#pragma METAL fp contract(off)
// Fragment arrays stay in registers only when their loops unroll fully.
#define UNROLL _Pragma("clang loop unroll(full)")

// guard[0] bits: 1 range, 2 non-finite, 4 flushed result.
inline void raise(device atomic_uint *guard, uint bit) {
	atomic_fetch_or_explicit(guard, bit, memory_order_relaxed);
}

// Bit tests: arithmetic would read a subnormal as zero. Callers pass one slot per dispatch, so
// the simdgroup's minimum goes in one atomic.
inline void note(float v, device atomic_uint *guard, int slot) {
	const uint mag = as_type<uint>(v) & 0x7fffffffu;
	if (mag >= 0x7f800000u) raise(guard, 2u);
	const uint least = simd_min(mag != 0u && mag < 0x2f800000u ? mag : 0xffffffffu);
	if (least != 0xffffffffu && simd_is_first()) atomic_fetch_min_explicit(guard + 1 + slot, least, memory_order_relaxed);
}

// An intermediate that the exactness argument needs to be zero or at least 2^-40.
inline void need(float v, device atomic_uint *guard) {
	if (!isfinite(v)) raise(guard, 2u);
	else if (v != 0.0f && fabs(v) < 0x1p-40f) raise(guard, 1u);
}

inline float smallest(device atomic_uint *guard, int slot) {
	return as_type<float>(atomic_load_explicit(guard + 1 + slot, memory_order_relaxed));
}

// Lane layout of simdgroup_float8x8: row r holds columns c and c + 1.
inline int fragRow(uint lane) { return int(((lane & 16) >> 2) | ((lane >> 1) & 3)); }
inline int fragCol(uint lane) { return int(((lane & 8) >> 1) | ((lane & 1) << 1)); }

#define WM 2
#define WN 2
#define FM 4
#define FN 4
#define BM (WM * FM * 8)
#define BN (WN * FN * 8)

// ---------------------------------------------------------------------------------------------
// Convolution as implicit GEMM: out[m][n] = sum_k W[m][k] * X(k, n), k = (ci, kh, kw) as MLAS
// expands it, plus bias after the last block. Mode 0 stores [m][oh][ow]; mode 1 scatters a
// transposed convolution whose kernel equals its stride (row m = (co, kh, kw), column n =
// (ih, iw)). The batch is the grid's z.
struct ConvParams {
	int cin, h, w, rows, ho, wo, strideH, strideW;
	int K8, kBlock, nStart, nEnd;
	int isc, ish;
	int osc, osh;
	int mode, kh, kw;
	int outRows;
	int inSlot, outSlot;
	float tiny;
	int isn, osn, hasBias;
};

inline float convOperand(device const float *x, constant ConvParams &p, int4 t, int n) {
	const int oh = n / p.wo, ow = n % p.wo;
	const int ih = oh * p.strideH + t.y, iw = ow * p.strideW + t.z;
	if (ih < 0 || ih >= p.h || iw < 0 || iw >= p.w) return 0.0f;
	return x[oh * p.strideH * p.ish + ow * p.strideW + t.x];
}

// Specialized per form so the hot loop carries nothing it does not use.
template <bool BIAS, int MODE>
void convBody(device const float *xin, device const float *wt, device float *yout, device const int4 *ktab,
              device atomic_uint *guard, device const float *bias, constant ConvParams &p, uint3 tg, uint sg,
              uint lane) {
	device const float *x = xin + int(tg.z) * p.isn;
	device float *y = yout + int(tg.z) * p.osn;
	const int m0 = int(tg.y) * BM + int(sg / WN) * FM * 8;
	const int n0 = p.nStart + int(tg.x) * BN + int(sg % WN) * FN * 8;
	const int r = fragRow(lane), c = fragCol(lane);
	// Every window lies inside the input (padding is materialized), so loads need no bounds
	// checks; columns past the end read the last one and are not stored.
	int base[FN][2];
	UNROLL for (int j = 0; j < FN; j++) UNROLL for (int e = 0; e < 2; e++) {
		const int n = min(n0 + j * 8 + c + e, p.nEnd - 1);
		base[j][e] = (n / p.wo) * p.strideH * p.ish + (n % p.wo) * p.strideW;
	}
	// Each lane's two elements of every fragment: the block chains and their running totals.
	simdgroup_float8x8 acc[FM][FN];
	float total[FM][FN][2];
	UNROLL for (int i = 0; i < FM; i++) UNROLL for (int j = 0; j < FN; j++) {
		acc[i][j] = simdgroup_float8x8(0.0f);
		total[i][j][0] = 0.0f;
		total[i][j][1] = 0.0f;
	}
	device const float *a0 = wt + m0 * p.K8;
	for (int k0 = 0; k0 < p.K8; k0 += p.kBlock) {
		const int kEnd = min(p.K8, k0 + p.kBlock);
		for (int k = k0; k < kEnd; k += 8) {
			simdgroup_float8x8 a[FM], b[FN];
			UNROLL for (int i = 0; i < FM; i++) simdgroup_load(a[i], a0 + i * 8 * p.K8 + k, p.K8);
			// The input offset of (ci, dh, dw) from the window origin.
			const int t = ktab[k + r].x;
			UNROLL for (int j = 0; j < FN; j++) {
				b[j].thread_elements()[0] = x[base[j][0] + t];
				b[j].thread_elements()[1] = x[base[j][1] + t];
			}
			UNROLL for (int i = 0; i < FM; i++) UNROLL for (int j = 0; j < FN; j++)
				simdgroup_multiply_accumulate(acc[i][j], a[i], b[j], acc[i][j]);
		}
		UNROLL for (int i = 0; i < FM; i++) UNROLL for (int j = 0; j < FN; j++) {
			total[i][j][0] = total[i][j][0] + acc[i][j].thread_elements()[0];
			total[i][j][1] = total[i][j][1] + acc[i][j].thread_elements()[1];
			acc[i][j] = simdgroup_float8x8(0.0f);
		}
	}
	UNROLL for (int i = 0; i < FM; i++) UNROLL for (int j = 0; j < FN; j++) {
		UNROLL for (int e = 0; e < 2; e++) {
			const int m = m0 + i * 8 + r, n = n0 + j * 8 + c + e;
			if (m >= p.outRows || n >= p.nEnd) continue;
			const int oh = n / p.wo, ow = n % p.wo;
			if (MODE == 0) {
				const float v = BIAS ? total[i][j][e] + bias[m] : total[i][j][e];
				note(v, guard, p.outSlot);
				y[m * p.osc + oh * p.osh + ow] = v;
			} else {
				const int co = m / (p.kh * p.kw), kk = m % (p.kh * p.kw);
				const float v = BIAS ? total[i][j][e] + bias[co] : total[i][j][e];
				note(v, guard, p.outSlot);
				const int yh = oh * p.kh + kk / p.kw, yw = ow * p.kw + kk % p.kw;
				y[co * p.osc + yh * p.osh + yw] = v;
			}
		}
	}
}

#define CONV_KERNEL(NAME, BIAS, MODE) \
kernel void NAME(device const float *xin [[buffer(0)]], device const float *wt [[buffer(1)]], \
                 device float *yout [[buffer(2)]], device const int4 *ktab [[buffer(3)]], \
                 device atomic_uint *guard [[buffer(4)]], device const float *bias [[buffer(5)]], \
                 constant ConvParams &p [[buffer(6)]], \
                 uint3 tg [[threadgroup_position_in_grid]], uint sg [[simdgroup_index_in_threadgroup]], \
                 uint lane [[thread_index_in_simdgroup]]) { \
	convBody<BIAS, MODE>(xin, wt, yout, ktab, guard, bias, p, tg, sg, lane); \
}
CONV_KERNEL(conv, false, 0)
CONV_KERNEL(conv_bias, true, 0)
CONV_KERNEL(conv_scatter, false, 1)
CONV_KERNEL(conv_scatter_bias, true, 1)

inline bool tinyOperand(float v, float tiny) {
	const uint mag = as_type<uint>(v) & 0x7fffffffu;
	return mag != 0u && (mag < 0x00800000u || as_type<float>(mag) < tiny);
}

// IEEE binary32 a * b + c (a * b without add), rounded to nearest even with subnormal operands
// and results kept, as the CPU computes it. Finite operands only.
inline float softFma(float a, float b, float c, bool add) {
	const uint ua = as_type<uint>(a), ub = as_type<uint>(b), uc = as_type<uint>(c);
	const uint sp = (ua ^ ub) & 0x80000000u, sc = uc & 0x80000000u;
	int ea = int((ua >> 23) & 0xffu), eb = int((ub >> 23) & 0xffu), ec = int((uc >> 23) & 0xffu);
	ulong ma = ua & 0x7fffffu, mb = ub & 0x7fffffu, mc = uc & 0x7fffffu;
	if (ea) ma |= 0x800000u; else ea = 1;
	if (eb) mb |= 0x800000u; else eb = 1;
	if (ec) mc |= 0x800000u; else ec = 1;
	// Values are P * 2^e with P's top bit at 62, leaving room for a carry.
	ulong P = ma * mb;
	if (P == 0) {
		if (!add) return as_type<float>(sp);
		return mc != 0 ? c : as_type<float>(sp & sc);
	}
	const int shift = int(clz(P)) - 1;
	P <<= shift;
	int e = ea + eb - 300 - shift;
	uint sign = sp;
	if (add && mc != 0) {
		const int shiftC = int(clz(mc)) - 1;
		ulong X = P, Y = mc << shiftC;
		int ex = e, ey = ec - 150 - shiftC;
		uint sx = sp, sy = sc;
		if (ey > ex) {
			X = Y; Y = P;
			const int t = ex; ex = ey; ey = t;
			sx = sc; sy = sp;
		}
		const int d = ex - ey;
		if (d >= 63) Y = Y != 0 ? 1 : 0;
		else if (d > 0) Y = (Y >> d) | ((Y & ((1ul << d) - 1)) != 0 ? 1ul : 0ul);
		if (sx == sy) { P = X + Y; sign = sx; }
		else if (X >= Y) { P = X - Y; sign = sx; }
		else { P = Y - X; sign = sy; }
		e = ex;
		if (P == 0) return 0.0f;
	}
	const int top = 63 - int(clz(P));
	const int msb = e + top;
	const int drop = msb >= -126 ? top - 23 : -149 - e;
	ulong q;
	if (drop <= 0) q = P << -drop;
	else if (drop > 64) q = 0;
	else {
		const ulong rem = drop == 64 ? P : P & ((1ul << drop) - 1), halfway = 1ul << (drop - 1);
		q = drop == 64 ? 0 : P >> drop;
		if (rem > halfway || (rem == halfway && (q & 1))) q++;
	}
	if (msb >= 128) return as_type<float>(0x7f800000u | sign);
	const uint bits = msb >= -126 ? (uint(msb + 126) << 23) + uint(q) : uint(q);
	return as_type<float>(bits | sign);
}

inline bool normalOrZero(float v) {
	const uint bits = as_type<uint>(v);
	return (bits & 0x7f800000u) != 0u || (bits & 0x7fffffffu) == 0u;
}

// The unbiased exponent; subnormals and zero read as -127, which bounds them from above.
inline int exponentOf(float v) { return int((as_type<uint>(v) >> 23) & 0xffu) - 127; }

// |a b| < 2^(E(a) + E(b) + 2) <= 2^(E(c) - 25), under half the spacing of the floats around a
// normal c, so a b + c rounds to c whatever a flush did to a or b.
inline bool absorbed(float a, float b, float c) {
	return (as_type<uint>(c) & 0x7f800000u) != 0u && exponentOf(a) + exponentOf(b) + 27 <= exponentOf(c);
}

// The hardware result where it provably equals the CPU's, otherwise the emulation.
inline float cpuFma(float a, float b, float c) {
	const float r = fma(a, b, c);
	if (!isfinite(r) || (fabs(r) >= 0x1p-125f && normalOrZero(a) && normalOrZero(b) && normalOrZero(c))) return r;
	if (isfinite(a) && isfinite(b) && absorbed(a, b, c)) return c;
	return softFma(a, b, c, true);
}
inline float cpuMul(float a, float b) {
	const float r = a * b;
	if (!isfinite(r) || (fabs(r) >= 0x1p-125f && normalOrZero(a) && normalOrZero(b))) return r;
	return softFma(a, b, 0.0f, false);
}
inline float cpuAdd(float a, float b) { return cpuFma(1.0f, a, b); }

// Columns that read an operand under p.tiny (or a subnormal one) lose the granularity
// argument. They replay their CPU chains with the CPU's arithmetic and overwrite the GEMM's.
kernel void conv_correct(device const float *xin [[buffer(0)]], device const float *wt [[buffer(1)]],
                         device const int4 *ktab [[buffer(2)]], device atomic_uint *guard [[buffer(3)]],
                         device float *yout [[buffer(4)]], device const float *bias [[buffer(5)]],
                         constant ConvParams &p [[buffer(6)]], uint2 gid [[thread_position_in_grid]]) {
	if (smallest(guard, p.inSlot) >= p.tiny) return;
	const int n = p.nStart + int(gid.x);
	if (n >= p.nEnd) return;
	device const float *x = xin + int(gid.y) * p.isn;
	device float *y = yout + int(gid.y) * p.osn;
	bool tiny = false;
	for (int k = 0; k < p.K8 && !tiny; k++) tiny = tinyOperand(convOperand(x, p, ktab[k], n), p.tiny);
	if (!tiny) return;
	const int oh = n / p.wo, ow = n % p.wo;
	for (int m = 0; m < p.outRows; m++) {
		float total = 0.0f;
		for (int k0 = 0; k0 < p.K8; k0 += p.kBlock) {
			float chain = 0.0f;
			for (int k = k0; k < min(p.K8, k0 + p.kBlock); k++) chain = cpuFma(wt[m * p.K8 + k], convOperand(x, p, ktab[k], n), chain);
			total = k0 == 0 ? chain : cpuAdd(total, chain);
		}
		const int co = p.mode == 0 ? m : m / (p.kh * p.kw);
		const float v = p.hasBias ? cpuAdd(total, bias[co]) : total;
		note(v, guard, p.outSlot);
		if (p.mode == 0) y[m * p.osc + oh * p.osh + ow] = v;
		else {
			const int kk = m % (p.kh * p.kw);
			y[co * p.osc + (oh * p.kh + kk / p.kw) * p.osh + ow * p.kw + kk % p.kw] = v;
		}
	}
}

// ---------------------------------------------------------------------------------------------
// C = alpha * A B, batched over the grid's z. A[m][k] sits at a[m * lda + k] (or a[k * lda + m]
// when transA), B[k][n] at b[k * ldb + n] (or b[n * ldb + k]). With accumulate, C already
// holds the bias and every block is fused onto it, as MLAS does for beta = 1.
struct GemmParams {
	int M, N, K, kBlock, lda, ldb, ldc;
	int transA, transB, accumulate;
	float alpha;
	int batchA, batchB, batchC;
	int aSlot, bSlot, outSlot;
	float aTiny;
	int tinyBase;
};

inline float gemmA(device const float *a, constant GemmParams &p, int m, int k) {
	return p.transA ? a[k * p.lda + m] : a[m * p.lda + k];
}
inline float gemmB(device const float *b, constant GemmParams &p, int k, int n) {
	return p.transB ? b[n * p.ldb + k] : b[k * p.ldb + n];
}

template <bool TA, bool TB>
void gemmBody(device const float *ain, device const float *bin, device float *yout, device atomic_uint *guard,
              constant GemmParams &p, uint3 tg, uint sg, uint lane) {
	device const float *a = ain + int(tg.z) * p.batchA;
	device const float *b = bin + int(tg.z) * p.batchB;
	device float *y = yout + int(tg.z) * p.batchC;
	const int m0 = int(tg.y) * BM + int(sg / WN) * FM * 8;
	const int n0 = int(tg.x) * BN + int(sg % WN) * FN * 8;
	const int r = fragRow(lane), c = fragCol(lane);
	// Fragments are loaded whole only where every element is in range.
	const bool wholeM = m0 + FM * 8 <= p.M, wholeN = n0 + FN * 8 <= p.N;
	// Each lane's two elements of every fragment: the block chains and their running totals.
	simdgroup_float8x8 acc[FM][FN];
	float total[FM][FN][2];
	UNROLL for (int i = 0; i < FM; i++) UNROLL for (int j = 0; j < FN; j++) {
		acc[i][j] = simdgroup_float8x8(0.0f);
		UNROLL for (int e = 0; e < 2; e++) {
			const int m = m0 + i * 8 + r, n = n0 + j * 8 + c + e;
			total[i][j][e] = p.accumulate && m < p.M && n < p.N ? y[m * p.ldc + n] : 0.0f;
		}
	}
	bool first = !p.accumulate;
	for (int k0 = 0; k0 < p.K; k0 += p.kBlock) {
		const int kEnd = min(p.K, k0 + p.kBlock);
		for (int k = k0; k < kEnd; k += 8) {
			simdgroup_float8x8 fa[FM], fb[FN];
			const bool wholeK = k + 8 <= kEnd;
			if (wholeK && wholeM && wholeN) {
				UNROLL for (int i = 0; i < FM; i++) {
					if (TA) simdgroup_load(fa[i], a + k * p.lda + m0 + i * 8, p.lda, ulong2(0, 0), true);
					else simdgroup_load(fa[i], a + (m0 + i * 8) * p.lda + k, p.lda);
				}
				UNROLL for (int j = 0; j < FN; j++) {
					if (TB) simdgroup_load(fb[j], b + (n0 + j * 8) * p.ldb + k, p.ldb, ulong2(0, 0), true);
					else simdgroup_load(fb[j], b + k * p.ldb + n0 + j * 8, p.ldb);
				}
				UNROLL for (int i = 0; i < FM; i++) UNROLL for (int j = 0; j < FN; j++)
					simdgroup_multiply_accumulate(acc[i][j], fa[i], fb[j], acc[i][j]);
				continue;
			}
			UNROLL for (int i = 0; i < FM; i++) UNROLL for (int e = 0; e < 2; e++) {
				const int mm = m0 + i * 8 + r, kk = k + c + e;
				fa[i].thread_elements()[e] = (mm < p.M && kk < kEnd) ? gemmA(a, p, mm, kk) : 0.0f;
			}
			UNROLL for (int j = 0; j < FN; j++) UNROLL for (int e = 0; e < 2; e++) {
				const int kk = k + r, nn = n0 + j * 8 + c + e;
				fb[j].thread_elements()[e] = (kk < kEnd && nn < p.N) ? gemmB(b, p, kk, nn) : 0.0f;
			}
			UNROLL for (int i = 0; i < FM; i++) UNROLL for (int j = 0; j < FN; j++)
				simdgroup_multiply_accumulate(acc[i][j], fa[i], fb[j], acc[i][j]);
		}
		UNROLL for (int i = 0; i < FM; i++) UNROLL for (int j = 0; j < FN; j++) {
			UNROLL for (int e = 0; e < 2; e++) {
				const float chain = acc[i][j].thread_elements()[e];
				total[i][j][e] = first ? chain * p.alpha : fma(chain, p.alpha, total[i][j][e]);
			}
			acc[i][j] = simdgroup_float8x8(0.0f);
		}
		first = false;
	}
	UNROLL for (int i = 0; i < FM; i++) UNROLL for (int j = 0; j < FN; j++) {
		UNROLL for (int e = 0; e < 2; e++) {
			const int m = m0 + i * 8 + r, n = n0 + j * 8 + c + e;
			if (m >= p.M || n >= p.N) continue;
			const float v = total[i][j][e];
			note(v, guard, p.outSlot);
			y[m * p.ldc + n] = v;
		}
	}
}

// Transposition is a template parameter so the whole-tile loop carries no branches.
kernel void gemm(device const float *ain [[buffer(0)]], device const float *bin [[buffer(1)]],
                 device float *yout [[buffer(2)]], device atomic_uint *guard [[buffer(3)]],
                 constant GemmParams &p [[buffer(4)]],
                 uint3 tg [[threadgroup_position_in_grid]], uint sg [[simdgroup_index_in_threadgroup]],
                 uint lane [[thread_index_in_simdgroup]]) {
	if (p.transA && p.transB) gemmBody<true, true>(ain, bin, yout, guard, p, tg, sg, lane);
	else if (p.transA) gemmBody<true, false>(ain, bin, yout, guard, p, tg, sg, lane);
	else if (p.transB) gemmBody<false, true>(ain, bin, yout, guard, p, tg, sg, lane);
	else gemmBody<false, false>(ain, bin, yout, guard, p, tg, sg, lane);
}

// A product of operands at least 2^ea and 2^eb is a multiple of 2^(ea + eb - 46), and alpha
// scales that by its lowest set bit, so no partial sum can be subnormal while every product has
// ea + eb >= p.tinyBase (-80 for alpha 1). Rows of A holding an operand under 2^(tinyBase - eb)
// are recomputed by gemm_correct, eb being the smallest exponent in B's row k for a computed B.
// The first test is global; a computed B's minimum is known only below 2^-32.
inline float tinyFor(uint least, int base) {
	return as_type<float>(uint(clamp(base + 127 - (int(least >> 23) - 127), 1, 254)) << 23);
}

inline bool anyTiny(device atomic_uint *guard, constant GemmParams &p) {
	if (p.bSlot < 0) return smallest(guard, p.aSlot) < p.aTiny;
	return smallest(guard, p.aSlot) < tinyFor(min(as_type<uint>(smallest(guard, p.bSlot)), 0x2f800000u), p.tinyBase);
}

kernel void gemm_kmin(device const float *bin [[buffer(0)]], device atomic_uint *guard [[buffer(1)]],
                      device float *tiny [[buffer(2)]], constant GemmParams &p [[buffer(3)]],
                      uint2 gid [[thread_position_in_grid]]) {
	const int k = int(gid.x);
	if (!anyTiny(guard, p) || k >= p.K) return;
	device const float *b = bin + int(gid.y) * p.batchB;
	uint least = 0x7f800000u;
	for (int n = 0; n < p.N; n++) {
		const uint mag = as_type<uint>(gemmB(b, p, k, n)) & 0x7fffffffu;
		if (mag != 0u) least = min(least, mag);
	}
	// A subnormal B element turns every product it meets into a hazard.
	tiny[int(gid.y) * p.K + k] = least == 0x7f800000u ? 0.0f : least < 0x00800000u ? INFINITY : tinyFor(least, p.tinyBase);
}

// One simdgroup per row of A, eight rows per threadgroup. A row is marked 1 for gemm_correct's
// replay, or 2 when it meets a subnormal B element, which rules out the hardware path.
kernel void gemm_mark(device const float *ain [[buffer(0)]], device atomic_uint *guard [[buffer(1)]],
                      device uint *rows [[buffer(2)]], device const float *tiny [[buffer(3)]],
                      constant GemmParams &p [[buffer(4)]], uint2 tg [[threadgroup_position_in_grid]],
                      uint sg [[simdgroup_index_in_threadgroup]], uint lane [[thread_index_in_simdgroup]]) {
	const int m = int(tg.x) * 8 + int(sg);
	if (m >= p.M) return;
	if (!anyTiny(guard, p)) {
		if (lane == 0) rows[int(tg.y) * p.M + m] = 0u;
		return;
	}
	device const float *a = ain + int(tg.y) * p.batchA;
	device const float *t = tiny + int(tg.y) * p.K;
	bool mark = false, soft = false;
	for (int k = int(lane); k < p.K; k += 32) {
		const float v = gemmA(a, p, m, k);
		const float limit = p.bSlot < 0 ? p.aTiny : t[k];
		const uint mag = as_type<uint>(v) & 0x7fffffffu;
		mark = mark || tinyOperand(v, limit);
		soft = soft || (mag != 0u && isinf(limit));
	}
	mark = simd_any(mark);
	soft = simd_any(soft);
	if (lane == 0) rows[int(tg.y) * p.M + m] = soft ? 2u : mark ? 1u : 0u;
}

// One output's chain with the CPU's arithmetic throughout.
inline float cpuChain(device const float *a, device const float *b, constant GemmParams &p, device const float *bias,
                      int m, int n) {
	float total = p.accumulate ? bias[n] : 0.0f;
	for (int k0 = 0; k0 < p.K; k0 += p.kBlock) {
		float chain = 0.0f;
		for (int k = k0; k < min(p.K, k0 + p.kBlock); k++) chain = cpuFma(gemmA(a, p, m, k), gemmB(b, p, k, n), chain);
		total = p.accumulate || k0 > 0 ? cpuFma(chain, p.alpha, total) : cpuMul(chain, p.alpha);
	}
	return total;
}

// Each thread replays one column's chains for the marked rows among ROWS_PER_THREAD, advancing
// them together so each B element is read once. Hardware fma equals the CPU's while results
// clear the subnormal range, or when a subnormal A element is absorbed; a row whose chain leaves
// that domain, or that meets a subnormal B element, is replayed with the CPU's arithmetic.
#define ROWS_PER_THREAD 8
kernel void gemm_correct(device const float *ain [[buffer(0)]], device const float *bin [[buffer(1)]],
                         device float *yout [[buffer(2)]], device atomic_uint *guard [[buffer(3)]],
                         device const float *bias [[buffer(4)]], device const uint *rows [[buffer(5)]],
                         constant GemmParams &p [[buffer(6)]], uint3 gid [[thread_position_in_grid]]) {
	const int n = int(gid.x), m0 = int(gid.y) * ROWS_PER_THREAD;
	if (!anyTiny(guard, p) || n >= p.N) return;
	uint marked = 0u, soft = 0u;
	UNROLL for (int r = 0; r < ROWS_PER_THREAD; r++) {
		const uint mark = m0 + r < p.M ? rows[int(gid.z) * p.M + m0 + r] : 0u;
		marked |= uint(mark != 0u) << r;
		soft |= uint(mark == 2u) << r;
	}
	if (!marked) return;
	device const float *a = ain + int(gid.z) * p.batchA;
	device const float *b = bin + int(gid.z) * p.batchB;
	device float *y = yout + int(gid.z) * p.batchC;
	float total[ROWS_PER_THREAD];
	uint unclean = soft;
	UNROLL for (int r = 0; r < ROWS_PER_THREAD; r++) total[r] = p.accumulate ? bias[n] : 0.0f;
	if (marked & ~soft) for (int k0 = 0; k0 < p.K; k0 += p.kBlock) {
		float chain[ROWS_PER_THREAD];
		UNROLL for (int r = 0; r < ROWS_PER_THREAD; r++) chain[r] = 0.0f;
		const int kEnd = min(p.K, k0 + p.kBlock);
		// Four k per pass, loaded together; positions past the block read as zero products.
		for (int k = k0; k < kEnd; k += 4) {
			const int span = min(4, kEnd - k);
			float bv[4], av[ROWS_PER_THREAD][4];
			UNROLL for (int u = 0; u < 4; u++) bv[u] = u < span ? gemmB(b, p, k + u, n) : 0.0f;
			UNROLL for (int r = 0; r < ROWS_PER_THREAD; r++) {
				if (!((marked >> r) & 1u)) {
					UNROLL for (int u = 0; u < 4; u++) av[r][u] = 0.0f;
				} else if (!p.transA && span == 4) {
					const packed_float4 v = *(device const packed_float4 *)(a + (m0 + r) * p.lda + k);
					UNROLL for (int u = 0; u < 4; u++) av[r][u] = v[u];
				} else {
					UNROLL for (int u = 0; u < 4; u++) av[r][u] = u < span ? gemmA(a, p, m0 + r, k + u) : 0.0f;
				}
			}
			UNROLL for (int u = 0; u < 4; u++) {
				const int eb = exponentOf(bv[u]);
				UNROLL for (int r = 0; r < ROWS_PER_THREAD; r++) {
					const uint mag = as_type<uint>(av[r][u]) & 0x7fffffffu;
					const float s = fma(av[r][u], bv[u], chain[r]);
					// The chain is normal or +0 here: a hazard ends the row's hardware replay.
					const bool exact = mag == 0u || (mag >= 0x00800000u ? fabs(s) >= 0x1p-125f
						: chain[r] != 0.0f && eb - 127 + 27 <= exponentOf(chain[r]));
					unclean |= uint(!exact) << r;
					chain[r] = s;
				}
			}
		}
		UNROLL for (int r = 0; r < ROWS_PER_THREAD; r++) {
			total[r] = p.accumulate || k0 > 0 ? cpuFma(chain[r], p.alpha, total[r]) : cpuMul(chain[r], p.alpha);
		}
	}
	for (int r = 0; r < ROWS_PER_THREAD; r++) {
		if (!((marked >> r) & 1u)) continue;
		const float v = (unclean >> r) & 1u ? cpuChain(a, b, p, bias, m0 + r, n) : total[r];
		note(v, guard, p.outSlot);
		y[(m0 + r) * p.ldc + n] = v;
	}
}

// ---------------------------------------------------------------------------------------------
// InstanceNormalization as ORT computes it with Eigen, per instance of S contiguous elements:
// head elements up to 16-byte alignment, two four-wide packet accumulators, a pairwise
// horizontal sum, the head, then the tail. Instances start at instance * S floats from an
// aligned base, so the head length is (-(instance * S)) mod 4.
struct NormParams { int instances, S, W, sc, sh, channels; float epsilon; };

inline float elementAt(device const float *x, constant NormParams &p, int inst, int i) {
	return p.sh == 0 ? x[inst * p.sc + i] : x[inst * p.sc + (i / p.W) * p.sh + i % p.W];
}

// Lane j's chain over i = start + j, start + j + 8, ... < end, row-major in [H][W].
inline float laneChain(device const float *x, constant NormParams &p, int inst, int start, int end, int j,
                       float mean, bool squares, thread bool &started) {
	float chain = 0.0f;
	if (p.W % 8 == 0 && start % p.W == 0 && (end - start) % p.W == 0) {
		// Sixteen loads in flight ahead of their ordered additions, walking [H][W] rows.
		device const float *first = x + inst * p.sc + j;
		int h = start / p.W, w = 0;
		const int count = (end - start) / 8;
		int done = 0;
		for (; done + 16 <= count; done += 16) {
			float v[16];
			UNROLL for (int u = 0; u < 16; u++) {
				v[u] = first[h * p.sh + w];
				w += 8;
				if (w == p.W) { w = 0; h++; }
			}
			UNROLL for (int u = 0; u < 16; u++) {
				float s = v[u];
				if (squares) { s = s - mean; s = s * s; }
				chain = started ? chain + s : s;
				started = true;
			}
		}
		for (; done < count; done++) {
			float s = first[h * p.sh + w];
			w += 8;
			if (w == p.W) { w = 0; h++; }
			if (squares) { s = s - mean; s = s * s; }
			chain = started ? chain + s : s;
			started = true;
		}
		return chain;
	}
	int i = start + j;
	if (p.sh == 0) {
		// Contiguous instance: sixteen loads in flight ahead of their ordered additions.
		device const float *base = x + inst * p.sc;
		for (; i + 120 < end; i += 128) {
			float v[16];
			UNROLL for (int u = 0; u < 16; u++) v[u] = base[i + 8 * u];
			UNROLL for (int u = 0; u < 16; u++) {
				float s = v[u];
				if (squares) { s = s - mean; s = s * s; }
				chain = started ? chain + s : s;
				started = true;
			}
		}
	}
	for (; i < end; i += 8) {
		float v = elementAt(x, p, inst, i);
		if (squares) { v = v - mean; v = v * v; }
		chain = started ? chain + v : v;
		started = true;
	}
	return chain;
}

// One Eigen redux (sum of x, or of (x - mean)^2) for lanes 8q..8q+7; lane 0 of each eight holds it.
inline float eigenSum(device const float *x, constant NormParams &p, int inst, int j, float mean, bool squares) {
	const int S = p.S;
	const int head = min(S, int((4 - ((inst * S) & 3)) & 3));
	const int alignedSize = (S - head) / 4 * 4, alignedSize2 = (S - head) / 8 * 8;
	const int alignedEnd = head + alignedSize, alignedEnd2 = head + alignedSize2;
	auto value = [&](int i) { float v = elementAt(x, p, inst, i); if (squares) { v = v - mean; v = v * v; } return v; };
	float result = 0.0f;
	if (alignedSize > 0) {
		bool started = false;
		float chain = 0.0f;
		if (alignedSize > 4) {
			chain = laneChain(x, p, inst, head, alignedEnd2, j, mean, squares, started);
		} else if (j < 4) {
			chain = value(head + j);
		}
		const float hi = simd_shuffle_down(chain, 4);
		float r0 = alignedSize > 4 ? hi + chain : chain;
		if (alignedSize > 4 && alignedEnd > alignedEnd2 && j < 4) r0 = r0 + value(alignedEnd2 + j);
		const float pair = r0 + simd_shuffle_down(r0, 1);
		result = pair + simd_shuffle_down(pair, 2);
		if (j == 0) {
			for (int i = 0; i < head; i++) result = result + value(i);
			for (int i = alignedEnd; i < S; i++) result = result + value(i);
		}
	} else if (j == 0) {
		result = value(0);
		for (int i = 1; i < S; i++) result = result + value(i);
	}
	return result;
}

kernel void norm_stats(device const float *x [[buffer(0)]], device const float *gamma [[buffer(1)]],
                       device const float *beta [[buffer(2)]], device float2 *affine [[buffer(3)]],
                       device atomic_uint *guard [[buffer(4)]], constant NormParams &p [[buffer(5)]],
                       uint gid [[thread_position_in_grid]], uint lane [[thread_index_in_simdgroup]]) {
	const int inst = int(gid / 8), j = int(lane & 7);
	const bool active = inst < p.instances;
	const int at = active ? inst : 0;
	const float count = float(p.S);
	const float sum = eigenSum(x, p, at, j, 0.0f, false);
	const float mean = simd_shuffle(sum, ushort(lane & ~7u)) / count;
	const float squares = eigenSum(x, p, at, j, mean, true);
	if (j == 0 && active) {
		const int ch = at % p.channels;
		const float invStdev = 1.0f / sqrt(p.epsilon + (squares + 0.0f) / count);
		const float scale = invStdev * gamma[ch];
		const float shift = fma(-mean, scale, beta[ch]);
		need(mean, guard);
		need(scale, guard);
		need(shift, guard);
		affine[at] = float2(scale, shift);
	}
}

// ---------------------------------------------------------------------------------------------
// LayerNormalization over contiguous rows as ORT 1.27 computes it for float: Welford's
// running mean and M2 (fused), then (x - mean) / stdev fused with scale and bias. One row
// per thread.
struct LayerNormParams { int rows, size, hasBias; float epsilon; int outSlot; };

kernel void layer_norm(device const float *x [[buffer(0)]], device float *y [[buffer(1)]],
                       device const float *scale [[buffer(2)]], device const float *bias [[buffer(3)]],
                       device atomic_uint *guard [[buffer(4)]], constant LayerNormParams &p [[buffer(5)]],
                       uint row [[thread_position_in_grid]]) {
	if (int(row) >= p.rows) return;
	device const float *in = x + int(row) * p.size;
	device float *out = y + int(row) * p.size;
	// A flushed result shows as a zero its operands do not explain; any such zero raises bit 4.
	bool flushed = false;
	float mean = 0.0f, m2 = 0.0f;
	for (int h = 0; h < p.size; h++) {
		const float x = in[h];
		const float delta = x - mean;
		flushed |= delta == 0.0f && x != mean;
		const float step = delta / float(h + 1);
		flushed |= step == 0.0f && delta != 0.0f;
		const float next = mean + step;
		flushed |= next == 0.0f && mean != -step;
		mean = next;
		const float delta2 = x - mean;
		flushed |= delta2 == 0.0f && x != mean;
		const float sum = fma(delta, delta2, m2);
		flushed |= sum == 0.0f && !(m2 == 0.0f && (delta == 0.0f || delta2 == 0.0f));
		m2 = sum;
	}
	const float variance = m2 / float(p.size);
	flushed |= variance == 0.0f && m2 != 0.0f;
	const float stdev = sqrt(variance + p.epsilon);
	for (int h = 0; h < p.size; h++) {
		const float x = in[h];
		const float d = x - mean;
		flushed |= d == 0.0f && x != mean;
		const float centered = d / stdev;
		flushed |= centered == 0.0f && d != 0.0f;
		float v;
		if (p.hasBias) {
			v = fma(centered, scale[h], bias[h]);
			flushed |= v == 0.0f && !(bias[h] == 0.0f && (centered == 0.0f || scale[h] == 0.0f));
		} else {
			v = centered * scale[h];
			flushed |= v == 0.0f && centered != 0.0f && scale[h] != 0.0f;
		}
		note(v, guard, p.outSlot);
		out[h] = v;
	}
	if (flushed) raise(guard, 4u);
}

// ---------------------------------------------------------------------------------------------
// MlasErfKernel's four-wide path, lane by lane.
inline float mlasErf(float value) {
	const float sign = as_type<float>(as_type<uint>(value) & 0x80000000u);
	float absValue = as_type<float>(as_type<uint>(value) & 0x7fffffffu);
	absValue = min(3.925f, absValue);
	const float square = absValue * absValue;
	float rSmall = -5.99104969e-4f;
	rSmall = fma(rSmall, square, 4.99339588e-3f);
	rSmall = fma(rSmall, square, -2.67667342e-2f);
	rSmall = fma(rSmall, square, 1.12818025e-1f);
	rSmall = fma(rSmall, square, -3.76124859e-1f);
	rSmall = fma(rSmall, square, 1.28379151e-1f);
	rSmall = fma(rSmall, absValue, absValue);
	const bool big = absValue > 0.921875f;
	rSmall = big ? 0.0f : rSmall;
	const float a = big ? absValue : 0.0f;
	float rBig = 1.72948930e-5f;
	rBig = fma(rBig, a, -3.83208680e-4f);
	rBig = fma(rBig, a, 3.88393435e-3f);
	rBig = fma(rBig, a, -2.42545605e-2f);
	rBig = fma(rBig, a, 1.06777847e-1f);
	rBig = fma(rBig, a, 6.34846687e-1f);
	rBig = fma(rBig, a, 1.28717512e-1f);
	rBig = fma(rBig, a, a);
	rBig = -rBig;
	rBig = max(-88.3762626647949f, rBig);
	const float expC = 1.25829120e+7f;
	float r = fma(1.44269504088896341f, rBig, expC);
	r = r - expC;
	float fx = fma(r, -6.93145752e-1f, rBig);
	fx = fma(r, -1.42860677e-6f, fx);
	float y = 1.38319808e-3f;
	y = fma(y, fx, 8.37550033e-3f);
	y = fma(y, fx, 4.16689515e-2f);
	y = fma(y, fx, 1.66664466e-1f);
	y = fma(y, fx, 4.99999851e-1f);
	y = fma(y, fx, 1.00000000e+0f);
	y = fma(y, fx, 1.00000000e+0f);
	y = y * as_type<float>((int(r) + 127) << 23);
	y = 1.0f - y;
	return as_type<float>(as_type<uint>(rSmall) | as_type<uint>(y) | as_type<uint>(sign));
}

// MlasGeluErfKernel: scale, erf, then (x * 0.5) * (erf + 1).
inline float gelu(float x) {
	const float e = mlasErf(x * 0.70710678118654752440f);
	return (x * 0.5f) * (e + 1.0f);
}

// MlasLogisticKernel; its scalar tail fuses the same way, so every position matches. The final
// + 0.5 absorbs anything a flush could change.
inline float logistic(float x) {
	const float v = min(18.0f, max(-18.0f, x));
	const float sq = v * v;
	float p = fma(sq, 4.37031012579801e-11f, 1.15627324459942e-07f);
	p = fma(p, sq, 6.08574864600143e-05f);
	p = fma(p, sq, 8.51377133304701e-03f);
	p = fma(p, sq, 2.48287947061529e-01f);
	p = p * v;
	float q = fma(sq, 6.10247389755681e-13f, 5.76102136993427e-09f);
	q = fma(q, sq, 6.29106785017040e-06f);
	q = fma(q, sq, 1.70198817374094e-03f);
	q = fma(q, sq, 1.16817656904453e-01f);
	q = fma(q, sq, 9.93151921023180e-01f);
	return min(1.0f, max(0.0f, p / q + 0.5f));
}

// ---------------------------------------------------------------------------------------------
// Col2im of an overlapping transposed convolution: each output sums its contributions in
// increasing kernel offset from zero, then adds the bias, as ORT's Col2im and Col2imNd do.
// col is [Cout * kh * kw][H * W]; y is [Cout][Ho][Wo] through strides.
struct Col2imParams {
	int cout, h, w, ho, wo, kh, kw, sh, sw, dh, dw, pt, pl;
	int osc, osh, hasBias, outSlot;
};

kernel void col2im(device const float *col [[buffer(0)]], device float *y [[buffer(1)]],
                   device const float *bias [[buffer(2)]], device atomic_uint *guard [[buffer(3)]],
                   constant Col2imParams &p [[buffer(4)]], uint3 gid [[thread_position_in_grid]]) {
	const int ow = int(gid.x), oh = int(gid.y), co = int(gid.z);
	if (ow >= p.wo || oh >= p.ho || co >= p.cout) return;
	float acc = 0.0f;
	for (int kr = 0; kr < p.kh; kr++) {
		const int rh = oh + p.pt - kr * p.dh;
		if (rh < 0 || rh % p.sh != 0 || rh / p.sh >= p.h) continue;
		for (int kc = 0; kc < p.kw; kc++) {
			const int rw = ow + p.pl - kc * p.dw;
			if (rw < 0 || rw % p.sw != 0 || rw / p.sw >= p.w) continue;
			acc = acc + col[((co * p.kh + kr) * p.kw + kc) * (p.h * p.w) + (rh / p.sh) * p.w + rw / p.sw];
		}
	}
	const float v = p.hasBias ? acc + bias[co] : acc;
	note(v, guard, p.outSlot);
	y[co * p.osc + oh * p.osh + ow] = v;
}

// ---------------------------------------------------------------------------------------------
// Elementwise work over a logical tensor of up to six dimensions. x is the innermost index, y
// the next, z the outer four flattened. Operands carry their own strides, 0 where broadcast.
struct NdParams {
	int dims[6];
	int sa[6], sb[6], sy[6];
	int op, outSlot;
	// pad: the output index minus lo[d] reads the input when inside [0, inDims[d]).
	int lo[6], inDims[6];
	int instanceDims;
	// The outermost dimension the grid's z spans; outer dimensions before it are 1.
	int firstOuter;
};

// op: 0 copy, 1 gelu, 2 sqrt, 3 add, 4 sub, 5 mul, 6 div, 7 affine (instance norm apply),
// 8 affine then gelu, 9 pad with zeros, 10 logistic.
// Specialized per op, and for tensors whose outer three dimensions are 1 (FLAT), so the
// index arithmetic and the op dispatch cost nothing per element.
template <int OP, bool FLAT>
void ndBody(device const float *a, device const float *b, device float *y, device const float2 *affine,
            device atomic_uint *guard, constant NdParams &p, uint3 gid) {
	int idx[6] = {0, 0, 0, 0, 0, 0};
	idx[5] = int(gid.x);
	idx[4] = int(gid.y);
	if (idx[5] >= p.dims[5] || idx[4] >= p.dims[4]) return;
	int oa, ob, oy;
	if (FLAT) {
		idx[3] = int(gid.z);
		oa = idx[3] * p.sa[3] + idx[4] * p.sa[4] + idx[5] * p.sa[5];
		ob = idx[3] * p.sb[3] + idx[4] * p.sb[4] + idx[5] * p.sb[5];
		oy = idx[3] * p.sy[3] + idx[4] * p.sy[4] + idx[5] * p.sy[5];
	} else {
		int z = int(gid.z);
		for (int d = 3; d > p.firstOuter; d--) { idx[d] = z % p.dims[d]; z /= p.dims[d]; }
		if (p.firstOuter <= 3) idx[p.firstOuter] = z;
		oa = 0; ob = 0; oy = 0;
		for (int d = 0; d < 6; d++) { oa += idx[d] * p.sa[d]; ob += idx[d] * p.sb[d]; oy += idx[d] * p.sy[d]; }
	}
	float out;
	if (OP == 9) {
		bool inside = true;
		int src = 0;
		for (int d = 0; d < 6; d++) {
			const int i = idx[d] - p.lo[d];
			inside = inside && i >= 0 && i < p.inDims[d];
			src += i * p.sa[d];
		}
		out = inside ? a[src] : 0.0f;
	} else {
		const float v = a[oa];
		if (OP == 0) out = v;
		else if (OP == 1) { need(v, guard); out = gelu(v); }
		else if (OP == 2) out = sqrt(v);
		else if (OP == 10) out = logistic(v);
		else if (OP <= 6) {
			const float u = b[ob];
			out = OP == 3 ? v + u : OP == 4 ? v - u : OP == 5 ? v * u : v / u;
			// A flushed result is a zero the operands do not explain.
			const bool explained = OP == 3 ? v == -u : OP == 4 ? v == u : (v == 0.0f || (OP == 5 && u == 0.0f));
			if (out == 0.0f && !explained) raise(guard, 4u);
		} else {
			int instance = 0;
			if (FLAT) instance = p.instanceDims >= 5 ? idx[3] * p.dims[4] + idx[4] : p.instanceDims == 4 ? idx[3] : 0;
			else for (int d = 0; d < p.instanceDims; d++) instance = instance * p.dims[d] + idx[d];
			const float2 s = affine[instance];
			out = v * s.x + s.y;
			if (OP == 8) { need(out, guard); out = gelu(out); }
		}
	}
	note(out, guard, p.outSlot);
	y[oy] = out;
}

#define ND_KERNEL(OP, FLAT, NAME) \
kernel void NAME(device const float *a [[buffer(0)]], device const float *b [[buffer(1)]], \
                 device float *y [[buffer(2)]], device const float2 *affine [[buffer(3)]], \
                 device atomic_uint *guard [[buffer(4)]], constant NdParams &p [[buffer(5)]], \
                 uint3 gid [[thread_position_in_grid]]) { ndBody<OP, FLAT>(a, b, y, affine, guard, p, gid); }
#define ND_KERNELS(OP) ND_KERNEL(OP, false, nd_##OP) ND_KERNEL(OP, true, nd_##OP##_flat)
ND_KERNELS(0) ND_KERNELS(1) ND_KERNELS(2) ND_KERNELS(3) ND_KERNELS(4) ND_KERNELS(5)
ND_KERNELS(6) ND_KERNELS(7) ND_KERNELS(8) ND_KERNELS(9) ND_KERNELS(10)

// ---------------------------------------------------------------------------------------------
// MlasComputeSoftmax over contiguous rows of n: the maximum, MlasComputeSumExpVector of each
// element into four lane sums (element i joins lane i % 4 in order), the lanes reduced as
// (0 + 1) + (2 + 3), the tail of n % 4 added in order, then every exp scaled by 1 / sum.
// Four threads per row, one per lane.
struct SoftmaxParams { int rows, n, outSlot; };

inline float sumExp(float x, float negMax) {
	float v = max(-88.3762626647949f, cpuAdd(x, negMax));
	const float bias = 12582912.0f;
	const float biased = fma(v, 1.44269504088896341f, bias);
	const float m = biased - bias;
	v = fma(m, -6.93145752e-1f, v);
	v = fma(m, -1.42860677e-6f, v);
	const float normal = as_type<float>((as_type<uint>(biased) << 23) + 0x3f800000u);
	float p = 0x1.694000p-10f;
	p = fma(p, v, 0x1.125edcp-7f);
	p = fma(p, v, 0x1.555b5ap-5f);
	p = fma(p, v, 0x1.555450p-3f);
	p = fma(p, v, 0x1.fffff6p-2f);
	p = fma(p, v, 1.0f);
	p = fma(p, v, 1.0f);
	return cpuMul(p, normal);
}

kernel void softmax(device const float *x [[buffer(0)]], device float *y [[buffer(1)]],
                    device atomic_uint *guard [[buffer(2)]], constant SoftmaxParams &p [[buffer(3)]],
                    uint gid [[thread_position_in_grid]]) {
	const int row = int(gid / 4), j = int(gid % 4);
	const bool live = row < p.rows;
	device const float *in = x + (live ? row : 0) * p.n;
	device float *out = y + (live ? row : 0) * p.n;
	const int full = p.n >= 4 ? p.n & ~3 : 0;
	float mx = -FLT_MAX;
	bool finite = true;
	if (live) for (int i = j; i < p.n; i += 4) {
		finite = finite && isfinite(in[i]);
		mx = max(mx, in[i]);
	}
	mx = max(mx, simd_shuffle_xor(mx, 1));
	mx = max(mx, simd_shuffle_xor(mx, 2));
	const float negMax = -mx;
	float lane = 0.0f;
	if (live) for (int i = j; i < full; i += 4) {
		const float e = sumExp(in[i], negMax);
		out[i] = e;
		lane = cpuAdd(lane, e);
	}
	const float pair = cpuAdd(lane, simd_shuffle_xor(lane, 1));
	float total = full ? cpuAdd(pair, simd_shuffle_xor(pair, 2)) : 0.0f;
	for (int i = full; i < p.n; i++) {
		const float e = sumExp(in[i], negMax);
		if (live && j == 0) out[i] = e;
		total = cpuAdd(total, e);
	}
	if (!live) return;
	if (!finite) raise(guard, 2u);
	const float scale = 1.0f / total;
	for (int i = j; i < p.n; i += i < full ? 4 : 1) {
		if (i >= full && j != 0) break;
		const float v = cpuMul(scale, out[i]);
		note(v, guard, p.outSlot);
		out[i] = v;
	}
}

// Host data may hold subnormals; their magnitudes are noted for the consumers' conditions.
kernel void check_values(device const float *x [[buffer(0)]], device atomic_uint *guard [[buffer(1)]],
                         constant int2 &p [[buffer(2)]], uint gid [[thread_position_in_grid]]) {
	if (int(gid) < p.x) note(x[gid], guard, p.y);
}
`;
