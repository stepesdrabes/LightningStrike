#pragma once
#include <cstddef>
#include <cstdint>

// Writes (scale, shift) per instance as ORT's InstanceNormalization computes them; bit 1 of the
// result means a value fell outside the range the GPU apply pass reproduces.
uint32_t instanceNormStats(const float *data, size_t instances, size_t size, size_t stride, size_t channels,
                           float epsilon, const float *gamma, const float *beta, float *affine);

struct GemmRows {
	const float *a, *b, *bias;
	float *y;
	const uint32_t *rows;
	size_t m, n, k, kBlock, lda, ldb, ldc, batch, batchA, batchB, batchC;
	float alpha;
	uint32_t *least;
};

// Recomputes the rows of y = alpha A B (from the bias when there is one) that rows[] marks, as
// MLAS chains them: an fma chain over k per K block from +0, blocks fused onto the total in
// order. B is row-major [k][n]. Sets *least to the smallest output magnitude under 2^-32 (as
// bits, 0x7f800000 when none); bit 2 of the result marks a non-finite output.
uint32_t gemmRows(const GemmRows &g);
