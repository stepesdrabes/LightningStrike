// CPU arithmetic for the separation engine, reproducing ONNX Runtime 1.27's ARM64 code for
// steps that are sequential reductions or subnormal-heavy chains, both faster here than on the GPU.
// Built with -ffp-contract=off: every fused operation below is an explicit fma.
#include "cpu.h"

#include <arm_neon.h>
#include <dispatch/dispatch.h>

#include <algorithm>
#include <atomic>
#include <cmath>
#include <cstring>

namespace {

// Eigen's redux over n floats whose first element sits `head` floats before 16-byte alignment:
// two four-wide accumulators over aligned packet pairs, one more packet if any, a pairwise
// horizontal sum, then the head and the tail in order. With squares, each term is (x - mean)^2.
float eigenRedux(const float *x, size_t n, size_t head, bool squares, float mean) {
	const float32x4_t m = vdupq_n_f32(mean);
	auto packet = [&](size_t i) {
		float32x4_t v = vld1q_f32(x + i);
		if (squares) {
			v = vsubq_f32(v, m);
			v = vmulq_f32(v, v);
		}
		return v;
	};
	auto value = [&](size_t i) {
		float v = x[i];
		if (squares) {
			v = v - mean;
			v = v * v;
		}
		return v;
	};
	if (head > n) head = n;
	const size_t alignedSize = (n - head) / 4 * 4, alignedSize2 = (n - head) / 8 * 8;
	const size_t alignedEnd = head + alignedSize, alignedEnd2 = head + alignedSize2;
	if (alignedSize == 0) {
		float res = value(0);
		for (size_t i = 1; i < n; i++) res = res + value(i);
		return res;
	}
	float32x4_t r0 = packet(head);
	if (alignedSize > 4) {
		float32x4_t r1 = packet(head + 4);
		for (size_t i = head + 8; i < alignedEnd2; i += 8) {
			r0 = vaddq_f32(r0, packet(i));
			r1 = vaddq_f32(r1, packet(i + 4));
		}
		r0 = vaddq_f32(r0, r1);
		if (alignedEnd > alignedEnd2) r0 = vaddq_f32(r0, packet(alignedEnd2));
	}
	const float32x4_t pairs = vpaddq_f32(r0, r0);
	float res = vpadds_f32(vget_low_f32(pairs));
	for (size_t i = 0; i < head; i++) res = res + value(i);
	for (size_t i = alignedEnd; i < n; i++) res = res + value(i);
	return res;
}

bool outside(float v) { return !std::isfinite(v) || (v != 0.0f && std::fabs(v) < 0x1p-40f); }

}  // namespace

uint32_t instanceNormStats(const float *data, size_t instances, size_t size, size_t stride, size_t channels,
                           float epsilon, const float *gamma, const float *beta, float *affine) {
	uint32_t flags = 0;
	const float count = static_cast<float>(size);
	for (size_t i = 0; i < instances; i++) {
		const float *x = data + i * stride;
		// ORT's buffers are 64-byte aligned, so instance i begins (i * size) mod 4 floats past alignment.
		const size_t head = (4 - ((i * size) & 3)) & 3;
		const float mean = eigenRedux(x, size, head, false, 0.0f) / count;
		const float squares = eigenRedux(x, size, head, true, mean);
		const float invStdev = 1.0f / std::sqrt(epsilon + (squares + 0.0f) / count);
		const float scale = invStdev * gamma[i % channels];
		const float shift = std::fma(-mean, scale, beta[i % channels]);
		if (outside(mean) || outside(scale) || outside(shift)) flags |= 1u;
		affine[2 * i] = scale;
		affine[2 * i + 1] = shift;
	}
	return flags;
}

namespace {

// R rows of y, 32 columns from n0, chained over k as MLAS does. The totals accumulate in y.
template <int R>
void gemmRowBlock(const GemmRows &g, const float *const *a, float *const *y, const float *b, size_t n0) {
	const size_t width = std::min<size_t>(32, g.n - n0), vectors = width / 4;
	const float32x4_t alpha = vdupq_n_f32(g.alpha);
	for (int r = 0; r < R; r++) {
		for (size_t t = 0; t < width; t++) y[r][n0 + t] = g.bias ? g.bias[n0 + t] : 0.0f;
	}
	for (size_t k0 = 0; k0 < g.k; k0 += g.kBlock) {
		const size_t kEnd = std::min(g.k, k0 + g.kBlock);
		const bool started = g.bias || k0 > 0;
		float32x4_t chain[R][8];
		float tail[R][4] = {};
		for (int r = 0; r < R; r++) for (size_t v = 0; v < 8; v++) chain[r][v] = vdupq_n_f32(0.0f);
		for (size_t k = k0; k < kEnd; k++) {
			const float *row = b + k * g.ldb + n0;
			float32x4_t bv[8];
			for (size_t v = 0; v < vectors; v++) bv[v] = vld1q_f32(row + 4 * v);
			for (int r = 0; r < R; r++) {
				const float32x4_t av = vdupq_n_f32(a[r][k]);
				for (size_t v = 0; v < vectors; v++) chain[r][v] = vfmaq_f32(chain[r][v], bv[v], av);
				for (size_t t = vectors * 4; t < width; t++) tail[r][t - vectors * 4] = std::fma(a[r][k], row[t], tail[r][t - vectors * 4]);
			}
		}
		for (int r = 0; r < R; r++) {
			float *out = y[r] + n0;
			for (size_t v = 0; v < vectors; v++) {
				vst1q_f32(out + 4 * v, started ? vfmaq_f32(vld1q_f32(out + 4 * v), chain[r][v], alpha) : vmulq_f32(chain[r][v], alpha));
			}
			for (size_t t = vectors * 4; t < width; t++) {
				const float c = tail[r][t - vectors * 4];
				out[t] = started ? std::fma(c, g.alpha, out[t]) : c * g.alpha;
			}
		}
	}
}

}  // namespace

uint32_t gemmRows(const GemmRows &g) {
	std::atomic<uint32_t> flags{0}, least{0x7f800000u};
	std::atomic<uint32_t> *sharedFlags = &flags, *sharedLeast = &least;
	const size_t chunks = (g.m + 15) / 16;
	dispatch_apply(g.batch * chunks, dispatch_get_global_queue(QOS_CLASS_USER_INITIATED, 0), ^(size_t job) {
		const size_t z = job / chunks, mStart = (job % chunks) * 16, mEnd = std::min(g.m, mStart + 16);
		const float *b = g.b + z * g.batchB;
		// Marked rows go two at a time, sharing each load of B.
		const float *a[16];
		float *y[16];
		size_t count = 0;
		for (size_t m = mStart; m < mEnd; m++) {
			if (!g.rows[z * g.m + m]) continue;
			a[count] = g.a + z * g.batchA + m * g.lda;
			y[count++] = g.y + z * g.batchC + m * g.ldc;
		}
		for (size_t n0 = 0; n0 < g.n; n0 += 32) {
			size_t r = 0;
			for (; r + 2 <= count; r += 2) gemmRowBlock<2>(g, a + r, y + r, b, n0);
			if (r < count) gemmRowBlock<1>(g, a + r, y + r, b, n0);
		}
		uint32_t localFlags = 0, localLeast = 0x7f800000u;
		for (size_t r = 0; r < count; r++) {
			for (size_t t = 0; t < g.n; t++) {
				uint32_t mag;
				std::memcpy(&mag, y[r] + t, 4);
				mag &= 0x7fffffffu;
				if (mag >= 0x7f800000u) localFlags |= 2u;
				else if (mag != 0u && mag < 0x2f800000u) localLeast = std::min(localLeast, mag);
			}
		}
		sharedFlags->fetch_or(localFlags);
		uint32_t seen = sharedLeast->load();
		while (localLeast < seen && !sharedLeast->compare_exchange_weak(seen, localLeast)) {}
	});
	*g.least = least.load();
	return flags.load();
}
