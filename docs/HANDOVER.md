# Handover

The current state of LightningStrike's analysis and show engine, as of the evening of
2026-09-08. This is the one document: what runs, where it stands against the owner's
judgements, how the review loop works, what was measured and rejected, and how to gate a
change. `README.md` says what the product is; `CLAUDE.md` holds the house rules. The narrative
round records that used to sit beside this file were removed on 2026-09-07 and live in git
history.

Versions: **ANALYSIS 30 / SHOW 25 / CONTEXT 3.** The 2026-09-08 round is committed (the
evening-of-09-07 round at `0266ffc`, this one in the three commits after it), and the installed
app carries it since the evening of 2026-09-08, running on corpus 3.

## What the system is

Ingest downloads a track, looks it up (genre family, published tempo, lyrics), runs Beat This
for beats and downbeats and the ADTOF drum model for the kit, then `analyzeTrack` in
`packages/analysis`: grid repair, the downbeat phase walk, movement detection, bar-synchronous
features, structure (segments, refine, phrase snap, vocabulary, consolidation), events and
moments. The engine in `packages/author-engine` composes a show from that analysis: a palette,
cues by bar, hits, a brief. The linter refuses anything the room cannot show. The app plays
the show to the strips.

The owner judges in the app: a rating, a comment, and a section map drawn on the analysis.
That judgement is the ground truth everything below is measured against.

## The app and the caches

- `/Applications/LightningStrike.app` on `~/Library/Application Support/cz.drabek.lightningstrike/cache`.
  The bundle name decides the cache; a plain name reads the plain `cache`.
- **The live cache is review corpus 3, the owner's final corpus**: 65 tracks from the archive
  that no map has covered, listed with reasons in `bench/judged/round-2026-09-08b/corpus.json`,
  pre-analysed clean at v30 with no map adopted and an empty `judge` folder. The owner asked
  for sixty to seventy unique songs in the genres they judge (rap and EDM first), not the whole
  library: 26 rap (Czech and US), 22 club (house, edm, bass, trance, the two techno tracks Xtal
  and Doppler), 14 pop, rock, metal and rnb, and three disco and latin. Thirty were picked for what
  this round shipped (the tracks the model read in 2/4, the ones whose downbeats move
  mid-track, the ones with synced lyrics, the techno profile) and thirty-five for spread; the
  ambient set, the remixes of songs already there and the corpus-1 tracks were left out.
  Doppler is the one track with a map (`round-2026-09-07/`), kept because techno is three
  tracks in the whole library. Take Me (To The Moon) runs in lounge under the fragmentation
  gate (17 sections in 159 s at 175 bpm); the queue's override plays the authored show if the
  owner wants to judge it anyway. **The autopilot trap**: launched on a corpus queue the app
  pulled two unrelated tracks into it (Vandr, a Skibidi remix) and dropped four items within
  ten minutes; the queue was reconciled to the cache afterwards, and the first thing to check
  after a launch is that `queue.json` still lists exactly the corpus. **The stale-context
  trap**: eleven archive contexts were at version 1 or 2, which the app re-fetches on first
  play, and the lookups drift: the app's own refresh left Doppler with no family and filed Lose
  Yourself as ambient; a scripted refresh through the same path (`probe` then `enrichTrack`)
  moved Enter Sandman to metal, American Idiot to rock, As It Was to house and lost
  September's 48 lyric lines. Every corpus-3 context is at version 3 now, with the archive's
  family kept where the lookup returned nothing or ambient (Doppler, Lose Yourself, Take Me,
  Xtal, the hardstyle Summertime Sadness) and September's lyrics carried over; the analyses
  were redone after the refresh, so a track's show and its sections come from one context.
- `cache-corpus2-2026-09-08`: corpus 2 (32 tracks) as the owner left it on 2026-09-08, at v29,
  with the second judgement's 32 judge files in `judge/` and the evening-of-09-07 files in
  `judge-archive-2026-09-07d/`. Rename it to `cache` to hear those tracks again; the app will
  re-analyse them at v30 on play (about 60 s a track) and adopt the maps, so move `judge/`
  aside first to hear the automatic reading.
- `cache-corpus1-2026-09-07`: corpus 1 at v28 with the owner's second look at four of its
  tracks (frozen in `bench/judged/round-2026-09-07c/`).
- `cache-archive-2026-09-07`: the whole 161-track library as it was, with the 43 old
  judgements under `judge-archive-2026-09-01`. Any gate that reads the app cache
  (`phasegrid`, `lintsweep`, `movements --set=app`) must be pointed here with `MV_CACHE_DIR`
  to see the whole library.
- `cache-A-archive`, `cache-B-archive`: the retired A/B stores. Do not build a second app
  without asking; the owner wants one.
- **The install trap**: `cp -R` onto an existing bundle nests it and the old binary keeps
  launching. `rm -rf` the target, copy, check `ls` shows only `Contents`, then
  `xattr -dr com.apple.quarantine`.
- A cleared blob re-derives on first play (~60 s a track);
  `MV_CACHE_DIR=<cache> node bench/reanalyse.ts [--skip-current]` does a cache ahead of time
  with both models and refreshes each meta's trust verdict.

## Where it stands against the owner's judgements

Corpus 2 was judged a second time on 2026-09-08 (04:28 to 14:10) on the v29 app with no map
adopted, plus three tracks the owner added (bad guy, SICKO MODE, goosebumps): 31 maps, 16
accepted as they stood, frozen in `bench/judged/round-2026-09-08/`. It supersedes
`round-2026-09-07d` for the same tracks: Praha/Viden, Blinding Lights, Le Freak, Az na mesic,
Someone You Loved and Hovorili mi ze, edited the evening before, were accepted as the v29
analysis had them. The owner's comment on Someone You Loved fixes the reading of every map:
"the thing I am mainly judging is the segmentation boundaries, not the labels".

Ratings: eleven 5s (Az na mesic, Blinding Lights "almost perfect! I really like this one",
Cigo a kava, Faster n Harder, HUMBLE., Immaterial, Kids, Kisses, Praha/Viden, Runaway, Vitej,
Windows98), sixteen 4s, three 3s (Higher "the effects in techno are just off", Best Part,
Thinkin Bout You "the original sections were fine honestly, but can be better"). Stranded:
"This is getting good!".

| | before this round | after |
|---|---|---|
| corpus 2 (31 maps of 2026-09-08): owner boundaries to the bar | 290 of 318 | **301 of 318** |
| corpus 2: one bar early / late | 21 / 7 | 9 / 8 |
| corpus 2: seams the analysis adds that no owner boundary has, on accepted tables | 0 | 0 |
| corpus 2: accepted-as-is tracks losing a boundary | 0 of 16 | 0 of 16 |
| corpus 1 (19 maps of 2026-09-07): to the bar | 158 of 180 | **158 of 180** |
| corpus 1: accepted-as-is tracks losing a boundary | 0 of 10 | 1 of 10 (SICKO MODE, see below) |

Per track after the round, corpus 2: Best Part 8 of 8 (from 2), FE!N 7 of 8 (from 4), Stiny 8
of 8 (from 7), Panama 7 of 7, SICKO MODE 16 of 16, ROCKSTAR 11 of 12 (from 10), Stranded 8 of
9 (from 7), Killing In the Name 10 of 12 (from 11), Thinkin Bout You 3 of 8 (from 4), bad guy
12 of 13 (from 13), goosebumps 8 of 10, Von dutch 5 of 9, and the sixteen accepted tracks
whole. Corpus 1: Stranded 6 of 13 (from 5), SICKO MODE 15 of 16 (from 16), the rest as before.

**The owner's own judgements conflict twice, and the newer deliberate one wins.** SICKO
MODE's second build was accepted at 97.5 s in corpus 1 (twice) and dragged to 100.6 s in round
08, where the kit leaves; the analysis now says 100.6 and the corpus-1 row loses that hit.
Killing In the Name's last chorus was dragged off-grid to 274.7 s on 2026-09-07 (the model's
downbeat) and left at the analysis's 274.02 in round 08; the walk now puts it at 274.7 and the
round-08 row loses that hit. Both are recorded here so the next round does not re-litigate
them.

**What is still wrong, by class**, the next session's work list:

1. **Thinkin Bout You's phrases** (3 of 8). One groove for three minutes, read in four now
   (3.7 s bars); the owner draws its sections where the verses and the hook begin, eight bars
   apart, and the DP sees no material change to put a boundary on. The hook split below found
   two of them and was rejected for the seams it planted elsewhere.
2. **Von dutch** (5 of 9). The owner's five off-grid marks sit one or two beats before the
   model's downbeats, which are unanimous on the grid bars there (bars 6 to 15 and 40 to 47
   have every downbeat at residue 0). Nothing in the evidence supports the marks; leave it
   until the owner hears it again.
3. **Killing In the Name's intro** (bar 5.75, 17.56 s). The model's downbeats wander through
   the first thirteen bars (residues 2.4, 1.4, 0.3, 3.3 ...), and the owner's verse sits on
   one of them a beat before the grid; the walk refuses a chaotic run by design.
4. **Restatements inside a homogeneous section**: goosebumps 54 and 58 (a four-bar build the
   snare leaves inside the last chorus), Stranded's breakdown at 3 against the DP's 4 (both in
   near-silence), bad guy's coda build (167.6 s on the old grid, a beat and a half before the
   level drop the new grid puts at bar 94), ROCKSTAR's outro (172.9 on the old grid, 170.9
   now), FE!N's bar 0 (the model's first downbeat is at 0.02 s, the owner's intro at 0.82).
5. **Labels the owner mentioned**: Illegal's four bars at 60 are a "verse" to the owner and a
   drop to the analysis (a vocal passage in club vocabulary); Someone You Loved's second
   chorus now reads chorus.
6. **Techno effects**: the profile changed this round (below) and the owner has not heard it.
   Xtal and Doppler are in corpus 3 for that.

## The review loop

1. The owner maps a track in the app -> `cache/judge/<id>.json`. A judgement saved with no
   section edit means the analysis was accepted as it stood; freeze it from the analysis,
   with `acceptedAnalysis` stamped, which `mapsweep` reads as a regression row. A judgement
   with neither a rating nor a map is a note, not a map: list it in the round's
   `corpus.json` and freeze nothing.
2. Copy the judgement to `bench/judged/round-<date>/<id>.map.json`. It is frozen there.
3. `MV_CACHE_DIR=<cache> node bench/movementprobe.ts <id> --no-hand-maps --no-marks --out=<file>`
   gives the analyser's own reading: it starts from the model's own count (`heard`), applies
   the published-level re-read with the kit and runs the drum model exactly as ingest does,
   and its `--out` carries `_probe`: per-bar arrival, physics, the score's components (step,
   kit, dip, novelty, voice), the fill bars, the anacrusis guard's verdict on every move it was
   asked about, the phase walk's runs and the cuts it took, and the boundary table after every
   pass (`dp`, `refined`, `pins`, `sung`, `arranged`, `hooks`, `pulled`, `final`).
   `--tuning='{"hookSplit":true}'` reads any sweep variant in full. **A saved judgement is law
   in the app** (the analysis adopts the map), so the automatic reading is only visible here.
4. `node bench/mapdiff.ts <map> <analysis>` per track;
   `MV_CACHE_DIR=<cache> node bench/mapsweep.ts [--maps=<round>] [--variant=a,b] [--only=<id>]`
   for every map at once, any `StructureTuning` variant, hits to 0.6 s, misses signed in bars,
   regressions on the accepted rows, and the `extra` column: analysis boundaries no owner
   boundary sits near, which on an accepted row is a seam the owner never drew. A rule that
   gains hits by splitting shows there before it shows anywhere else. Corpus 2 needs
   `--maps=bench/judged/round-2026-09-08` against `cache-corpus2-2026-09-08`; corpus 1 the
   default maps against `cache-corpus1-2026-09-07`.
5. Read the `dp` stage against `refined` first, then the phase runs: on the second corpus the
   dominant fault was the grid, and every one of the owner's off-grid marks was the model's
   own downbeat.
6. Find the general cause across tracks, fix it, then every gate below.

## What ships in the analysis

- **Grid repair** (`movements.ts`, `repairGrid`): tempo regimes from a 16-beat median
  change-point; tracker level flips undone (2:1, 3:1; 3:2 and 4:3 only when phase-continuous
  within 40 ms); **a doubled regime is folded onto the half of its beats the model's downbeats
  sit on**, with one short beat at the seam that the dedup and the blip repair leave alone
  (Patky's chorus at 116.6 s sat half a beat off every bar line; FE!N's chorus stretch the
  same); chaotic edges up to 45 s and interior gaps up to 20 s written at the neighbouring
  song's period; a lead-in rewritten at the first song's period; short blips rewritten; a pause
  before a new song written as the incoming song's pickup; the handshake for a switch the
  tracker rode through. **Bars are never read in two**: a downbeat every two beats is the
  model hedging half bars on a slow record, and the meter folds it to four with the phase the
  four-beat downbeats favour.
- **The downbeat phase walk** (`downbeatPhase.ts`) now runs on every track. Its runs are judged
  by `acceptedRestarts`: the track opens on the first run with a majority (60%) over eight
  bars, else the first solid one; a later run changes the bar line only when it is solid (85%
  unanimous, six or more downbeats, eight bars, six to the end of the record, 0.7 downbeats a
  bar) or a body (60% over 32 bars), the run before did not already carry a quarter of the new
  residue, and a half-bar flip that later returns to the old residue is refused as the 2-bar
  loop heard from its other half. Every accepted restart is a grid cut. A seam the repair
  placed on a bar line gets a second cut at the walk's next line within a bar of it, so the
  pickup written across a pause is one short bar and the count runs from the model's downbeat
  (ROCKSTAR's second half was a beat early to its end). Under a hand-drawn map the walk's cuts
  are off: the map's off-grid boundaries already say where the grid is cut.
- **Movements** (`proposeSeams`, `judgeSeams`): unchanged this round.
- **Structure** (`structure.ts`, `arrange.ts`, `consolidate.ts`, `vocabulary.ts`): per-movement
  DP segmentation; **two DP boundaries two bars apart with a decisive physical arrival between
  them collapse onto it** (the straddle: Stranded's chorus at 17, sung and kicked, between 16
  and 18); `refineBoundaries` moves a boundary at most one bar onto an arrival that beats its
  own bar by 45% and clears 2, never onto a drum fill, and never off the local phrase grid
  without an impact (`offGridImpact`: the kit landing, a pattern break, a sung entrance after a
  collapse, the kit returning after a silent bar with the voice on it, **music rising out of
  the quiet floor with physics of 2.5 or more** (Panama's pad at 2.03 was not the build), or a
  non-periodic collapse); a boundary the guard held pins as a stay does. Moved arrivals >= 2
  and stays >= 2 are pinned; `rephaseToPins`; **the sung phase**: on a song-vocabulary track
  whose three or more sung hooks agree on one phrase residue and whose table mostly sits one
  bar before it, every such boundary moves onto the singer's bar unless the kit lands (four
  kicks after one or none, or three more) or leaves there (Best Part 2 -> 8 of 8); the phrase
  snap; vocabulary (club: drop/groove/breakdown/build; song: chorus/verse, promoted from the
  repeated lines, **and a loud verse that is the sung chorus's own material is promoted with
  it**, while a chorus whose sibling keeps its label on thinner evidence is not demoted); the
  strict hook snap under the same off-grid guard; `pullOntoReturn` and `pushOntoDeparture`,
  **the latter now moving a build the DP opened on a drum fill onto the bar the kit leaves**
  (SICKO MODE 47 -> 48; PROVENZA's build, which begins under the kit, keeps its bar); the
  early same-kind merge keeps pinned and held seams; consolidation merges same-kind seams
  nothing arrives on.
- **Levels**: the published tempo re-reads the beats at 2, 0.5, 1.5 etc. when the model's
  reading is a clean ratio off it; hip-hop, rnb, ballad, ambient and metal never double; the
  snare on two and four checks the catalogue's octave.
- **The kit**: the ADTOF drum model, snapped to onsets; the DSP detector only as fallback.
- **Trust** (`core/trust.ts`): the fragmentation gate, corroborated by a published tempo at
  the same level.
- `TrackAnalysis.heard` keeps the model's own beats and downbeats; benches start from it.

## What ships in the engine

- **Techno holds its looks** (`genre.ts` `holdLooks`, `plan.ts`): interior cues keep the
  section's bed and rhythm layer and move only the transient or the accent, every second cue;
  builds dim toward the drop instead of climbing (`buildDims`); the colour bump comes every
  four phrases, the flash budget is three; the signatures are impulseSpin, glitchScan, pump,
  subThrob and flexStrobe; moshSlam, headbang, stageBlinders and chorusBloom are avoided and
  the pop decorations and hue cycles (confetti, sparkle, emberStorm, crownSpill, discoBall,
  mirrorBall, rainbowRain, hueCarousel, gradientSpin, vocalGlow) are excluded outright, the
  first use of `exclude` by a family; the wildcard obeys the exclusions too. Drawn from the
  Berghain, Panorama Bar, Tresor and Awakenings lighting accounts researched on 2026-09-08:
  one hue or white, darkness as the bed, looks held across sections, the strobe as punctuation
  on the kick's return. Higher composes as one bed and one rhythm across every drop with the
  accent alternating; the owner has not heard it.
- **Hiphop and rnb avoid undertow and glitchScan**: Hovorili mi ze's last chorus lit by the
  club floor under the techno scanner read as "almost entirely blue Frame, nothing moves and
  it is very bright".
- A palette per song of a multi-song track; no cue past eight bars; a record with no kit
  takes the ballad's restraint; genre profiles; the kick-burst family drawn at most one per
  show; the 8 Hz strobe ceiling; hit budgets by kick density; the picker prices a band too
  quiet at 2.6 in drop-class passages and a foreign gesture at 4.4; consecutive breakdown cues
  inherit the bed.
- The owner's standing taste verdicts, not to be re-proposed: no whole-field displacement; no
  fill-and-drain wipes; no strobing accents in rap verses; buildStrobe only in a build's back
  half; the strobe before a drop is endorsed; outros keep their look and thin; endings anchor
  to the finish line; the pre-arrival breath dims and never strikes the set; the cue ceiling
  must not be brought down at slow tempos.

## Measured and rejected, do not re-propose

- **The hook split** (`hookSplit`, off): a sung block beginning eight bars into a chorus or
  verse of twelve bars or more splits it. Thinkin Bout You +2 and goosebumps +1, against seven
  seams the owner never drew on four accepted corpus-1 tables (Hannah Montana three, Je mi fajn
  two, Safir, Do I Wanna Know?) and four more on Le Freak and Az na mesic, accepted in corpus
  2. Measurable as the `hooksplit` variant; read the `extra` column.
- The phase walk's opening rule without the body tier: a 15-bar solid intro held its phase
  over Lose Yourself's 100-bar body at 83% and put every boundary a beat late.
- Solid runs without the density floor: Safir's outro carried 11 downbeats over 16 bars on a
  new residue and re-barring it a beat later lost the owner's accepted outro to the DP.
- The straddle on the full arrival score: a sung line in the middle of goosebumps' two-bar
  breakdown collapsed the breakdown; physics only.
- The sung phase with any kick after none as a landing: Best Part's drummer plays one pickup
  kick before the last chorus.
- The unrestricted downbeat phase walk (5 worse on the phasegrid targets); the walk now runs
  under `acceptedRestarts` instead.
- A key change as the only witness of a seam; raw chroma cosine; per-track chroma thresholds
  fitted on two tracks; "a pause is quiet"; the median interval as the lead-in test; the last
  bar line as the seam whatever the gap.
- Against the 19 maps of 2026-09-07: the settling term at 0.8 and 1.2, ungated at 1.2 and
  1.6; a bass-landing term at 1 and 2; the refine margin at 1.2; a kit minimum of 2 or 3; an
  arrival split inside long segments. Against the 27 maps of the evening of 2026-09-07: lambda
  1.6 and 2.2; stayPinScore 3; hookSnapReach 1; the anacrusis guard with "the kit returns after
  one silent bar" as an impact, with a single-bar quiet floor, or with the quiet floor by rank
  alone; refusing the fill veto's bar a stay pin.
- The MusicFM section-label head (P6): built, A/B'd, judged worse, rolled back. If a learned
  labeller is reopened, SongFormer (MuQ + MusicFM, HR.5F 0.696 on Harmonix) is the 2026
  reference, and every annotation convention on record places a section on the downbeat that
  begins the phrase, never on the fill or pickup, which is the owner's convention too.
- A `MASTER` dimmer at 0.7; tuning `GAMMA` to make the effects calibration test green.

## Gates, with the current floors

Run all of these before any handover. `mapsweep`, `phasegrid` and `structscore` load the
analysis code once per process and run the variants inside it, so an edit to
`packages/analysis` or `core` while one is running does not touch that process; but a script
that runs two of them in sequence loads the code again for the second, and an edit between the
two contaminates it. Land edits between runs.

1. `npm test`: **968 green** with the one known failure (`effects.test.ts`, "every effect
   claiming to carry a room can actually fill one", the calibration). Two tests
   (`measure.test.ts`'s void bars and `ambient.test.ts`'s scenes) time out at 60 s only when
   several benches share the machine; run the suite on a quiet one. `npm run check` clean.
2. `MV_CACHE_DIR=<corpus-2 cache> node bench/mapsweep.ts --maps=bench/judged/round-2026-09-08 --variant=current`:
   **301 of 318**, extra 0 on accepted rows, 0 regressions; and
   `MV_CACHE_DIR=<corpus-1 cache> node bench/mapsweep.ts --variant=current`: **158 of 180**,
   the one accepted-row loss being SICKO MODE's superseded build. The variant
   `before-2026-09-08` is this round's structure starting point (the grid work has no variant;
   measure it by running the sweep on the previous commit).
3. `MV_CACHE_DIR=<archive> node bench/phasegrid.ts`: **27 same / 1 worse of 28**. The worse
   row is Titi Me Pregunto's last chorus, a boundary the analysis missed by 4.6 s on both
   sides that the coda's re-bar (43 of 44 downbeats on the new residue) moves a beat further:
   the instrument converts the target bar through the A-side grid, so a re-barred tail scores
   against itself. Two of its sentinels disagree with the owner's newest maps (Le Freak 45,
   the owner draws 48; Killing In the Name 49).
4. `node bench/structscore.ts --dataset harmonix|raveform --limit 60`: Harmonix F0.5 0.208,
   F3 0.535, label 9.9%, sections 10.9 against 10.1 annotated (before this round 0.210 /
   0.541 / 11.2, within the noise the grid work was always going to cost a corpus with no
   published tempo or lyrics); Raveform F0.5 **0.469**, F3 **0.574**, label 36.1%, sections
   17.6 against 9.4 (before 0.422 / 0.537 / 19.3: the fold parity and the strict walk on
   records whose downbeats the model hedges). Read F0.5/F3/sections; the label column is blind
   to same-kind merges.
5. `node bench/movements.ts --set=multisong|app|harmonix|raveform`: multi-song **10 hit / 12
   missed of 22, one false** (known misses: A-B-A rock, Know Yourself, Sing About Me,
   Paranoid's first and third, Suburbia's first and third; the false one is the Stairway
   cover's real tempo change); Harmonix Five Magics only, four splits; Raveform 0 of 60; the
   library (`--set=app` on the archive) **4 of 4 with no false seam**, six tracks given a
   movement. Unchanged by this round.
6. `MV_CACHE_DIR=<cache> node bench/lintsweep.ts`: **0 rejected** (65 clean on the corpus-3
   cache, 18 buttons placed). The app fails dark on a lint error.
7. Versions: any analyser change bumps `ANALYSIS_VERSION`, any composition change bumps
   `SHOW_VERSION`, in the same change.
8. Build: `npm run bundle -w @mv/desktop`, then `npx tauri build --bundles app` from
   `apps/desktop` (~3 min), then the install ritual above.

## Start here next session

1. Read this file and `CLAUDE.md`, then the analyser stack in order (`core/contracts/analysis.ts`,
   `analysis/analyze.ts`, `movements.ts`, `downbeatPhase.ts`, `structure.ts`, `arrange.ts`,
   `vocabulary.ts`, `consolidate.ts`, `ingest.ts`) and the engine (`author-engine/plan.ts`,
   `genre.ts`, `select.ts`), then the instruments (`bench/movementprobe.ts`, `mapdiff.ts`,
   `mapsweep.ts`).
2. This round is committed in three commits (analysis, engine, docs) on top of `0266ffc`;
   `git log -4` names them. Never touch `apps/controller/`, `firmware/` or
   `docs/frame-wiring.md`, which are the owner's and sit uncommitted in the working tree; commit
   only when asked, staging explicit paths.
3. The owner's judge files land in `cache/judge/`. Freeze them into `bench/judged/round-<date>/`
   by the rule in the review loop (a judgement with no section edit is frozen from the v30
   analysis with `acceptedAnalysis`), then `movementprobe --no-hand-maps --no-marks --out`,
   `mapdiff`, and `mapsweep --maps=<round>` on the live cache. Report by fault class across
   tracks before proposing a fix; a fix is a guard or a rule measured on every map and gate.
4. The floors are in the gates section. The sweep's `extra` column is the phantom-split gate;
   a rule that gains hits by splitting accepted tables is a loss.
5. **The owner's next steps, in their words**: the AI-authoring part; code cleanups without
   changing anything functionally; and the brightness of the effects, which is "way too high
   for some, the LEDs are powerful". The brightness is a look call of theirs: ship the level
   they ask for and report what the calibration tests say as room consequences (`GAMMA` and
   the effects calibration test are settled decisions, not dials to tune green).

## House rules that bite

- The owner works in the same tree. `firmware/`, `hardware/`, `packages/preview3d/`,
  `apps/controller/`, `packages/core/src/output.ts` and `geometry.ts`, `docs/FIRMWARE.md` and
  the wiring docs (`docs/frame-wiring.md` is untracked and theirs) are theirs; commit only your
  own paths, and only when asked.
- No em-dashes anywhere. Comments say why. Stage explicit paths. No co-author trailer.
- Aesthetic calls beat tests: ship the look the owner asked for and report what broke as room
  consequences.
