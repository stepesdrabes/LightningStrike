# LightningStrike handover: drum accuracy

Updated 2026-09-14 after the drum accuracy session. Read `README.md` and `CLAUDE.md` first.
Historical arrangement/lighting work remains in git and `bench/judged/`.

## Session order and user preferences

1. **Done: preparation performance** (2026-09-13); see
   [Preparation performance](#preparation-performance).
2. **Done: drum accuracy** (2026-09-13 to 14): learned drum fusion and the MDX23C kit separator
   beat the best published cross-dataset results on every public benchmark with a comparable
   published result (MDBDrums++'s only number uses an unstated protocol); see
   [Drum accuracy session](#drum-accuracy-session).
3. **Next:** the owner judges the blind A/B listening session; then the library is re-prepared
   and the Mac tested before the party. The Windows app was rebuilt and reinstalled on 2026-09-14.

The owner asked for SOTA drum analysis on every existing benchmark; their hand-made reviews are
useful but need not be 100% correct. Accuracy matters more than preparation speed.
The show is on September 19 on a **MacBook Pro M1 Pro with 16 GB unified memory**, currently
in service. The owner will test the Mac after it returns. Significant progress is sufficient;
perfection is not a release requirement. Ask for judgements when sound classification is
ambiguous. Use useful 8–20 second context, not tiny isolated clips. Rim/side-stick hits are
allowed as quieter snare accents; claps and snaps are snares.

## Drum accuracy session

Results, protocol and the training-set findings are in
[drum reliability](../bench/DRUM_RELIABILITY.md#learned-fusion-and-published-benchmarks-analysis-v37-september-14);
tooling in [drumeval](../bench/drumeval/README.md). In short, cross-dataset five-class F, fold
mean and pooled (published best in brackets): MDB 0.858 / 0.854 (0.81), ENST 2/3 mix 0.829 /
0.832 (0.80), drums-only MDB 0.913 / 0.911 (0.89) and ENST 0.883 / 0.884 (0.85); three-class
RBMA13 0.747 / 0.753 (0.67), IDMT 0.971 (0.949) and the Groove MIDI test split 0.870 (0.702).
Older in-dataset protocols at 20 ms or on track-level splits still report higher IDMT and ENST
numbers; see that document.

- **Listening session for the owner:** `drum-judge` in `.claude/launch.json` serves
  `http://127.0.0.1:5199`: 28 blind A/B passages (kick, snare, hat) where the v36 rules
  (`lib-base`, 39 songs) and the installed fusion (`lib-v19`) disagree most, including four
  passages of Desire's reviewed snares (61-82 s and 171-202 s). Verdicts append to
  `bench/reports/drumeval/judge/current/answers.jsonl`; read them before retraining.
- **Owner checks:** `judged.ts` 18/19 confirmed snares (v36 17); `reviews.ts` on the saved
  reviews: 1/5 confirmed wrong hits still emitted (v36 4), 22/37 missed-hit clicks hit (v36 23).
  Desire (Gryffin Remix)'s reviewed snares stay missed by every model trained on all corpora.
- **Installed model:** `models/drum-fusion.json` (version
  `v12e-a2md-enst-idmt-mdb-rbma-rwc-star-r300-l15-56e52c9c`, SHA-256
  `5e146d09966c04e695133d7cd61cbdb8074cc274466ab49d8bc39e61055720ad`) is
  `bench/reports/drumeval/fusion/v19-cv-strict/model.json`, five seeds per class; training is
  deterministic (a rerun reproduced every classifier bit for bit). Without it the rules run.
  Songs analysed with another version re-analyse when next prepared (`fusionModel.ts`); a file
  that fails to load leaves them as they are.
- **Label traps:** RBMA13 public snare labels omit claps and STAR Drums mixes hide unlabelled
  clap residue; both made the classifier reject bad guy's snaps (0/9), so neither trains snares
  (STAR trains only hats and cymbals). Always rerun `judged.ts` and `reviews.ts` after retraining.
- **Evidence on disk** (ignored): `bench/reports/drumeval/evidence/` for all corpora including
  `enst23`, `mdbsolo`, `enstsolo`, `mdbpp`, `gmd`, a STAR subset and the library; candidate set
  `v12e`; fusion
  models and night logs under `bench/reports/drumeval/{fusion,night}/`; the research notes
  (`adt-sota.md`, `adt-datasets.md`) were session scratch files and are summarized in
  DRUM_RELIABILITY.md and the drumeval README.
- **Before the party:** install `drumsep-mdx23c.onnx`, ADTOF and `drum-fusion.json` on every
  machine before preparing songs there. A song prepared at analysis 37 without them keeps the
  rule-based drums until it is refreshed; so does a song whose per-source ADTOF passes fail
  during preparation, for example under memory pressure.
- **Not done:** the library was not re-prepared (it re-prepares on demand at analysis 37,
  about a fifth of the song's length on DirectML, minutes on CPU); nothing ran on the Mac.

## Current production state

- Analysis **37**, show **34**, context **3**. No changes to lighting composition.
- `separation.ts`: HTDemucs, then MDX23C (`drumsep-mdx23c.onnx`) returning kick, snare, hi-hat
  and cymbal (ride/crash); the tom stem is dropped. CPU default, four threads per session, both
  CPU arenas off. Chunks: 343,980 samples for HTDemucs, 1,024 STFT frames (11.9 s) for MDX23C,
  25% overlap, centered tail context. `dsp/mdxFft.ts` mirrors the model's torch STFT; the kit
  input is not normalized. `runKit` runs the kit stage alone. Two CPU lanes with at least eight
  logical CPUs and 12 GiB (`MV_DRUM_CPU_LANES`).
- `ingest.ts`: resamples four sources, runs ADTOF on the drum stem and each source
  (`transcribeKit`), computes four source onset curves in workers, and passes everything to
  `analyzeTrack` with the installed fusion model.
- `drumFusion.ts`: candidates from the transcriptions and source attacks (snare proposals reach
  fainter peaks, for ghost notes), 85 features, flattened LightGBM trees evaluated exactly as
  trained; hats merge with cymbal hits; kick and snare levels floor at their source loudness
  relative to the track's loud hits. Toms are classified only for benchmark probes.
  `analysis.drumFusion` records the model version.
- `drumEvidenceCache.ts` format 3: four sources plus five activation sets, keyed by audio,
  separator and ADTOF model; 2 GiB LRU; sources alone only when no ADTOF is installed.
- `separatedDrums.ts` / `kickEvidence.ts`: the rule-based fallback, reading hats and cymbals
  summed as its cymbal source.
- `onnxSession.ts` / `onnxWorker.ts`: every ONNX session runs in a worker thread.
  `prelude.ts` / `dsp.ts` / `dspWorker.ts`: audio-only analysis steps run in workers, and
  analysis computes them itself if a worker fails. The desktop bundle ships
  `onnx-worker.mjs` and `dsp-worker.mjs` beside `ingest-worker.mjs`
  (`apps/desktop/scripts/bundle.js`); without them everything still runs on the ingest thread.
- `dsp/separationFft.ts`: host FFT replaces dense Fourier operations in the HTDemucs export;
  packed inverse FFT and bounded denominator cache. Learned weights are unchanged.
- `cpuGraphCache.ts`: checksummed immutable CPU graphs keyed by model, runtime and hardware;
  original-model fallback. Never copy Windows optimized graphs as Mac executable graphs.

DirectML is explicit on Windows: `MV_DRUM_PROVIDER=dml`. Both stages report their actual
provider and restart the affected stage on CPU on native errors/non-finite outputs.
**Do not remove HTDemucs `extra.ep.dml.disable_graph_fusion='1'`: without it, ORT 1.27
produced severely wrong but finite audio.** MDX23C runs correctly with DirectML fusion; CPU and
DirectML kit outputs agree at 74-120 dB and a CPU preparation produced the same hits as the
DirectML-evidence replay.

Model revision: `htdemucs-a6eabce3-mdx23c-e2ec140f-v1`.

| File | SHA-256 |
|---|---|
| `htdemucs.onnx` (168,524,330 bytes) | `a6eabce31c0866a7ad7ac545dc7b12fbe4ccd0c86731e94e99fd5b583da504df` |
| `drumsep-mdx23c.onnx` (437,697,734 bytes, non-commercial weights) | `e2ec140f5487c79b0be512d705746e2ac017bf3ab06d899d561ca963d91755c2` |

See [model setup and correctness constraints](../bench/lab/SEPARATION.md). Models and
large reports are ignored by git. A fresh clone needs the updated `models/` directory
(copy it; the setup script re-exports MDX23C only with torch 2.11 and onnx 1.22). Desktop builds
bundle all of `models/`, so never distribute one. The unused `drumsep.onnx` was retired.

## Preparation performance

First-time preparation overlaps independent work: ONNX sessions run in worker threads,
CPU separation uses two lanes, DirectML compiles both separation models ahead of their
stages, and audio-only analysis steps run in workers. Design, measurements, rejected
experiments and commands are in [SEPARATION-PERFORMANCE.md](../bench/lab/SEPARATION-PERFORMANCE.md).
**The figures below were measured with the earlier DrumSep kit model.** With MDX23C and five
more ADTOF passes, a CPU preparation of Habibi took 202 s with a 6.3 GB peak (its kit stage
130 s, 0.9x real time; 1.2-1.4x on a loaded machine); DirectML runs the kit stage at about 0.1x.
Re-measure both before the party.

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
(MLProgram/static) and 56 (plus CPU/GPU); the MDX23C export already has fixed shapes. Verify
actual provider placement and cold compilation, then PCM and onset parity.
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
PCM and `candidate.analysis.json`; those sources came from DrumSep and have no hi-hat file.
`collect-review-evidence.ts` replays the rule-based detectors against the original reviewed
grid; `bench/drumeval/reviews.ts` scores a drumeval library run, including the fusion, against
the saved reviews. `prepare-drum-evidence.ts` prepares sources with explicit Windows DML; it is
not the Mac preparation entry point.

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

On 2026-09-14 the owner had the Windows app rebuilt from the uncommitted drum accuracy work
and installed over the previous build in `%LOCALAPPDATA%/Programs/LightningStrike`; user
`MV_DRUM_PROVIDER=dml` stays configured and the app library was untouched. Installers are
under `apps/desktop/src-tauri/target/release/bundle/`. The local receipt
`bench/reports/drumeval/night/installation-receipt.json` records installer and file hashes,
the byte-for-byte comparison of the installed server, runtime and models with the build, and
Habibi prepared with the installed runtime: on CPU its analysis equals the verified workspace
preparation, on DirectML it finds the same kick, snare and hat hits. NSIS upgrades leave files
from earlier builds; 133 such unreferenced files, including the retired `drumsep.onnx`, were
moved out. The 2026-09-13 receipt is in `ingest-performance/perf-0913/` and the v36 release
records remain in `judgement-correction/`.

After the drum accuracy work, 1,425 tests passed (two optional skips) with clean
TypeScript/Svelte checks and `git diff --check`. Release validation also includes full
CPU/DML event comparison and pinned Node runtime replay. Run `npm test`, `npm run check`, and
`git diff --check` before future commits. No cached models, datasets,
audio, optimized graphs, built runtime or installers belong in git.

Obsolete audit/triage/safeguard documents and one-off experiment scripts were moved out of
the maintained tree to local `bench/reports/audio-reliability/cleanup-2026-09-13/` and, for the
DrumSep-only tools, `cleanup-2026-09-14/`; their manifests list them. This is historical
source, not directly executable tooling after relocation. Saved result evidence remains in
place. Wiring docs and earlier non-drum benchmarks were left intact. This file is the single
current session handover.

The 2026-09-14 drum cleanup moved superseded drum runs, candidate sets and fusion models, the
unread `kick44`, `snare44`, `cymbal44` and `mdx-*44` evidence files, DrumSep exports,
unreferenced separation experiments, derived caches of performance reports and the download
archives whose extracted copies the corpora use into `bench/reports/drum-cleanup-2026-09-14/`
for deletion; `bench/reports/drumeval/night/cleanup-2026-09-14-removed.txt` lists every path.
It kept candidate set `v12e`, both v19 fusion models, the ADTOF baseline runs (`base-*`),
`export-v12e` and the runs the listening session and v19 results use. Re-running the LOCO and
Groove MIDI evaluations on the remaining evidence reproduced all 507 track results.
