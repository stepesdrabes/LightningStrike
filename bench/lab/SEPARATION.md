# Native drum separation

The optional production path runs HTDemucs on stereo 44.1 kHz PCM, then DrumSep on the
stereo drum estimate. `DrumSeparator` returns mono drums, kick, snare and cymbal PCM at the original
sample positions. It releases the first ONNX session before opening the second, uses 25%
overlap with Demucs triangle weights, and bounds each neural call to 7.8 or 8 seconds.
Partial chunks use the same centered context padding as `demucs.apply_model`.
Both graph calls always receive their validated fixed lengths. Although DrumSep declares
dynamic axes, arbitrary final lengths can fail in internal traced padding branches.

Models are optional local files in `MV_MODEL_DIR` or `models/`. Runtime does not download
them. `DrumSeparator.create()` returns null if either is missing and rejects an incorrect
checksum. Preserve the upstream MIT license notices when distributing the exports.

`DrumSeparator.create(modelDir, { graphCacheDir })` optionally caches optimized CPU graphs
locally after original model verification. Graphs are bound to model/runtime/hardware and
session options, verified before reuse, and regenerated on mismatch. The cache holds one
configuration per model and is derived data. HTDemucs disables its retained CPU memory
arena to avoid multi-GB residency between calls; DrumSep keeps the normal arena. An explicit
`cpuArena` boolean overrides both settings for device benchmarking. The
inverse FFT uses one packed real transform. See [performance measurements and the M1 Pro
benchmark protocol](SEPARATION-PERFORMANCE.md).

| Installed file | Source revision | SHA-256 |
|---|---|---|
| `htdemucs.onnx` | Host-FFT extraction of [StemSplitio/htdemucs-onnx](https://huggingface.co/StemSplitio/htdemucs-onnx/tree/d54ed9eb60e258ea82131c6ee14578628816456a) | `a6eabce31c0866a7ad7ac545dc7b12fbe4ccd0c86731e94e99fd5b583da504df` |
| `drumsep.onnx` | Patched [splitzo/drumsep](https://huggingface.co/splitzo/drumsep/tree/f510fb1dbdd968e3218f64e8d7ac1af0fafdb6e2) | `e35619cef17d1aeaf410dae9d9895f3814cccc51b7a0deecbf543fe0131d7002` |

Install both exports and their license notices from the workspace root:

```sh
uv run --no-project --python 3.12 --with onnx==1.22.0 python bench/setup-drum-separation.py
```

The setup script pins full download URLs, revisions and SHA-256 values. It verifies existing
files, applies the reproducible graph patch when needed, and keeps intermediate exports under
`bench/reports/audio-reliability/model-exports` so desktop packaging does not copy them.
The original Splitzo file has SHA-256
`313dcb93e0ed60f52280cd20f2145f32110ffa6f450ce157a69846e16642dd5f`.
Python and pinned ONNX 1.22.0 are only needed to prepare the export; the application uses
`onnxruntime-node`.

HTDemucs extraction (`cut-htdemucs-fft.py`) preserves its learned weights and normalization.
It moves the export's dense convolution Fourier transforms to the shared host FFT and
returns only drums. This reduces the model from 316.4 MB to 168.5 MB and the graph from
24,765 to 3,430 nodes. The original export has SHA-256
`68d0bf16428ef66e692cdff8a9ccf28f1ef3f69440d57e58605a4cc55fcc5e74`.
Setup recognizes this previous production model, preserves it in ignored intermediate
exports, and replaces it only after validating the new graph checksum.

The patch replaces four unsupported boolean `EyeLike` operations with equality of dynamic
row and column indices. It also restores the waveform-dependent final reshape length that
the exporter had captured as the constant 1764000 despite declaring a dynamic sample axis.
The [Gridshift export](https://huggingface.co/gridshiftstudio/drumsep-onnx) replaces those
diagonal masks with identity operations on all-false tensors. This changes attention and
produced 18% relative RMS error on the Habibi snare estimate, so that export is not accepted.

STFT uses a periodic 4096-sample Hann, hop 1024, normalization by 64, reflection padding of
1536 plus the rounding remainder, and removal of the Nyquist bin and two frames per side.
Complex channels are ordered left real, left imaginary, right real, right imaginary.
The inverse restores zero Nyquist and edge frames, overlap-adds with the window-square
denominator, and crops the centered and explicit padding. Its output is added to the model's
time branch. These conventions follow [HDemucs](https://github.com/facebookresearch/demucs/blob/main/demucs/hdemucs.py)
and [the upstream spectrum functions](https://github.com/facebookresearch/demucs/blob/main/demucs/spec.py).

The fixed first-stage graph takes `mix[1,2,343980]` and `magnitude[1,4,2048,336]`, returning
`freq_output[1,1,4,2048,336]` and `time_output[1,1,2,343980]` for drums. The corrected second-stage graph
takes `waveform[1,2,N]` and `magnitude[1,4,2048,ceil(N/1024)]`, returning
`freq_output[1,4,4,2048,ceil(N/1024)]` and `time_output[1,4,2,N]` ordered
kick, snare, cymbals, toms. Production fixes `N=352800` (8 seconds); the dynamic metadata
does not guarantee arbitrary-length execution.

CPU is the portable default. `DrumSeparator.create(modelDir, { provider: 'dml' })` explicitly
enables experimental DirectML on Windows. It disables memory patterns, serializes calls,
uses fixed-length DrumSep inputs and disables HTDemucs DirectML graph fusion. The latter is a
correctness requirement: ORT 1.27's fused HTDemucs graph produced large, finite incorrect
values on the tested RTX 3060. Native errors or non-finite output restart the affected
stage on CPU; progress identifies the actual provider. CPU graph caches are not used by
DirectML. Successful execution on an untested GPU/driver is not itself numerical validation.
No CoreML or GPU default is enabled on macOS.

Validation tools:

- `exp-onnx-parity.py` compares an exact native forward with the Node tensors.
- `profile-separation.ts` isolates model and FFT timing and records input/model provenance.
- `exp-native-separation.ts` exercises the production API from planar stereo float32 PCM;
  it checkpoints first-stage stereo drums and `--resume` reuses them after verifying the
  input PCM hash, length and runtime version.
- `MV_SEPARATION_TEST_MODELS=1 npx vitest run packages/analysis/src/separation.test.ts`
  enables the optional real-model short-input test; ordinary FFT and installation tests
  require no model files.
- `prepare-drum-evidence.ts --ids=ID,ID --out=IGNORED_DIRECTORY` copies cached audio and
  metadata into an isolated cache, runs each full track in a separate serial DirectML
  process, and saves pure 44.1 kHz stems, 22.05 kHz evidence and SHA/version manifests.
  It verifies evidence read-back and preserves existing scratch analyses. It does not run
  the detector or write to the source library. Use this to compare detector revisions on
  full-song source estimates without repeating neural separation.

On the 24-second Habibi excerpt, the complete stereo HTDemucs estimate matched PyTorch
with RMS error 2.9e-6 and correlation 0.99999999985. Host STFT maximum error was 5.7e-6;
inverse maximum error was 4.8e-7. The corrected DrumSep snare estimate on an identical
40-second padded input had RMS error 0.000137 and correlation 0.99999895. These measure
conversion fidelity, not drum detection accuracy.

Upstream licenses: [Demucs MIT](https://github.com/facebookresearch/demucs/blob/main/LICENSE),
[DrumSep MIT](https://github.com/inagoy/drumsep/blob/main/LICENSE),
[StemSplit exporter MIT](https://github.com/StemSplit/demucs-onnx/blob/main/LICENSE).
