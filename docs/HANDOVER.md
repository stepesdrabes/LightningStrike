# Handover

State as of 2026-08-18 (round 8 in flight): v23 / SHOW 18 / CONTEXT 3, everything
committed through `0a90511`, 827 tests green. Multi-tempo is researched and three
slices have shipped. **ONE DEFECT IS OPEN AND IT IS THE FIRST THING TO FIX** - the
section editor does not honour the owner's drawn boundaries and the preview toggle
sticks; the whole task is written up in `docs/BRIEF-section-editor.md`, with measured
evidence. The map loop, which the defect sits on top of: A hand-drawn map decides its track outright - grid
and sections both - and it is heard THE NEXT PLAY, not the next version bump: the
analysis stamps the map it adopted (`TrackAnalysis.handMap`) and ingest re-analyses
on any difference, redraw and delete included. Adoption is room-confirmed: Blinding
Lights 3* -> 5*, Ponyboy 2* -> "way better", Hannah's sectioning praised, and the
owner hand-arranged Snooze. Package C (lyric-assertive placement) is DEAD - the
owner's Snooze and Blinding Lights maps disagree about the hook evidence, so it
would fix one and wreck the other. SHOW 17 answers Ponyboy's one complaint: a
drop-class passage that measurably pounds draws its looks a band harder.
Start at "If you are the next session" near the end, then come back to the top.
`docs/EFFECT_POLISHING.md` carries the method (judge loop, cluster-before-fix, the
kill criterion, bench-vs-room discipline). The complete campaign evidence lives in
`bench/judged/round-2026-08-14/`:

- `snapshot.json` - all 36 original judgements joined against the sections/cues/hits
  they were made against. Survives every version bump. Never regenerate it.
- `digest.md` - the human walk of the same. `diagnosis.md` - ranked root causes RC1-6.
- `adversary-review.md` + `round2-record.md` - every design, every adversarial finding
  and its disposition, and the room's verdicts per round. READ round2-record.md FIRST:
  its tail sections carry rounds 2, 3 and the round-4 target.
- `ab-verdicts.md`, `listening-list*.md`, `research-endings.md` (verified citations),
  `sweep-record.md` (every corpus sweep number).

The older overhaul history (pre-campaign) is in git at `fd9cbb0` and in the session
memory; nothing there is needed to start round 4.

## Where the code stands

Everything through the finishing wave is COMMITTED (seven commits 2026-08-15,
b5c3fbc..49bf891): the v20+v21 analyser slices, the bench instruments, the judge
trio (section editor, typed hit marks, arrangement preview), the v22 cuts path +
settle gate + SOPHIE fixture + genre provenance, the engine round (SHOW 16), and
the records. The owner's own in-flight work stays uncommitted: `docs/hardware.html`
and everything under `packages/preview3d/` - DO NOT touch or commit those; stage
explicit paths only. The sectioning-model memo was moved OUT of the repo by the
owner on purpose (a second research agent must not read it) - do not recreate it.

ANALYSIS_VERSION 23, SHOW_VERSION 17, CONTEXT_VERSION 3 (round 7: the map->cuts
carry-forward, corroborated residues, map adoption, the map stamp that makes a
fresh map audible on the next play, kick-corroborated genre families, and SHOW 17's
pounding band raise - all UNCOMMITTED at handover time unless the owner said commit;
the previous state was v22 / SHOW 16 / CONTEXT 2, the finishing wave:
v20 boundary slice, v21 pounding arm, v22 listener-cut grids + settle gate +
audioGenres; SHOW 16 = group-final peaks + the leaving pass). 806 tests green,
`npm run check` clean. earlybars at v23: 20 hit / 0 closer / 8 same / 0 worse of
28 - THE FLOOR, and inert by design: analyzeTrack reads no judgement, so adoption
cannot flatter it. structscore v22 identical to v20/21 (sweep-record.md). Judged-36
analysis-side ZERO drift from v21 on frozen code; composition side moved by
design: peaks Vitej 81->82, Titi 37->54 (EARFQUAKE stays 8 - its choruses do not
group as kin, a GROUPING question on the ledger), and five fade-class tracks
gained decline steps (Thinkin, Self Esteem, Blinding Lights, Someone You Loved,
Cigo). Room verdicts on file: Vitej GOOD, EARFQUAKE GOOD, WTSA GOOD, SAFIR
piecewise CONFIRMED including the healed strobe edge, Ponyboy labelled correct
by hand map. The cuts loop is CLOSED: a hand-drawn map re-grids its track on the
next analysis automatically.
Commit discipline: Conventional Commits, no co-author trailer, no em-dashes anywhere,
stage explicit paths, only commit when the owner says so (the pattern each round:
implement -> gates -> owner listens -> owner says "commit").

What shipped, one line each (details in round2-record.md):

- R1 (v17/v13): same-material consolidation behind five guards; club vocabulary needs
  kit corroboration (CLUB_KICK_FLOOR 0.4); hasDrops behind `audible`; the Discogs
  "Folk, World, & Country" parent no longer votes; heartbeat kick-gated; `silhouette`
  peak master added. Room: B beat A 3 wins / 5 ties / 1 loss.
- R2 (v18/v14): hook-snap physics veto (physics-only arrivals - the voice term was
  grading itself); peakStyle on masters (pools pinned by test: slam = blinderWall,
  chromaBurst, shutterCut, silhouette; bloom = chromaBurst, tideBloom); outro bed
  inheritance; the cold-ending button; linter learned the finish-line anchor and the
  outro repeated-stack exemption. Room: 4 good, 0 regressions.
- R3 (v19): the ratio form of the snap veto restored (entrance windows ONLY - a
  restart cannot lag or lead) and the absorb-left move for 2-bar builds. Room:
  EARFQUAKE went 2* -> 5* ("sectioning is great"); Vitej 3* -> 4*.
- R4 (v19/v15 + playhead): the breath dims instead of re-staging; indicators mark
  the heard instant. Room: playhead CONFIRMED; both seams still early -> reclassified
  (Vitej bar-class, Safir phase-class). Round 4 closed in the round record.
- R5, the finishing wave (v20 -> v22 / SHOW 16, COMMITTED): stay-pins + vote split
  + pin-aware fold + restart noise floor (v20); the pounding drops arm (v21);
  listener-cut grids with true short bars, the settle gate's measured negative,
  the SOPHIE kit fixture, audioGenres provenance (v22); group-final peaks and the
  leaving pass (SHOW 16); the judge trio (section editor, typed hit marks,
  arrangement preview). Room: Vitej/EARFQUAKE/WTSA GOOD, Safir confirmed via cuts,
  Ponyboy fixed and hand-mapped. Ladder floor 20 hit / 0 worse of 28.

The boundary instrument `bench/earlybars.ts` is the campaign's backbone: 18 frozen
owner-marked pairs + 10 sentinels (28 rows), scored against whatever analyzer is
checked out. Current full score 20 hit / 0 closer / 8 same / 0 worse of 28 (the
v22 floor; WTSA ear-confirmed at 83). Run it after ANY analysis change - with MV_CACHE_DIR pointed at a
cache that has Kisses/WTSA audio (cache-C today; the primary cache lacks those
two): `MV_CACHE_DIR=... node bench/earlybars.ts [--variant=NAME] [--no-lyrics]`.
First run per track pays BeatThis (~15 s each, cached in bench/corpus/.beats).
`--no-lyrics` attributes an error to the DP/refine vs the hook snap - it found
EARFQUAKE. The scorer reads non-build section starts (a build is the approach, not
the seam). Its sibling `bench/stagetrace.ts` (round 5) replays the structure stages
one call at a time in cache coordinates and self-checks against a real analyzeTrack
run - the instrument that named every mechanism this round.

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

## The original phase brief (kept for the evidence and the code map; hypothesis REFUTED)

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

## The apps and caches (the owner's A/B/C setup)

- `/Applications/LightningStrike.app` = A, the ORIGINAL judged build (337d06f), on
  `~/Library/Application Support/cz.drabek.lightningstrike/cache` (+ judge/ = the 36
  original judgements, already fully mined into snapshot.json).
- `LightningStrike (B).app` = round 1 (v17/v13) on `cache-B` (round-1 A/B verdicts
  in its judge/).
- `LightningStrike (C).app` = ROUND 4 FINAL (v19/v15 + the playhead fix) on
  `cache-C` (round-2 and round-3 verdicts in its judge/, all mined; the round-4
  listening verdicts LAND HERE and are the next session's first read).
- Round 5 hands over by replacing C again (after mining its judge/) or adding D -
  ask the owner which.
- **THE INSTALL TRAP**: `cp -R new.app "/Applications/X.app"` onto an existing bundle
  NESTS it (X.app/LightningStrike.app) and the old binary keeps launching - one A/B
  was listened against the wrong build this way. `rm -rf` the target first, then
  copy, then verify `ls "X.app/"` shows `Contents` and nothing else.
- Cache clears keep audio/meta/context/judge and delete only `*.analysis.json` +
  `*.show.json`; stale versions re-derive lazily anyway (~30-60 s per track on first
  play). `cache114/` (repo, gitignored) is the 114-track gate corpus, regenerated at
  v19 - do not wipe. The judged-36 scratch copies in the session scratchpad are GONE
  (session temp); recreate from the desktop cache if needed (copy audio+meta+context,
  run `MV_CACHE_DIR=<dir> node bench/reanalyse.ts`).

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

1. `npm test` (764) and `npm run check`. If check errors with TS6305 after deleting
   dist/, `npx tsc --build --force packages/analysis` (stale tsbuildinfo).
2. `node bench/earlybars.ts` - 15 hit / 0 worse (of 28 rows) is the floor; any
   WORSE is a stop.
3. `node bench/structscore.ts --dataset raveform|harmonix --limit 60 --variant current`
   after analyser changes (baselines in sweep-record.md; label columns are BLIND to
   same-kind merges and lyric effects - read F0.5/F3/sections).
4. Judged-36 recompose readout: `node bench/judged-after.ts <scratch>` AFTER a scratch
   reanalyse - it diffs sections/phantoms/peaks/hits vs snapshot.json. IT DOES NOT
   LINT: the R2 ship-blocker (the button lint-deleting shows) was invisible to it.
   Always ALSO run `node bench/lintsweep.ts` (composes + lints the whole library;
   46/46 lint-clean is the floor, and the app fails DARK on lint errors).
5. `MV_CACHE_DIR=.../cache114 node bench/reanalyse.ts` then
   `MV_CACHE_DIR=... node bench/showprobe.ts` - 0 lint / 0 misfires / 100% quiet
   coverage, dark bars <= 2 (the known pair). Env var must prefix EACH command
   (an `&&` chain does not inherit it - this bit once).
6. Versions: ANY analyser change bumps ANALYSIS_VERSION, ANY composition change bumps
   SHOW_VERSION, in the same change. cache114 must be regenerated before showprobe
   means anything at the new version.
7. Build: `npm run bundle -w @mv/desktop` then `npx tauri build --bundles app` from
   apps/desktop (DMG fails on this machine; --bundles app is the path). ~4 min.
8. Background-run hygiene: a running structscore/reanalyse loads code per PROCESS at
   start - editing packages/analysis or core mid-sweep contaminates the variants that
   have not started yet (one sweep was killed and rerun for this). Land edits between
   runs. And if two desktop apps are open with the room wired, only one may stream to
   the board or it flickers between shows.

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

## If you are the next session: the first hour

1. **START WITH `docs/BRIEF-section-editor.md`.** The open defect, reported three times,
   with three of this session's fixes having each addressed something real and left the
   owner's actual complaint standing. Two parts, both with file:line suspects in the
   brief: (a) a grid cut re-walks the WHOLE bar table instead of splitting the one bar
   it falls in, so one deliberately off-grid boundary moved ELEVEN of the owner's
   sixteen on Melanz, by up to 1.68 s - measured, table in the brief; (b) the
   Preview/Original toggle sticks on Preview, most likely because saving a map now
   triggers a re-analysis that replaces `show`, breaking `togglePreview`'s
   `show === previewShow` identity check so the shelved show is dropped. Verify before
   fixing; do not delete that identity check, it guards a real case.
2. Then this file to the end, then round2-record.md's TAIL - the **round-7 verdicts**
   and the round-8 section (multi-tempo). `docs/EFFECT_POLISHING.md` is the method.
3. Everything is COMMITTED through `0a90511` and the tree is clean, except
   `docs/BRIEF-section-editor.md` which is deliberately uncommitted. Do not stage
   `docs/hardware.html` or `packages/preview3d/*` (the owner's own in-flight work).
   Only commit when the owner says so.
4. **MULTI-TEMPO: RESEARCHED, AND THREE SLICES SHIPPED (round 8).** The tempo is now read
   AT THE BAR (`bpmAt`/`beatPeriodAt` in core), which closed a live breach of the 8 Hz
   strobe ceiling - 9.2 Hz on SICKO MODE's fast movement, passed by a linter reading the
   same median the planner sized from. The tempo map is on screen: the player bar reads
   the local tempo with a "N tempi" chip, the timeline has a tempo lane, the inspector
   lists the segments, and the judge panel offers each change point as a movement
   candidate (SICKO MODE: 0:29 and 1:01), offered and never applied. What remains is in
   the record's round-8 section: PHASE (47 of 120 model downbeats sit off a bar line, and
   phase-reset candidates would need the model's downbeats stored, which they are not),
   three median-driven decisions that change how a show LOOKS and want the owner's ear
   (palette heat, lapBars, the genre flash budget - the owner asked to do these together),
   and the retroactive-rescale bug in eight effects plus `Presence`, which already
   misfires on the idle transition and which no gate has ever tested.
   The evidence, kept because it will be argued with again: The owner, after mapping SICKO MODE:
   "the songs contain sections that have completely different BPM and they might start
   offbeat compared to each other. That is the BIGGEST gap that the whole LightningStrike
   analysis have. It should be somehow displayed in the UI, and properly know the
   boundaries." Measured before any design (probes are in the round record):
   - Beat This ALREADY tracks it. On SICKO MODE the model reports 136.4 bpm to 58.3s and
     76.9 after, and 101 of its 119 downbeat intervals hold exactly four beats. The
     pipeline throws that away by fitting ONE tempo: only 47 of 120 model downbeats land
     on a shipped bar line (median miss 0.44 s).
   - The naive fix does NOT work: splitting at the switch and fitting a uniform grid per
     part recovers only 53% (Melanz 49%), because phase resets are scattered through the
     track, not just at the switch.
   - And an automatic detector would wreck normal tracks: the model's downbeats imply 18
     phase resets on SICKO MODE (3 sticky), 48 on Melanz (8 sticky) - and 27 on Je mi
     fajn, an ORDINARY track, because the model emits 2-beat bars when unsure. The signal
     points; it must not decide. Same wall the killed plateau detector hit.
   Shape the design around the owner's movement mark as the trusted anchor, per-movement
   level and phase read from the model's own beats inside the marked span, the tempo map
   shown in the UI, and candidate switches SUGGESTED for confirmation rather than applied.
5. MULTI-SONG slice 1 is BUILT AND UNHEARD: a
   "New song starts here" mark in the judge panel gives the new song its own downbeat,
   a section seam nothing can merge away, and its own energy levelling. Ask the owner to
   mark SICKO MODE (its switch is at 63.5s) and Melanz, then listen. The engine slice -
   per-movement palette, peak arc and vocabulary, all four of which the owner chose - is
   designed and deliberately NOT shipped on top of an unheard change; the design notes
   are in the record's multi-song section, including the trap that a cue with no palette
   resolves against the SHOW palette rather than the previous cue.
6. THE ROOM HAS NOT HEARD SHOW 17. It has heard v23 adoption and liked it
   (Blinding Lights 3* -> 5* "almost perfect", Ponyboy 2* -> "way better", Hannah's
   sectioning praised). SHOW 17's band raise is unheard, and it moves TWO PRAISE
   SENTINELS - Pistacie 5* (5 of 12 cues) and EARFQUAKE 5* (2 of 11, a lightning
   landing on its peak bar). Those two head the listening list, with Ponyboy: the
   question for Ponyboy is whether "a bit more aggressive" is now right, too much,
   or still short, and whether its GROOVES (which pound at ~1.0 kicks/beat and were
   deliberately left alone to keep the drops stepping up) should rise too.
7. A map is LAW on its track, and it is heard on the NEXT PLAY: `TrackAnalysis.handMap`
   stamps the map that was adopted and ingest re-analyses on any difference. So the
   loop to offer the owner is listen -> redraw in the panel -> play. A map error is a
   show error until it is redrawn, which is the owner's accepted trade. Note the maps
   are, in the owner's words, "NOT 100% fully the best": Safir's verse was drawn a
   beat off its own confirmed bar line and Blinding Lights' outro on a mid-bar beat,
   both rounded onto bar lines by the adoption and neither treated as a grid edit.
   The owner offers measurements on request - ask.
8. Adoption blinds `bench/mapscore.ts` on any played cache: it would measure the
   adoption, not the analyser, and report ~100% forever. Run the eval on a cache
   regenerated with `bench/reanalyse.ts --no-hand-maps`.
9. PACKAGE C IS CLOSED, and now with ground truth on both sides: Snooze's map
   choruses (24/56/79/83) match the lyric hook starts (23/55/79/82) within a bar,
   while Blinding Lights' (23/39/63/79/113) miss its hook starts (33/72/104/128) by
   ten bars and more. Hook-placed choruses fix one and wreck the other, and no
   measurable column separates the two cases - the P6 vocabulary-blind failure again.
   Do not rebuild it. Snooze is fixed by its own map instead.
10. Smaller open threads, in value order: Snooze's DP first chorus is bar 17 where the
   map says 24 - seven bars, the refine-margin class, and the class now holds nine
   pairs (bad guy 23->24, KITN 21->22, PROVENZA 79->80, Thinkin 2->1, Cigo 50->49,
   Titi 73->72, plus Blinding Lights' three one-bar-early choruses); Self Aware kit
   precision (win condition = raising the SOPHIE fixture's 0.4 precision floor);
   EARFQUAKE's grouping (its choruses do not group as kin, so the group-final peak
   cannot reach the last one); `gridTrust` now judges the owner's own map density
   (nothing near the 4.5/min gate today - the densest map is 3.3 - but a busy map
   could route an adopted track to the lounge; needs the owner's call on whether a
   map exempts its track); a context correction lands one play before the show hears
   it (harmless at a version bump, pre-existing for every context change);
   An Ending's phantom share; Praha's restart edge at 0.63 vs the 0.6 floor;
   Back In Black double-time (parked, owner ground truth on file).
11. The model loop: 6 of the 15 maps that freeze the eval now exist (Snooze joined).
   Protocol note - four of the first five were drawn by EDITING the analyser's own
   sections (98-100% agreement before adoption), so they are partly derivative and
   cannot carry an independent eval. Maps on tracks the analyser gets WRONG are worth
   several agreeing ones: Ponyboy (35%) and Snooze (7 bars out) are the valuable
   pair so far. The memo lives outside the repo by the owner's hand - ask for it.
12. Floors and gates, current at v23 / SHOW 18: suite 827; typecheck clean; earlybars
   20 hit / 0 closer / 8 same / 0 worse of 28 (MV_CACHE_DIR at cache-C for
   Kisses/WTSA audio) - inert by design, since analyzeTrack reads no judgement;
   structscore raveform 0.394/0.540, harmonix 0.202/0.532 (unmoved at v23);
   47/47 lint-clean, 0 rejected; showprobe 0 lint / 0 misfires / 100% quiet, dark 2,
   contrast 2.75, hue jumps 2745 (contrast and jumps drifted from 2.76/2585 with the
   band raise - that drift IS the change, and the new numbers are the baseline);
   judged 36 at SHOW 16 vs 17 = 9 changed / 27 identical, transient layer only.
   Land edits BETWEEN background runs - the contamination incident in the record is
   what skipping that costs.
13. THE JUDGE PATH WAS AUDITED AND REPAIRED (round-7 tail, full detail in the record).
   Three reports of "the preview does not work" turned out to be four distinct causes,
   and the audits found five ways the judge file could LOSE DATA. What changed, all of
   it shipped: the preview re-sections the per-bar column and stages its own analysis;
   the preview composes the LIVE editor draft, not the file; every judgement write is a
   PATCH (each writer owns its fields), serialised per track and landed through a
   rename, so a star can no longer revert a redrawn map and concurrent writes cannot eat
   each other; the section editor snaps to BAR lines with shift for the beat grid; the
   preview and the adoption share ONE rounding rule (`nearestBar` in core - they used to
   break a mid-bar tie in opposite directions, four seconds apart on Melanz); and a
   boundary placed off the grid ON PURPOSE (flagged `offGrid` by the fine drag) now CUTS
   the grid to itself in both the preview and the next analysis, so the drawn moment
   becomes a real bar line. Older maps carry no flag and still imply nothing, which is
   what protects Safir's confirmed grid.
14. What shipped after the judge audit, all committed: the tempo read AT THE BAR
   (`bpmAt`/`beatPeriodAt`, closing a 9.2 Hz breach of the 8 Hz strobe ceiling on SICKO
   MODE's fast movement); `tempoSegments` and the tempo map on screen (player bar reads
   the local tempo with an "N tempi" chip, timeline tempo lane, inspector listing, and
   the judge offering each change point as a movement candidate); and the scrubber's
   names row plus the editor's keyboard nudge, in-lane movement dividers, undo and
   keyboard kind picker. The last of those is what the open defect sits on.
15. App C is rebuilt at v23 / SHOW 18 (2026-08-18 02:36). Rebuild via
   `npm run bundle -w @mv/desktop` then `npx tauri build --bundles app` from
   apps/desktop, `rm -rf` the target before copying (the nesting trap). Every track
   re-analyses once on its next play (~30-60 s) because the analysis version bumped,
   every context re-enriches once, and every show recomposes.
