# Exact drum separation on Apple silicon GPUs

On Apple silicon both separation stages (HTDemucs, then MDX23C) run on the GPU and return the
same bits as ONNX Runtime 1.27's ARM64 CPU kernels. Analyses, drum evidence and shows are
identical; only preparation time changes. Measured on the M1 Pro (14-core GPU, 16 GB), fresh
drum evidence, warm graph cache (`bench/reports/metal-separation/`):

| Track | CPU | Metal | Same analysis and drum evidence |
|---|---:|---:|---|
| Like a Prayer (131 s) | 140 s | 45 s | yes |
| Bangarang (215 s) | 204 s | 80 s | yes |
| September (217 s) | 229 s | 73 s | yes |

One chunk on ONNX Runtime's CPU kernels against the plan: HTDemucs 1.9 s against 0.74 s (0.48 s
of it GPU, the rest native steps), MDX23C 8.3 s against 1.27 s. Peak RSS stayed under the CPU
path's (4.5 to 6.3 GB against 6.3 to 7.5 GB).

## Where it lives

- `packages/analysis/native/`: `metal.mm` (a small N-API Metal binding), `cpu.cpp` (CPU steps
  that are faster natively: large instance-norm statistics and subnormal-heavy GEMM rows),
  `build.ts` (`npm run build:metal -w @mv/analysis`; the desktop bundle builds it beside the
  workers).
- `packages/analysis/src/metal/`: `onnx.ts` parses ORT's optimized CPU graph, `mlas.ts` predicts
  MLAS's K blocking, `kernels.ts` holds the Metal source, `plan.ts` compiles the graph into
  recorded command buffers and runs it, `plan.test.ts` checks it against ORT.
- `metalWorker.ts` runs a plan in a worker; `separation.ts` opens one per stage (`METAL_STAGES`)
  from the cached CPU graph and restarts a stage on the CPU if Metal fails. `MV_DRUM_METAL=0`
  turns it off.

## Why the results are exact

The plan runs ORT's own optimized graph, so it executes the same operators. Each kernel performs
the same IEEE operations in the same order as the MLAS or Eigen code ORT runs on ARM64:

- **Product sums.** MLAS computes each output of a GEMM or convolution as an fma chain over k
  from +0 within a K block, then adds block results in order (fused with alpha, or onto the bias
  with beta 1). `simdgroup_multiply_accumulate` computes exactly that chain, so any tiling works.
  The block size depends on how MLAS partitions threads: `mlas.ts` reproduces it, including the
  fourfold degree of parallelism MLAS uses on CPUs with two core types.
- **Other operators** are ports of the shipped ARM64 code, read from the dylib's disassembly where
  the source was ambiguous: Eigen's two-packet reductions for InstanceNormalization, Welford's
  LayerNormalization, MLAS's erf (Gelu), logistic and Softmax exp polynomials, and Col2im's sum
  order. `#pragma METAL fp contract(off)` stops the compiler from fusing; safe math mode keeps
  division and square root correctly rounded.
- **Subnormals.** The GPU flushes subnormal inputs and results of every arithmetic operation; the
  CPU keeps them. A product of operands at least 2^ea and 2^eb is a multiple of 2^(ea + eb - 46),
  so while every product has ea + eb >= -80 (less alpha's lowest set bit) no partial sum can be
  subnormal and the GPU result is exact. Rows that fail this bound are recomputed:
  - on the GPU with hardware fma while every result stays at least 2^-125, or while a subnormal
    operand is provably absorbed (its product is under half the spacing of the partial sum);
  - otherwise with `softFma`, an integer emulation of IEEE fma with subnormals;
  - for attention's probability-times-values products, natively on the CPU (`gemmRows`): the
    first frequency-branch self-attention holds subnormal probabilities in about 70% of rows.
  Softmax emulates the CPU's subnormal exps and products. Elementwise kernels raise a flag when
  an operand or result is outside the range they reproduce.
- **Guard.** Every value records its smallest magnitude under 2^-32, and the plan checks the
  ranges its arguments assume. A chunk it cannot prove exact returns a doubt, and the worker
  runs that chunk on ORT's CPU kernels instead.

## Performance notes

- Activations live row-interleaved, `[H][C][W]`; NCHW thrashed the GPU TLB.
- A padded convolution's input carries its zero border: when a value's only consumers are
  convolutions padding it alike, its producer writes into the interior of a padded buffer that
  only shares storage with the same geometry. The kernel then needs no bounds checks (+30%).
- Fragment arrays (4 x 4 per simdgroup) stay in registers only when their loops are fully
  unrolled; without the pragma they spill and run several times slower.
- Guard minima are reduced per simdgroup before the atomic; per-thread atomics on outputs full
  of small values took a 1x1 convolution from 4 ms to 25 ms.
- Large instance-norm statistics are eight sequential chains per instance, faster on a CPU core;
  the plan runs them natively between GPU segments, zero-copy on shared buffers.
- The kit plan is built while HTDemucs runs, and ADTOF transcribes the five sources in parallel.
- Elementwise kernels are instantiated per op and for tensors whose outer three dimensions
  are 1; the generic indexing cost nearly half their time.
- Convolution and GEMM block totals stay in registers rather than threadgroup memory.
- Remaining time per chunk: convolutions run at about 2.5 to 2.7 TFLOPS (MMA peak is about 4);
  in HTDemucs the native replay of marked attention rows takes about 190 ms beside 480 ms of GPU.

Tried and dropped, all exact but slower: a second HTDemucs plan to fill the GPU while the first
runs native steps (the plans contend; 20.9 s against 18.9 s per song), threadgroup-staged
convolution tiles, several elements per elementwise thread, and one simdgroup per softmax row.

Not exact, so not usable: CoreML, MPS and MPSGraph (unknown accumulation order), Winograd or FFT
convolutions, and Accelerate's BLAS (different blocking).

## Verifying a change

1. `npx vitest run packages/analysis/src/metal/plan.test.ts`. Each case is built so that its
   correction path decides the output bits: disabling the conv corrector, the GPU row replay, the
   native replay or the softmax emulation must make a case fail.
2. `node bench/lab/metal-compare.ts --id=TRACK --stage=drums` (and `--stage=kit`) compares one real
   chunk against ORT bit for bit and prints timings; `--profile` lists the slowest steps.
3. Prepare whole tracks with `bench/lab/profile-ingest.ts --cache=cache --fresh-evidence
   --graphs=cache/separator-graphs`, once with `MV_DRUM_METAL=0`, and compare the analysis hashes.
