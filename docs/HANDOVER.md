# Handover

The current state of LightningStrike's analysis and show engine, as of the evening of
2026-09-08. This is the one document: what runs, where it stands against the owner's
judgements, how the review loop works, what was measured and rejected, and how to gate a
change. `README.md` says what the product is; `CLAUDE.md` holds the house rules. The narrative
round records that used to sit beside this file were removed on 2026-09-07 and live in git
history.

Versions: **ANALYSIS 30 / SHOW 28 / CONTEXT 3.** The 2026-09-08 round is committed (the
evening-of-09-07 round at `0266ffc`, this one in the three commits after it). The three
effects rounds of 2026-09-09 (the level round at SHOW 26, the taste round at SHOW 27 and the
polish round at SHOW 28, all below), the hit floor, the trust line and the queue fix are one
commit on top of the owner's `25fd255`, made at the owner's word after they judged the SHOW
27 build side by side in the room ("definitely better") and heard the polish round. The
installed app is that commit, on the corpus-3 queue re-initialised from `corpus.json` the
same evening.

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
  after a launch is that `queue.json` still lists exactly the corpus. Half of that trap was
  the store itself: until the SHOW 28 commit it forgot every row that had played more than
  thirty rows before the current one, so a corpus of 65 lost its head as the owner played through
  it ("songs get removed when there are more than 32"). Nothing removes a row now but a
  person. The queue is re-initialised by writing `queue.json` (items in `QueueItem` shape,
  status `pending`, `currentKey` null) from `corpus.json` and the metas while the app is
  quit; the store re-derives genre and the trust verdict from the cache on load and the
  runner re-composes each pending row. **The stale-context
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
  mirrorBall, hueCarousel, vocalGlow) are excluded outright, the
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
  show; the 6 Hz strobe ceiling; hit budgets by kick density; the picker prices a band too
  quiet at 2.6 in drop-class passages and a foreign gesture at 4.4; consecutive breakdown cues
  inherit the bed.
- The owner's standing taste verdicts, not to be re-proposed: no whole-field displacement; no
  fill-and-drain wipes; no strobing accents in rap verses; buildStrobe only in a build's back
  half; the strobe before a drop is endorsed; outros keep their look and thin; endings anchor
  to the finish line; the pre-arrival breath dims and never strikes the set; the cue ceiling
  must not be brought down at slow tempos.

## The effects round of 2026-09-09 (SHOW 26)

The owner's four complaints, all measured before anything moved: some effects far brighter
than others so the room jumped between interior cues of one section; the peak lit by soft
looks; vortex in 64 of 65 shows; strobes too long and slams too quick, and buildStrobe
unpleasant. Two harnesses were written for it and stay in `bench/`:

- `bench/effectlevel.ts` renders every effect alone through the real output chain at its
  role's opacity and the engine's section intensity, and reports per section the additive
  authoring-domain level (`auth`, the number the four layers ADD before gamma), the delivered
  mean byte, the brightest the room mean gets (`strike`), fill, on-time, punch and ripple.
- `bench/effectusage.ts [--measure]` composes the whole cache and tallies which effects hold
  which sections, what lights the peak, how strobes and slams are sized; with `--measure` it
  plays every show and reports the delivered level per section class and the jump between
  consecutive cues of one section at the same intensity, naming the stacks.

What the measurement said: the rhythm layer alone spanned 3 to 129 mean bytes in a drop
(gradientSpin 129, vuTowers 95, vortex 71 against chase 3, glitchScan 14); silhouette held the
ring at a mean of 141 for eight bars so its kick push had nowhere to go; stageBlinders slammed
the whole room to full on every beat of every drop in 51 shows; lightning (energy 5, in 56
shows) delivered a mean of one byte and snareBlade zero, and one of them was the peak's
transient in 24 of 65 shows; for hiphop and pop the top-band rhythm pool after the avoid lists
was pump and vortex. Consecutive same-section cues differed by a median of 41 bytes, p90 114.

What shipped:

- **One ladder, set in the additive domain.** The mixer sums the layers before gamma, so
  four layers that each look moderate alone add past white. Beds sit near 0.4 `auth` (they
  have to, to pass the carry test alone), sustained rhythms near 0.22, transients and accents
  at rest under 0.15 with their events to white. Every effect's gain moved; chorusBloom's
  per-phrase climb is capped (it reached 2.0 by the last phrase of a real chorus and was the
  brightest thing in every stack it joined). Result over the corpus: consecutive-cue jump
  median 41 -> 14 bytes, p90 114 -> 48; drops p10/median/p90 68/123/186 -> 52/84/124,
  intros 32 -> 28, grooves 58 -> 46 (then the groove intensity was raised a step, 0.68 ->
  0.72, verse 0.64 -> 0.68, so a groove reads above an intro).
- **Hits.** `slam` holds white for a tenth of a second and cools through the accent over two
  beats (it was 95% gone inside a beat). The strobe hit is two beats into an ordinary drop and
  a bar into the peak, ending on the downbeat, capped at 1.5 s (`HIT_RULES.strobe` is a bar
  and 2 s for an agent); each flash holds at full and reaches white; the alternating wall
  pairs stay, at the owner's word. Median strobe 1.96 s -> 1.08 s.
- **The peak** draws only from its band and the one under it, and pays half the novelty
  price for a repeat (`PickRequest.peak`, every cue of the peak section). snareBlade is
  mirrored on the opposite wall with the wall lit under the stroke; chromaBurst strikes the
  room white before its shells, which are thick now; rippleTank and clapAlong are energy 4
  (measured among the hardest-hitting transients), so the peak's transient pool is five
  looks rather than two. lightning was rebuilt to strike a whole wall, then removed on the
  owner's review ("I don't like the lightning effect"); heartbeat went with it, "often out
  of place" - a once-a-bar double pulse is a half-time device fired on every track, and a
  kit-locked version would only duplicate the radial kick looks.
- **Vortex** has arms, direction, twist and speed drawn per cue (`VARIETY` in plan.ts, a
  seed-stable hash per cue kept off the picker's stream; chase, impulseSpin, sweep,
  hueCarousel, pixelRain, pump and the new looks draw too), and three new rhythm looks share
  its band: `blockChase` (the four walls struck in turn, beam on the one), `snapSplit` (the
  ring clenches into the corners on the kick), and `twoTone` as a fourth loud bed (long walls
  base, short walls third, swapping every phrase). `backbeatBloom` (snare, short walls open
  from the middle) joins stageBlinders and crownSpill (now legal in drops) as a top-band
  accent. Drop rhythm share: pump 28%/vortex 19% -> eight effects between 5% and 18%.
- **stageBlinders** strikes on kit hits rather than the grid: the downbeat hit at full, hard
  off-beat hits answered at `answer` (0.35), dark between. **buildStrobe** is rewritten: hard
  40 ms flashes on a ladder of half notes to sixteenths in the back half of the build, the
  long walls first, then alternating pairs, the beam joining, the whole frame last; emitted
  past one so the last flashes arrive white through the accent's budget. Its whole-room rung
  keeps climbing where the rate is capped by `STROBE_MAX_HZ`.
- **Removed**, with the owner's agreement: weave, hatTicker, peakDot, conveyorGlow (invisible
  on this frame), gradientSpin (a flat palette wall; hueCarousel is the same idea), rainbowRain
  (pixelRain with a hue walk). bandBloom and harmonicRibbon no longer list the drop: they are
  sustained fields written to carry a two-layer cue.
- `SHOW_VERSION` 26. The effects calibration test is green again; `taste.quiet` was
  re-probed (`bench/quietprobe.ts --limit 6` on the corpus-3 cache) and pasted back.

**The owner's first review (2026-09-09, on the installed build): "really good overall",
but the effects "maybe a bit too aggressive", the strobe and bump too aggressive ("I loved
the strobe's intensity before better, I just wanted it slightly more"), and the bump/slam
"very weird".** What answered it, and the verdicts it fixed:

- The strobe is back to the shape the owner liked: each flash decays from its first frame
  (`pow(1 - phase / 0.6, 1.4)`) rather than holding a white square, at 0.85 of the old level's
  0.7. Wall pairs alternate, as before. The held full-white flash is off the table.
- The slam is the old slam with a 60 ms hold at white and an exponential tail (time constant
  a third of `beats`, default 1.4), cooling white to accent only. The two-beat version that
  went on walking from the accent down to the base was the "very weird": after every drop the
  whole room slid through a colour change, which reads as a scene change, not a hit. A slam
  never visits the base.
- The colour bump is exactly what it was (no hold, exponential over 0.9 beat): it was never
  complained about, and the hold made it a second slam.
- The aggressive edge came off the hardest new gestures: stageBlinders answers off-beat hits
  at 0.25 instead of 0.35 with a third-of-a-beat tail; buildStrobe's flashes have a 60 ms
  tail and start at 1.6 emit. lightning was softened first and then removed outright, and
  heartbeat with it (second review).

## The taste round of 2026-09-09 (SHOW 27)

The owner's review of the SHOW 26 build: the effects "too aggressive (tune it slightly)",
"sometimes everything is way too flickery (when many flickery effects are stacked)", and the
strobe "sometimes way too quick"; drops and choruses first, grooves and verses too, "depends
on the song". Their answers to the three taste questions, not to be re-asked: the strobe
ceiling is 6 Hz; one hard hitter per cue, tried first, with the two-hitter setting kept here
in case one reads too polite; measure everything thoroughly.

What the measurement said (`bench/effectusage.ts --measure` now reports per-pixel shimmer,
the busiest cues by stack, and which effects sit in them; `bench/effectlevel.ts` has a `shim`
column): the busiest cues of the corpus were three layers all striking on the same kick,
each defensible alone - a unison slam under a half-room gatling under a snare bloom (Duality),
blockChase under rippleTank under crownSpill (As It Was). Drop cues shimmered at a median of
12.1 bytes, p90 18.6; 40 of 98 strobes ran between 6 and 8 Hz. The research pass (Williams,
Sinclair, the Eos and MA busking conventions, ITU-R BT.1702, IEEE 1789, the tungsten
cooling measurements) agrees on the structure: one hit layer over a stable base, every
running effect on one clock, releases of 200 to 300 ms to read as a lamp, and 8 to 10 Hz is
where the eye's flicker sensitivity peaks and a flashing room reads brightest.

What shipped:

- **`taste.activity`** on every effect, 0 to 1: how much of the room's light moves at frame
  scale. Whole-room strikers 1 (moshSlam, stageBlinders, doubleKickGatling, buildStrobe,
  shutterCut), partial strikes 0.5 to 0.7 (a wall per beat, a wave per kick), twinkles and
  hard-edged patterns 0.3 to 0.5, smooth motion 0.2 to 0.3, fields 0. Rated by hand from the
  gesture, because a per-pixel metric cannot tell a chase from a flicker (impulseSpin and
  stopTime measure as busy as a gatling; they are rotations).
- **The activity budget** (`activityBudget` in `select.ts`, `ACTIVITY_FLOOR` 0.8,
  `ACTIVITY_LOUD_TOP` 1.4 for drop-class and builds, `ACTIVITY_GROOVE_TOP` 0.9 for grooves,
  verses and breakdowns, scaled by energy from 0.3 to 0.75). The planner sums what the cue
  already holds (`busy`, held and inherited layers included, the peak master only when its
  burst is the whole section) and the picker filters to what still fits, keeping the calmest
  candidates rather than the whole pool when nothing does. So a drop holds one whole-room
  striker and a moving look, or two partial strikers, and the accent then holds or blooms; a
  groove or verse never holds a whole-room striker. **To allow two hard hitters, set
  `ACTIVITY_LOUD_TOP` to 2.4** (and `ACTIVITY_GROOVE_TOP` to 1.4 for one in a groove).
- **Who leads.** The transient and the accent share the budget, so whichever is picked
  first is the hit layer. Fixed transient-first, the blinders never lit a rock chorus again
  and drop accents collapsed onto vocalGlow and pitchRibbon; fixed accent-first, the
  transient collapsed onto subSwell in 41% of drops. Now the floor decides (`KIT_LEADS`, 0.6
  kicks a beat): a kick-driven passage leads with the kit answer, a sung one with the phrase
  gesture. Drop accents: crownSpill 24%, vocalGlow 19%, backbeatBloom 14%, pitchRibbon 14%,
  emberStorm 9%, confetti 8%, stageBlinders 6%; transients snareBlade 22%, clapAlong 19%,
  rippleTank 19%, subSwell 11%.
- **The strobe ceiling** `STROBE_MAX_HZ` 8 -> 6: sixteenths to 90 bpm, eighths to 180.
  buildStrobe's ladder reads the same constant. The linter's rule and test moved with it.
- **Softened, slightly:** stageBlinders' tail a third to half a beat (a 500 to 1000 W lamp
  takes 200 to 300 ms to go dark) and its emit 0.9+1.2i -> 0.8+1.1i; blockChase's cool-down
  0.4 -> 0.5 beat, striking on the half bar past 150 bpm (a wall per beat at 174 is a 3 Hz
  flicker); doubleKickGatling's rounds 0.48 -> 0.6 beat at 0.5+1.2i; backbeatBloom
  1.2+1.8i -> 1.0+1.6i; crownSpill's wall spill at three quarters of the crown and 0.85 beat
  (it struck the whole ring white once a bar in 136 cues); glitchScan on the eighth grid by
  default with a `perBeat` param the hats rule raises to sixteenths, two or three segments a
  step, tail 0.32 -> 0.4 beat.
- **Tried and reverted:** longer trails on kickTunnel, kickCannon and shockwave - they add
  their rings into a decaying buffer every frame, so a longer trail integrated into a
  brighter, busier room (kickTunnel mean 24 -> 34, shimmer 22 -> 26), not a softer one.
  Charging the peak master's activity to the cue after the burst (whose layers the burst
  borrows) starved the peak: subSwell in 42 of 74 peaks.
- **The linter** warns `busy-stack` when an authored cue's layers (master excluded) exceed
  the budget by more than the engine's own calm fallback could add (0.3); the engine's 74
  shows raise none. The AI catalog tags effects HARD (activity >= 0.8) and STRIKE (>= 0.5)
  and the prompt states the rule. `bench/lintsweep.ts` now tallies warnings by rule.
- **`bench/stripchart.ts`**, the way to SEE a passage: a PNG with one column per frame and
  one row per LED (strips separated), the room mean, the per-pixel shimmer and the grid
  (downbeats, kicks, snares, cue changes, hits) under it. `node bench/stripchart.ts <title>
  --list` prints the sections, cues and stacks; `--at BAR --bars N` charts a passage; `--stack
  "b:wash r:vortex t:kickTunnel"` substitutes layers; `--effect vortex` charts one effect over
  the gate journey. Read the PNG with the image viewer. A flash is a vertical line, a chase a
  diagonal, a twinkle grain, a hold a flat band; the mean trace's sawtooth is a per-bar
  gesture and the shimmer trace's comb is a per-kick one.
- `SHOW_VERSION` 27. 961 tests green, 74 lint-clean.

Result over corpus 3: drop shimmer median 12.1 -> 10.6, p90 18.6 -> 16.1; grooves 4.4 -> 4.0,
p90 9.5 -> 8.1; builds p90 9.0 -> 8.1; delivered levels unchanged (drop 79, peak 105, groove
48); the busiest cue 27.6 -> 25.9 and it is impulseSpin + kickTunnel, a rotation under rings.
Same-section jumps median 13.7 -> 14.6, p90 43.5 -> 45.8, within a byte or two of where the
level round left them: the calm accents a spent budget falls to are steady fields where the
strikers they replace are events, and a steady field adds more mean light, so vocalGlow now
yields to a loud passage (its gain scaled by 1 - 0.35 x the passage's energy; drop mean 30 ->
13 bytes) and the jumps came back down from a median of 16.

**The owner's verdict** (2026-09-09, in the room, side by side with the build before both
rounds): "definitely better", and "I will have to tune it more and further" by hand in a
later session. So the next session does not start another effects pass unprompted; when the
owner asks for help with one, it first reads `git status` and `git diff --stat` for their own
edits under `packages/core/src/effects`, `plan.ts` and `select.ts`, asks what they changed and
what they heard, and measures (`effectlevel`, `effectusage --measure`, a stripchart of the
passage) before moving anything. The knobs are in the table below.

## The polish round of 2026-09-09 (SHOW 28)

The owner's notes on the SHOW 27 build, which they had not yet tuned by hand: the effects
"a little too aggressive"; rippleTank "WAY TOO NOISY (find and fix similar effects)"; the
breakdowns carrying "almost 0 effects energy (should be higher, but still CALM)". Their
answers before anything moved, not to be re-asked: the noise is fine crossing ripples
everywhere and too many drops; the aggression is the kick and snare transients, "there
might be more", tune it all and "SURPRISE ME"; breakdowns get a slow moving layer, not a
level lift.

What the measurement said, on the 78-track cache: rippleTank alone drew a lattice of
crossing crests, because every kick, snare and hat dropped a one-to-three-pixel stone into a
dispersive stencil and each stone broke into a train of short ripples that crossed for a
second; it sat in 110 cues at +2.5 shimmer over its section median. Breakdowns delivered a
healthy 43 bytes and a shimmer of 0.9 against a groove's 4.0 and an intro's 0.7: a bed and
one still field, never a moving layer. The transient role punched 220 to 240 bytes (a pixel
from dark to near white inside 120 ms of every kick) with tails of an eighth to a quarter of
a beat: shutters, not lamps.

What shipped:

- **rippleTank rebuilt.** The lattice steps exactly one pixel per step (`next = l + r -
  prev`), the one setting where a bump travels without dispersing; speed is the step rate
  (a tenth of the ring per beat at `spread` 0.5), the decay scales both frames together so
  a crest keeps its shape, and a stone is a raised cosine written into both frames - a stone
  at rest; written into one frame it is a stone thrown up, and the velocity integrates into a
  lit plateau that spreads until the ring glows. Kicks land at the corners forty pixels
  wide, snares at the wall centres, the hats drop nothing, one stone per third of a beat,
  and a soft kick stops in the bright read where only an accented one reaches white. Alone
  in a drop: mean 12 -> 7 bytes, shimmer 10.7 -> 7.1; the Windows98 drop stack it sits in
  (undertow, pump, rippleTank, crownSpill, silhouette) 113 -> 96 mean and 23.4 -> 19.1
  shimmer with the same layers.
- **The transient role softened to lamps.** Every kick and snare answer keeps its attack
  and loses the blinding peak and the snap-off: snareBlade's blade at 1.0 rather than 1.4
  over a wider stroke living a beat and a quarter; clapAlong's hands seven pixels wide with a
  half-beat release; splash, snareWhip, beamFlick, kitStage, ricochet, kickTunnel, shockwave,
  kickCannon and backbeatBloom at lower gains and wider stamps. doubleKickGatling and
  moshSlam cool in ONE colour family: their cut from white to the base at a threshold was a
  second flash, in colour, on the way down from every round. pyroBursts' flame is a noise
  field read along the column, not a phase per pixel. Drop punches are 90 to 235 where the
  gate's full-strength kicks land, and a real kick at kickEnv 0.7 stops well short of white.
- **Grain removed.** Every pixel-scale hot point is a soft dot now: pixelRain's droplets,
  sparkle, confetti, flexStrobe, emberStorm, mirrorBall and vuTowers' peak dots at 1.5 to
  2.6 px of sigma, with their gains cut to match - a wider stamp carries more light, and at
  the first try pixelRain went 42 -> 47 bytes before it landed at 20. chase and glitchScan
  crossfade three or four pixels at every seam. crownSpill's beam glitter re-rolls per bar
  and answers the snare rather than the hats. impulseSpin's crest never sharpens past a
  third power.
- **Breakdowns move.** `activityBudget` returns a flat `ACTIVITY_BREAKDOWN` (0.5) for a
  breakdown, half a groove's, and the planner picks a rhythm look under it before the accent
  (inherited through a run of breakdown cues with the bed): a roll, a sweep, a comet or a
  slow chase, never a striker, and the kit answer where the kit still plays is a bloom. The
  linter's `busy-stack` rule reads the same function and the AI prompt states the grammar.
  `select.test.ts` pins both halves.
- kickTunnel is rated `activity` 0.85: a ring converging on the centre crosses every strip at
  the same depth at the same moment. `SHOW_VERSION` 28.
- The frame-rate test in `measure.test.ts` now pins the opposite of what it did: with every
  strike holding past a frame and leaving like a lamp, a flickering cue reads within two
  bytes at 30 fps of what it reads at 60. The old assertion ("dimmer at 30") was pinning the
  catalog's sub-frame flashes.
- **Hits are floored against the cue's dimmer** (the owner, on the SHOW 28 build: "strobes
  sometimes still feel kinda dim", Rock That Body's first one; "make sure they are NOT TOO
  BRIGHT on the other side"). The strobe that announces a drop sits inside the breath bar
  the planner has just dimmed to six tenths of the passage, so it rendered at 0.31 to 0.47
  and reached byte 22 where a build's strobe reached 150; 28 of the corpus's 108 strobes sat
  there. The mixer now blends the additive master AFTER the cue scale at
  `max(intensity, HIT_INTENSITY_FLOOR)` (0.68, a build cue's level), so a hit out of a
  hollow or a dimming build arrives at a build's level and every hit above it is byte for
  byte what it was. The blackout moved from multiplying the cue intensity to `Mixer.dim`,
  a cut over everything the floor cannot lift; `mixer.test.ts` pins all four cases.

- **The fragmentation line moved 5.2 -> 5.4 sections a minute** (`FRAGMENTED` in `trust.ts`),
  on the owner's word that cool (Grey256) is "correctly mapped out": 16 sections in 180 s at
  160 bpm, 4/4 at meter confidence 1.00, every boundary on the 4-bar grid, refused at 5.33
  because the rate is counted in wall-clock minutes and a fast track cuts more bars into one.
  The calibration's broken end starts at 5.5, and nothing else in either cache sits between
  the two lines: Take Me stays in lounge at 6.4 with a table that earns it. Scaling the rate
  by the analysed tempo was refused because a wrong-level grid reports a wrong tempo. The
  verdict is stored in the meta at ingest, so a gate change needs `bench/reanalyse.ts` to
  refresh it (it did, for cool) and the queue row follows on the next launch.

Result over the 78-track cache (`effectusage --measure`, before -> after): drop shimmer median
10.7 -> 9.7, p90 16.2 -> 15.1; grooves 4.0 -> 3.4, p90 8.1 -> 7.3; builds 4.1 -> 3.5;
breakdowns 0.9 -> 1.6 (p90 1.8 -> 3.4), still under half a groove; the busiest cue 25.9 ->
23.9. Delivered levels: drop 79 -> 76, peak 104 -> 105, groove 48 -> 45, breakdown 43 -> 51,
intro and outro unchanged. Same-section jumps median 14.4 -> 14.9, p90 43.6 -> 47.3, within
the noise of the level round; the largest pairs are a three-layer cue handing to a four-layer
one, which is the planner's accent rule and not a level. Drop transients: clapAlong 21%,
rippleTank 20%, snareBlade 19%, subSwell 11%. 78 shows lint-clean, no `busy-stack` warning.

Watch next: whether the softened transients read too polite on a pounding house track (their
gains are one line each, listed above); whether a breakdown's moving layer reads as a
breakdown or as a groove (`ACTIVITY_BREAKDOWN` down to 0.35 keeps it to rolls and sweeps);
whether rippleTank's crests read from the floor at slow tempos, where a tenth of the ring per
beat is a slow wave; whether the one-family cooling on gatling and moshSlam still reads as
gunfire in metal.

## Effects tuning know-how

The method for any further pass, so the loop is a measurement and not an argument.

**Where a level lives.** The mixer sums the four layers in the authoring domain (bed 0.45,
rhythm 0.8, transient 0.95, accent 0.55, master 1) and multiplies by the cue's intensity and
a 1.4 headroom BEFORE gamma 2.45. So layers ADD linearly in `auth` and the room sees the sum
through a steep curve: a sum of 0.5 is byte 60, 0.7 is byte 105, 0.85 is white. Four layers
at "moderate" alone are a white room. Judge a stack, never one effect, and judge in `auth`.

**The ladder the catalog sits on now** (`bench/effectlevel.ts`, drop column, `auth`): beds
0.36 to 0.44 (they cannot go lower and still pass the carry test alone), sustained rhythms
0.17 to 0.29 (pump, emberBump and lean are constant-output designs at the top of that),
event rhythms under 0.25 with strikes over 200 bytes, transients under 0.2 at rest, accents
under 0.22 at rest, held masters (silhouette, tideBloom) about 0.4. A four-layer drop stack
then sums to about 0.7, a three-layer one to 0.5, which is the remaining structural jump:
the first statement of a returning chorus holds its accent back on purpose.

**The instruments.**

- `node bench/effectlevel.ts [ids] [--raw]`: every effect alone, at its role's opacity and
  the engine's section intensity, over the gate journey and the quiet journey. Read `auth`
  for the sum, `mean` for what it delivers, `strike` for the brightest the room mean gets
  when an event fires, `punch` for how far a pixel moves on a kick, `ripple` for whole-room
  flicker. Two traps: the gate's build reaches `buildProgress` 0.8 only (the void takes the
  rest), so a build effect's last rung never shows in the build column; and the script has
  one snare a bar, so snare effects read at half their real duty.
- `node bench/effectusage.ts [cache] [--measure] [--limit N]`: composes the whole cache and
  tallies who holds what, the peak's stack, strobe and slam lengths; `--measure` plays every
  show at 30 fps and prints the delivered level per section class and the jump between
  consecutive same-section cues at the same intensity, naming the stacks and the layer that
  changed. Four minutes for corpus 3. The blame table is not causal (every changed layer on
  the bright side is charged); read the pairs.
- `bench/punchprobe.ts` and `bench/quietprobe.ts` as before; the quiet numbers only matter as
  an order within a bare pool.
- `node bench/stripchart.ts <title> [--at BAR] [--bars N] [--list] [--stack ...] [--effect id]`
  draws a passage (SHOW 27 section above). Judge a stack by eye there before and after a
  change; the numbers cannot tell a rotation from a flicker.

**The knobs, by complaint.**

| the room says | turn |
|---|---|
| too bright or too dark overall in a section | `intensityFor` in `plan.ts` (drop 0.9, chorus 0.86, groove 0.72, verse 0.68, intro 0.46) |
| one effect brighter than its peers | its gain line; aim at the ladder's `auth` band for its role |
| jumps inside a section | `effectusage --measure`, read the pairs; the offender is whichever layer sits above its band |
| hits do not read | the rest levels are too high, not the hit too low; a hit already reaches white |
| a strobe too long or too short | `STROBE_BEATS` / `PEAK_STROBE_BEATS` / `STROBE_MAX_S` in `plan.ts`; the linter's own cap is `HIT_RULES.strobe` |
| a strobe too hard or too soft | `strobe.ts`: the flash curve and the 0.5 + 0.5i level; never a held square |
| a slam too quick or too weird | `slam.ts`: `HOLD_SECONDS`, the `beats` default; white to accent only |
| blinders too busy | `stageBlinders` `answer` (0.25) and the refractory (0.34 beat) |
| the peak is soft | `PickRequest.peak` in `select.ts` (band floor, half novelty); the burst-stub rule in `buildSlots` |
| one effect everywhere | its genre `avoid`/`exclude` rows, or a sibling at the same energy (a lone effect in a band wins by fit, a weight cannot move it) |
| a look never varies | `VARIETY` in `plan.ts`, one draw per cue off the seed |
| everything flickers, several layers strike at once | `taste.activity` on the effects and `ACTIVITY_LOUD_TOP` / `ACTIVITY_GROOVE_TOP` in `select.ts`; 2.4 allows two hitters |
| a groove or verse hits too hard | `ACTIVITY_GROOVE_TOP` (0.9 keeps whole-room strikers out) |
| the wrong layer is the hit layer | `KIT_LEADS` in `plan.ts`: above it the transient picks first, below it the accent |
| a strobe too fast | `STROBE_MAX_HZ` in `show.ts` (6); the strobe and buildStrobe both read it |
| a hit snaps off too hard | its tail: half a beat reads as a lamp (stageBlinders), never a longer trail on a ring effect |
| an effect reads as grain or noise | widen its stamps to 1.5 to 2.5 px of sigma AND cut its gain (a wider stamp carries more light); a per-pixel phase becomes a noise field read along the strip; a wave lattice runs at one pixel per step, speed in the step rate |
| a transient blinds on every kick | its peak: scale the strike by the kick envelope so a soft kick stops in `glow` and only an accented one reaches `white`; cool in one colour family, never a threshold cut to the base |
| a breakdown looks dead | `ACTIVITY_BREAKDOWN` in `select.ts` (0.5, half a groove) and the rhythm pick in the breakdown case of `plan.ts` |
| a strobe or slam reads dim in one place and right in another | where it sits: a hit inside the breath bar or a dimming build was scaled by that cue's intensity; `HIT_INTENSITY_FLOOR` in `mixer.ts` (0.68, a build's level) is the least a master renders at, and nothing above it moves |

**Verdicts that stand** (the owner's, in the room): strobe pairs alternate; the strobe decays
per flash, at the old level plus a step; **a hit is one colour and only its level moves** (the
slam fades in white, blinderWall and shutterCut fade in place instead of settling into the
base, silhouette's kick push is a touch of white rather than a walk to it, stageBlinders cool
white to glow and never to the third hue - "the slam should not cycle between the colors",
said after the white-to-accent version); the bump is a flood with no hold, and it is the one
punctuation that IS a colour, the accent; blinders answer the kit, not the grid; drops
are dimmer at rest than they were so the hits own white; the eight removals (the six of the
level pass, then lightning and heartbeat) stay removed; the strobe ceiling is 6 Hz; one hard
hitter per cue and none in a groove or verse, the two-hitter setting documented above for the
case one reads too polite.

Watch next: whether one hitter reads too polite anywhere (the two-hitter setting is one
constant); whether a groove with no whole-room striker still reads as driving on a pounding
house track; whether vocalGlow or pitchRibbon as the calm accent of a drop reads as a layer
or as filler (the budget falls to them when the rhythm and the transient spend it); whether
blockChase's half-time strike past 150 bpm reads as the tempo; whether the build still reads
as a build at 128 bpm now the sixteenth rung is capped to eighths; whether twoTone's phrase
swap reads as the song turning or as a cut; whether a quiet groove sits too close to an
intro.

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

1. `npm test`: **967 green, no known failures** (the effects calibration test passes again
   since the 2026-09-09 rounds; the picker's budget has five tests of its own, the fifth for
   the breakdown cap; the mixer's hit floor has four; the trust gate's fast-track case has
   one). Two tests (`measure.test.ts`'s void bars and
   `ambient.test.ts`'s scenes) time out at 60 s only when several benches share the machine;
   run the suite on a quiet one. `npm run check` clean.
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
6. `node bench/lintsweep.ts [cacheDir]`: **0 rejected** (78 clean on the live cache, which
   has grown past corpus 3's 65; 24 buttons placed, no `busy-stack` warnings on the engine's
   own shows). The app fails dark on a lint error.
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
2. The 2026-09-08 round is committed in three commits (analysis, engine, docs) on top of
   `0266ffc`, and the three 2026-09-09 effects rounds with the hit floor, the trust line and
   the queue fix in one commit on top of the owner's `25fd255`. The owner's own
   tuning lands in the tree between sessions, so read `git status` first. Never touch
   `apps/controller/`, `firmware/` or `docs/frame-wiring.md`, which are the owner's; commit
   only when asked, staging explicit paths.
3. The owner's judge files land in `cache/judge/`. Freeze them into `bench/judged/round-<date>/`
   by the rule in the review loop (a judgement with no section edit is frozen from the v30
   analysis with `acceptedAnalysis`), then `movementprobe --no-hand-maps --no-marks --out`,
   `mapdiff`, and `mapsweep --maps=<round>` on the live cache. Report by fault class across
   tracks before proposing a fix; a fix is a guard or a rule measured on every map and gate.
4. The floors are in the gates section. The sweep's `extra` column is the phantom-split gate;
   a rule that gains hits by splitting accepted tables is a loss.
5. **The owner's next steps, in their words**: "analysis engine polishing based on RL from
   my judged songs" on the re-initialised corpus-3 queue, which is the review loop above
   run on the judge files that land in `cache/judge/`; then tuning the effects "more and
   further" by hand; then the AI-authoring part; code cleanups without changing anything
   functionally. The effects
   are a look call of theirs, so ship the level they ask for and report what the calibration
   tests say as room consequences (`GAMMA` and the effects calibration test are settled
   decisions, not dials to tune green). `bench/effectlevel.ts`, `bench/effectusage.ts
   --measure` and `bench/stripchart.ts` are the instruments for any further pass; the
   polish round's "watch next" list is where a complaint is most likely to land.

## House rules that bite

- The owner works in the same tree. `firmware/`, `hardware/`, `packages/preview3d/`,
  `apps/controller/`, `packages/core/src/output.ts` and `geometry.ts`, `docs/FIRMWARE.md` and
  the wiring docs (`docs/frame-wiring.md` is untracked and theirs) are theirs; commit only your
  own paths, and only when asked.
- No em-dashes anywhere. Comments say why. Stage explicit paths. No co-author trailer.
- Aesthetic calls beat tests: ship the look the owner asked for and report what broke as room
  consequences.
