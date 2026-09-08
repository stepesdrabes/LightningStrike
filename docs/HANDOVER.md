# Handover

The current state of LightningStrike's analysis and show engine, as of the evening of
2026-09-07. This is the one document: what runs, where it stands against the owner's
judgements, how the review loop works, what was measured and rejected, and how to gate a
change. `README.md` says what the product is; `CLAUDE.md` holds the house rules. The narrative
round records that used to sit beside this file were removed on 2026-09-07 and live in git
history.

Versions: **ANALYSIS 29 / SHOW 24 / CONTEXT 3.** The installed app carries them since
2026-09-08. Everything through the afternoon of 2026-09-07 is committed at `3976d48`; the
evening's analysis, engine and bench changes are in the working tree, uncommitted.

## What the system is

Ingest downloads a track, looks it up (genre family, published tempo, lyrics), runs Beat This
for beats and downbeats and the ADTOF drum model for the kit, then `analyzeTrack` in
`packages/analysis`: grid repair, movement detection, bar-synchronous features, structure
(segments, refine, phrase snap, vocabulary, consolidation), events and moments. The engine in
`packages/author-engine` composes a show from that analysis: a palette, cues by bar, hits, a
brief. The linter refuses anything the room cannot show. The app plays the show to the strips.

The owner judges in the app: a rating, a comment, and a section map drawn on the analysis.
That judgement is the ground truth everything below is measured against.

## The app and the caches

- `/Applications/LightningStrike.app` on `~/Library/Application Support/cz.drabek.lightningstrike/cache`.
  The bundle name decides the cache; a plain name reads the plain `cache`.
- **The live cache is review corpus 2**: 29 tracks listed with reasons in
  `bench/judged/round-2026-09-07b/corpus.json`, re-analysed clean at v29 on 2026-09-08 for the
  owner's second judgement. The 28 judge files of the evening of 2026-09-07 are frozen in
  `bench/judged/round-2026-09-07d/` (see below) and moved out of the app's sight to
  `cache/judge-archive-2026-09-07d`, so the analysis adopts no map; move them back into
  `cache/judge` to hear the maps again. Twelve rap tracks (HUMBLE., Thinkin Bout You,
  Best Part, FE!N, ROCKSTAR where the detector hears two songs, Cigo a kava, Praha/Viden, Az na
  mesic, Patky, Stiny, Panama, Separ's Hovorili mi ze), twelve EDM (Way Too Self Aware and Vitej
  as praised sentinels, Kisses, Higher, 365, Von dutch, Immaterial, Illegal, Faster n Harder,
  Kids Techno Mix, Runaway (U & I), Windows98), and five that carry the open classes: Blinding
  Lights, Killing In the Name, Stranded now read at 92 bpm, Someone You Loved with no kit, Le
  Freak.
- `cache-corpus1-2026-09-07`: corpus 1 rebuilt fresh at v28 with no map adopted, plus the
  owner's second look at four of its tracks (HIGHEST IN THE ROOM, SICKO MODE, Timeless,
  Melanz), frozen in `bench/judged/round-2026-09-07c/` for comparison with the first
  judgements in `round-2026-09-07/`. Swap the two directory names to hear it.
- `cache-archive-2026-09-07`: the whole 161-track library as it was, with the 43 old
  judgements under `judge-archive-2026-09-01`. Any gate that reads the app cache
  (`phasegrid`, `lintsweep`, `movements --set=app`) must be pointed here with `MV_CACHE_DIR`
  to see the whole library; off the corpus cache phasegrid sees 16 of its 28 targets.
- `cache-A-archive`, `cache-B-archive`: the retired A/B stores. Do not build a second app
  without asking; the owner wants one.
- **The install trap**: `cp -R` onto an existing bundle nests it and the old binary keeps
  launching. `rm -rf` the target, copy, check `ls` shows only `Contents`, then
  `xattr -dr com.apple.quarantine`.
- A cleared blob re-derives on first play (~60 s a track);
  `MV_CACHE_DIR=<cache> node bench/reanalyse.ts [--skip-current]` does a cache ahead of time
  with both models.

## Where it stands against the owner's judgements

Corpus 2 (29 tracks, judged on the evening of 2026-09-07; frozen in
`bench/judged/round-2026-09-07d/`, 27 maps): 15 edited maps and 12 accepted as they stood.
HUMBLE. could not be judged (the app ran it in lounge mode) and Way Too Self Aware was not
judged. Higher was accepted at a rating of 2 with the owner unsure, and counts as accepted by
the rule.

Ratings: nine 5s (Faster n Harder, Kids, Windows98, Kisses, Illegal, Vitej, Cigo a kava,
Runaway, and none of the edited maps), nine 4s (Thinkin Bout You "almost perfect, wrongly
sub-sectioned per the bars", Panama, Immaterial, Az na mesic, Blinding Lights, Hovorili mi ze,
ROCKSTAR, Someone You Loved, Patky, Stiny), seven 3s (FE!N, Killing In the Name, Le Freak,
Praha/Viden, 365, Best Part "not so sure myself", Stranded), one 2 (Higher, "not sure how to
section techno").

| | before this round | after |
|---|---|---|
| corpus 2: owner boundaries to the bar | 214 of 266 | **232 of 266** |
| corpus 2: one bar early / late | 38 / 14 | 25 / 9 |
| corpus 2: labels wrong on hits | 1 | 0 |
| corpus 2: accepted-as-is tracks moved | 0 of 12 | 0 of 12 |
| corpus 1 (19 maps of 2026-09-07): to the bar | 151 of 180 | **158 of 180** |
| corpus 1: early / late | 22 / 7 | 17 / 5 |
| corpus 1: accepted-as-is tracks moved | 0 of 10 | 0 of 10 |

Per track after the round, corpus 2: Killing In the Name 10 of 12, Az na mesic 12 of 12,
Blinding Lights 8 of 12, Praha/Viden 9 of 10, Le Freak 8 of 11 (from 2), Stiny 5 of 9, Von
dutch 5 of 9, Someone You Loved 10 of 10, 365 10 of 10 (from 6), Stranded 8 of 10, FE!N 4 of
8, ROCKSTAR 12 of 13, Hovorili mi ze 5 of 6, Patky 6 of 7, Best Part 1 of 8 (from 3, the one
map that loses), and the twelve accepted tracks whole. Corpus 1: Killing In the Name 7 of 11,
Blinding Lights 7 of 8, Melanz 13 of 13, Someone You Loved 10 of 11, Stranded 5 of 13; the rest
as before.

**What is still wrong, by class**, which is the next session's work list:

1. **The model's downbeat phase changes mid-track where the owner placed his off-grid marks.**
   FE!N's first minute has the downbeat at residue 3 of the shipped grid and the owner's four
   boundaries at bars 2.75, 6.75, 10.75 and 14.75; Stiny's last chorus at 57.5 and Killing In
   the Name's at 99.25 sit exactly where the model's residue run changes; Von dutch alternates
   half bars in its builds. `phaseSegments` (the downbeat phase walk, `bench/walkprobe`-style
   readings in the round's scratch) finds every one of these at the shipped reset cost and
   ships scoped to marked movements only, because the unrestricted walk was 5 worse on the
   frozen targets last time. Higher, accepted at 2, restarts in its intro at every cost tried,
   so any re-opening needs the walk to require a long consistent residue run. Eight boundaries.
2. **The repair's half when it folds a doubled regime.** Patky's note "the chorus should start
   EXACTLY HERE, I can't drag it there" is 116.6 s: the model's own downbeat at 116.58 falls
   between the beats of the repaired 70 bpm grid, because the fold kept the half that continued
   the previous phase rather than the half the model's downbeats sit on. The editor snaps to
   beats, so the owner could not place the mark.
3. **The DP two bars early on Blinding Lights** (66 for 68, 74 for 76) and its 92, a chorus
   whose only evidence is the phrase grid and the one-bar kick suspension every Blinding Lights
   chorus opens with (kicks 3, 3, 1, 4 around each). Le Freak 104 (consolidated at an arrival
   of 1.55 against the 1.6 floor), 144 (the DP two bars early) and its ending.
4. **Praha/Viden 7**: a rap pickup line sung out of a quiet intro, allowed by the same
   sung-entrance rule that Thinkin Bout You's every hook needs. Not separable on the evidence
   the arrival score carries.
5. **Restatements the owner hears and the DP does not**: Stiny 37 and 41 (a four-bar kick-out
   inside a chorus), Hovorili mi ze 56, Stranded 78 (a riff change at constant level, removed
   by the early same-kind merge).
6. **Best Part**, rated 3 "not so sure myself": the DP itself sits a bar early through the
   first half (3, 11, 39 for 4, 12, 40) and hears the chorus at 15 where the owner draws 20.
7. **Thinkin Bout You's bars are half bars.** It now reproduces the accepted map at 65 bpm, but
   with two beats to a bar: the model's downbeats alternate 1.84 s and 3.7 s spacing and the
   record inserts two beats near 35 s, so the sub-sectioning "not per the bars" the owner heard
   needs 65 in four with the phase flip honoured, which is class 1 again.

## The review loop

1. The owner maps a track in the app -> `cache/judge/<id>.json`. A judgement saved with no
   section edit means the analysis was accepted as it stood; freeze it from the analysis,
   with `acceptedAnalysis` stamped, which `mapsweep` reads as a regression row. A judgement
   with neither a rating nor a map (HUMBLE.) is a note, not a map: list it in the round's
   `corpus.json` and freeze nothing.
2. Copy the judgement to `bench/judged/round-<date>/<id>.map.json`. It is frozen there.
3. `MV_CACHE_DIR=<cache> node bench/movementprobe.ts <id> --no-hand-maps --no-marks --out=<file>`
   gives the analyser's own reading: it starts from the model's own count (`heard`), applies
   the published-level re-read with the kit and runs the drum model exactly as ingest does,
   and its `--out` carries `_probe`: per-bar arrival, physics, the score's components (step,
   kit, dip, novelty, voice), the fill bars, the anacrusis guard's verdict on every move it was
   asked about, and the boundary table after every pass (`dp`, `refined`, `pins`, `arranged`,
   `hooks`, `pulled`, `final`). `--tuning='{"pickupGuard":false}'` reads any sweep variant in
   full. **A saved judgement is law in the app** (the analysis adopts the map), so the
   automatic reading is only visible here.
4. `node bench/mapdiff.ts <map> <analysis>` per track;
   `MV_CACHE_DIR=<cache> node bench/mapsweep.ts [--maps=<round>] [--variant=a,b] [--only=<id>]`
   for every map at once, any `StructureTuning` variant, hits to 0.6 s, misses signed in bars,
   regressions on the accepted rows. `bench/reports/mapsweep.json` holds the per-track rows.
   Corpus 2 needs `--maps=bench/judged/round-2026-09-07d` against the live cache; corpus 1 the
   default maps against `cache-corpus1-2026-09-07`. Its drum cache under `bench/corpus/.drums`
   now round-trips the activation curves; before this round a cached run handed the quantiser
   an unreadable curve and two tracks moved a boundary between a fresh run and a cached one.
5. The `dp` stage against `refined` is the first thing to read: on this corpus the DP had the
   owner's table on Le Freak, Praha/Viden, 365 and Killing In the Name, and every miss was a
   later pass moving a correct boundary.
6. Find the general cause across tracks, fix it, then every gate below.

## What ships in the analysis

- **Grid repair** (`movements.ts`, `repairGrid`): tempo regimes from a 16-beat median
  change-point; tracker level flips undone (2:1, 3:1; 3:2 and 4:3 only when phase-continuous
  within 40 ms); chaotic edges up to 45 s and interior gaps up to 20 s written at the
  neighbouring song's period; a lead-in rewritten at the first song's period when under nine
  in ten of its intervals hold it; short blips (a few beats at double time inside a steady
  song) rewritten at the period; a pause before a new song written from the outgoing song's
  last complete bar as the incoming song's pickup; the handshake for a switch the tracker rode
  through. Bar phase from the walk segment at the first steady song.
- **Movements** (`proposeSeams`, `judgeSeams`): a tempo step between two steady songs (ratio
  >= 1.10, both >= 20 s) with a step-not-ramp test or a pause >= 2 periods; a same-tempo seam
  needs the walk to restart or the beat to stop, plus new material on timbre and centred
  chroma (<= 0.88, <= 0.70) and a pause >= 2 s or a key change >= 3 fifths at confidence
  >= 0.45; long pauses also need timbre under 0.95. Witnesses skip a written zone. Nothing
  before 45 s. Seams the repair placed on a bar line are cut exactly there.
- **Structure** (`structure.ts`, `arrange.ts`, `consolidate.ts`): per-movement DP
  segmentation; `refineBoundaries` moves a boundary at most one bar onto an arrival that
  beats its own bar by 45% and clears 2, **never onto a drum fill** (a loud bar whose pattern
  neither neighbour holds while the bar after settles), and **never off the local phrase grid
  without an impact** (`offGridImpact`: the kit landing, a pattern break, a sung entrance after
  a collapse, the kit returning after a silent bar with the voice on it, music rising out of
  the quiet floor 8 dB under the loud passages, or a non-periodic collapse); a boundary the
  guard held pins as a stay does. Moved arrivals >= 2 and stays >= 2 are pinned;
  `rephaseToPins` (moved pins vote); the phrase snap (one bar, never a pin); vocabulary (club:
  drop/groove/breakdown/build; song: chorus/verse, promoted and demoted from the repeated lyric
  lines); the hook snap, **strict**: no window claims a bar the record has not arrived at, a
  decisive incumbent is never displaced, and the same off-grid guard applies; `pullOntoReturn`
  and `pushOntoDeparture`; the early same-kind merge keeps pinned and held seams; consolidation
  merges same-kind seams nothing arrives on. Outro and ring-out only where the record ends.
- **Levels**: the published tempo re-reads the beats at 2, 0.5, 1.5 etc. when the model's
  reading is a clean ratio off it; hip-hop, rnb, ballad and ambient never double, and metal
  does not either (Stranded). **The snare checks the catalogue's octave**: on the faster of the
  two grids, with the bar phase from the model's downbeats, under half the snares on beats two
  and four refuses a doubling and confirms a halving (Thinkin Bout You: Deezer's 130, the
  model's 65, the snare on two and four at 65).
- **The kit**: the ADTOF drum model, snapped to onsets; the DSP detector only as fallback.
- **Trust** (`core/trust.ts`): the fragmentation gate is corroborated by a published tempo at
  the same level, which is what HUMBLE.'s sixteen stop-time sections needed to leave lounge.
- `TrackAnalysis.heard` keeps the model's own beats and downbeats; benches start from it.

## What ships in the engine

- A palette per song of a multi-song track, a quarter turn from the one before, written into
  every cue; the switch arrives on its downbeat with a slam; each song's loudest passage at
  0.96 under the one peak.
- No cue holds the room past eight bars, and a remainder past eight bars that would hold past
  30 s splits into the eight and a stub of at least 6 s; the burst re-landing rounds down;
  outros and voids exempt.
- A record with no kit (kicks and snares under 0.15 per loud bar, from the drum model) takes
  the ballad's restraint whatever its family: no flashes, swell peak, no transient or bump
  cadence, and the ballad's avoid list plus the kick-burst family hard-excluded.
- Genre profiles (heat, saturation, flash budget, peak treatment, signatures, avoid lists),
  the kick-burst family drawn at most one per show, the 8 Hz strobe ceiling, hit budgets by
  kick density.
- **The picker prices a band too quiet at 2.6 in drop-class passages** (1.6 elsewhere and for
  a band too loud), so a top-band look used once beats a fresh look two bands down; a foreign
  gesture costs 4.4, two uses of novelty, so the steeper price cannot buy an avoided effect
  (Panama's last chorus: "these effects carry NO energy", heartbeat and confetti after the
  three native top-band rhythms had each been used once).
- **Consecutive breakdown cues inherit the bed** and move the accent every second cue
  (Immaterial: "a bit of mess in the breakdown sections", four breakdown sections in 32 bars
  with a fresh bed on each).
- The owner's standing taste verdicts, not to be re-proposed: no whole-field displacement; no
  fill-and-drain wipes; no strobing accents in rap verses; buildStrobe only in a build's back
  half; the strobe before a drop is endorsed; outros keep their look and thin; endings anchor
  to the finish line; the pre-arrival breath dims and never strikes the set; the cue ceiling
  must not be brought down at slow tempos (five looks became nine on Melanz's third song).

## Measured and rejected, do not re-propose

- The unrestricted downbeat phase walk: 5 worse on the frozen time-scored targets, including a
  praised Killing In the Name seam moving 0.64 s. It ships scoped to marked movements. The
  evening corpus is the case for re-opening it with a stricter restart (class 1 above).
- A key change as the only witness of a seam (confidence 0.2-0.5 on rap, related keys in
  multi-movement rock); raw chroma cosine (0.95 between two different songs; centre it);
  per-track chroma thresholds fitted on two tracks; phase continuity anchored on a regime's
  own first beat or at 70 ms on a 0.33 s lattice; "a pause is quiet" (real switches carry the
  hook a cappella through the pause); the median interval as the lead-in test; the last bar
  line as the seam whatever the gap (SICKO's switch moved a bar and a half).
- Against the 19 maps of 2026-09-07: the settling term gated at 0.8 (no change) and 1.2 (one
  loss), ungated at 1.2 and 1.6 (two accepted tracks move); a bass-landing term at 1 and 2
  (not one boundary moves); the refine margin at 1.2 (five losses); a kit minimum of 2 or 3
  kicks (SICKO loses one); an arrival split inside long segments (no gain, label errors
  double). The dials stay in `StructureTuning` at no-change defaults.
- Against the 27 maps of the evening of 2026-09-07 plus the 19: the DP's phrase-length prior
  `lambda` at 1.6 and 2.2 (201 and 193 of 266, six and eight accepted tracks moved);
  `stayPinScore` 3 (207 of 266, two accepted moved); `hookSnapReach` 1 (no change); the
  anacrusis guard with "the kit returns after one silent bar" as an impact (Le Freak's
  alternating kick detections fire it on every other bar), with a single-bar quiet floor
  (Blinding Lights' pre-chorus dip), or with the quiet floor by rank alone (a compressed record
  spans six decibels and its verses are its bottom decile); refusing the fill veto's bar a stay
  pin as well as a move (Doppler's build opens on a fill-shaped bar).
- The MusicFM section-label head (P6): built, A/B'd, judged worse, rolled back. Hook-placed
  choruses fix Snooze and wreck Blinding Lights; no column separates the two. If a learned
  labeller is reopened, SongFormer (MuQ + MusicFM, HR.5F 0.696 on Harmonix, weights on
  Hugging Face, ASLP-lab) is the 2026 reference, and every annotation convention on record
  (Harmonix, JSD, SLMS, Raveform) places a section on the downbeat that begins the phrase,
  never on the fill or pickup, which is the owner's convention too.
- A `MASTER` dimmer at 0.7 (flat); tuning `GAMMA` to make the effects calibration test green
  (the calibration is a settled decision, and that one test is expected to fail).

## Gates, with the current floors

Run all of these before any handover. `mapsweep`, `phasegrid` and `structscore` load the
analysis code once per process and run the variants inside it, so an edit to
`packages/analysis` or `core` while one is running does not touch that process; but a script
that runs two of them in sequence loads the code again for the second, and an edit between the
two contaminates it. Land edits between runs.

1. `npm test`: **941 green** with the one known failure (`effects.test.ts`, "every effect
   claiming to carry a room can actually fill one", the calibration). An ambient test times
   out only when several benches share the machine. `npm run check` clean.
2. `MV_CACHE_DIR=<live cache> node bench/mapsweep.ts --maps=bench/judged/round-2026-09-07d --variant=current`:
   **232 of 266**, 0 regressions on accepted rows; and
   `MV_CACHE_DIR=<corpus-1 cache> node bench/mapsweep.ts --variant=current`: **158 of 180**, 0
   regressions. The floors for any structure change. The variant `before-2026-09-07d` is the
   evening's starting point (214 and 151) for a re-measurement.
3. `MV_CACHE_DIR=<archive> node bench/phasegrid.ts`: **28 same / 0 worse of 28**. The
   time-scored bar-line gate; the only one that can judge a change that re-bars a track. `bench/earlybars.ts`
   scores the same targets by bar and cannot. Note that two of its sentinels are older than the
   owner's newest maps and disagree with them: Le Freak 45 (the owner now draws 48) and Killing
   In the Name 49.
4. `node bench/structscore.ts --dataset harmonix|raveform --limit 60`: Harmonix F0.5 0.210,
   F3 0.541, label 10.0%, sections 11.2 against 10.1 annotated; Raveform F0.5 0.422, F3 0.537,
   label 35.3%, sections 19.3 against 9.4 annotated (before this round 0.200 / 0.538 and 0.422
   / 0.536). Read F0.5/F3/sections; the label column is blind to same-kind merges.
5. `node bench/movements.ts --set=multisong|app|harmonix|raveform`: multi-song 10 hit / 12
   missed of 22 (known misses: A-B-A rock, Know Yourself, Sing About Me, Paranoid's first and
   third, Suburbia's first and third), one false (the Stairway cover's real tempo change);
   Harmonix Five Magics only, four splits; Raveform 0 of 60; the library (`--set=app` on the
   archive) 4 of 4 with no false seam, six tracks given a movement.
6. `MV_CACHE_DIR=<cache> node bench/lintsweep.ts`: **0 rejected** (29 clean on the live cache,
   10 buttons placed). The app fails dark on a lint error.
7. Versions: any analyser change bumps `ANALYSIS_VERSION`, any composition change bumps
   `SHOW_VERSION`, in the same change.
8. Build: `npm run bundle -w @mv/desktop`, then `npx tauri build --bundles app` from
   `apps/desktop` (~8 min), then the install ritual above.

## House rules that bite

- The owner works in the same tree. `firmware/`, `hardware/`, `packages/preview3d/`,
  `apps/controller/`, `packages/core/src/output.ts` and `geometry.ts`, `docs/FIRMWARE.md` and
  the wiring docs (`docs/frame-wiring.md` is untracked and theirs) are theirs; commit only your
  own paths, and only when asked.
- No em-dashes anywhere. Comments say why. Stage explicit paths. No co-author trailer.
- Aesthetic calls beat tests: ship the look the owner asked for and report what broke as room
  consequences.
