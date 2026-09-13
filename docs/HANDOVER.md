# LightningStrike handover: performance, then drum accuracy

Updated 2026-09-13. Read `README.md` and `CLAUDE.md` first. This replaces the old v30
handover; historical arrangement/lighting work remains in git and `bench/judged/`.

## Session order and user preferences

1. **Next session: optimize preparation performance**, preserving the current drum gains.
2. **Following session: improve drum accuracy further**, using the listening harness and
   the owner's hearing. Do not mix a threshold sweep into an implementation speed comparison.

The show is on September 19 on a **MacBook Pro M1 Pro**, currently in service. Its memory
capacity has not been confirmed. The owner will test the Mac after it returns. Accuracy
matters more than minimum latency; minutes are acceptable, but the 3–4 minute waits need
improvement. Significant progress is sufficient; perfection is not a release requirement.
The owner heard improvements in nearly every song, especially fewer gaps between hits.
Ask for judgements when sound classification is ambiguous. Use useful 8–20 second context,
not tiny isolated clips. Rim/side-stick hits are allowed as quieter snare accents.

## Current production state

- Analysis **36**, show **34**, context **3**. No changes to lighting composition this round.
- `packages/analysis/src/separation.ts`: CPU default, four threads; HTDemucs CPU arena off,
  DrumSep arena on. Fixed 7.8/8 second chunks, 25% overlap, centered tail context.
- `dsp/separationFft.ts`: host FFT replaces dense Fourier operations in the HTDemucs export;
  packed inverse FFT and bounded denominator cache. Learned weights are unchanged.
- `cpuGraphCache.ts`: checksummed immutable CPU graphs keyed by model, runtime and hardware;
  original-model fallback. Never copy Windows optimized graphs as Mac executable graphs.
- `drumEvidenceCache.ts`: lossless separated evidence, checksums, 2 GiB LRU budget, safe
  interrupted-writer cleanup. Detector updates can reuse separation.
- `separatedDrums.ts`: guarded quiet-snare recovery and cymbal veto after acoustic snapping.
- `kickEvidence.ts`: independent model + full-mix attack + rising separated low-frequency
  evidence; conservative vocal-residue rejection. Kicks retain measured attack timing.
- `drums.ts` / `analyze.ts`: source-frame ownership prevents one model peak making two kicks.

DirectML is explicit on Windows: `MV_DRUM_PROVIDER=dml`. Both stages report their actual
provider and restart the affected stage on CPU on native errors/non-finite outputs.
**Do not remove HTDemucs `extra.ep.dml.disable_graph_fusion='1'`: without it, ORT 1.27
produced severely wrong but finite audio.** Node 1.27 ignores `freeDimensionOverrides`;
the no-op setting was removed in pre-commit cleanup. Actual kit inputs remain fixed-size.
No runtime tuning changed during cleanup; the existing verified installers remain valid.

Model revision: `htdemucs-a6eabce3-drumsep-e35619ce-v4`.

| File | SHA-256 |
|---|---|
| `htdemucs.onnx` (168,524,330 bytes) | `a6eabce31c0866a7ad7ac545dc7b12fbe4ccd0c86731e94e99fd5b583da504df` |
| `drumsep.onnx` | `e35619cef17d1aeaf410dae9d9895f3814cccc51b7a0deecbf543fe0131d7002` |

See [model setup and correctness constraints](../bench/lab/SEPARATION.md). Models and
large reports are ignored by git. A fresh clone needs the updated `models/` directory
or the pinned setup script; old HTDemucs exports do not pass the new checksum.

## Measured baseline for the performance session

Windows 11, Ryzen 5 3600, 16 GB RAM, RTX 3060 12 GB, ORT Node 1.27.0. Same saved Habibi
audio (146.946 s), context and benchmark host Node 24.19, isolated caches, app closed.
These are preparation from saved audio, excluding new downloads/metadata lookups.

| Run | Wall time | Peak process RSS |
|---|---:|---:|
| Installed v35 CPU baseline | 171.373 s | 5.39 GB |
| Final v36 packaged CPU worker, cold | 159.549 s | 3.01 GB |
| Same worker, cached evidence / forced reanalysis | 15.781 s | 1.98 GB |
| Final v36 DirectML, cold | 51.876 s | 1.74 GB (GPU memory separate) |

CPU cold time improved 6.9%, memory 44.2%; forced reanalysis 90.8%; DirectML time 69.7%.
An earlier optimized CPU run took 153.924 s, so observed cold CPU range is 154–160 s.
Do not promise sub-minute CPU preparation or call cached reanalysis a first-import result.
The packaged Node 24.11.0 additionally reproduced identical events in 15.912 s cached.
Final CPU/DML timestamps match exactly (301 kick / 138 snare / 546 hat); one snare level
differs by one percentage point. Cold/warm CPU event streams match exactly.

Reports under `bench/reports/audio-reliability/`:

- `ingest-performance/{installed-baseline,release-v36-cpu,release-v36-dml}/timings.json`
- `judgement-correction/{release-provider-parity,pinned-runtime-check,release-manifest}.json`
- `separation-performance/`: chunk tests, original tensor captures and rejected approaches.

The arena/FFT-only early candidate was slower cold (184.18 s). A 52.50 s DML run overlapped
model export and is excluded; the final 51.876 s run is clean. No new inference should run
concurrently with the application, another benchmark, a build, or tests.

### Next performance experiments

- Start with a stable, isolated whole-track baseline using `bench/lab/profile-ingest.ts`.
  Set `MV_DRUM_PROVIDER=cpu` explicitly for CPU measurements: this Windows user's delivered
  app configuration uses DirectML. `--worker` can test a built worker; use a new `--out`
  directory and require report status `verified`. Source/model changes invalidate a run.
- `profile-separation.ts` measures individual stages, graph cache, provider and thread
  choices. `compare-separated-pcm.ts` and `compare-separated-onsets.ts` check fidelity.
- `profile-ht-cpu-arena.ts` is **prepared but unrun**. Its four arena/pattern/initializer
  configurations depend on the local ignored captures named in `FILES`. Run `--prepare`
  before `--run`; no gains from this experiment have been established.
- `static-drumsep.py` exports bench-only fixed-shape metadata, optionally shape inference.
  It preserves operations/weights but has **not** passed neural parity or timing. Do not
  install it as the production model based only on ONNX validation.
- Node 1.27 does not expose arena shrink/cap controls or RunOptions.extra. Do not silently
  benchmark ignored flags. Keep provider fallback visible; successful execution is not
  numerical or acoustic validation.

See [full measurements and commands](../bench/lab/SEPARATION-PERFORMANCE.md).

## Mac requirements and unverified work

Native ARM64 CPU is the supported production route; no Python or NVIDIA GPU at show time.
The pinned ONNX ARM64 binaries declare **macOS 14.0**, stricter than Node 24.11's 13.5;
`tauri.conf.json` now declares 14.0. `check-mac-runtime.ts` verifies Mach-O architecture
and minimum OS metadata. **Nothing has executed on the M1 Pro in this effort.**

Build natively on Apple Silicon with the updated models and the normal Tauri prerequisites.
Measure CPU four/six/eight threads and RAM pressure before selecting a Mac default. CoreML
is a future experiment, not a shipping speed claim: the harness supports legacy flags 24
(MLProgram/static) and 56 (plus CPU/GPU), and requires the separately exported static kit
model. Verify actual provider placement and cold compilation, then PCM and onset parity.
Stock Node binding does not expose modern CoreML model-cache options. The Windows GPU
timing must never be presented as a Mac estimate.

## Listening data for the later accuracy session

Live harness: `http://127.0.0.1:5197/drums?trackId=tWEaUKCQ8Fg` when its dev server is running.
Cache: `bench/reports/audio-reliability/drum-review-ui/cache`. Six full v36 songs are published:

| Track | ID | Latest reviewed old-analysis notes | Current progress / remaining work |
|---|---|---|---|
| Habibi | `tWEaUKCQ8Fg` | rev4, 20 notes | 8 marked snares + 5 kicks recovered; early 98.999 removed. Five marked snares and wrong 138.163 remain. |
| poster boy | `jOLT6ukrQSg` | rev1, 4 notes | Vocal false kick 48.920 removed; wrong snares 95.003, 113.519, 118.108 unresolved. |
| Desire (Gryffin Remix) | `tN6YYPs3g3c` | rev1, 9 notes | Seven acoustic associations recovered; 76.406 and 195.384 remain. |
| Like a Prayer | `wy7_PFy-ztQ` | rev2, 18 notes | Ten kicks recovered. All eight snare negatives are provisional. |
| Back In Black | `9vWNauaZAgg` | partial excerpt labels | Full-song check retains 6/6 known snares; new additions remain unjudged. |
| bad guy | `ZD6rXLXZOEI` | partial excerpt labels | Full-song check 7/9 before/after latest rule: 32.446 absent; 35.931 appears at 36.000. Excerpt processing had 9/9. |

The owner clicked approximately without snapping. Preserve raw clicks, associate to the
reviewed grid's sixteenth subdivisions, then inspect the nearby acoustic attack. Do not
force true audio attacks to a coarse grid or count rough manual marks as exact-time labels.
Two Like a Prayer clicks choose adjacent grid slots; actual recovered kicks are 33.325 and
101.495 s. Desire has seven acoustic associations but only four within a strict 50 ms of
the coarse reviewed grid. Wrong/early/late notes stay tied to their exact original markers.

`bench/judged/drum-review-evaluation.json` binds Like a Prayer provisional IDs to exact
track/audio/analysis identity. `score-drum-review.ts` reads it; direct callers must pass
`provisionalIdsForReview`. Use `--review-analysis=PATH` for hash-checked grid alignment and
`--audio=PATH` to verify encoded audio identity across different decoded PCM hashes.
Unmarked areas are not negatives and cannot establish precision/full-song recall.

Do not restore notes deliberately removed by later user revisions. Historical
`testreview1` contains these synthetic IDs, which are never training/evaluation evidence:
`api-test`, `04f8c493-6bf6-4e96-8c71-78d3535e0f34`,
`eec8c7de-e3d1-466c-b1cf-91c825fc317a`. Do not discard whole reviews by fixture ID.

Current sources and original reviewed analyses: `judgement-correction/{sources,cache}`.
Each source folder has audio/model/PCM provenance, ADTOF activations, separated 22.05 kHz
PCM and `candidate.analysis.json`. `collect-review-evidence.ts` replays current detectors
against the original reviewed grid. `prepare-drum-evidence.ts` currently prepares sources
with explicit Windows DML; it is not the Mac preparation entry point.

Use `publish-drum-reviews.ts` dry-run before publication, a new backup directory and minimum
analysis version. It archives old marker snapshots without replacing saved reviews. The
UI's Earlier notes / drafts and Load latest analysis preserve independent revision histories.
See [publication workflow](../bench/lab/DRUM-REVIEW-PUBLICATION.md). Do not drive/reload/play
the owner's browser while they are judging. Audio, saved shows, notes and browser drafts
are user data; never reset them as cleanup. Transfer ignored review/cache data separately
when moving this work to the Mac.

Strict MDB totals and rejected approaches are in [drum reliability](../bench/DRUM_RELIABILITY.md).
Six native mixes: 312 TP / 13 FP / 198 FN; 23 oracle stems: 1769 / 239 / 885. The native
extra strict FP is an annotated side-stick approved for quieter product snare lighting;
do not change the dataset taxonomy to hide it. Both corpora informed development and are
not held-out evidence. Future accuracy work should include new tracks and exhaustive,
longer-context review windows. Remaining review-tool leads: unfinished editor export and
strict validation of manually imported scorer JSON; verify current behavior before fixing.

## Delivery, checks and cleanup

The v36 Windows installers are under `apps/desktop/src-tauri/target/release/bundle/`.
`judgement-correction/release-manifest.json` records their hashes and verified worker.
Pre-commit cleanup changed documentation and removed only an ignored native option and
formatting from runtime source; numerical behavior and version constants are unchanged.
After this commit the requested installation target is
`%LOCALAPPDATA%/Programs/LightningStrike`, with user `MV_DRUM_PROVIDER=dml` configured.
Read `judgement-correction/installation-receipt.json` for post-commit install verification;
that local receipt is written by the delivery step, not stored in git.

The final pre-commit run passed 1,385 tests (two optional skips), clean TypeScript/Svelte
checks, and `git diff --check`. Release validation also includes full CPU/DML event
comparison and pinned Node runtime replay. Run `npm test`, `npm run check`, and
`git diff --check` before future commits. No cached models, datasets,
audio, optimized graphs, built runtime or installers belong in git.

Obsolete audit/triage/safeguard documents and one-off experiment scripts were moved out of
the maintained tree to local `bench/reports/audio-reliability/cleanup-2026-09-13/`; its
manifest lists them. This is historical source, not directly executable tooling after
relocation. Saved result evidence remains in place. Wiring docs and earlier non-drum
benchmarks were left intact. This file is the single current session handover.
