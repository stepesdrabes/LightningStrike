# Handover

The current state of LightningStrike's analysis and show engine, as of 2026-09-07. This is
the one document: what runs, where it stands against the owner's judgements, how the review
loop works, what was measured and rejected, and how to gate a change. `README.md` says what
the product is; `CLAUDE.md` holds the house rules. The narrative round records that used to
sit beside this file were removed on 2026-09-07 and live in git history.

Versions: **ANALYSIS 28 / SHOW 23 / CONTEXT 3.** The installed app carries them. The analysis
and engine changes of 2026-09-07 are in the working tree, uncommitted; everything before them
is committed through `851e1da`.

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
- **The live cache is review corpus 2**: 29 tracks, pre-analysed at v28, unjudged,
  listed with reasons in `bench/judged/round-2026-09-07b/corpus.json`. Rap and EDM first, at
  the owner's word that those are always the best: twelve rap tracks (HUMBLE., Thinkin Bout
  You, Best Part, FE!N, ROCKSTAR where the detector hears two songs, Cigo a kava,
  Praha/Viden, Az na mesic, Patky, Stiny, Panama, Separ's Hovorili mi ze), twelve EDM (Way Too
  Self Aware and Vitej as praised sentinels, Kisses, Higher, 365, Von dutch, Immaterial,
  Illegal, Faster n Harder, Kids Techno Mix, Runaway (U & I), Windows98), and five that carry
  the open classes: Blinding Lights, Killing In the Name, Stranded now read at 92 bpm, Someone
  You Loved with no kit, Le Freak. A first, unclean pass of judgements on an earlier draft was discarded at the
  owner's ask.
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

Corpus 1 (19 tracks, judged in full on 2026-09-07; frozen in `bench/judged/round-2026-09-07/`):

| | |
|---|---|
| owner boundaries to the bar | 151 of 180 (from 145 at the start of the round) |
| one bar early / late | 22 / 7 |
| labels wrong on hits | 7 |
| accepted-as-is tracks moved | 0 of 10 |

Ratings: seven 5s (Self Aware, SICKO MODE "basically perfect", Vitej, Sunset, Je mi fajn,
Hannah Montana, Pistacie), six 4s (HIGHEST IN THE ROOM, Blinding Lights, Melanz, Safir, Do I
Wanna Know?, EARFQUAKE), five 3s (Doppler and Killing In the Name "unsure myself", Timeless,
PROVENZA, Someone You Loved), one 2 (Stranded, unsure). Per track after the round: Doppler 12
of 13, Blinding Lights 6 of 8, EARFQUAKE 8 of 8, Melanz 12 of 13, SICKO MODE 16 of 16, PROVENZA
5 of 9, Timeless 5 of 8, Someone You Loved 9 of 11, Killing In the Name 4 of 11, Stranded 4 of
13, and the ten accepted tracks whole.

**What is still wrong, by class**, which is the next session's work list:

1. **The kit arrives a bar before the floor lands.** The kick or a crash comes on the fill
   bar, the bass on the next, and the owner draws the next. Blinding Lights 1:02 and 1:36,
   PROVENZA 0:52 and 2:53, Killing In the Name's three later choruses, Melanz 3:01, Timeless
   0:24. Eight boundaries. A bass-landing term, the settle term and a looser margin were all
   swept against the maps and none moved these (below); the fill bar's own arrival score is
   the obstacle, and the owner's word "bass lands here" on corpus 2 is the evidence to collect.
2. **Restatements the segmenter cannot see** because the material does not change: Timeless
   1:20 (arrival 4.6 on the refine's scale, fourteen bars in, off any phrase grid), PROVENZA
   2:01, Someone You Loved 1:53 (which also costs that section its chorus label: the 37 s
   section's repeated lines cover 42% against a 55% bar).
3. **Killing In the Name's half-bar builds** (1:41, 3:09): the owner's boundaries sit mid-bar
   on beats, not on downbeats; its later choruses are class 1.
4. **Doppler and Stranded**, where the owner was unsure too. Doppler's first 87 s read as one
   breakdown with the hats entering at 16.6 unmarked; Stranded is now read at 92 bpm and needs
   a fresh judgement.
5. **Effects**: Do I Wanna Know? "full green in the first verse", twice on file. The moss
   palette's base is green and the verse bed fills the room with it. A palette-library or an
   output-calibration decision, the owner's to make.

## The review loop

1. The owner maps a track in the app -> `cache/judge/<id>.json`. A judgement saved with no
   section edit means the analysis was accepted as it stood; freeze it from the analysis.
2. Copy the judgement to `bench/judged/round-<date>/<id>.map.json`. It is frozen there.
3. `MV_CACHE_DIR=<cache> node bench/movementprobe.ts <id> --no-hand-maps --no-marks --out=<file>`
   gives the analyser's own reading: it starts from the model's own count (`heard`), applies
   the published-level re-read and runs the drum model exactly as ingest does, and its `--out`
   carries `_probe`: per-bar arrival, physics, settle, and the boundary table after every pass
   (`refined`, `pins`, `arranged`, `hooks`, `pulled`, `final`). **A saved judgement is law in
   the app** (the analysis adopts the map), so the automatic reading is only visible here.
4. `node bench/mapdiff.ts <map> <analysis>` per track;
   `MV_CACHE_DIR=<cache> node bench/mapsweep.ts [--variant=a,b] [--only=<id>]` for every map at
   once, any `StructureTuning` variant, hits to 0.6 s, misses signed in bars, regressions on
   the accepted rows. `bench/reports/mapsweep.json` holds the per-track rows.
5. Find the general cause across tracks, fix it, then every gate below.

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
  beats its own bar by 45% and clears 2; moved arrivals >= 2 and stays >= 2 are pinned;
  `rephaseToPins`; the phrase snap (one bar, never a pin); vocabulary (club: drop/groove/
  breakdown/build; song: chorus/verse, promoted and demoted from the repeated lyric lines);
  the hook snap; `pullOntoReturn` (a boundary on a no-kick bar moves onto a decisive kit
  return, into kit-carried kinds only); `pushOntoDeparture` (a breakdown, build or outro
  starts on the bar the kit leaves and the floor falls, both directions, never a build
  forward); the early same-kind merge keeps a pinned seam; consolidation merges same-kind
  seams nothing arrives on. Outro and ring-out only where the record ends.
- **Levels**: the published tempo re-reads the beats at 2, 0.5, 1.5 etc. when the model's
  reading is a clean ratio off it; hip-hop, rnb, ballad and ambient never double, and metal
  does not either (Stranded).
- **The kit**: the ADTOF drum model, snapped to onsets; the DSP detector only as fallback.
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
- The owner's standing taste verdicts, not to be re-proposed: no whole-field displacement; no
  fill-and-drain wipes; no strobing accents in rap verses; buildStrobe only in a build's back
  half; the strobe before a drop is endorsed; outros keep their look and thin; endings anchor
  to the finish line; the pre-arrival breath dims and never strikes the set; the cue ceiling
  must not be brought down at slow tempos (five looks became nine on Melanz's third song).

## Measured and rejected, do not re-propose

- The unrestricted downbeat phase walk: 5 worse on the frozen time-scored targets, including a
  praised Killing In the Name seam moving 0.64 s. It ships scoped to marked movements.
- A key change as the only witness of a seam (confidence 0.2-0.5 on rap, related keys in
  multi-movement rock); raw chroma cosine (0.95 between two different songs; centre it);
  per-track chroma thresholds fitted on two tracks; phase continuity anchored on a regime's
  own first beat or at 70 ms on a 0.33 s lattice; "a pause is quiet" (real switches carry the
  hook a cappella through the pause); the median interval as the lead-in test; the last bar
  line as the seam whatever the gap (SICKO's switch moved a bar and a half).
- Against the 19 maps of 2026-09-07 (`bench/mapsweep.ts`): the settling term gated at 0.8 (no
  change) and 1.2 (one loss), ungated at 1.2 and 1.6 (two accepted tracks move); a
  bass-landing term at 1 and 2 (not one boundary moves); the refine margin at 1.2 (five
  losses); a kit minimum of 2 or 3 kicks (SICKO loses one); an arrival split inside long
  segments (no gain, label errors double). The dials `settleWeight`, `settleGate`,
  `bassWeight`, `refineMargin`, `kitMinKicks`, `splitAtArrival` stay in `StructureTuning` at
  no-change defaults for the next sweep.
- The MusicFM section-label head (P6): built, A/B'd, judged worse, rolled back. Hook-placed
  choruses fix Snooze and wreck Blinding Lights; no column separates the two.
- A `MASTER` dimmer at 0.7 (flat); tuning `GAMMA` to make the effects calibration test green
  (the calibration is a settled decision, and that one test is expected to fail).

## Gates, with the current floors

Run all of these before any handover. Editing `packages/analysis` or `core` while a bench is
running contaminates the variants that have not started; land edits between runs.

1. `npm test`: **932 green** with the one known failure (`effects.test.ts`, "every effect
   claiming to carry a room can actually fill one", the calibration). An ambient test times
   out only when several benches share the machine. `npm run check` clean.
2. `MV_CACHE_DIR=<cache> node bench/mapsweep.ts --variant=current`: **151 of 180**, 0
   regressions on accepted rows. The floor for any structure change.
3. `MV_CACHE_DIR=<archive> node bench/phasegrid.ts`: **28 same / 0 worse of 28**. The
   time-scored bar-line gate; the only one that can judge a change that re-bars a track.
   `bench/earlybars.ts` scores the same targets by bar and cannot.
4. `node bench/structscore.ts --dataset harmonix|raveform --limit 60`: Harmonix F0.5 0.200,
   F3 0.538, label 10.1%; Raveform F0.5 0.422, F3 0.536, label 35.4%, sections 19.4 against
   9.4 annotated. Read F0.5/F3/sections; the label column is blind to same-kind merges.
5. `node bench/movements.ts --set=multisong|app|harmonix|raveform`: multi-song 10 hit / 12
   missed of 22 (known misses: A-B-A rock, Know Yourself, Sing About Me, Paranoid's first and
   third, Suburbia's first and third), one false (the Stairway cover's real tempo change);
   Harmonix Five Magics only, four splits; Raveform 0 of 60; the library 4 of 4 with no false
   seam plus bad guy's coda.
6. `MV_CACHE_DIR=<cache> node bench/lintsweep.ts`: 0 rejected. The app fails dark on a lint
   error.
7. Versions: any analyser change bumps `ANALYSIS_VERSION`, any composition change bumps
   `SHOW_VERSION`, in the same change.
8. Build: `npm run bundle -w @mv/desktop`, then `npx tauri build --bundles app` from
   `apps/desktop` (~8 min), then the install ritual above.

## House rules that bite

- The owner works in the same tree. `firmware/`, `hardware/`, `packages/preview3d/`,
  `apps/controller/`, `packages/core/src/output.ts` and `geometry.ts`, `docs/FIRMWARE.md` and
  the wiring docs are theirs; commit only your own paths, and only when asked.
- No em-dashes anywhere. Comments say why. Stage explicit paths. No co-author trailer.
- Aesthetic calls beat tests: ship the look the owner asked for and report what broke as room
  consequences.
