# LightningStrike handover: drum accuracy next

Updated 2026-09-13 after the preparation performance session. Read `README.md` and
`CLAUDE.md` first. This replaces the old v30 handover; historical arrangement/lighting work
remains in git and `bench/judged/`.

## Session order and user preferences

1. **Done: preparation performance.** First-time preparation overlaps independent work and
   produces byte-identical analyses; see [Preparation performance](#preparation-performance).
2. **Next session: improve drum accuracy further**, using the listening harness and
   the owner's hearing. Do not mix a threshold sweep into an implementation speed comparison.

The show is on September 19 on a **MacBook Pro M1 Pro with 16 GB unified memory**, currently
in service. The owner will test the Mac after it returns. Accuracy matters more than minimum
latency; minutes are acceptable, but the 3–4 minute waits need improvement. Significant
progress is sufficient; perfection is not a release requirement.
The owner heard improvements in nearly every song, especially fewer gaps between hits.
Ask for judgements when sound classification is ambiguous. Use useful 8–20 second context,
not tiny isolated clips. Rim/side-stick hits are allowed as quieter snare accents.

## Current production state

- Analysis **36**, show **34**, context **3**. No changes to lighting composition this round.
- `packages/analysis/src/separation.ts`: CPU default, four threads per session; HTDemucs CPU
  arena off, DrumSep arena on. Fixed 7.8/8 second chunks, 25% overlap, centered tail context.
  Two CPU lanes with at least eight logical CPUs and 12 GiB (`MV_DRUM_CPU_LANES`).
- `onnxSession.ts` / `onnxWorker.ts`: every ONNX session runs in a worker thread.
  `prelude.ts` / `dsp.ts` / `dspWorker.ts`: audio-only analysis steps run in workers, and
  analysis computes them itself if a worker fails. The desktop bundle ships
  `onnx-worker.mjs` and `dsp-worker.mjs` beside `ingest-worker.mjs`
  (`apps/desktop/scripts/bundle.js`); without them everything still runs on the ingest thread.
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

Model revision: `htdemucs-a6eabce3-drumsep-e35619ce-v4`.

| File | SHA-256 |
|---|---|
| `htdemucs.onnx` (168,524,330 bytes) | `a6eabce31c0866a7ad7ac545dc7b12fbe4ccd0c86731e94e99fd5b583da504df` |
| `drumsep.onnx` | `e35619cef17d1aeaf410dae9d9895f3814cccc51b7a0deecbf543fe0131d7002` |

See [model setup and correctness constraints](../bench/lab/SEPARATION.md). Models and
large reports are ignored by git. A fresh clone needs the updated `models/` directory
or the pinned setup script; old HTDemucs exports do not pass the new checksum.

## Preparation performance

First-time preparation now overlaps independent work: ONNX sessions run in worker threads,
CPU separation uses two lanes, DirectML compiles both separation models ahead of their
stages, and audio-only analysis steps run in workers. Every analysis stays byte-identical.
Design, measurements, rejected experiments and commands are in
[SEPARATION-PERFORMANCE.md](../bench/lab/SEPARATION-PERFORMANCE.md).

Habibi (146.946 s) on this PC (Ryzen 5 3600, 16 GB, RTX 3060) from saved audio, warm CPU graph
cache, separation evidence deleted before every run; final A/B against the previous commit:

| Pipeline | Previous | Now | Peak RSS previous / now |
|---|---:|---:|---:|
| CPU (`MV_DRUM_PROVIDER=cpu`) | 125.9-127.5 s | 83.8-86.4 s | 2.81-2.92 / 6.68-6.81 GB |
| DirectML (this PC's app setting) | 47.3-47.5 s | 17.9-18.4 s | 1.75-2.08 / 2.83-2.94 GB |

A final behavior-preserving refactor came after these runs; an interleaved recheck on a busier
machine kept the final bundle within noise of the previous one, with identical analyses.

Constraints that keep shows identical: separation sessions keep four intra-op threads,
input tensors keep `byteOffset` 0 and `session.disable_prepacking` stays unset. Costs: CPU
preparation peaks near 6.8 GB, and a 10 ms main-thread timer standing in for the 60 fps LED
loop fired up to 13-17 ms late at the 99th percentile (6.6-6.9 ms before, 9-11 ms with
DirectML). `MV_DRUM_CPU_LANES=1` restores one CPU lane. Reports:
`bench/reports/audio-reliability/ingest-performance/perf-0913/`.

Remaining leads, none implemented:

- First-time URLs call yt-dlp twice (`probe`, then `downloadAudio`); one call printing JSON
  before download would remove a YouTube extraction. Model verification and the DirectML
  HTDemucs session could also start when a download starts. Untested: both need downloads.
- `analyzeTrack` stages that do not read separated drums (grid, meter, sections, mix drums)
  could run once Beat This! and ADTOF finish, beside separation: at most 0.7 s, and only
  with its operation order unchanged.
- CPU lanes re-hash the same cached graph per lane (about 0.3 s of CPU per song).
- The queue prepares only the current and next rows; preparing further ahead is a product
  decision, not a speed-up of one song.

## Mac requirements and unverified work

Native ARM64 CPU is the supported production route; no Python or NVIDIA GPU at show time.
The pinned ONNX ARM64 binaries declare **macOS 14.0**, stricter than Node 24.11's 13.5;
`tauri.conf.json` now declares 14.0. `check-mac-runtime.ts` verifies Mach-O architecture
and minimum OS metadata. **Nothing has executed on the M1 Pro in this effort.**

Build natively on Apple Silicon with the updated models and the normal Tauri prerequisites.
Keep four intra-op threads per session. Compare `MV_DRUM_CPU_LANES=1` and `2` with
`profile-ingest.ts` (wall time, peak RSS, timer lateness); the default is two lanes on the
M1 Pro. On the 16 GB PC with only 6.8 GB free, one lane took 129 s at a 4.3 GB peak and two
lanes 94 s at 6.7 GB (84 s with more memory free), so close other apps before preparing a
queue. Finder-launched apps ignore shell exports, so set a lane override with
`launchctl setenv MV_DRUM_CPU_LANES 1` before opening the app. Watch the LEDs while a
track prepares during playback; one lane is the fallback if frames hitch. CoreML
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

On 2026-09-13 the owner had the Windows app rebuilt from the uncommitted preparation
performance work and installed over v36 in `%LOCALAPPDATA%/Programs/LightningStrike`;
user `MV_DRUM_PROVIDER=dml` stays configured and the app library was untouched. Installers
are under `apps/desktop/src-tauri/target/release/bundle/`. The local receipt
`bench/reports/audio-reliability/ingest-performance/perf-0913/installation-receipt.json`
records installer and file hashes, the byte-for-byte comparison of the installed server,
runtime and models with the build, and prepared-track checks with the installed runtime
whose analyses equal the references. The NSIS upgrade leaves files from earlier builds in
`server/`; 387 such unreferenced files were moved to the Recycle Bin. The v36 release
records remain in `judgement-correction/`.

After the preparation performance work, 1,402 tests passed (two optional skips) with clean
TypeScript/Svelte checks and `git diff --check`. Release validation also includes full
CPU/DML event comparison and pinned Node runtime replay. Run `npm test`, `npm run check`, and
`git diff --check` before future commits. No cached models, datasets,
audio, optimized graphs, built runtime or installers belong in git.

Obsolete audit/triage/safeguard documents and one-off experiment scripts were moved out of
the maintained tree to local `bench/reports/audio-reliability/cleanup-2026-09-13/`; its
manifest lists them. This is historical source, not directly executable tooling after
relocation. Saved result evidence remains in place. Wiring docs and earlier non-drum
benchmarks were left intact. This file is the single current session handover.
