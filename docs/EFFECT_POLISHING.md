# Effect polishing

How a listening complaint becomes a shipped fix, and the rules this repo has already paid
for. First written after the 2026-08-12 pass that fixed seven complaints in one sweep;
rewritten after the first judged rounds, which changed the method: the owner now judges in
the app, and the judgements are the instrument everything else is tuned against.

## The judge loop is the method

The app has a judge mode: `J` opens the panel, stars and a fixed chip vocabulary score the
track, `N` drops a time-anchored note at the playhead ("bar 87: this slam came from
nowhere"). Every judgement autosaves to `<cache>/judge/<trackId>.json` pinned to the
`analysisHash` and show seed that were actually playing, so a complaint about a
since-recomposed show is history rather than a bug report. Thirty judged tracks produced
three actionable clusters in one evening; the marked bars did more than any corpus metric.

Rules the first rounds established:

- **The chips aggregate, the notes diagnose.** "sections wrong" ten times says where to
  look; "@71s bar 43: chorus starts a bit early" says what to fix. Ask for both.
- **Marked bars outrank bench scores at one-bar resolution.** The boundary metrics tolerate
  half a second, which at 120 bpm is most of a bar - exactly the errors the room hears and
  the bench cannot. Fourteen user-marked bars are a better instrument for that class than
  either annotated corpus.
- **Cluster before fixing.** Three of seven complaints in one pass shared a root cause
  (nothing was kit-aware); ten of thirty shared another (one-bar boundary jitter). A
  per-complaint fix on a shared cause is work done seven times.
- **Close the loop.** After a fix lands, hand back the short list of tracks to re-judge,
  never the whole corpus. Re-listening is the expensive resource here.
- **Positive judgements are calibration.** The 5-star tracks guard against regressions and
  say what "right" reads like; ask for them explicitly.

- **A judgement is only worth what its build is.** The file pins `analysisHash` and the show
  seed, which catches a recomposed show but NOT a rebuilt app: a rollback or a re-analysis
  can leave both pinned values identical while the show is different. Say which build was
  installed when a round starts, and treat verdicts from before a version bump as history.

### Handing a judged round to the next session

What a continuation needs, in this order:

1. **Which build was judged** - the commit the app was installed from, and whether the cache
   was cleared first. Without it a verdict cannot be attributed.
2. **The judge files themselves** (`<cache>/judge/*.json`). They carry the rating, chips,
   notes, bars, `analysisHash` and seed. Aggregate the chips with a python one-liner before
   reading any of them individually.
3. **The 5-star tracks named explicitly.** They are the regression guard and they are what
   the fixes must not break.
4. **Which complaints repeat.** One track with a bad drop is a track; five tracks with the
   same chip is a root cause, and the root cause is the only thing worth fixing.

### Comparing two builds, cheaply

Copy the `.app` into `/Applications` under a different name and it gets its own library:
`LightningStrike (B).app` reads and writes `cache-B`, judgements included, because the judge
directory hangs off the cache. Naming the copy is the whole of the configuration - no terminal,
no wiping between. `cp -R` the existing cache into the new one first and the second build
inherits the same audio and analyses without re-downloading anything, so only the shows
differ. An inherited `MV_CACHE_DIR` still overrides, for a session driving the comparison
itself.

**For small differences, ask which rather than how many stars.** Absolute ratings across days
rest on memory, and memory is poor at exactly the differences worth arguing over; paired
comparison is the standard instrument for small impairments for that reason. Hand back the
same track twice, A and B, and ask which - it is more sensitive and it is less work to answer.

## When the bench disagrees with the room, suspect the bench

The room is the instrument of record. Twice now a corpus score has argued a change was good
while listening said it was worse, and both times the score was answering a different
question:

- **A metric that collapses the classes under test cannot see the error.** `structscore`'s
  `base=` column maps verse onto groove and chorus onto drop, so a labeller that renamed
  every chorus scored 53.1 to 71.1 on it while the EXACT figure sat at 22.5% in the same
  output. Read the column that distinguishes the thing being changed, and headline that one.
- **Check what the baseline arm actually has.** `structscore` fetches no `TrackContext`, so
  its rules path runs with no lyrics where the app has them, and `speaksClub` falls back to a
  kick heuristic that reads much of a pop corpus as club. A win over a crippled arm is not a
  win.
- **Aggregate scores hide degeneracy.** A track labelled one thing end to end can score
  respectably against a reference that is also mostly one thing. Measure the per-track
  distribution as well as the mean: single-label dominance caught what section agreement
  missed, and it was the number that matched what the owner heard.

The general shape: before believing a corpus result over a listening result, write down what
the metric would report if the specific failure being alleged were present. If the answer is
"the same number", the metric is not evidence.

## Diagnose from the cache, not from the code

Every complaint names a track, and the track's whole story is on disk: the desktop app's
cache in `~/Library/Application Support/cz.drabek.lightningstrike/cache`, the dev server's
in `cache/`, the judging corpus in `cache114/` - `<id>.analysis.json`, `.show.json`,
`.meta.json`, `.context.json` beside the audio. Before touching anything:

1. Find the id by grepping metas for the title; the judgement file already carries it.
2. Read the analysis against the complaint: per-section kick/snare/hat densities, tempo and
   meter confidence, the events column. Most complaints are visible as numbers.
3. Read the show's cues and hits against those numbers - what the planner believed.
4. Recompose the cached analysis at HEAD and diff against the cached show. Same seed
   reproduces the same show, so `cached == fresh` proves the complaint is live; a diff
   means a stale build was judged - half of one session's "bugs" were one already-fixed bug
   that had never reached the cache.
5. For lyric questions, `chorusSpansFromLyrics` over the cached context is ground truth
   enough: on the first track checked, the hook line's synced time marked the true chorus
   bar twice while the boundary sat one and two bars off. LRCLIB line timing is reliable;
   trust it as evidence.

## Saturation is a number, and taste has a budget

The complaint "this effect is OVERUSED" arrives long after the numbers could have said so.
Measure share-of-shows per family before shipping any effect or preference change
(`bars used and shows containing, per family, over the corpus` - a twenty-line probe):

- **A signature drifts into a mandate at any weight.** The +1.1 preference put impulseSpin
  in 30 of 34 house shows; removing the preference left it at 80 percent on merit alone,
  because a mid-energy kick rhythm is near-eligible in every pool. The shipped answer is
  both halves: each show draws a seed-stable HALF of the family's signature list, and the
  undrawn half joins the avoid list at full weight for the night. A signature look is
  either this show's vocabulary or it rests. Guarded by a 60-seed band test.
- **The avoid weight must beat the jitter.** At 1.2 against 1.4 of seed jitter, moshSlam
  still opened rap choruses; at 2.4 (one use of novelty) a foreign gesture reliably loses
  the tie and stays reachable when the pool empties. Prefer and avoid are not symmetric:
  a nudge suffices toward, a shove is needed away.
- **High-salience effects saturate at the same share as subtle ones and get complained
  about first.** vortex and pump sit in ~95 percent of all shows organically and nobody
  minds; a travelling wave at 88 percent was called out immediately. Budget salience,
  not just presence.

## Archetypes, not just effects

The second complaint class was "the effects are all shockwave effects" - and the count
agreed: six of twelve transients were radial energy from a point (expanding rings,
converging rings, waves from corners, bursts). A catalog diversifies by GESTURE GEOMETRY,
not by file count. The archetype vocabulary now on the wall:

- radial burst (shockwave, kickTunnel, rippleTank, pyroBursts) - the incumbent family
- spring displacement - the field itself shoved and returning (recoil; the owner rejected it on sight - whole-field displacement reads as the room glitching, spend displacement on a local element instead)
- directional travel with reflection - a shot, not a wave (ricochet)
- linear stroke - one wall, one line, one direction (snareBlade)
- structural give - architecture taking weight (counterweight)
- interference - two slow fields making a fast-feeling pattern (weave)
- freeze - motion withheld as the gesture (stopTime)
- exact-arrival gestures only a compiled show can do (buildStacker and timedSweep both tried it; the owner rejected both - an exact arrival earns its place only when the shape between arrivals is worth watching)

And the closing law of the family complaints: the whole kick-burst family (shockwave,
kickTunnel, kickCannon, ricochet, pyroBursts, splash) is drawn at most ONE per show, the
rest avoided for the night - the owner named four members in one breath, which is the tell
that files are one gesture.

**New effects must arrive at the incumbents' energy distance or they change nothing.** The
five newcomers first shipped at e2-3 against incumbent bursts at e4-5, scored 4-8 shows per
family, and moved no needle: the -1.6/band energy fit priced them out of the exact cues
the bursts saturate. Repriced to e3-4 they compete everywhere (28-32 of 36 hip-hop shows)
and the burst share fell without a single veto. This is the third time the catalog-pairs
lesson has been paid for; it is apparently the tuition this repo keeps owing.

## The kit is a fact, not a vibe

`BarRow.kicks/snares/hats` and the onset streams are measurements. The rules built on them:

- An effect whose whole gesture answers one drum declares `taste.kit`; the picker refuses
  it where that stream runs under 0.2 hits/beat over the slot. The veto falls back to the
  unfiltered pool rather than emptying one - filters guarantee absence, preferences
  guarantee presence, and a hard requirement that can empty a pool is a mistake made twice
  already.
- Tag by what the gesture IS: moshSlam and headbang are `kick` because a unison slam is a
  kick gesture, whatever band tripped the detector.
- Grid-locked pulsers keep timing from the grid and take PERMISSION from a `Presence` of
  the hit envelope: full through a pattern's own gaps, resting within a couple of bars of
  real silence, rising only to the envelope's own peak.
- Punctuation obeys the same honesty: a drop arrival with no kick in its bar gets a colour
  bump, not a slam.
- The wildcard's freedom is from the SECTION vocabulary only. It still respects the kit
  veto and never lands a flash or impact effect - a strobe as the one surprise in a rap
  verse was how "surprise" read as fault.

## Hits must survive the cue boundary

The player consumes onsets up to ~30 ms EARLY on purpose (anticipation: early light reads
tighter than late). That lead means a kick sitting exactly on a cue boundary fires its
one-frame edge into the OUTGOING effect; the incoming one - installed precisely to answer
it - heard silence. The player now re-asserts any edge younger than the lead plus a frame
on the install frame. The general law: any consume-once event plus any deferred consumer
is this bug; when adding either, ask who else needed the event.

## Aggression comes from the record, not the genre card

- A bloom-family drop that measurably pounds (>= 0.8 kicks/beat) takes slam treatment for
  its punctuation - per slot, not only at the peak. The peak-only version fixed Galantis;
  a listening note then missed the strobe on the FIRST drop of a pounding house track.
  Same evidence, same answer, anywhere it occurs.
- Swell families are never overridden; their peak is a rise by definition.
- Genre remaps are the last resort; the aggression override fixes the track that is
  playing without moving every other track in the drawer.

## Builds, rates and fades

- buildStrobe fires only from buildProgress 0.45: two listening notes on two tracks said
  the same thing, a sixteen-bar riser flashing from its first bar is half a minute of
  strobe. The roll is the END of a build; the front half belongs to the layers that climb.
- The strobe rate ceiling is `strobePerBeat` under `STROBE_MAX_HZ = 8`, one function
  imported by the planner AND the linter - two implementations of one allowance is how
  they disagree (the `hitSeconds` lesson).
- Quiet-to-quiet seams (intro/breakdown/outro into anything short of a drop) fade over 12
  beats. Both sides are near-still, so the change IS the event, and at two bars it read
  as a jump twice in one judging round.

## Param semantics are contracts

`paramsFor` writes values into any effect declaring a matching key, so the KEY is a
contract about units: `perBeat` is a rate, `cycleBeats` is a period, and reusing one for
the other ran sineRoll at four times its speed on every sparse track. Felt sizes derive
from the MEDIAN tempo once at compose. Grid-locked phase comes off the absolute bar clock
and is never multiplied by `ctx.motion`; integrated state (springs, momentum) may scale
its timestep by motion because pausing genuinely parks it.

## Trust the analysis to distrust itself

`gridTrust` trips on fragmentation - over 5.2 sections a minute, or over 4.5 with meter
confidence at or below 0.55 or a 2/4 verdict - never on confidence alone, and now only
with at least TEN sections: fragmentation needs fragments. A 95-second hardstyle edit with
a normal eight-section arrangement reads as 5.1 a minute, which routed a correctly
labelled track to lounge; rate-based gates are biased against short tracks. Calibrate on
the real corpus, price the false positive honestly (a good show replaced by lounge costs
more than a bad one let through), and keep the owner's override in the meta.

## Version discipline, or fixes never arrive

- Analyser changes bump `ANALYSIS_VERSION`, engine changes bump `SHOW_VERSION`, every
  session, no exceptions. Everything re-derives lazily per track.
- `prepare()` keeps a show only when hash matches AND versions are current AND the
  analysis came from cache; model-authored shows are exempt.
- The app build must be at least as new as the artifacts handed to it, or the old build
  re-analyses the future back down. The full loop that works: quit app, rebundle, rebuild,
  install, sync artifacts, relaunch, then curl its own `/api/library` and read the
  `current` count - the app's opinion, not the repo's.

## A single reactivity number cannot say whether a hit reads

`measureEffect`'s `react` column is bytes moved across a journey, against a deafened run,
normalised by the effect's own mean. That makes it three things at once, and on a restrained
effect the three fight: a full-room look answering every kick modestly scores LOWER than a
beam-only look answering a few hugely, because the divisor is the mean. Worse, a design whose
whole point is constant output - a saturation walk inside `base..glow`, a conserved trade
between the ring and the beam - scores near zero by construction while still landing plainly.

`bench/punchprobe.ts` asks the direct question instead: at each kick, how far does the
furthest pixel move within 120 ms? And it reports the WEAKEST tenth of the hits beside the
median, which is what separates the two shapes:

- **calm and kick-forward**: sits near its own median on every hit and cannot spike.
  `emberBump` 36/38/**39**, `crossbeam` 42/51/**59**, `counterweight` 24/40/**76**.
- **wild**: a weakest of ZERO and a maximum near the top of the range, because it fires rarely
  and enormously. `moshSlam` 0/0/233, `lightning` 0/1/245, `ricochet` 237/243/248.
- **anticipation**: nothing at the arrival and everything before it. `lean` reads 0/1/1 with an
  APPROACH of 83. That column had to be added, because without it the effect measured as dead
  while doing exactly what it was written to do.

These are BYTES and they move with the room's calibration, which is the three constants in
`packages/core/src/output.ts`. The run above is the shipped one: **GAMMA 2.45, knee 0.84,
MASTER 1**. An earlier round of this table was taken at MASTER 0.7 and read about 40% lower
throughout, which is the master and nothing about the effects.

So the absolutes are worth nothing across a calibration change and the ranking is worth most of
it. Even the ranking is not immune: `crossbeam` and `emberBump` swapped places between those two
runs, because the knee moved as well as the master and they sit at different heights against it.
**Re-run `bench/punchprobe.ts` after touching any of the three** rather than reading this table as
a fact about the catalog.

And the caution the numbers earned: `lean` scored a healthy-looking 33/35/72 before a bug in it
was fixed, and those numbers were measuring the BUG - a snap at the beat the gesture was written
not to have. A good punch reading is not evidence the effect is right.

The owner's ask - punchy but not distracting - is the first shape, and the ceiling is the
column that says so. Nothing in the catalog before round 9 answered the kick with a maximum
under 81; three effects now do. Note what this does NOT measure: whether a constant-flux move
is visible to a human at all. That is the room's to answer, and it is the open question about
`emberBump` and `crossbeam` specifically.

## Prove it before claiming it

Unit tests per rule first, and **verify a new regression test fails against the bug it
was written for** - the kick-on-switch test was flipped off and on to prove both
directions. Then recompose the named tracks and diff cues/hits; then a scratch-copy
re-analysis (`MV_CACHE_DIR` + `bench/reanalyse.ts`) so no live cache is mutated during
validation; then `bench/showprobe.ts` for the gate that never moves: **0 lint errors,
0 misfires, 100 percent quiet coverage**. Measure saturation per family after any picker
or catalog change. The engine-never-fails-its-own-linter sweep stays the cheapest
high-yield test in the suite.

A fix that cannot be seen in a recomposed cue list, a hit diff, a probe number or a
re-judged track is not finished; it is intended.
