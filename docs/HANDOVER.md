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
- Where it runs (`analysisProvider`: `auto`, `gpu`, `cpu`; `striker2Provider.ts`): Core ML
  (`coreMlFlags` 56, MLProgram on the CPU and GPU) on Apple silicon, DirectML on Windows only under
  `gpu` (the RTX 3060 belongs to MAXX 2.0 until the owner says otherwise), the CPU last. Each
  provider must first pass Rule P on the manifest's golden chunks (`striker2Parity.ts`; striker-2's
  research/2026-10-29-app-speed.md section 9); verdicts live in `cache/striker2-providers.json`,
  keyed by graph, onnxruntime-node, provider options, threads and machine. `striker2Pool.ts` keeps
  one session for the run, and the ingest worker now lives between songs so it can.
- The front end is computed chunk by chunk while the previous chunk runs; the features are the
  same bits as one pass (`Striker2FrontEnd`).

Install: copy `striker2.onnx` and `striker2.json` from striker-2's `python -m striker.export`
into `models/`. They stay uncommitted: personal-use weights (`models/striker2.NOTICE`).
On 2026-10-29 the shipped `Striker-2.0-1029 (1254cace)` (XXL, 523 MB) prepared Raveform
`0004.0EWbonj7f18` (236 s) in 16.0 s and Kernkraft 400 (207 s) in 13.7 s on the Ryzen 5 3600 PC
under load, its stage 14.8 and 13.3 s, at a 2.4 GB peak working set. On the M1 Pro, on the CPU,
it prepared Take Me (To The Moon) (159 s) in 14.3 s from a checkout (Node 26) and Krystaly
(181 s) in 26.5 s in the installed app (Node 24.11), its stage 9.0 and 10.1 s; the rest is
mostly the YouTube fetch.

Bench: `bench/hearing.ts` gives harnesses Striker 2.0's hearing of a file, cached under
`bench/corpus/.striker2/`; `bench/drumeval/evaluate.ts` scores it on labelled corpora
([drumeval](../bench/drumeval/README.md)); `bench/beatscore.ts` scores its beats on GTZAN;
`bench/reanalyse.ts` re-analyses the library in a batch; `bench/lab/striker2-dump.ts` serves
striker-2's parity tool.

The owner's verdict in the room, 2026-10-29: the lights look almost exactly as before, quality
did not go down, and preparation is far faster than with the retired pipeline. Still open:
striker-2's integration checks (the benchmarks through this pipeline, the downbeat rule for the
lights, the library diff against analysis 39, the owner's saved reviews).

## Mac

The desktop bundle carries the pinned Node 24.11.0 runtime for the target, onnxruntime-node's
binaries for that platform and architecture only (`runtimeFilter` in
`apps/desktop/scripts/bundle-support.js`), and `runtime/models`: Striker 2.0's manifests, the
graphs and golden chunks they name, their notices and Discogs-EffNet (`bundledModels`). No native addon of ours
is built any more. The pinned ONNX ARM64 binaries declare **macOS 14.0**, stricter than Node
24.11's 13.5; `tauri.conf.json` declares 14.0, and `bench/lab/check-mac-runtime.ts` verifies the
Mach-O architecture and minimum OS. Build natively on Apple Silicon with Xcode's command-line
tools and the Tauri prerequisites. To measure Striker 2.0's execution providers there, copy a
model folder (static `striker2.onnx`, `striker2.json` and its golden files; optionally the older
dynamic graph) to the Mac and, in the checkout after `npm ci`, with nothing else running and on
mains power:

```sh
node bench/lab/striker2-providers.ts --model=<folder> --song=<audio file> [--dynamic=<old graph>]
```

It runs the CPU at the default threads and at the performance-core count, Core ML 56, 24 and 25,
each in its own process, and prints a table: session, first and median chunk, front end, network,
decoders and the app's whole song, peak memory, Core ML's partition count, Rule P and the song's
events against the CPU. The JSON report lands in `bench/reports/striker2-providers/`.
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
