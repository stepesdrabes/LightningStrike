# Native drum separation

The optional production path runs HTDemucs on stereo 44.1 kHz PCM, then jarredou's MDX23C
DrumSep on the stereo drum estimate. `DrumSeparator` returns mono drums, kick, snare, hi-hat and
cymbal PCM (ride and crash) at the original sample positions; the model's tom stem is not kept.
`runKit` runs the second stage alone on a stereo drum stem a previous run separated.
On CPU it releases the first model's sessions before opening the second's, uses 25% overlap
with Demucs triangle weights, and bounds each neural call to a fixed chunk: 7.8 seconds for
HTDemucs and 1,024 STFT frames (11.9 seconds) for MDX23C. Sessions run in worker threads;
chunk inputs are prepared while earlier chunks run, and results are committed in chunk order.
CPU separation uses two concurrent sessions per model on machines with at least eight
logical CPUs and 12 GiB (`lanes`, or `MV_DRUM_CPU_LANES`). Each keeps four intra-op threads.
Partial chunks use the same centered context padding as `demucs.apply_model`.

Models are optional local files in `MV_MODEL_DIR` or `models/`. Runtime does not download
them. `DrumSeparator.create()` returns null if either is missing and rejects an incorrect
checksum.

`DrumSeparator.create(modelDir, { graphCacheDir })` optionally caches optimized CPU graphs
locally after original model verification. Graphs are bound to model/runtime/hardware and
session options, verified before reuse, and regenerated on mismatch. The cache holds one
configuration per model and is derived data. Both models disable the retained CPU memory
arena to avoid multi-GB residency between calls. An explicit `cpuArena` boolean overrides
that for device benchmarking. See [performance measurements and the M1 Pro benchmark
protocol](SEPARATION-PERFORMANCE.md); its kit-stage figures predate MDX23C.

| Installed file | Source revision | SHA-256 |
|---|---|---|
| `htdemucs.onnx` | Host-FFT extraction of [StemSplitio/htdemucs-onnx](https://huggingface.co/StemSplitio/htdemucs-onnx/tree/d54ed9eb60e258ea82131c6ee14578628816456a) | `a6eabce31c0866a7ad7ac545dc7b12fbe4ccd0c86731e94e99fd5b583da504df` |
| `drumsep-mdx23c.onnx` | STFT-free export of `drumsep_5stems_mdx23c_jarredou.ckpt` ([mirror](https://github.com/EverlastEngineering/DrumToMIDI/tree/62ca57f8335942ebcc1fe6070af4e5249d845369/mdx_models)) | `e2ec140f5487c79b0be512d705746e2ac017bf3ab06d899d561ca963d91755c2` |

Install both exports and their notices from the workspace root:

```sh
uv run --no-project --python 3.12 --with onnx==1.22.0 --with torch==2.11.0 --with pyyaml --with onnxruntime==1.30.0 python bench/setup-drum-separation.py
```

The setup script pins full download URLs, revisions and SHA-256 values. It verifies existing
files and keeps intermediate exports under `bench/reports/audio-reliability/model-exports` so
desktop packaging does not copy them. Python is only needed to prepare the exports; the
application uses `onnxruntime-node`. The MDX23C export was byte-identical when repeated with
torch 2.11.0 and onnx 1.22.0 on Windows; if another platform produces a different checksum,
copy the verified file instead.

**License.** The MDX23C DrumSep weights are for non-commercial use only (the model repository
moved to CC BY-NC-SA 4.0; the checkpoints were published as CC BY-NC-ND 4.0). Setup writes
`drumsep-mdx23c.NOTICE`. Never publish the export or a build that contains it. The model code
is [Music-Source-Separation-Training](https://github.com/ZFTurbo/Music-Source-Separation-Training)
(MIT). The earlier [inagoy DrumSep](https://github.com/inagoy/drumsep) kit model was replaced
because it lost claps under loud kicks that listening had confirmed; MDX23C keeps them in its
snare stem.

HTDemucs extraction (`cut-htdemucs-fft.py`) preserves its learned weights and normalization.
It moves the export's dense convolution Fourier transforms to the shared host FFT and
returns only drums. This reduces the model from 316.4 MB to 168.5 MB and the graph from
24,765 to 3,430 nodes. The original export has SHA-256
`68d0bf16428ef66e692cdff8a9ccf28f1ef3f69440d57e58605a4cc55fcc5e74`.
Setup recognizes this previous production model, preserves it in ignored intermediate
exports, and replaces it only after validating the new graph checksum.

HTDemucs STFT uses a periodic 4096-sample Hann, hop 1024, normalization by 64, reflection
padding of 1536 plus the rounding remainder, and removal of the Nyquist bin and two frames per
side. Complex channels are ordered left real, left imaginary, right real, right imaginary.
The inverse restores zero Nyquist and edge frames, overlap-adds with the window-square
denominator, and crops the centered and explicit padding. Its output is added to the model's
time branch. These conventions follow [HDemucs](https://github.com/facebookresearch/demucs/blob/main/demucs/hdemucs.py)
and [the upstream spectrum functions](https://github.com/facebookresearch/demucs/blob/main/demucs/spec.py).

`export-mdx23c.py` exports `TFC_TDF_net` between its STFT and inverse STFT (opset 17, fixed
shape). `dsp/mdxFft.ts` mirrors the model's `torch.stft`: n_fft 2048, hop 512, periodic Hann,
centred with reflection, unnormalised, bins 0-1023 as left real, left imaginary, right real,
right imaginary. The inverse restores the zero Nyquist bin and follows `torch.istft`. The kit
input is the unnormalised stereo drum estimate, as the model was trained.

The fixed first-stage graph takes `mix[1,2,343980]` and `magnitude[1,4,2048,336]`, returning
`freq_output[1,1,4,2048,336]` and `time_output[1,1,2,343980]` for drums. The kit graph takes
`spec[1,4,1024,1024]` and returns `sources[1,5,4,1024,1024]` ordered kick, snare, toms,
hi-hat, cymbals.

CPU is the portable default. `DrumSeparator.create(modelDir, { provider: 'dml' })` explicitly
enables experimental DirectML on Windows. It disables memory patterns, serializes calls,
uses fixed-length kit inputs and disables HTDemucs DirectML graph fusion. The latter is a
correctness requirement: ORT 1.27's fused HTDemucs graph produced large, finite incorrect
values on the tested RTX 3060. Native errors or non-finite output restart the affected
stage on CPU; progress identifies the actual provider. CPU graph caches are not used by
DirectML. DirectML opens HTDemucs while the model checksums run, and opens the kit model while
HTDemucs runs and compiles it on an all-zero chunk; later outputs are unchanged. Successful
execution on an untested GPU/driver is not itself numerical validation. No CoreML or GPU
default is enabled on macOS.

Validation tools:

- `mdx23c-reference.py` runs the PyTorch MDX23C reference (overlap 4, fp16 CUDA) on cached
  drumeval stereo drum stems.
- `profile-separation.ts` isolates model and FFT timing and records input/model provenance.
- `exp-native-separation.ts` exercises the production API from planar stereo float32 PCM;
  it checkpoints first-stage stereo drums and `--resume` reuses them after verifying the
  input PCM hash, length and runtime version.
- `MV_SEPARATION_TEST_MODELS=1 npx vitest run packages/analysis/src/separation.test.ts`
  enables the optional real-model short-input test; ordinary FFT and installation tests
  require no model files.

On the 24-second Habibi excerpt, the complete stereo HTDemucs estimate matched PyTorch
with RMS error 2.9e-6 and correlation 0.99999999985. Host STFT maximum error was 5.7e-6;
inverse maximum error was 4.8e-7. On the full 146.9-second Habibi drum stem, the Node MDX23C
kit agrees with the PyTorch reference at 50.1 dB (kick), 28.2 dB (snare) and 37.9 dB (hi-hat)
signal-to-difference, which includes the reference's different overlap and fp16. CPU and
DirectML outputs agree at 74-120 dB. These measure conversion fidelity, not drum detection
accuracy. On the Ryzen 5 3600, with other preparation work running, the CPU kit stage took
1.2 to 1.4 times the audio duration with two lanes, and the whole CPU separation peaked at a
4.9 GB working set; DirectML on the RTX 3060 ran the kit stage in a tenth of the duration.
A script that runs CPU separation on its own main thread may not exit afterwards; production
runs it in the ingest worker, which terminates normally.

Upstream licenses: [Demucs MIT](https://github.com/facebookresearch/demucs/blob/main/LICENSE),
[StemSplit exporter MIT](https://github.com/StemSplit/demucs-onnx/blob/main/LICENSE),
[Music-Source-Separation-Training MIT](https://github.com/ZFTurbo/Music-Source-Separation-Training/blob/main/LICENSE).
