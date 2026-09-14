# Separation performance measurements

Kit-stage and whole-preparation figures below were measured with the earlier inagoy DrumSep
kit model; HTDemucs figures still apply. The MDX23C kit stage costs are in
[SEPARATION.md](SEPARATION.md).

Measurements use the same 24-second stereo Habibi PCM excerpt, the pinned production
models and production chunking. Outputs and JSON profiles are ignored under
`bench/reports/audio-reliability/separation-performance`. Run only one neural benchmark
at a time, with LightningStrike preparation idle: a concurrent app run caused paging and
invalidated one six-thread measurement on this 16 GB machine.

The tested machine is a Ryzen 5 3600 (six physical cores), 16 GB RAM, RTX 3060 12 GB,
Windows 11, Node 24.19 and ONNX Runtime Node 1.27.0. These are not M1 Pro measurements.
The harness records OS/architecture, CPU, ORT versions, provider options and input hash.

## Concurrent preparation (current runtime)

Preparation overlaps work that does not depend on other work. The Node binding runs
`session.run()` synchronously on its calling thread, so every ONNX session lives in its own
worker thread (`onnxSession.ts`, `onnxWorker.ts`). Cover-art and catalogue lookups run beside
the audio work, and EffNet, ADTOF and Beat This! run beside separation. Loudness, the stereo
image, the mix spectrogram, onset curves and chroma need only decoded audio, so a DSP worker
computes them beside the models (`prelude.ts`, `dsp.ts`, `dspWorker.ts`); four more compute
the separated kick, snare, hi-hat and cymbal onset curves while the evidence cache is written,
after ADTOF has transcribed the drum stem and each source. Separation
prepares each chunk's normalized input and STFT while earlier chunks run, then commits
chunks strictly in order, so every overlap-add accumulates in the original order.

CPU separation uses two lanes on machines with at least eight logical CPUs and 12 GiB:
two sessions of the same model with four intra-op threads each, sharing one chunk queue and
with intra-op spinning disabled. `MV_DRUM_CPU_LANES=1..4` overrides the count. DirectML
keeps one lane; a second DirectML session on the RTX 3060 did not add throughput. Creating
the HTDemucs DirectML session takes about two seconds, so it starts while the model
checksums run; CPU sessions wait, because an unverified model must never publish a cached
CPU graph. DirectML also opens the kit model while HTDemucs runs and compiles it on an all-zero
chunk: DrumSep's first real run otherwise spent about 2.6 seconds compiling kernels.

Every change below was accepted only with byte-identical `.analysis.json`:

- DrumSep CPU output depends on `intraOpNumThreads`: 1-3 threads agree, 4, 6, 8 and 12 each
  differ. HTDemucs, Beat This! and ADTOF were identical at every tested count on x64, but
  ARM64 lacks the NCHWc convolution path, so no count change is assumed safe on the Mac.
- Concurrent sessions with identical options match sequential runs bit for bit, on CPU and
  DirectML. Arena, memory pattern and spinning settings do not change output. A DirectML
  warm-up run does not change later outputs.
- Input tensors alias JS memory; keep their `byteOffset` at zero. Research against the
  1.27 source also found that `session.disable_prepacking` changes output.

Habibi, isolated caches, warm CPU graph cache, separation evidence deleted before each run.
Each A/B alternated the previous commit (a `git worktree`) with the candidate, two rounds of
two runs; each row adds to the one above. The previous-commit range spans all three A/B
sessions, and the DirectML warm-up row is one pair of runs without its own baseline:

| Candidate | CPU wall time | CPU peak RSS | DirectML wall time | DirectML peak RSS |
|---|---:|---:|---:|---:|
| Previous commit | 125.9-135.8 s | 2.81-2.92 GB | 47.3-48.6 s | 1.75-2.08 GB |
| Worker sessions, CPU lanes, concurrent stages | 93.3-97.1 s | 5.64-6.18 GB | 26.6-26.9 s | 2.26-2.32 GB |
| DrumSep DirectML warm-up | | | 22.7-23.1 s | 2.64-2.71 GB |
| FFT loop order, earlier decode, quiet threads | 89.3-92.2 s | 6.62-6.76 GB | | |
| Prelude and onset curves in workers, earlier DirectML HTDemucs session | 83.8-86.4 s | 6.68-6.81 GB | 17.9-18.4 s | 2.83-2.94 GB |

Every analysis in these runs equals the previous commit's analysis for its provider; the CPU
analyses also equal the release v36 CPU analysis. Reports, one directory per A/B variant:
`bench/reports/audio-reliability/ingest-performance/perf-0913/ab/`. With `--fresh-genre`
(the local EffNet stage of a new track, 0.76 s before) the previous commit took
124.6-125.2 s on CPU and 47.8-48.2 s on DirectML; the final candidate 84.0-85.4 s and
17.9-18.3 s, with identical analyses, contexts and metadata. The bundled `ingest-worker.mjs`,
`onnx-worker.mjs` and `dsp-worker.mjs` on the pinned Node 24.11.0 runtime matched as well.
A behavior-preserving review refactor followed these runs. Rechecked later on a busier machine
(38-95 s of other CPU per run instead of about 16 s), DirectML took 21.4-21.8 s with the final
bundle and 20.4-21.6 s with the previous one from the same folder; interleaved with the previous
bundle (21.3-21.9 s), the installed app folder took 21.7-23.1 s. All analyses stayed identical
(`perf-0913/refactor-check/`).

- HTDemucs keeps about 2.2 GB of activations per call without its arena, so two lanes peak
  near 6 GB in separation alone and whole preparation at 6.7-6.8 GB; with its arena, two
  lanes kept 10.2 GB. The kit model's arena is off as well.
- Two lanes: HTDemucs 2.21 s per chunk against 3.05 s alone; DrumSep 1.20 against 1.76 s.
  Three lanes added 5-7% at a much higher memory cost.
- Spinning off kept two-lane separation throughput and saved about a quarter of its CPU
  time. Whole-song runs took 96-97 s against 95 s with spinning, but peaked at 5.7 against
  6.7 GB with less timer lateness (99th percentile 16-19 against 21-27 ms).
- `Float32Array.from(source, map)` spent 4.2 seconds on the separator's four mono downmixes;
  a loop takes 60 ms. `every(Number.isFinite)` spent about 0.2 s checking whole-song PCM.
- Visiting each FFT level's butterflies twiddle-first is bit-identical and about 27% faster.
- Sparse filterbank spans: ADTOF's spectrogram fell from 1.80 to 0.54 s and Beat This!'s
  mel frontend from 0.77 to 0.16 s. Analysis reuses its chromagram and shifts HPSS median
  windows with loops. With its prelude and onset curves computed ahead, `analyzeTrack` takes
  0.7 s instead of 2.8 s; the analysis stage, which includes waiting for those workers,
  fell from about 3.7 to 1.3 s.
- Computing ADTOF's half-second spectrogram in a worker removed one stalled DirectML chunk, but
  preparation did not get shorter (DirectML 17.8-18.3 s, CPU 85.9-86.8 s); it was not kept.
- A 10 ms main-thread timer, standing in for the hardware renderer, fired late by at most
  6.6-6.9 ms at the 99th percentile before; during CPU preparation it reached 13.4-15.5 ms,
  and 9.2-10.3 ms with DirectML.

ONNX Runtime on Windows cannot open a path longer than 260 characters. Graph cache names
are long, so every earlier benchmark under `bench/reports/audio-reliability/ingest-performance`
recompiled both graphs; the app's default cache path was short enough. Cached graphs now
open through `\\?\` paths.

## Whole-track measurements

The full 146.946-second Habibi recording was decoded and analyzed in isolated copies of
the desktop cache, with the app closed. Runs use Node 24.19 and the same saved source
audio and context. Learned weights are unchanged; the exported graph differs.
`bench/lab/profile-ingest.ts` runs the real ingest worker and
records progress, process peak RSS, hashes and stage timing. The older baseline uses the
installed bundled worker; the candidate uses the workspace worker.

| Pipeline | Wall time | Process peak RSS | Evidence reused |
|---|---:|---:|---|
| Installed v35 baseline | 171.37 s | 5.39 GB | No |
| Final v36 packaged CPU worker, first run | 159.55 s | 3.01 GB | No |
| Same CPU path, forced detector reanalysis | 15.78 s | 1.98 GB | Yes |
| Final v36 DirectML on RTX 3060, first run | 51.88 s | 1.74 GB | No |

The final portable CPU path takes 6.9% less time and 44.2% less peak process memory.
Forced reanalysis with cached source evidence takes 90.8% less time than the old cold run;
this is not a first-import claim. DirectML takes 69.7% less time on this tested Windows GPU
and remains explicit opt-in (`MV_DRUM_PROVIDER=dml`). CPU is the portable default.
Reports: `ingest-performance/{installed-baseline,release-v36-cpu,release-v36-dml}`. The two
release profiles use the identical built worker and packaged native dependencies on Node
24.19, matching the baseline benchmark host. Both statuses are verified; packaging and
all other inference had finished. The actual bundled Node 24.11.0 also completed forced
cached reanalysis in 15.91 seconds with bit-identical event streams.

Final CPU and DirectML produce identical 301 kick, 138 snare and 546 hat timestamps; one
snare strength differs by one percentage point. All eight newly recovered Habibi snare
attacks, four prior confirmed positives and two negative exclusions pass on CPU. Cold
and warm CPU event streams are bit-identical. Detailed checks are in
`judgement-correction/{release-provider-parity,pinned-runtime-check,release-cpu-habibi-labels}.json`.

The earlier performance-only CPU run took 153.92 seconds and 3.03 GB, a 10.2% time saving;
the observed CPU range is therefore about 154–160 seconds, not a guaranteed fixed time.
Those changes preserved complete snare/hat streams; source-ownership correction removed
12 duplicate/invented kicks. The earlier clean DirectML run took 51.59 seconds.
The earlier arena/FFT/cache-only candidate took 184.18 s cold and was a regression;
`optimized-cpu` is retained as negative evidence. A separate 52.50 s DirectML run overlapped
two static model exports and is excluded from the clean timing comparison.

Successful 22.05 kHz kick/snare/cymbal evidence is persisted losslessly, keyed by the
44.1 kHz stereo PCM identity, frame count, separation revision and resampling settings.
Payload checksums reject truncated/corrupt artifacts. The 2 GiB LRU budget touches only
derived `.drums` files. Graph and evidence cache errors do not fail song preparation.

```sh
node bench/lab/profile-ingest.ts --id=TRACK --out=NEW_REPORT_DIRECTORY --runs=2
node bench/lab/profile-ingest.ts --id=TRACK --out=NEW_REPORT_DIRECTORY --runs=2 --fresh-evidence --graphs=GRAPH_DIR --fresh-genre
```

Use a new report directory each time. The harness copies source audio, metadata, context,
analysis and any hand-map judgement into its own cache. It never rewrites the source
library. It records source-module hashes and rejects changes during a workspace benchmark.
`--fresh-evidence` deletes separated drums before each run, `--graphs` seeds verified CPU
graphs as in a warm app, `--fresh-context` reruns catalogue enrichment (network lookups),
`--fresh-genre` reruns only the local genre model and `--worker` times a bundled
`ingest-worker.mjs` with its sibling worker bundles. For an A/B, run the previous commit from a
`git worktree` and alternate it with the candidate, then `cmp` the `run-*.analysis.json` files.

## Host-FFT model extraction (current runtime)

The HTDemucs learned network is unchanged, but its dense Fourier-transform convolutions
and inverse overlap-add graph have moved to the shared host FFT. The extracted model is
168.5 MB instead of 316.4 MB, with 3,430 nodes instead of 24,765. Its pinned checksum and
reproducible setup are documented in [SEPARATION.md](SEPARATION.md).

A fixed normalized 7.8-second CPU forward matches the original export with relative RMS
error 3.70e-7, maximum absolute error 2.06e-6 and correlation 0.99999999999988. Three warm
host-FFT calls took a median 3.398 seconds versus 3.730 seconds for the original optimized
graph, approximately 9% faster. Loading the new graph took about 0.9 seconds.

A separate consecutive arena comparison found median 2.766 seconds with the CPU arena
and 3.051 seconds without it, with identical PCM. Peak RSS was 4.75 GiB with the arena
versus 2.55 GiB without. The memory-conscious default therefore keeps the HTDemucs arena
disabled; the explicit `cpuArena` option supports future measurements on other devices.
These chunk measurements are not a whole-track ingestion speed claim.

## Earlier CPU measurements (original dense-FFT model)

HTDemucs' default CPU arena retained approximately 5.24 GB RSS after inference. Disabling
that arena retained approximately 0.79 GB and produced **bit-identical** mono drums for
all 1,058,400 excerpt samples. The clear-window four-thread run took 17.54 seconds for
five model calls, versus 22.54 seconds in the earlier arena baseline. Because available
memory also improved between runs, whole-track controlled timings should determine the
speed claim. At the time the setting changed HTDemucs only; both arenas are now off.

Two HTDemucs threads were slower (30.00 seconds of inference). Six threads with its arena
disabled took 18.35 seconds, so the portable default remains four. A separate six-thread
run under memory pressure is excluded entirely.

The inverse FFT now packs its even real and odd imaginary spectral components into one
real transform. On a saved eight-second model tensor, the median time fell from 442 to
252 ms (43%). Maximum sample error was 2.38e-7 and relative RMS error 4.52e-8. Independent
NumPy reference tests and a direct complex-bin phase test pass. Models, overlap, source
normalization and the onset detector are unchanged by these implementation optimizations.

An optimized HTDemucs graph loaded in 0.577 seconds versus 5.4–8.7 seconds for the original
graph. It occupies 345 MB and includes hardware-specific graph transforms. The optional
production `graphCacheDir` keeps one graph per model, keyed by original model
SHA-256, ORT version, platform/architecture/CPU, OS release and CPU session options.
Reopening requires streaming SHA-256 verification and disables already-applied graph
transforms. Published filenames include the configuration and graph-content SHA-256;
an atomic hard link publishes immutable bytes. Concurrent pruning can cause a cache miss,
but cannot substitute different bytes between verification and native opening. Corrupt
or unloadable artifacts rebuild from the verified original model. Filesystems without
hard-link support retain the successfully loaded original session without caching it.

There is no persistent lease to strand after desktop shutdown. Temporary exports include
the process ID and a UUID. Cleanup removes an orphan only when probing its process returns
`ESRCH`; live, suspended, inaccessible or reused process IDs are retained conservatively.
Stale configurations are pruned best-effort, with a 512 MiB published-graph budget per
model. Oversized exports are discarded; undeletable old graphs can prevent publication.
Concurrent active exports can temporarily exceed that budget. Only derived graph names
are eligible for cleanup; user audio and original models are outside this directory.
The prior real two-pass model test
compiled both graphs, reopened them and obtained bit-identical PCM for all four outputs.
The immutable-publication update is covered by simulated loader tests for interruption,
corruption, concurrent pruning, failed export, unsupported links and oversized output;
it has not repeated neural inference or an M1 Pro runtime test.

## GPU validation of the extracted graph

The original dense-FFT HTDemucs graph exhausted the 12 GB GPU. The extracted graph fits,
but DirectML fusion produced severely incorrect finite PCM (relative RMS error above
13,000). Disabling HTDemucs DirectML graph fusion with
`extra.ep.dml.disable_graph_fusion='1'` restored accuracy. It is mandatory in the explicit
Windows DirectML runtime option. CPU remains the default on every platform.

| Two-stage input | Separation wall time | Peak process RSS |
|---|---:|---:|
| Habibi 24 s | 11.84 s | 0.98 GiB |
| Back In Black 24 s | 11.67 s | 0.91 GiB |
| bad guy 24 s | 13.05 s | 1.01 GiB |
| Full Habibi 146.946 s | 36.03 s | 1.40 GiB |

These fresh-process runs include graph loading and first-call GPU compilation, both
separation stages, mono output and diagnostic file writes; they exclude decoding,
transcription and the final detector. Full Habibi used 12.12 seconds for first-stage drums
and 19.11 seconds for the kit stage. GPU total-device memory peaked at 3,959 MiB from a
1,517 MiB desktop baseline. Steady HTDemucs calls including host FFT took roughly 0.35
seconds; DrumSep neural calls took roughly 0.27 seconds plus host FFT.

All source PCM comparisons passed relative RMS <0.001 and correlation >0.999999.
Full-Habibi snare relative RMS was 0.000335, with correlation 0.9999999474. The three
24-second excerpts produced exactly the same kick/snare/hat event times and strengths.
Full Habibi retained all 296 kick, 129 snare and 543 hat timestamps, all four confirmed
claps and both excluded false snares. Two snare strengths changed by one percentage
point; all other strengths matched. This validates the tested device and driver, not
untested Mac or Windows accelerators.

Reports are under `separation-performance/htcut-dml-{habibi,bib,bad-guy,habibi-full}`.
`compare-separated-pcm.ts` and `compare-separated-onsets.ts` compare
each candidate against saved original sources with the identical PCM/grid/transcription.
The historical cut-graph admission script is preserved in the local cleanup archive;
current runs use `profile-separation.ts` plus these numerical/event comparisons.

DirectML requires sequential execution and disabled memory patterns; see the
[official provider documentation](https://onnxruntime.ai/docs/execution-providers/DirectML-ExecutionProvider.html).

## Reproduction and future M1 Pro tests

The desktop package now declares macOS 14.0 as its minimum. Inspection of both native
ONNX Runtime 1.27 ARM64 Mach-O libraries found deployment target 14.0; this is stricter
than the bundled Node 24.11 requirement of 13.5. `node bench/lab/check-mac-runtime.ts`
checks architecture and deployment metadata against the app declaration without executing
macOS code. Native packaging selects ARM64 Node and ONNX dependencies on an ARM64 build
host. Copy the updated platform-independent `models/` files or run the pinned setup script
before building there. Windows optimized graph caches are regenerated for the Mac.

The input is planar stereo float32 PCM at 44.1 kHz. Use the identical PCM file for every
variant; do not compare excerpt normalization against a different full-track input.

```sh
node bench/lab/profile-separation.ts --provider=cpu --lanes=1 --out=bench/reports/audio-reliability/separation-performance/cpu-lanes-1
node bench/lab/profile-separation.ts --provider=cpu --lanes=2 --out=bench/reports/audio-reliability/separation-performance/cpu-lanes-2
node bench/lab/profile-separation-fft.ts
```

`--threads` remains for numerical experiments only; any value other than four changed
DrumSep's CPU output, and production keeps four for MDX23C too. With several lanes, summed
call time exceeds wall time.

`--stage=drums` profiles only HTDemucs; `--stage=kit` takes previously separated planar
stereo drums. `--arena=false` disables CPU arenas for the requested stages. The production
default already disables the HTDemucs arena. `--save-optimized=DIR` writes diagnostic
optimized ONNX files; it never changes the original pinned models.
`--arena=true` measures the higher-memory alternative. `--ort-profile=DIR` records the
native provider/operator trace; `summarize-ort-profile.ts TRACE.json` aggregates it. Trace
durations can represent GPU host dispatch, so use the main harness for wall time.
`--graph-cache=DIR` exercises production CPU cache generation and reuse; compare first and
second runs in the same environment. This flag cannot be combined with GPU providers,
arena/spinning overrides or diagnostic export paths.

`profile-ht-cpu-arena.ts` is prepared but unrun: its four arena, memory-pattern and
initializer configurations depend on local ignored captures named in its `FILES`. Run
`--prepare` before `--run`; no gain from it is established. Node 1.27 exposes neither arena
shrink/cap controls nor `RunOptions.extra`, so do not benchmark those flags. Never run
inference benchmarks beside the app, another benchmark, a build or tests.

The M1 Pro lane comparison is described in the [handover](../../docs/HANDOVER.md). The
installed macOS ARM64 package also advertises CoreML, whose kernels would change the
analysis; this harness can test it without changing production defaults:

```sh
node bench/lab/profile-separation.ts --provider=coreml --coreml-flags=24 --threads=4 --out=bench/reports/audio-reliability/separation-performance/coreml-24
node bench/lab/profile-separation.ts --provider=coreml --coreml-flags=56 --threads=4 --out=bench/reports/audio-reliability/separation-performance/coreml-56
```

Flags 24 request MLProgram/static shapes; 56 also selects CPU/GPU rather than ANE.
The stock Node binding accepts these legacy flags, not the modern CoreML model-cache
options. See the [pinned provider flag definitions](https://github.com/microsoft/onnxruntime/blob/v1.27.0/include/onnxruntime/core/providers/coreml/coreml_provider_factory.h).
The Node 1.27 session parser does not implement `freeDimensionOverrides`; the MDX23C export
already has fixed shapes (`spec[1,4,1024,1024]`), so no separate static kit export is needed.
`--kit-model` remains an optional override, and the harness rejects unavailable bundled
providers. It does not pass the ignored dimension-override option. Profiling and provider
partitioning must be checked on the target Mac instead of assuming accelerator coverage.
Both throughput and PCM/onset fidelity remain unmeasured on Apple hardware. A provider
being present is not evidence that every operator will run efficiently on that provider.

Model overrides are checksum-recorded and cannot be combined with the production graph cache.
