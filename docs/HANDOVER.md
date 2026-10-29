# LightningStrike handover

Updated 2026-10-29. Read `README.md` and `CLAUDE.md` first. The drum accuracy work of September
(Striker 1.x, the separators, ADTOF, Beat This!, the Metal engine) is retired; its code and notes
are in git history before branch `feat/striker2-only`, and its benchmark pages in
`bench/drumeval/reports/`.

## Owner preferences

Quality first: the owner asked for the best model quality, with speed second. The room's
machine is a **MacBook Pro M1 Pro with 16 GB unified memory**, and the app must also run there
at great speed. Ask for judgements when sound classification is ambiguous, with 8 to 20 seconds
of context rather than tiny clips. Rim and side-stick hits are allowed as quieter snare accents;
claps and snaps are snares.

## Analysis 40: Striker 2.0 only

Branch `feat/striker2-only`, from `feat/striker2-m7` (striker-2's milestone M7; its
`docs/integration.md` is the plan). Every song is prepared by one network:

- `ingest.ts` reads the model the settings choose (`analysisModel` in `settings.json`:
  `striker2` or `striker2-small`), verifies its manifest and the graph's SHA-256
  (`strikerModel.ts`, `striker2.ts`), decodes the song at 22.05 kHz for the prelude and at
  44.1 kHz for the model, and runs Striker 2.0 beside the genre model: features
  (`striker2Frontend.ts`, branch A being ADTOF's spectrogram bit for bit), chunks with borders
  through ONNX Runtime on the CPU, then the decoders (`striker2Decode.ts`) and the DBN for beats
  and downbeats (`striker2Dbn.ts`).
- `analyzeTrack` takes the DBN's beats and downbeats for the grid (eight or fewer beats leave the
  grid to the onset tracker, noted in `.preparation.json`), kick, snare and hat with cymbals
  merged within 30 ms, unsnapped and deduplicated within 30 ms, and writes `bass` and `activity`
  last. `striker` is the manifest's name, second in the JSON for the library's 2 KB read.
  `publishedLevel` checks a catalogue tempo octave against Striker 2.0's snares.
- No fallback: a missing, unverified or failing model fails the preparation with its reason,
  logged on the queue row and written to `<id>.preparation.json`. Analyses already made are kept
  while no model can run; an analysis is reused only when its `striker` names the chosen model.
- The library dialog chooses the model. Striker 2.0 Small (`striker2-small.json` and its graph)
  does not exist yet; the dialog shows it as not installed and refuses it. Switching puts queued
  songs the other model made back in line.
- The AI authoring tool's tempo re-read (`reanalyse`) keeps the drums the stored analysis heard
  and re-tracks the grid with the onset tracker at the asked tempo.
- `Striker2.create` takes a list of ONNX Runtime execution providers, `['cpu']` by default; the
  per-platform list (CoreML on macOS, DirectML on Windows) behind a parity self-check is the next
  step, being designed in striker-2.

Install: copy `striker2.onnx` and `striker2.json` from striker-2's `python -m striker.export`
into `models/`. They stay uncommitted: personal-use weights (`models/striker2.NOTICE`).
On 2026-10-29 the shipped `Striker-2.0-1029 (1254cace)` (XXL, 523 MB) prepared Raveform
`0004.0EWbonj7f18` (236 s) in 16.0 s and Kernkraft 400 (207 s) in 13.7 s on the Ryzen 5 3600 PC
under load, its stage 14.8 and 13.3 s, at a 2.4 GB peak working set.

Bench: `bench/hearing.ts` gives harnesses Striker 2.0's hearing of a file, cached under
`bench/corpus/.striker2/`; `bench/drumeval/evaluate.ts` scores it on labelled corpora
([drumeval](../bench/drumeval/README.md)); `bench/beatscore.ts` scores its beats on GTZAN;
`bench/reanalyse.ts` re-analyses the library in a batch; `bench/lab/striker2-dump.ts` serves
striker-2's parity tool.

Open before a merge: striker-2's integration checks (the benchmarks through this pipeline, the
downbeat rule for the lights, the library diff against analysis 39, the owner's saved reviews),
the M1 Pro, and the owner's listening A/B in the room.

## Mac

The desktop bundle carries the pinned Node 24.11.0 runtime for the target, onnxruntime-node's
binaries for that platform and architecture only (`runtimeFilter` in
`apps/desktop/scripts/bundle-support.js`), and `runtime/models`: Striker 2.0's manifests and the
graphs they name, their notices and Discogs-EffNet (`bundledModels`). No native addon of ours
is built any more. The pinned ONNX ARM64 binaries declare **macOS 14.0**, stricter than Node
24.11's 13.5; `tauri.conf.json` declares 14.0, and `bench/lab/check-mac-runtime.ts` verifies the
Mach-O architecture and minimum OS. Build natively on Apple Silicon with Xcode's command-line
tools and the Tauri prerequisites. Striker 2.0 has not been measured on the M1 Pro yet.
Finder-launched apps ignore shell exports, so set overrides with `launchctl setenv` before
opening the app.

## Listening data for the later accuracy session

These reviews were made on analyses of the retired pipelines (v36); they remain the owner's
labels for scoring Striker 2.0. Live harness: `http://127.0.0.1:5197/drums?trackId=tWEaUKCQ8Fg`
when its dev server is running. Cache: `bench/reports/audio-reliability/drum-review-ui/cache`.
Six full v36 songs are published:

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

Current sources and original reviewed analyses: `judgement-correction/{sources,cache}`, from
the retired separation pipeline. `bench/drumeval/reviews.ts` scores a drumeval library run
against the saved reviews.

Use `publish-drum-reviews.ts` dry-run before publication, a new backup directory and minimum
analysis version. It archives old marker snapshots without replacing saved reviews. The
UI's Earlier notes / drafts and Load latest analysis preserve independent revision histories.
See [publication workflow](../bench/lab/DRUM-REVIEW-PUBLICATION.md). Do not drive/reload/play
the owner's browser while they are judging. Audio, saved shows, notes and browser drafts
are user data; never reset them as cleanup. Transfer ignored review/cache data separately
when moving this work to the Mac.

An annotated MDB side-stick is approved for quieter product snare lighting; do not change the
dataset taxonomy to hide it. Future accuracy work should include new tracks and exhaustive,
longer-context review windows. Remaining review-tool leads: unfinished editor export and
strict validation of manually imported scorer JSON; verify current behavior before fixing.

## Checks

Run `npm test`, `npm run check` and `git diff --check` before every commit. No models, datasets,
audio, built runtime or installers belong in git. Audio, saved shows, notes and browser drafts
are user data; never reset them as cleanup.
