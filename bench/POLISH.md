# Lighting and drum review tools

These harnesses read cached tracks and write diagnostic artifacts. They do not replace saved
analyses, shows or user settings. Cache selection defaults to the desktop cache;
`MV_CACHE_DIR` selects another library.

- `node bench/compositionprobe.ts --snapshot=bench/reports/before.json` captures composition.
  Use `--compare=FILE --render=8 --ids=ID,ID` to compare rendered shows with that snapshot.
- `node bench/eveningcheck.ts evenings/FILE.ts` loads an evening exactly as the app does and
  reports loader findings and gate admission, then plans the night with the cached library so
  segment and pause lengths can be read off. Without a flag it renders each narration, moment,
  pause and hold, printing mean and peak delivered bytes, lit pixels, pixels stuck in the dither
  codes and Bounce Lamp duty. `--events` instead lists every event the moment's timing table
  scores with the audio's level and the room's largest pixel move in the same window, which finds
  a gesture that exists on only one side. `--moment NAME --step SECONDS` narrows the output.
- `node bench/drumprobe.ts ID ID --out bench/reports/drums.json` compares model evidence and
  pattern completion on the same inference. Its counts are predictions, not labelled accuracy.
- `node bench/effectpolish.ts --save bench/reports/effects-before.json` captures isolated effect
  output. Use `--compare FILE --html bench/reports/effects.html` for visual comparison.
- `node bench/quietprobe.ts --limit 8 --effects chorusBloom,ambientDrift` measures responsiveness
  in real quiet passages. Compare the whole candidate pool on the same corpus before updating
  ranking metadata.
- `node bench/drumscore.ts --label=NAME` scores every drum stage (DSP, raw model, snapped model,
  the shipped analysis and a frozen `--before` analyser) against the labelled MDB Drums corpus
  under `bench/corpus/mdb-drums` at the 50 ms mir_eval tolerance, writing
  `bench/reports/audio-reliability/mdb/results-NAME.{json,md}`. Model activations and beats are
  cached per track, so variants re-run in seconds. `bench/lab/mdb.ts` exposes the same corpus,
  caches and scoring for experiments; `bench/lab/example.ts` is the template.
- `MV_CACHE_DIR=<library> node bench/lab/library-reanalyse.ts --out=DIR` re-analyses every
  library track with the working-tree analyser from its cached model beats and the cached
  ADTOF activations under `bench/reports/audio-reliability/library-activations`, composes its
  show, and writes both with copies of context and meta into a scratch cache that
  `compositionprobe`, `lintsweep` and `showreview --analysis/--show` can read. `summary.json`
  lists per track whether beats, bar lines and sections changed and how the onset counts moved.
- `node bench/introprobe.ts --id ID [--analysis FILE --show FILE] [--before-shows FILE
  --before-core DIR]` measures one opening: room level at 30, 60 and 120 Hz, what the snares,
  the level track and the spectrum each contribute, the lift around each snare, effect-state
  determinism after a backward seek, and whether anything after the intro changed (only
  meaningful when both sides share an analysis and the shows differ in the intro alone).
- `node bench/audibility.ts --id ID --from S --to S` writes a 10 ms timeline of level, onset
  strength, DSP and model drum evidence and per-attack spectral snapshots for one passage, to
  judge by evidence what is audible where no labels exist.
- `node bench/transitionprobe.ts --ids ID,ID,ID --out bench/reports/transitions-after.json` walks
  the room through every transition it makes on cached tracks: track to track, a queue jump,
  pause and resume, seeks, lounge on and off, the dissolve into rest and the wake, hardware
  clock jitter and a stale sync, cue boundaries and a scene handover at rest. Each case reports
  the worst single-frame byte move against the show's own movement, the frames that moved more
  than a dissolve can, and the darkest frame. `--core DIR` renders with another checkout's
  `packages/core/src` (a git worktree of the baseline) and `--compare FILE` prints both runs
  side by side.
- `node bench/showreview.ts ID --out bench/reports/review.html` exports audio with actual ceiling
  and bounce-lamp output. `--analysis FILE` and `--show FILE` select diagnostic inputs. The HTML
  is self-contained, with opening/chorus/breakdown selection, seeking and optional snare clicks.
  Use `--bars 0,62 --seconds 24` to inspect exact passages reported from the app.

`showreview` renders at 60 Hz and stores 30 Hz display samples. For comparisons, supply
`--before-shows FILE` from `compositionprobe` and `--before-core DIR` pointing to the baseline
core source directory. Otherwise both shows use the current renderer. Each renderer warms
from the start of the track, and both sides use the same audio interval. Snare clicks follow
analysis timestamps; visual envelopes retain the renderer's transport anticipation.

Room kick contrast compares a 133 ms approach window with the next 167 ms around each
anticipated kick. It complements visible shape, timing and listening judgement; a brighter
bed can increase absolute light while reducing perceived punch.
The report also separates kick dips from positive lifts and records the larger absolute
onset swing. A ducking effect can articulate kicks through darkness; that metric alone
does not establish whether its feel suits the passage.
