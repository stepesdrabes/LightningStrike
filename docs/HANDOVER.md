# LightningStrike handover: drum accuracy

Updated 2026-09-14 after the drum accuracy session. Read `README.md` and `CLAUDE.md` first.
Historical arrangement/lighting work remains in git and `bench/judged/`.

## Session order and user preferences

1. **Done: preparation performance** (2026-09-13); see
   [Preparation performance](#preparation-performance).
2. **Done: drum accuracy** (2026-09-13 to 14): Striker 1.0, the learned drum hit classifier, and
   the MDX23C kit separator beat the best published cross-dataset results on every public
   benchmark with a comparable published result (MDBDrums++'s only number uses an unstated
   protocol); see [Drum accuracy session](#drum-accuracy-session).
3. **Done: Striker 1.1** (2026-09-15 to 16): the electronic music misses, diagnosed and
   addressed; see [Striker 1.1](#striker-11).
4. **Next:** the library is re-prepared and the Mac tested before the party. The Windows app
   was rebuilt and reinstalled on 2026-09-14; 1.1 has not been installed on it.

The owner asked for SOTA drum analysis on every existing benchmark; their hand-made reviews are
useful but need not be 100% correct. Accuracy matters more than preparation speed.
The show is on September 19 on a **MacBook Pro M1 Pro with 16 GB unified memory**, currently
in service. The owner will test the Mac after it returns. Significant progress is sufficient;
perfection is not a release requirement. Ask for judgements when sound classification is
ambiguous. Use useful 8–20 second context, not tiny isolated clips. Rim/side-stick hits are
allowed as quieter snare accents; claps and snaps are snares.

## Striker 1.1

Everything measured is in [drum reliability](../bench/DRUM_RELIABILITY.md#why-electronic-music-fails-september-16);
the tooling is in [drumeval](../bench/drumeval/README.md) and [annotate](../bench/annotate/README.md).

**The problem.** Striker 1.0 leads every published benchmark and finds about half the kicks in the
room's own music. The cause is not thresholds and not candidate generation: the kit separator was
trained on acoustic kits and does not put a driven electronic kick in the kick source, which is
what Striker's most important kick feature asks about. On a real hardstyle record 43% of the energy
at a kick lands in the kick source and 32% lands in the snare source, so the classifier calls it a
snare, confidently.

**The fix, in two parts.** First, what the classifier is told: a synthetic corpus whose kicks span
that whole range, so it cannot rely on the kick source; sixteen features measuring the attack on
the mixture instead of the sources; and a per-class duplicate gap, because the benchmark's 50 ms
matching window was being used as a duplicate radius and 8.9% of snare reference pairs sit closer
than that.

Second, whether it is told anything at all. On hardcore and hard techno the transcriber's kick
activation is flat zero, not merely weak, and every proposal stream read either it or the
separator, so no candidate reached the classifier for 92% of the kicks on the worst track. The
mixture's own onset function, which the beat tracker already computes, now proposes for every class
as a fifth stream (`fromOdf`). It raises candidate recall on every corpus in the harness, most of
all for toms and cymbals, which have no separated source at all. A hit rescued that way also needs
a level the lights can use: the loudness fallback read the separated source, which is silent
exactly there, so a class whose every measure reads zero now falls back to the mixture bands, and
no accepted hit reaches the player at level 0, which the player treats as "no level recorded" and
replaces with a fixed amplitude. It is a fallback and not a fifth opinion, because a mixture band
holds whatever else is playing in it: levels that were already non-zero are untouched.

**New corpora and tools.** `synth` (140 rendered electronic tracks, `bench/drumeval/synth/`),
`fsl30` and `drumloop101` (electronic benchmarks nobody here made), `grid` (kicks read off the beat
grid of real four-on-the-floor library tracks), `owner` (hand annotations). `ceiling.ts` bounds what
any selector can reach; `inspect.ts` says whether a miss was never proposed or was rejected;
`fourfloor.ts` measures the library with no labels at all.

**What is installed, and what it costs.** `models/striker.json` is `Striker 1.1 (bb74c4e6)`,
candidate revision 5, analysis 39, thresholds kick 0.375 / snare 0.35 / hat 0.45 / cymbal 0.275 /
tom 0.175, from `bench/reports/drumeval/striker/v29-cv-strict` and reproducible byte for byte from
the recipe in [drumeval](../bench/drumeval/README.md). On the published cross-dataset benchmarks, measured on Striker 1.0's own protocol, it
gives up **0.007** of three-class sum F: MDB 0.860 to 0.855, ENST 0.809 to 0.798, ENST 2/3 0.841 to
0.832, RBMA13 0.753 to 0.744, IDMT unchanged at 0.971, MDB drums 0.920 to 0.914, ENST drums 0.893
to 0.885, MDBDrums++ 0.862 to 0.852. What it buys: FSL-30 0.798 to 0.806, drumloop101 0.859 to
0.870, and on the owner's own confirmed labels **24 of 37** reviewed missed-hit clicks answered
against 22 for 1.0, with 18 of 19 hits kept, no confirmed non-hit emitted and one of five wrong
markers still emitted, all three unchanged from 1.0.

The library's kick coverage of the beat grid reads 53% for 1.0 and 56% for 1.1, but **a run with no
model at all on the same analyser also reads 56%**, so those three points belong to the fifth
proposal stream feeding the rule-based path and not to the classifier. Do not quote that metric as
evidence for the model. What the classifier does on the library is filter: same analyser, model
against none, kick 30,009 to 29,304, snare 24,236 to 21,087, hat 69,296 to 60,311, and on the
owner's labels the fallback finds more (19 of 19, 26 of 37) and is wrong more (3 of 5).

**Always pass `--model` to `evaluate.ts`.** Without it the run silently uses the rule-based
fallback; the giveaway is a missing `classes` key in each track record, and `summary.json` now
records the model path and version so this cannot go unnoticed again.

To go back to Striker 1.0, both the model and the analyser have to move together:

```sh
git checkout packages/analysis/src/striker.ts packages/core/src/contracts/analysis.ts
cp bench/reports/drumeval/striker/v19-cv-strict/model.json models/striker.json
```

**The cause of the snare loss was found and half of it fixed.** The synthetic corpus's residue
marking had two independent four-fold multiplications: `backing.ts` flattened all four classes'
proposals into one set of times, and `render.py` then marked every class at every one of them. An
optional reference covered 63% of a synthetic track for every class, so that corpus could not
penalise a false positive and taught the snare to distrust its own separated source. Residue is now
recorded per class: coverage falls to 13% for kicks and 26% for snares, and cross-dataset acoustic
snare recovers (MDB 0.792 to 0.808, ENST drums 0.848 to 0.855, held-out 0.861 to 0.867). The
renderer is deterministic, so re-rendering gave byte-identical audio and only the candidate export
had to be redone: `node bench/drumeval/synth/residue.ts` then re-render and re-export `synth`.

**Most of what looked like a trade was the operating point.** Comparing detections against ENST's
references one by one, 1.1 lost 415 and gained 33, and the 415 are a region of confidence rather
than a kind of drum: median separated source -25.7 dB against -12.4, activation 0.197 against 0.681.
Scoring the same model at a lower snare threshold recovers them exactly. The cause is that
`best_threshold` let corpora with incomplete annotations vote: where `a2md`, `rwc` or `star` miss a
real hit, detecting it reads as a false positive, so the threshold rises to hide it and the properly
annotated corpora pay in recall. `--threshold-corpora` restricts the vote, and the shipped model
applies it to the snare, where aligned MIDI's missing soft strokes actually are (a2md carries 3.4%
of its snares well below that track's loud ones, rwc 6.4%, against ENST's 31%). Applying it to every
class helps the snare and costs the kick and hi-hat, so it is applied to one.

The models either side are kept: `v23-cv-strict` (before the label fix), `v24-cv-strict` (synthetic
snare dropped entirely), `v25-cv-strict` and `v26-cv-strict` (the two threshold objectives).

**What is blocked on the owner.** The annotation tool at `bench/annotate` is rebuilt and the whole
path from a confirmed page to a scored corpus is proven, but almost nothing is annotated. Every
benchmark here is acoustic drums or synthetic; the owner's clips are the only measurement that
speaks for the room.

**Care.** `CANDIDATE_REVISION` is 5, so a 1.0 model is refused by this tree and vice versa; the
1.0 model is kept byte-identical at `bench/reports/drumeval/striker/v19-cv-strict/model.json`.
The analyser falls back to the rule-based path rather than failing when the installed model does
not match, which is quiet, so never leave the tree with the two out of step. Score `synth` and
`owner` with the `light` metric: under `strict` the `unreviewed` markers that stand for backing
residue and unconfirmed pages would become hits a detector must find. Those markers are also far
too numerous, covering about 69% of a synthetic track, so that corpus barely penalises a false
positive; see the audit section of the reliability document before trusting any number from it.

**Clean `target/release/server` before a desktop build.** Tauri copies the `../../web/build`
resource into `apps/desktop/src-tauri/target/release/server` without removing what is already
there, so each build's route chunks are left behind. A build made on 2026-09-16 shipped a September
14 chunk carrying the **previous `ANALYSIS_VERSION`** beside the current one. Nothing reachable
referenced it, because SvelteKit addresses chunks by content hash and no manifest named it, but a
superseded version constant inside a shipped bundle is not something to leave to luck. Rebuilding
after `rm -rf apps/desktop/src-tauri/target/release/server` removed it and took the NSIS installer
from 687 MB to **655 MB** and the MSI from 762 MB to **727 MB**.

Judge staleness by content, not by modification time: most of that directory is the 368 MB bundled
`node_modules`, whose files keep their cache timestamps and look old while being exactly right. The
sibling `models` resource is the same story.

## Drum accuracy session

Results, protocol and the training-set findings are in
[drum reliability](../bench/DRUM_RELIABILITY.md#striker-10-and-published-benchmarks-analysis-v38-september-14);
tooling in [drumeval](../bench/drumeval/README.md). In short, cross-dataset five-class F, fold
mean and pooled (published best in brackets): MDB 0.858 / 0.854 (0.81), ENST 2/3 mix 0.829 /
0.832 (0.80), drums-only MDB 0.913 / 0.911 (0.89) and ENST 0.883 / 0.884 (0.85); three-class
RBMA13 0.747 / 0.753 (0.67), IDMT 0.971 (0.949) and the Groove MIDI test split 0.870 (0.702).
Older in-dataset protocols at 20 ms or on track-level splits still report higher IDMT and ENST
numbers; see that document.

- **Owner's verdict:** listening in the app itself, the owner preferred Striker 1.0 to the v36
  rules, so the unanswered blind A/B session and its `judge/` tooling were removed on
  2026-09-14. The `lib-base` (v36 rules) and `lib-v19` (Striker 1.0) runs stay for library
  diffs with `diff.ts`.
- **Owner checks:** `judged.ts` 18/19 confirmed snares (v36 17); `reviews.ts` on the saved
  reviews: 1/5 confirmed wrong hits still emitted (v36 4), 22/37 missed-hit clicks hit (v36 23).
  Desire (Gryffin Remix)'s reviewed snares stay missed by every model trained on all corpora.
- **Installed model:** Striker 1.0, `models/striker.json` (version `Striker 1.0 (56e52c9c)`,
  recipe `v12e-a2md-enst-idmt-mdb-rbma-rwc-star-r300-l15`, SHA-256
  `25c0ba3348a3b2045f40d0956a110dea974a3f3026c278bd38fc32ebb9197103`), is
  `bench/reports/drumeval/striker/v19-cv-strict/model.json`, five seeds per class; training is
  deterministic (a rerun reproduced every classifier bit for bit). Without it the rules run.
  Songs analysed with another version re-analyse when next prepared (`strikerModel.ts`); a file
  that fails to load leaves them as they are. `train-striker.py --name` names each release.
- **Label traps:** RBMA13 public snare labels omit claps and STAR Drums mixes hide unlabelled
  clap residue; both made the classifier reject bad guy's snaps (0/9), so neither trains snares
  (STAR trains only hats and cymbals). Always rerun `judged.ts` and `reviews.ts` after retraining.
- **Evidence on disk** (ignored): `bench/reports/drumeval/evidence/` for all corpora including
  `enst23`, `mdbsolo`, `enstsolo`, `mdbpp`, `gmd`, a STAR subset and the library; candidate set
  `v12e`; Striker models and night logs under `bench/reports/drumeval/{striker,night}/`; the
  research notes (`adt-sota.md`, `adt-datasets.md`) were session scratch files and are
  summarized in DRUM_RELIABILITY.md and the drumeval README.
- **Before the party:** install `drumsep-mdx23c.onnx` and ADTOF on every machine before
  preparing songs there. `striker.json` is committed since 2026-09-18, so a checkout carries it.
  A song prepared at analysis 38 without them keeps the rule-based drums until it is refreshed;
  so does a song whose per-source ADTOF passes fail during preparation, for example under
  memory pressure.
- **Not done:** the library was not re-prepared (it re-prepares on demand at analysis 38,
  about a fifth of the song's length on DirectML, minutes on CPU); nothing ran on the Mac.

## Current production state

- Analysis **38**, show **34**, context **3**. No changes to lighting composition.
- `separation.ts`: HTDemucs, then MDX23C (`drumsep-mdx23c.onnx`) returning kick, snare, hi-hat
  and cymbal (ride/crash); the tom stem is dropped. CPU default, four threads per session, both
  CPU arenas off. Chunks: 343,980 samples for HTDemucs, 1,024 STFT frames (11.9 s) for MDX23C,
  25% overlap, centered tail context. `dsp/mdxFft.ts` mirrors the model's torch STFT; the kit
  input is not normalized. `runKit` runs the kit stage alone. Two CPU lanes with at least eight
  logical CPUs and 12 GiB (`MV_DRUM_CPU_LANES`).
- `ingest.ts`: resamples four sources, runs ADTOF on the drum stem and each source
  (`transcribeKit`), computes four source onset curves in workers, and passes everything to
  `analyzeTrack` with the installed Striker model.
- `striker.ts`: Striker's candidates from the transcriptions and source attacks (snare proposals
  reach fainter peaks, for ghost notes), 85 features, flattened LightGBM trees evaluated exactly
  as trained; hats merge with cymbal hits; kick and snare levels floor at their source loudness
  relative to the track's loud hits. Toms are classified only for benchmark probes.
  `analysis.striker` records the model version.
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
grid; `bench/drumeval/reviews.ts` scores a drumeval library run, including Striker, against
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

On 2026-09-14 the owner had the Windows app rebuilt twice, the second time after the Striker
rename, and installed over the previous build in `%LOCALAPPDATA%/Programs/LightningStrike`;
user `MV_DRUM_PROVIDER=dml` stays configured and the app library was untouched. Installers are
under `apps/desktop/src-tauri/target/release/bundle/`. The local receipt
`bench/reports/drumeval/night/installation-receipt.json` records installer and file hashes,
the byte-for-byte comparison of the installed server, runtime and models with the build, and
Habibi prepared with the installed runtime: its DirectML analysis equals the workspace
preparation byte for byte, and the first install's CPU analysis equalled the verified
workspace run. NSIS upgrades leave files from earlier builds; 133 and then 127 such
unreferenced files, including the retired `drumsep.onnx` and `drum-fusion.json`, were moved
out. The 2026-09-13 receipt is in `ingest-performance/perf-0913/` and the v36 release records
remain in `judgement-correction/`.

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

The 2026-09-14 drum cleanup moved superseded drum runs, candidate sets and models, the unread
`kick44`, `snare44`, `cymbal44` and `mdx-*44` evidence files, DrumSep exports, unreferenced
separation experiments, derived caches of performance reports and the download archives whose
extracted copies the corpora use into `bench/reports/drum-cleanup-2026-09-14/` for deletion;
`bench/reports/drumeval/night/cleanup-2026-09-14-removed.txt` lists every path. It kept
candidate set `v12e`, both Striker 1.0 training outputs, the ADTOF baseline runs (`base-*`),
`export-v12e` and the runs the library diffs and v19 results use. Re-running the LOCO and
Groove MIDI evaluations on the remaining evidence reproduced all 507 track results.
