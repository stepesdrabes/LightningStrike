# Handover

**Round 12 (2026-09-02) is the top layer: v27 / SHOW 22 / CONTEXT 3, UNCOMMITTED past
1b68b77.** Two more owner maps (HIGHEST IN THE ROOM, Vitej mezi nama) and a praised sentinel
(Sunset), all frozen in `bench/judged/round-2026-09-01/`. HIGHEST was a grid fault - the tracker's
double-time blips in quiet passages, now repaired inside the grid repair - and Vitej the
transitional-bar pattern, now pulled onto the kit's return for kit-carried sections only. The
probe runs the drum model like the app does; before it did not, and its labels were not the
app's. Read the round record's "Round 12" first.

**Round 11 (2026-09-01, evening) sits under it: v26 / SHOW 22 / CONTEXT 3.**
The analysis and the app half are committed (four commits, 960b448..1b68b77); the second pass -
no look held past 30 s, `MAX_CUE_S` in plan.ts, SHOW 22 - is in the tree uncommitted, measured
at 24 cues added across 137 shows and none over 40 s. The owner heard Round 10 and judged "the switches are NOT good"; two frozen maps
in `bench/judged/round-2026-09-01/` say where the bars are, the 43 old judge files are archived
(`cache/judge-archive-2026-09-01/`, at the owner's word), and the analyser now lands both
Melanz seams and both SICKO MODE seams on the owner's bar lines to the frame, with no outro
before a switch. Read the round record's "Round 11" section first. What remains open, in order:

1. **Listen.** Melanz 2:49.64 (the beat stops on the bar line, the pickup is the new song's),
   3:25.66; SICKO MODE 1:00.38, 2:56.56, and that the second song ends on its breakdown. The
   cache re-analyses at v26 on first play, ~40-60 s a track.
2. **The boundaries still off** are one bar early on a transitional bar three times out of
   four (SICKO 0:53.54 for 0:55.28, 1:37.54 for 1:40.64; Melanz 2:58.64 for 3:01.65): the DP
   cuts where the change begins, the owner hears where it lands. A fill-bar witness in
   `refineBoundaries` is the candidate; sweep it on Harmonix and Raveform, never on two tracks.
3. **Melanz 4:46.76**, a chorus restated after a two-bar bass dip, is merged by consolidation
   (same kind, same group, no arrival). Whether a departure should count as an arrival there is
   a room question.
4. **Run `node bench/mapdiff.ts <map> <analysis>`** after any analyser change, on the probe's
   output (`bench/movementprobe.ts <id> --no-hand-maps --no-marks --out=...`); the probe now
   starts from the model's own count, never from a blob's repaired beats.

**Round 10 (2026-09-01) is the layer under it: v25 / SHOW 21 / CONTEXT 3, UNCOMMITTED.** Multi-song tracks now split themselves - the owner's ask was "everything should be
AUTOMATIC, the hand markings are mostly for judging". Read the round record's "Round 10" section
(`bench/judged/round-2026-08-14/round2-record.md`) and the memory note `multi-song-detector` first;
then this list:

1. **What the room has not heard.** SICKO MODE and Melanz split at 59.6/176.6 s and 171.6/207.8 s
   with NO marks and NO maps (the maps in `cache/judge` are still law on those two tracks; delete
   or redraw them to hear the automatic reading). Three single-song tracks in the library also get
   a movement - Hallowed Be Thy Name 1:00, bad guy 2:28, Fear of the Dark 1:43 - real tempo
   sections, defensible, and one alt-click on the lane refuses any of them. Every other library
   track is untouched by the detector; 23 tracks have their grid REPAIRED (tracker level flips
   undone, beatless intros written at the song's tempo), which the time-based gate scores as
   unchanged and the bar-numbered one cannot judge.
2. **The gates.** `bench/phasegrid.ts` 0 hit / 1 closer / 27 same / 0 worse - run THIS one for
   anything touching `movements.ts`, because the repair renumbers bars. `bench/earlybars.ts`
   prints 5 worse for that reason alone (its five rows sit on renumbered tracks and phasegrid
   shows each at 0.00 s). `bench/lintsweep.ts` 130/0. Suite 887 green with the one calibration
   failure (`wash`/`spectrumBed`, item 0 below). `bench/movements.ts --set=multisong|app|harmonix|
   raveform` is the detector's own instrument; the 18-track multi-song corpus is fetched by
   `bench/fetch-multisong.ts` (gitignored under `bench/corpus/multisong`).
3. **What to ask the room, in order.** SICKO MODE from 0:55 (the switch arrives as the peak, the
   palette turns), 2:50 (the third song, its own colour); Melanz at 2:50 (the beat stops, the
   room should re-stage on the pause) and 3:27; then whether Hallowed / bad guy / Fear of the
   Dark's re-staging reads as right or as a fault, which decides whether the tempo-only rule stays.
4. **Known misses, on purpose.** A-B-A rock (Bohemian Rhapsody's opera and rock, A Day in the
   Life) has a middle section the tempo alone cannot tell from an EDM half-time break, and the EDM
   corpus (60 tracks, 0 false) was chosen over them. Know Yourself is a near miss (chroma 0.73).
   Expectations marked "detector-placed, unverified by ear" in the corpus want the owner's ear.
5. **Install** is the same ritual as before (below, "The app and the cache"); the built app from
   this round is in `apps/desktop/src-tauri/target` if the build finished. The app cache
   re-analyses every track lazily at v25 on first play (~40-60 s each), or
   `MV_CACHE_DIR=<cache> node bench/reanalyse.ts` does the lot ahead of time.

State as of 2026-08-28 (round 9 landed, UNCOMMITTED and UNHEARD): **v24 / SHOW 20 /
CONTEXT 3**, 858 tests green, typecheck clean, earlybars at its floor. This file is the
CAMPAIGN - the analysis, the engine and what the room hears. Start at "If you are the
next session" near the end, then come back to the top. `docs/EFFECT_POLISHING.md`
carries the method (judge loop, cluster-before-fix, the kill criterion, bench-vs-room
discipline).

**Round 9 in one paragraph.** SICKO MODE was lit on the BACKBEAT for 232 seconds, and
three independent substrates agree it was: the owner's mark, the kit's own kick/snare
phase profile (gain +1.024), and a Viterbi over Beat This's downbeats. A phase walk now
places a listener-marked movement on the right beat. Three effect repairs landed, the
biggest being that `chromaBurst` - the effect the picker hands the peak of nearly every
track - was arriving half a beat late at peak byte 40 and now peaks at 145. `base ->
glow` turns out to be a SATURATION move at constant flux, not a brightness ramp, which
CLAUDE.md had wrong and which opens the cheapest punch in the system. And four
restrained kick effects shipped, judged by a new instrument that asks how far the room
moves on the WEAKEST tenth of its hits. Full detail in the round record's "Round 9"
section, which is where to read before touching any of it.

There is now ONE app and ONE cache, at the owner's ask: `/Applications/LightningStrike.app`
on `~/Library/Application Support/cz.drabek.lightningstrike/cache` (formerly cache-C,
verified a strict superset of A and B). The other two caches are renamed to
`cache-A-archive` / `cache-B-archive`, not deleted. The A/B era is over - "the old AB
tests were finished and C won every time, now we are polishing C further."

The complete campaign evidence lives in `bench/judged/round-2026-08-14/`:

- `snapshot.json` - all 36 original judgements joined against the sections/cues/hits
  they were made against. Survives every version bump. Never regenerate it.
- `digest.md` - the human walk of the same. `diagnosis.md` - ranked root causes RC1-6.
- `adversary-review.md` + `round2-record.md` - every design, every adversarial finding
  and its disposition, and the room's verdicts per round. READ round2-record.md FIRST:
  its tail carries rounds 7, 8 and 9.
- `ab-verdicts.md`, `listening-list*.md`, `research-endings.md` (verified citations),
  `sweep-record.md` (every corpus sweep number).

The older overhaul history (pre-campaign) is in git at `fd9cbb0` and in the session
memory.

## Where the code stands

**Round 9 is COMMITTED, in seven commits on top of `faa0d04`, and the room has not heard any
of it.** (`faa0d04` is the owner's own firmware commit, and it is the real baseline - not
`332b451`, which is one older.)

| | |
|---|---|
| `a365268` | the phase walk, the movement placement, the two normalisation faults, ANALYSIS 24 |
| `74b6777` | chromaBurst, subSwell, the palette fact, Presence in beats |
| `5470c80` | the five new effects, SHOW 20 |
| `7d64b91` | the drag clamp that blocked the owner on SICKO MODE |
| `5f889ca` | `phasegrid.ts`, `punchprobe.ts`, `targets.ts` |
| `b8e0433` | the stale-yt-dlp diagnosis on the download path |
| `74ede0a` | the records: this file, the round-9 section, the method note |

Measured green at 862 tests with the owner's in-flight calibration shelved - see first-hour
item 0 for why that qualifier is needed and why it is not this round's problem.

Files that are NOT this round's and were deliberately left uncommitted in the working tree:
`firmware/node/src/fixture/*.rs`, `hardware/`, `docs/demo-wiring.md`, `docs/frame-wiring.md`,
and the hardware bring-up half of core - `packages/core/src/output.ts` (GAMMA 2.45, MASTER
0.7), `packages/core/src/geometry.ts` and `geometry.test.ts` (run labels, reel-pairing
regions), and `packages/core/src/effects/effects.test.ts` (updated for MASTER). All of that is
the owner's own work. `packages/preview3d/*` is theirs too, and `docs/hardware.html` is theirs
(committed at `049dd22`). Stage explicit paths, and
only commit when the owner says so. The sectioning-model memo was moved OUT of the repo by
the owner on purpose - a second research agent must not read it - so do not recreate it.

ANALYSIS_VERSION **24**, SHOW_VERSION **20**, CONTEXT_VERSION 3.

- v24 = the model's downbeats are stored (~900 bytes a track) and a listener-marked movement
  is placed on the beat the walk chooses rather than on the beat the press landed near.
  Everything else about it is inert on an unmarked track, and `earlybars` proves it: the
  floor is unmoved at 20 hit / 0 worse.
- SHOW 20 = five new effects in the pools (`subBreath`, `emberBump`, `crossbeam`, `lean`,
  `tremor`), plus the peak now ranked on a movement-blind energy column.
- The `chromaBurst` and `subSwell` repairs needed NEITHER bump: a show is a cue list and the
  rendering is code, so a render change is heard on the next play.

What shipped in earlier rounds, one line each (details in round2-record.md):

- R1 (v17/v13): same-material consolidation behind five guards; club vocabulary needs kit
  corroboration; hasDrops behind `audible`; heartbeat kick-gated; `silhouette` peak master.
- R2 (v18/v14): hook-snap physics veto; peakStyle on masters; outro bed inheritance; the
  cold-ending button; the linter's finish-line anchor.
- R3 (v19): the ratio form of the snap veto (entrance windows ONLY - a restart cannot lag or
  lead) and the absorb-left move for 2-bar builds. EARFQUAKE went 2* -> 5*.
- R4 (v19/v15): the breath dims instead of re-staging; the playhead marks the heard instant.
- R5 (v20-v22 / SHOW 16): stay-pins, vote split, pin-aware fold, restart noise floor; the
  pounding drops arm; listener-cut grids, the settle gate's measured negative, the SOPHIE
  fixture, audioGenres provenance; group-final peaks and the leaving pass; the judge trio.
- R6/R7 (v23 / SHOW 17): map adoption and the stamp that makes a fresh map audible on the
  next play; kick-corroborated genre families; the pounding band raise. Package C REFUTED.
- R8 (SHOW 18): the tempo read AT THE BAR (`bpmAt`/`beatPeriodAt`), which closed a live 9.2 Hz
  breach of the 8 Hz strobe ceiling on SICKO MODE; `tempoSegments` and the tempo map on
  screen; the section editor's grid faults fixed.
- R9 (v24 / SHOW 20): this round. See the round record.

The boundary instrument `bench/earlybars.ts` is the campaign's backbone: 18 frozen
owner-marked pairs + 10 sentinels, scored against whatever analyzer is checked out, and its
targets now live in `bench/targets.ts` so `bench/phasegrid.ts` reads the same rows. Run
earlybars after ANY analysis change; run phasegrid instead for anything that re-phases.
`bench/stagetrace.ts` replays the structure stages one call at a time in cache coordinates
and self-checks against a real analyzeTrack run.

## ROUND 4, first slice: SHIPPED same session - read this before the phase brief

The phase hypothesis below was TESTED AND REFUTED by `bench/phaseprobe.ts` before any
code changed: (B) Beat This's own downbeats agree with the shipped grid at +0.00
beats on EVERY track - the "% agree" column reproduces meterConfidence, i.e. low-conf
tracks have INTERNALLY inconsistent model downbeats, not wrongly-chosen ones; and
(A) the owner's marks sit mid-bar even on conf-1.00 praised tracks (EARFQUAKE 5* at
~2.8 beats), so note lag (~1.5-2 s, half a bar at these tempos) swamps sub-bar
reading. Marks cannot resolve phase; the prose can.

What the "2-4 beats off" actually was: `shapeApproaches` in plan.ts - "the breath
before it lands" - inserted a one-bar cue before every drop-class arrival that
STRIPPED the look to its bed and dimmed. Both owner marks (Safir 41, Vitej 80) sat
exactly on it: a re-staged room reads as the next section arriving. On Safir it was
newly exposed because R3's absorb removed the 2-bar build whose climb used to occupy
that bar. FIXED at SHOW_VERSION 15, owner delegating the call ("decide for the best
look"): the breath now keeps the FULL outgoing look and only dims (intensity x0.6,
fadeBeats 2 so it settles by mid-bar and HOLDS). Verified: Safir 41 and Vitej 80
recompose with identical layer stacks to their predecessors; lintsweep clean; 764.

If the next A/B still reads "off" at these seams, the remaining suspect is the model
plurality phase itself being wrong on low-conf tracks - untestable from marks; would
need the owner tapping "one" per suspect track (a which-beat-is-one question, one
track at a time). Do not rebuild a local discriminator (history below).

Also in this slice (0e6e3c4): the scrubber and timeline playhead led the ear by the
audio OUTPUT LATENCY - the readout published the raw clock while the room and the
hardware sync already rendered `heardPosition` (raw minus outputLatency). Fixed at
the readout, so judge timestamps now land on the heard moment too, which makes every
FUTURE owner mark slightly more accurate than the ones already mined (do not
re-litigate old marks against the new clock). App-chrome change, made on the owner's
explicit ask - the chrome stays out of scope otherwise.

**ROUND 4 CLOSED (2026-08-15 afternoon).** The owner listened: playhead confirmed;
both seams STILL EARLY, and the fresh marks split them - Vitej resolved to bar 82
(bar-class, fixed in the round-5 slice), Safir confirmed as the phase suspect
(third press on the same instant, half-bar-flip line inside the cluster). The
model-plurality path is OPEN: the owner was asked for tap-protocol marks
(EARFQUAKE ~0:25-0:50 as lag calibration, Safir ~0:50-1:15, live presses on the
felt "one"); taps had not landed by session end. Full verdicts + diagnoses in
round2-record.md.

## The original phase brief (kept for the code map; the REFUTATION was itself wrong)

> **OVERTURNED IN ROUND 9, 2026-08-27.** The hypothesis below was right and the instrument
> that refuted it was not. `phaseprobe` found that low-confidence tracks have INTERNALLY
> inconsistent model downbeats and concluded Beat This could not adjudicate phase. The cause
> is the opposite: the model tracks phase resets that one uniform four-beat walk cannot
> express, so its downbeats only LOOK inconsistent when forced through that walk. Given a walk
> that can express them (`downbeatPhase.ts`), the same downbeats go from 52% to 87% consistent
> on Safir and 39% to 86% on SICKO MODE. Read the round record's "Round 9" section before
> reading any of the below as settled. What survives unchanged: owner marks still cannot
> resolve sub-bar phase, which is exactly why the walk supplies the beat and the mark supplies
> the bar.

**The finding.** After R3 landed Safir's boundaries EXACTLY on the owner's marked bars
(breakdown 33, chorus 42, verified in cache-C's v19 blob), the owner still heard it
wrong and, asked directly, said: sections start "2-4 beats off", and explicitly
CLEARED the strobe lead as a suspect ("strobe is okay like that before actual drop" -
do not redesign the strobe-into-drop). Measured: the owner's timestamped marks sit
1.3 beats (67.1 s vs barTimes[42] = 66.56) and 2.5 beats (54.0 s vs barTimes[33] =
52.98) AFTER the grid's bar starts, at meterConfidence 0.52 and downbeatPhase 0. The
bar boundaries are right in bar numbers; the grid's "one" is displaced from the felt
one, so every cue, slam and strobe fires beats ahead of the music's own count.

**The hypothesis worth the round**: the stubborn "boundary off" residue on
low-meterConfidence tracks is PHASE-class, not section-class. The suspects and their
meterConfidence, all judged tracks with unresolved off-feel: Cigo a kava 0.32,
Thinkin Bout You 0.36, SICKO MODE 0.39, bad guy 0.47, Killing In the Name 0.47,
Safir 0.52, Tili Me Pregunto 0.54, Snooze 0.56. The 4-5* cohort sits at 0.75-1.0.
A half-bar phase error also poisons everything downstream that looked "1 bar early
or late" at bar resolution - some of the 11 unfixed earlybars pairs may be phase in
disguise.

**Instruments that exist:**

- `bench/beatscore.ts` - beat/downbeat F and CMLt on GTZAN. The downbeat columns are
  the corpus-side gate; the shipped Beat This checkpoint decision (final0 over small0,
  downbeat CMLt 0.605 vs 0.558) is in round2-record's history and memory.
- The owner's timestamped marks: every note in snapshot.json carries `t` seconds AND
  a bar. A phase probe compares `t` against `tempo.barTimes[bar]` per mark - marks
  carry ~0.5-1 s reaction lag (they drift LATE), so treat deltas under ~1 beat as
  noise and look for the CONSISTENT 2-beat-class offsets. Safir's two marks and the
  round-2 mark (67.2 s for bar 42) are the cleanest anchors.
- `bench/boundlab.ts` prints per-bar arrivals for one track. CAVEAT: it re-runs
  BeatThis fresh and reads only beatsPerBar/downbeatPhase from the cached blob, so on
  a track where the cached grid came out at another metrical level (Back In Black)
  its bar indices disagree with the cache. Align before trusting it there.

**Where the phase is decided (read in this order, none of it read this session):**

1. `packages/analysis/src/beatthis.ts` - the model emits beats AND downbeats.
2. `packages/analysis/src/downbeats.ts` - how downbeat phase is chosen from them
   (and what happens at low agreement; meterConfidence's semantics live here or in
   `tempo.ts` - "margin over the runner-up", per README).
3. `packages/analysis/src/beats.ts`, `metricalLevel.ts`, and `analyze.ts` around the
   `barSynchronous(bf, beatsPerBar, phase)` call - where phase becomes the bar table.
4. `publishedLevel` in enrich/analyze - corrects the metrical LEVEL from published
   bpm; it has no phase component.

**First moves, in order:**

1. Build the phase probe (bench/, ~an hour): for every judged track, every owner mark
   -> delta between `t` and `barTimes[bar]` in beats, grouped by meterConfidence.
   If the low-confidence cohort shows consistent ~2-beat deltas and the high-
   confidence cohort does not, the hypothesis is confirmed before any code changes.
2. Diagnose Safir specifically: does Beat This's own downbeat stream agree with the
   shipped phase 0? If the model said the other phase and the local fit overrode it
   (or vice versa), the fix is about WHO decides at low confidence.
3. Only then design. Constraints from history: "metrical level cannot be delegated to
   either tracker, and no local discriminator adjudicates it" (the abandoned
   metrical-level corrector - do not rebuild it); Beat This final0's downbeat CMLt is
   the number that must not regress; the beatscore gate must stay flat on the
   high-confidence majority. A phase fix that helps 8 low-confidence tracks and
   moves nothing else is the win condition. Sweepable, sentinel-guarded, adversary
   before shipping - the full R2/R3 loop.
4. The metrical-level cousin: Back In Black's grid is DOUBLE-TIME because Deezer's
   published 190.5 is itself the doubled reading, so publishedLevel confirmed the
   wrong octave (meterConf 1.0!). Owner ground truth on file: "verse 2 should be as
   verse 1 in length". Parked with the relative-floor idea (task: NOT floor-class);
   any phase work should at least not make this class worse.

**Design-space notes for the fix (written before reading the phase code - verify):**
`downbeatPhase` is the beat offset (0..beatsPerBar-1) at which bars start on the beat
stream; a "2-beat" error is a HALF-BAR phase flip, the classic weak-backbeat
ambiguity. Candidate shapes, cheapest first: (a) at low meterConfidence, trust Beat
This's own downbeat stream over the local fit (or vice versa - the diagnosis says
which side Safir's error came from); (b) an arrival-evidence vote: the pipeline's own
decisive arrivals (the pin class) overwhelmingly land on true downbeats, so their
beat-phase distribution is a cheap discriminator that does NOT rebuild the abandoned
level corrector (it adjudicates PHASE, not level, and only at low confidence);
(c) expose the half-bar alternative the way tempo.alternativeBpm exposes octaves, and
let reanalyse/research flip it. Guard rails: never touch tracks above ~0.7
meterConfidence; beatscore downbeat F/CMLt flat; earlybars 15/0 floor holds (bar
INDICES shift when phase flips - the probe's pairs are bar-numbered, so re-derive
expected bars from the owner's `t` marks, not from stored bar numbers, for any track
whose phase changes).

## The rounds beyond 4, each with its design direction and instrument

**R5 candidate: ballad/swell endings** (T2/T3/T4 from `research-endings.md`, all
citations verified). T2 ring-out decay: the outro cue's intensity tracks a level
follower on the audio tail instead of holding 0.5 - engine-side, needs the outro cue
to read the spectrum envelope it already has; select by terminal envelope (the carve
already distinguishes ringing tails). T3 fade tracking: monotonic level decline with
pattern unchanged -> brightness follows, motion slows. T4 afterglow: after
button/decay, a low warm still wash instead of zero (between-track form is short;
end-of-queue lingers - the lounge dissolve partly covers this, check what the app
already does before building). Measure: recomposed outro cue intensity curves on the
5 ending-chip tracks + KITN/Gojira; the button/outro tests extend naturally. T5
(queue-seam palette handover in the dark) is app-side: out of scope, note for owner.

**The remaining earlybars pairs after the v20 slice** (8 "same" + WTSA at closer):
refine-margin class (Titi 73->72, Cigo 50->49, PROVENZA 79->80, bad guy 23->24,
KITN 21->22, Thinkin 2->1 - the fill-vs-arrival fight; the settle knob history says
a track-local or evidence-gated settle is the unexplored move), DP class (Snooze
17->23, six bars - needs the lyric window used ASSERTIVELY, see RC5), phase-suspect
(Safir 33->34 - waits on the tap verdict), and WTSA 83-vs-82 (the stay-pin landed
83 on the huge arrival; whether the owner's 82 or the physics' 83 is the felt bar
is a listening question, not a code one). Vitej 82, Kisses 63, Titi 54 and Lose
Yourself 23 are DONE at v20. Unmarked v20 collateral to listen for: Praha chorus
39 -> 41 (the restart floor holding the band's bar - 1:26.8 vs 1:30.5).

**Peak selection by mean energy** - three complaints on file (Ine Plemena, Self Aware
"I would not say this is peak", Hannah Montana tension drop) PLUS EARFQUAKE: its peak
now sits on the FIRST chorus at bar 8, before SETTLE_BARS, so the reserved master is
SKIPPED - and the owner's only nit on the 5* was "effects could be a more lively",
which may BE that skipped master. Design direction: bias the rank toward the LAST
statement of the loudest group (finalOfGroup already exists; the house craft says the
first chorus holds back so every return adds), or rank groups pooled and pick the
final member. Instrument: peak bars across the judged 36 + cache114 before/after,
plus the three complaint tracks' peaks specifically. Engine-side, SHOW_VERSION bump.

**RC5 lyric-assertive naming** - Blinding Lights "almost the whole track is chorus";
demotion needs overlap < 0.12 while misplaced boundaries hold overlap at 0.27-0.31;
the hook windows land on the TRUE choruses (33/72/104 - hookcheck output in the round
dir). Direction: let strong hook windows PLACE chorus starts on song-family tracks
(not just nudge existing chorus-class boundaries), and loosen demotion where a
better-overlapping sibling exists. This is the assertive step the v16 snap
deliberately did not take; sentinel-heavy territory (Hannah, KITN, Praha all
lyric-good today). Snooze 17->23 is the same fix seen from the other side.

**Kit false positives** - Self Aware 4*: "drums just A BIT off (taking the bassline
as drums I think)". The kick detector's bass-subtraction exists precisely for this
(removing it once cost fixture precision 1.000 -> 0.529, in memory); suspect ADTOF's
kick head or the DSP threshold on bass-heavy mixes. Instrument: the drum fixtures +
spot-listening; low stakes, one track so far.

**Context provenance + CONTEXT_VERSION** - cached `genres` carry effnet's own echo
(adversary R1 finding 17), so a context re-vote no-ops; Get Lucky still wears
`ballad` in the app until its context re-derives. Fix shape: store effnet labels in
their own field, bump CONTEXT_VERSION, re-enrich lazily like analyses. Touches
ingest/enrich + the contract; cheap but wide - own round.

**Parked with reasons**: relative arrival floor (its poster child Back In Black is
metrical-class; risks the confirmed second-drop seams), exposure damper (design
against the every-mechanism-becomes-a-mandate history; the scratch usage probe's
share-per-family numbers are the instrument), peak-section ACCENT pool (Safir's
discoBall - the picker fills peak-span slots from thinned pools; an energy floor
with fallback is the shape), in-window hook edge choice (EARFQUAKE's 6-vs-8 resolved
via the veto instead; revisit only if a new in-window complaint lands).

Named risks with fixtures wanted (adversary R2, unfixed by choice): band-lags-singer
veto inversion (gospel/soul shape), ring-out kick pollution, swell cold endings, the
veto's edge-bar blind spot, single-raw-kick fragility of the veto, settle-scale
coupling (five absolute thresholds calibrated on the settle-free scale - the
structure.ts docblock names them).

## The app and the cache (one of each, since 2026-08-28)

- `/Applications/LightningStrike.app` is the ONLY build, on
  `~/Library/Application Support/cz.drabek.lightningstrike/cache`. The bundle name decides the
  cache (`server.rs: bundle_suffix()`), so a plain name reads the plain `cache`.
- `cache-A-archive` and `cache-B-archive` are the retired A and B stores, renamed rather than
  deleted. cache-C was verified a strict superset of both - no audio and no judge file existed
  in A or B that was not in C - before it was promoted to `cache`.
- 68 tracks with audio, 43 judgements including hand maps. The owner judges in this one.
- **THE INSTALL TRAP**: `cp -R new.app "/Applications/X.app"` onto an existing bundle NESTS it
  (X.app/LightningStrike.app) and the old binary keeps launching - one A/B was listened against
  the wrong build this way. `rm -rf` the target first, then copy, then verify `ls "X.app/"`
  shows `Contents` and nothing else, then `xattr -dr com.apple.quarantine`.
- If a future round needs a second build to compare against, rename the copy on the way in
  ("LightningStrike (D).app") and it gets `cache-D` of its own. Ask the owner first: they asked
  for one app, and the A/B era is explicitly over.
- Cache clears keep audio/meta/context/judge and delete only `*.analysis.json` +
  `*.show.json`; stale versions re-derive lazily anyway (~30-60 s per track on first play), or
  `MV_CACHE_DIR=<cache> node bench/reanalyse.ts` regenerates the lot ahead of time.
  `cache114/` (repo, gitignored) is the 114-track gate corpus, regenerated at v23 - do not wipe.

## Mining a new judged round (the workflow, refined over three rounds)

Verdicts land in the JUDGING app's cache: `cache-C/judge/*.json` for anything judged
in C. To mine: diff each file against the round's prior state (snapshot.json holds the
originals; per-file `updatedAt` and note lists say what changed - a python join, see
the mining scripts' shape in git history at 7ee7b3f's digest generator). Rules the
rounds taught:

- **A cleared rating + cleared tags is a RESET, not a bad verdict** - the owner wipes
  a track's old judgement before re-marking it (Praha, Safir in R3).
- **The note's `bar` field TRUNCATES from `t`.** EARFQUAKE's mark at 23.3 s printed
  bar 7 but 23.3 s is bar 7.87 - the intended bar was 8. Always recompute from `t`
  against `tempo.barTimes`; at fast tempos the field is off-by-one half the time.
- **Marks carry ~0.5-1 s reaction lag** (late). The owner's PROSE ("2-4 beats off")
  outranks the millisecond arithmetic.
- **Notes are usually dropped at the TRUE moment** ("this is where X should start"),
  not at the wrong one - but confirmations exist too ("correct chorus"), so read the
  text before the number.
- Join every new mark against the CURRENT analysis (sections + barTimes + arrivals)
  before believing any interpretation - R3's "Safir still wrong" dissolved into the
  phase finding only because the blob showed the bars already exactly on the marks.

## Gates and probes (run all before any handover)

Current floors, all green on 2026-08-28 at v24 / SHOW 20:

1. `npm test` - **858** - and `npm run check`. If check errors with TS6305 after deleting
   dist/, `npx tsc --build --force packages/analysis` (stale tsbuildinfo).
2. `node bench/earlybars.ts` - **20 hit / 0 closer / 8 same / 0 worse of 28** is the floor and
   any WORSE is a stop. Needs `MV_CACHE_DIR` on a cache holding Kisses/WTSA audio, which the
   single `cache` now does. It re-derives from audio, so a cleared cache does not affect it.
   First run per track pays BeatThis (~15 s each, cached in `bench/corpus/.beats`).
   **It cannot judge anything that re-phases a grid** - see 3.
3. `node bench/phasegrid.ts` - the same frozen targets scored by TIME rather than by bar,
   with A = one phase per track and B = the phase walk. Run this for any change that touches
   the grid's phase, because a reset renumbers every bar after it and a bar-numbered target
   then stops naming the same instant. `--cost=N` sweeps what a restart costs. Known limit:
   it converts the target bar through A's grid, so A scores 0.00 by construction wherever A's
   boundary IS the target bar. Both instruments read `bench/targets.ts`.
4. `node bench/structscore.ts --dataset raveform|harmonix --limit 60 --variant current`
   after analyser changes (baselines in sweep-record.md; label columns are BLIND to same-kind
   merges and lyric effects - read F0.5/F3/sections).
5. `node bench/lintsweep.ts` - composes and lints the whole library; 0 rejected is the floor,
   and the app fails DARK on lint errors. It reads whatever `MV_CACHE_DIR` points at, so its
   denominator is however many analyses that cache holds.
6. `MV_CACHE_DIR=.../cache114 node bench/reanalyse.ts` then
   `MV_CACHE_DIR=... node bench/showprobe.ts` - 0 lint / 0 misfires / 100% quiet coverage,
   dark bars <= 2 (the known pair). Env var must prefix EACH command (an `&&` chain does not
   inherit it - this bit once). cache114 must be regenerated before showprobe means anything
   at a new version; it is at v23 and this round did not regenerate it.
7. `bench/quietprobe.ts` produces `taste.quiet`. Re-run after touching any effect in the quiet
   pool. Worth knowing before spending a session on those numbers: **20 of the 33 stored values
   can never be read**, because they sit on `carries: false` effects and a bare cue refuses
   those with no fallback. Only 10 beds and 3 accents have live values.
8. Versions: ANY analyser change bumps ANALYSIS_VERSION, ANY composition change bumps
   SHOW_VERSION, in the same change. A change to an effect's RENDER needs neither - the show
   is a cue list and the rendering is code, so it is heard on the next play.
9. Build: `npm run bundle -w @mv/desktop` then `npx tauri build --bundles app` from
   apps/desktop (DMG fails on this machine; --bundles app is the path). ~4 min. Then the
   install ritual in "The app and the cache".
10. Background-run hygiene: a running structscore/reanalyse loads code per PROCESS at start,
   so editing packages/analysis or core mid-sweep contaminates the variants that have not
   started yet (one sweep was killed and rerun for this). Land edits between runs. And if two
   builds are ever open with the room wired, only one may stream to the board or it flickers.

## Method invariants this campaign proved again (beyond EFFECT_POLISHING)

- **Instrument first, sentinels included, and prove a new test fails against its
  bug.** Four snap-veto designs died on the instrument before one shipped; the
  cheapest of those deaths cost minutes.
- **Sentinels built from silence are weaker than sentinels built from praise.** The
  old Praha-63 "sentinel" (uncomplained, not praised) wrongly killed the ratio veto
  for a round; the owner's "maybe 64" note overturned it. Mark tentative vs hard.
- **Evidence on trial must not grade itself**: the snap veto reads PHYSICS-ONLY
  arrivals because the hook's voice term was lifting its own edge over the floor.
- **Restart vs entrance is a real asymmetry**: an entrance can lead the beat, a
  restart cannot lag or lead. It is encoded in the veto and in a Le Freak sentinel.
- **The owner's ear outranks the pairs**: "2-4 beats off" reframed bar-perfect
  boundaries as a phase problem no bar-resolution instrument could see.
- **Adversary before shipping, and have it EXECUTE repros** - the R2 reviewer found
  a show-deleting blocker by composing and linting the real library, which no test
  and no readout covered.
- Ask the owner in small pieces; they answer fast and their one-line answers have
  twice redirected a round ("strobe is okay", "maybe 64").
- **When the table is right and the ear still says off, suspect the LOOK, not the
  analysis.** Round 4's "2-4 beats off" survived three correct boundary fixes because
  the offender was a show gesture (the breath cue re-staging the room) - diff the
  CUES at the complained bar (layers, fades, intensity), not just the sections.
- **A re-staged room reads as an arrival, however dim.** Changing the layer stack is
  a boundary statement; changing only intensity is not. The breath, the outro, and
  any future approach-shaping obey this.
- **Owner marks carry ~1.5-2 s of lag** (mid-bar positions even on praised conf-1.00
  tracks); the `bar` field truncates from `t`. Trust the prose, recompute from `t`,
  and never read sub-bar meaning from a mark.

## Owner's standing taste verdicts (unchanged, do not re-propose)

No whole-field displacement; no fill-and-drain wipes; no strobing accents in rap
verses; buildStrobe only in a build's back half; 8 Hz strobe ceiling; kick-burst
family drawn at most one per show; one wave-family at ~50-60% of its genre is the
ceiling; exact-arrival gestures need the shape between arrivals to be worth watching.
PLUS, new this campaign: the strobe-before-a-drop is explicitly endorsed ("strobe is
okay like that before actual drop"); outros keep their look and thin; endings are
anchored to the finish line, not the outro boundary; the pre-arrival breath DIMS the
rig and never strikes the set (full look kept, intensity only - the owner delegated
this call and it shipped at v15).

## How round 9 actually went, including the wrong turns

Written out at length because the reversals are the useful part: three separate designs in
this round looked right and measured wrong, and each was caught by building an instrument
rather than by thinking harder.

**It began with three parallel research agents** - multi-song state of the art, an audit of
all 90 effects, and an audit of the sectioning pipeline - and with a direct measurement of
SICKO MODE while they ran. The measurement got there first and reframed everything: the track's
whole second half was lit on the backbeat. That was not a subtle finding once the kick and
snare streams were scored by beat phase (kick owns phases 1 and 3, snare owns 0 and 2, and the
shipped downbeat sat on a snare), but nothing in the pipeline had ever asked the question.

**Three dead ends on multi-song detection, in order.** Bar-to-bar grid jitter: refuted, because
the highest-jitter track in the cache is Cigo a kava, a single song, while SICKO MODE sits
mid-table. A piecewise-constant tempo fit over the tracked beats (Ableton's warp-marker model,
scale-free in beat units): better, but still fired on 24 of 47. Adding a clean-metrical-ratio
guard, so a 2:1 flip counts as the tracker changing its mind rather than the record changing
tempo: still 19 of 53. What finally separated them was **step versus ramp** - fitting a
constant-acceleration curve across the candidate and asking how much of its residual two
straight lines remove. A band speeding up is a ramp; a beat switch is a discontinuity. SICKO
MODE 1.00, Melanz 0.94, against Blinding Lights 0.49, Hannah Montana 0.43, Enter Sandman 0.17,
Highway to Hell 0.05. With a 15% minimum tempo ratio and both sides at least 20 s, that rule
fires on 4 of 132 tracks where the shipped detector fires on 33 of 114. **It was never landed
in `bench/` - the prototype lived in the session scratchpad and is gone.** Rebuilding it is
maybe an hour and it is the single cheapest improvement left on this gap.

**A correction that invalidated a table.** The first corpus numbers were taken against the
desktop `cache`, which turned out to be at ANALYSIS_VERSION 16 - nine versions stale. Every
corpus claim was re-taken on `cache114` at v23. The conclusion did not move (the shipped
detector's false-positive rate is ~30% either way) but the numbers did. Check `version` in a
blob before believing a sweep over it.

**The phase walk nearly shipped globally, and should not have.** Unrestricted it lifts carry
across the entire low-confidence cohort and leaves 43 of 60 Harmonix tracks completely
untouched - which read as a clean win. `earlybars` then reported 3 worse. Two of those three
turned out to be artefacts: one KITN row was the SAME INSTANT to the millisecond (142.18 s both
sides) renumbered by a reset upstream, and a Safir row scored WORSE while actually moving
CLOSER to the owner's own mark (66.56 -> 67.40 against a mark at 67.1). That is when it became
clear that **a bar-numbered instrument cannot gate a change that re-phases**, and
`bench/phasegrid.ts` was written to score the same frozen targets by TIME. Scored honestly the
global walk is 2 hit / 4 closer / 17 same / **5 worse**, including a praised seam moving 0.64 s.
So it was scoped to marked movements, where `earlybars` returns to its exact floor. The
unrestricted form is still there behind `phaseResetCost` and still measurable; it is the
biggest known win left on the shelf.

**`react` could not judge the new effects, and the instrument that replaced it nearly lied
too.** The character probe's reactivity column is bytes moved over a journey normalised by the
effect's own mean, which a constant-flux design minimises by construction - so `emberBump` and
`crossbeam` scored near zero while landing plainly. `bench/punchprobe.ts` asks instead how far
the room moves at the instant of a kick, reporting the weakest tenth of hits beside the median.
That worked - until `lean`. It scored a healthy 33/35/72, and then a bug was found in it: the
lobe snapped to the full next seat at the beat, which is precisely the discontinuity the
gesture was written NOT to have. Fixing the bug dropped it to 1/1/1. The effect was not broken;
the instrument was reading the wrong half of the beat, because `lean` puts all its movement in
the quarter-beat BEFORE the hit. An `approach` column was added and it reads 58 there. **Both
halves of that episode are the lesson: the healthy number was measuring the bug, and the dead
number was measuring the wrong window.**

**A docblock caught out its own code.** `crossbeam` claimed the beam takes back the same LIGHT
the ring gives up. The arithmetic conserved the authoring LEVEL, and the authoring domain is
gamma encoded, so the room actually brightened on every kick by the amount the effect existed
not to spend. Fixed by doing the trade in light, which halved its measured punch and revealed
the earlier version had been over-driving the beam; the trade share was then re-swept from 0.12
to 0.26 to land back in the band honestly. Later the same effect had to be fixed again - it had
written down `GAMMA = 2.2` when the owner's calibration had already moved the room to 2.45, so
it now imports the constant. One rationale, one place, and this is what the rule is for.

**What the audits got wrong.** The sectioning audit reported that EARFQUAKE's choruses do not
group as kin and its reserved master is therefore skipped. Measured at v23 they group fine
(group 1 covers sections 1/3/5) and the peak sits at bar 24, past `SETTLE_BARS`. That note in
the handover was stale and the audit had repeated it from the docs rather than from a blob.
The effects audit was accurate on everything checked, but its counts of the carrying pools were
computed with a predicate that inverted `taste.carries` (absent means it CARRIES), so "three
carrying accents" was right by luck and "carrying beds: 1" was wrong.

**The last thing to land was not code.** The room's calibration changed underneath the round, and
then changed again. It settled at **GAMMA 2.45, knee 0.84, MASTER 1**: the owner judged 2.45 on
real strips and kept it, kept the knee's lift with it, and rejected the 0.7 dimmer as flat on a
single 5 m reel. Every byte figure in the records was re-measured against that. The dimmer is not
gone, only at unity, and it is the knob for when all three reels are hanging.

## If you are the next session: the first hour

0. **THE SUITE IS RED, AND IT IS NOT ROUND 9.** Two tests fail: `measure.test.ts` x1 ("leaves
   no bar dark outside a void") and `effects.test.ts` x1 ("every effect claiming to carry a
   room can actually fill one", where `wash` and `spectrumBed` no longer do). Both come from
   the calibration, not from this round.

   The cause is `GAMMA` 2.2 -> **2.45** with the highlight knee 0.78 -> **0.84**
   (`output.ts:192` and `:37`). The exponent pulls the mids down and the knee lets peaks run
   closer to full, which is the contrast the owner asked for and judged on real strips. What it
   costs is the bottom of the range, and those two tests are where that shows.

   **This is a settled decision, not an open one.** It was tried at three calibrations and this
   is the one that was kept. Do not tune the exponent to make the suite green, and do not
   relax those thresholds either - they are what stop a cue shipping black, and they are
   telling the truth. If quiet passages need lifting, the knob is the mixer's **house floor**,
   which raises beds without giving back any peak contrast. That has not been tried yet and is
   the obvious next experiment.

   It was briefly worse: a `MASTER` dimmer at 0.7 took seven effects and four ambient scenes
   under, and was rejected as flat. `MASTER` is still there at unity for when all 12 m hang.

   The `geometry.ts`/`geometry.test.ts` changes (run labels, reel-pairing regions) are part of
   the hardware bring-up and are fine.

1. **ROUND 9 IS COMMITTED BUT THE ROOM HAS NOT HEARD IT.** Read the round record's "Round 9"
   section and "How round 9 actually went" above, then this list. The owner installed the
   build and said they would test after. **The first job is to collect that verdict, not to
   add work.**
2. **What to ask the room about, in order.** Hand back a SHORT list, never the whole corpus:
   - **SICKO MODE** - the whole second half was firing on the snare and now is not. This is
     the round's headline and it is a one-minute listen from 1:00.
   - **Any peak at all** - `chromaBurst` went from peak byte 40 to 145 and it lights the peak
     of nearly every show. The question to ask is whether it is now TOO big, not whether it
     works; the authored gain was left alone deliberately because 145 sits with tideBloom's
     159 and shutterCut's 162.
   - **The four new effects** - `subBreath`, `emberBump`, `crossbeam`, `lean`. They are the
     answer to "punchy but not distracting", they measure in counterweight's band, and only
     the room can say whether the constant-flux ones (`emberBump`, `crossbeam`) read as hits
     at all. That is the real open question about them: they move few BYTES by design.
   - **Melanz** - marked at 169.7 and 205.8, and its carry only reaches 43.6% where SICKO
     MODE's reaches 85.8%. If the room still hears it wrong, that is the next thread.
   - **Whether SICKO MODE's hand map wants redrawing.** Its shipped carry is 54.2%, not the
     85.8% the walk reaches alone, because 14 off-grid map boundaries cut the grid to where
     they were drawn - and they were drawn against the OLD wrong-phase grid. The map wins by
     design; the question is whether it should still say what it says.
3. **The unrestricted phase walk is the biggest measured win still on the shelf.** It lifts
   Cigo 32->66, Thinkin 36->69, Safir 52->87, KITN 47->87 - the entire phase-suspect cohort -
   and it is refused today only because `bench/phasegrid.ts` scores it at 5 worse against
   praised seams. If the room likes what the scoped walk did to SICKO MODE, the honest next
   move is to put the unrestricted form in front of it on ONE of those tracks and listen,
   rather than to keep trusting a bar-numbered instrument that provably cannot judge it.
4. **Do not gate a re-phasing change with `earlybars` alone.** A reset renumbers every bar
   after it, so a bar-numbered target stops naming the same instant. Use `bench/phasegrid.ts`,
   and know its own limit: it converts the target bar through the A-side grid, so A scores
   0.00 by construction wherever A's boundary IS the target bar. `bench/targets.ts` is the one
   copy of the frozen ground truth both instruments read.
5. **A note is not a movement mark.** The owner's "NEW SONG HERE" marks arrived as notes, and
   `movements` stayed empty, so the phase fix would not have applied. They were converted this
   round. If a future report says a movement fix "did nothing", check `movements` in the judge
   file first.
6. **What is designed and NOT built**, in value order:
   - the per-movement ENGINE slice (palette, peak slot, vocabulary) - the owner chose all four
     of these in round 7 and none has shipped. The trap on file: a cue with no palette resolves
     against the SHOW palette, never the previous cue, so a movement's palette must be written
     concretely into every cue of that movement.
   - a better movement-candidate offer. The shipped one fires on **33 of 114** tracks. A
     piecewise-constant tempo fit plus a step-vs-ramp test (does a smooth acceleration explain
     the change, or only two straight lines meeting at one beat?) cuts that to 4 of 132 while
     keeping SICKO MODE at step 1.00 and Melanz at 0.94; Blinding Lights 0.49, Hannah Montana
     0.43, Enter Sandman 0.17 and Highway to Hell 0.05 fall away. The prototype lives in the
     session scratchpad only - it was never landed in `bench/`.
   - Raveform's `structures/segments.json` carries `tempos: [{start, bpm,
     beat_position_in_bar}]` for 1423 tracks, of which exactly **8** have a genuine >=5% tempo
     change. That is a real acceptance-test denominator for any movement detector, it is
     licence-clean, and it is already in the repo. It also settles the contract question:
     store tempo ANCHORS with a bar position, which is the Rekordbox `<TEMPO>` shape.
7. **Still owed regardless of any feature**: eight effects plus `Presence` rescale
   retroactively when the beat period steps, and they already misfire on the idle transition
   (40 bpm against a track's 130). The gate has never run a tempo step - `scriptFrames` holds
   one `beatPeriod` for its whole journey. A fifth stage at another bpm would catch all nine
   and is the cheapest regression test available for the class.
8. **A map is LAW on its track, and it is heard on the NEXT PLAY**: `TrackAnalysis.handMap`
   stamps the map that was adopted and ingest re-analyses on any difference. The loop to offer
   the owner is listen -> redraw in the panel -> play. The maps are, in the owner's words,
   "NOT 100% fully the best": Safir's verse was drawn a beat off its own confirmed bar line and
   Blinding Lights' outro on a mid-bar beat, both rounded onto bar lines by the adoption.
9. **PACKAGE C IS CLOSED** with ground truth on both sides: Snooze's map choruses (24/56/79/83)
   match its lyric hook starts within a bar, while Blinding Lights' (23/39/63/79/113) miss its
   hook starts (33/72/104/128) by ten bars and more. Hook-placed choruses fix one and wreck the
   other, and no measurable column separates the two. Do not rebuild it.
10. **Smaller open threads**, in value order: the refine-margin class (nine one-bar-early
   boundaries, all the same mechanism - `refineBoundaries` needs a candidate to beat the
   incumbent by 45%, and a fill scores identically to the slam a bar later); Snooze's DP first
   chorus at 17 where the map says 24; Self Aware kit precision (win condition = raising the
   SOPHIE fixture's 0.4 precision floor); `gridTrust` now judges the owner's own map density
   (nothing near the 4.5/min gate today - the densest map is 3.3); Back In Black double-time
   (parked, owner ground truth on file: "verse 2 should be as verse 1 in length").
11. **Commit discipline**: Conventional Commits per CLAUDE.md, though the recent history all
   reads `NOISSUE <sentence>` - the discrepancy is the owner's to settle. No co-author trailer,
   no em-dashes anywhere, stage explicit paths, and only commit when the owner says so. Leave
   `packages/preview3d/*` and `firmware/*` alone: both are the owner's own work.
