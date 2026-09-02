# Round 2 record (v18 analysis / v14 show)

Driven by the A/B verdicts (ab-verdicts.md) and the 47 marked bars. Four work-streams;
two shipped, one shipped smaller than designed, one deferred with a reason.

## Boundary skew (the 22-early-vs-7-late class)

The instrument came first: `bench/earlybars.ts` freezes 15 complaint pairs (judged bar
vs the owner's true bar) plus 10 sentinels (praised boundaries that must not move).
Baseline at round-1 HEAD: 1 hit, 14 same, 0 worse - every error reproduced.

What survived four design iterations, each earlier one killed by the instrument:

- **The snap physics veto** (shipped): a FULL-REACH (2-bar) earlier pull in snapToHooks
  is refused when the incumbent bar's physics-only arrival is decisive (>= 2, the pin
  class) and the target edge is noise (< 0.6). Physics-only because the hook's own
  voice term was lifting the edge above the floor - the evidence on trial was grading
  itself. Distance-narrowed because a praised one-bar pickup (Praha 63) is
  indistinguishable from silence by arrival, which measures change, not level.
  Yield: EARFQUAKE 38 -> 40 and 6 -> 8 in isolation; in the full pipeline the chorus
  lands at 40, punctuation follows, and the peak relocates to the corrected chorus.
- **The settling-contrast term** (shipped OFF, settleWeight 0): sim(b, b+1) minus
  sim(b-1, b) - newness that persists. At weight 1.6 it fixed Killing In the Name
  21 -> 22 but moved two praised boundaries (KITN 49, Praha 63); at safe weights it
  buys nothing. The knob and the negative result are both kept.
- Final ladder: 12 hit, 0 worse of 25 (2 complaint pairs fixed + all 10 sentinels).
  The 13 unfixed pairs are refine-margin and DP class - round 3, instrument ready.

## Peak-master treatment matching (the A/B regression cluster)

`taste.peakStyle` on masters ('slam' | 'bloom', absent = both); `strongest()` refuses a
styled master on the other treatment. tideBloom declares bloom, blinderWall slam.
Až na měsíc recomposes to blinderWall (the A-preferred look); a 60-seed no-crossover
test guards it. Folds the Safír discoBall and Hannah Montana tension complaints'
master-level half; the peak-section ACCENT pool question stays open.

## Endings (5 chips, research-backed)

- **Outro inheritance**: an outro keeps the previous cue's bed and everything else
  leaves - the thinning is the gesture (research: no documented practice makes the
  entry into an outro an event). Fresh draws only when there is nothing to inherit or
  the bed cannot carry alone. The linter learned the exception narrowly (bed only,
  must equal the previous cue's).
- **The button**: a track ending cold inside drop-class material gets its final
  downbeat marked - slam where the bar kicks, colour lift where it does not, never on
  swell treatments or after a carved outro. In the wild: American Idiot bar 132, Cígo
  bar 117.
- Round 3 inherits: ring-out decay at the audio's own rate (T2), fade tracking (T3),
  afterglow and the queue seam (T4/T5 - partly app-side, outside this scope).

## Deferred: the relative arrival floor

Back In Black's cache grid is ~198 bars for a 255 s track - a double-time metrical
level, which doubles section resolution by itself. Its over-sectioning may be
grid-class, not floor-class; and a track-relative floor risks merging the confirmed
second-drop seams on the watchlist (Titi 53). Needs its own measured design after a
publishedBpm-correction check. (Also parked: boundlab disagrees with the cached grid
on such tracks - align before using it there.)

## Adversarial review, second pass (14 findings, dispositions)

The reviewer executed repros against the real library and found a SHIP-BLOCKER the
first readout missed because judged-after composes but never lints:

1. The button lint-ERRORED (`unanchored-hit`) on final sections that are not whole
   phrases - American Idiot and Cígo, the round's own flagships - and a rejected show
   deletes the track's show. FIXED: the linter learned the finish line as an anchor (a
   hit ending exactly where the record does is anchored to the one boundary every
   listener hears); regression test proven failing first. Post-fix: 46/46 library
   tracks compose lint-clean, 16 buttons placed.
2. The button yielded to routine phrase bumps (HUMBLE. unmarked). FIXED: placed before
   the flashes and punctuation; everything later yields through its own clear().
3. A bloom-family chorus ending took a slam its vocabulary forbids. FIXED: anthem rule
   applied to the button's kind.
5. Groove-base cold endings never qualified (Do I Wanna Know). FIXED: groove-base
   endings that pound (>= 0.8 kicks/beat) take the button.
10. repeated-stack fired on long inherited-bed outros, pushing agents toward the exact
    look-change the inheritance forbids. FIXED: consecutive outro cues exempt.
11. The lint exemption indexed the unsorted cue array. FIXED.
12/13. silhouette and shutterCut declare peakStyle 'slam' (a withheld centre and hard
    frames are impacts; an anthem wants its centre lit); the pool-membership test now
    asserts members per treatment, so a reshuffle is a deliberate edit. chromaBurst
    deliberately serves both (the generic biggest thing).
4/6/7/8/9/14: recorded risks, not fixed - swell cold-ends get no button (T2 territory),
    ring-out pollution by a stray kick, the band-lags-singer inversion of the veto
    (no on-record instance; every judged late-chorus error is 1 bar), the veto's
    edge-bar blind spot, single-raw-kick fragility, and the settle-scale coupling now
    named in the tuning docblock.

## Gates

762 tests green, typecheck clean, v18/v14. 46/46 library tracks lint-clean. Judged-36
re-analysis at v18: round-1 changes carried exactly; EARFQUAKE corrected with its peak
following the fixed boundary; no sentinel track moved. cache114 gate 0/0/100%.

## The room's verdict (B = round 1 vs C = round 2, 2026-08-15)

Good: Až na měsíc (the blinder punch back - the peak-style fix confirmed), Cígo a káva
(the button confirmed), Painkillers (guard held), Praha/Vídeň (good, one note),
EARFQUAKE (no complaint at the fixed second drop). Unchanged: Safír (the known blocked
pair, re-marked at 42), Stranded ("same as B" - the outro inheritance did not register
on its 4-bar outro; keep, but not a claimed win). No regressions reported.

Three time-anchored notes, all mined into earlybars:
- Safír 42 re-confirmed; mechanism known (the 2-bar build 41-43 blocks the snap via
  minSegmentBars). Top of round 3.
- EARFQUAKE first chorus: owner marks 7 against the in-window placement at 6 - the
  in-window edge-choice question, now a target instead of a guess.
- Praha 63 sentinel CONTESTED: owner says "maybe 64". The settle variants that pushed
  63 to 64 were scored worse against that sentinel; the sentinel is now a tentative
  pair at 64 instead. Instrument humility: sentinels built from silence are weaker
  than sentinels built from praise.

## Round 3, boundary slice (v19, same night)

The three owner-marked targets, all landed, measured by the grown instrument
(16 pairs + 11 sentinels):

- Safír 43 -> 42: the 2-bar build 41-43 blocked the snap via minSegmentBars; the move
  now absorbs such a build leftward (its first bar joins the passage it rose from) and
  the chorus starts where the owner marked twice.
- EARFQUAKE first chorus 6 -> 8: the DP had it right (arrival 6.48 at 8) and the snap
  dragged it to the sung entrance. The RATIO veto - tried in round 2 and dropped when
  the old Praha-63 sentinel scored its one disagreement as a regression - was restored
  after the owner's note overturned that sentinel, then narrowed to ENTRANCE windows
  only when the readout showed it sliding Le Freak's lyric-perfect RESTART chorus onto
  the band's arrival. A restart cannot lag or lead; an entrance can lead. Le Freak is
  now a sentinel.
- Praha 63 -> 64: falls out of the ratio veto, matching the owner's tentative mark.

Final ladder: 15 hit, 0 worse of 26. Suite 764. Readout collateral, flagged for the
listening list: EARFQUAKE's corrected first chorus now outranks by mean energy, so the
peak moved to bar 8 (before SETTLE_BARS, so its reserved master is skipped) - the third
data point for the queued peak-selection-by-mean redesign, not fixed here.

## Round-3 room verdict (same night, after the nested-bundle fix)

- **EARFQUAKE 2* -> 5***, tags cleared: "sectioning is great". The campaign's
  worst-complained hip-hop track, fixed by the boundary rounds; the peak-front-loading
  worry did not materialise ("maybe effects could be a more lively" only).
- Vítej 3* -> 4*; Praha's old rating and effects chip withdrawn (reset to unrated).
- Safír: analysis verified EXACTLY on the owner's marks (breakdown 33, chorus 42) -
  the residual complaint is hypothesised to be the one-bar strobe at 41 rolling into
  the slam at 42, reading as a false start. Vítej's note (drop "should start" at 81,
  where it IS, with the strobe at 80) fits the same shape. AWAITING the owner's answer
  before designing: is the pre-arrival strobe the thing that reads early?
- New boundary pairs into earlybars: Kisses 61 -> 63, Way Too Self Aware 84 -> 82.
- Back In Black: "verse 2 should be as verse 1 in length" - structure ground truth for
  the parked metrical-level thread (double-time grid).
- Self Aware 4*: "drums just A BIT off (taking the bassline as drums)" - kit
  false-positive thread, recorded.

## Round-4 headline target: downbeat phase (found via the owner's strobe answer)

The owner cleared the strobe lead ("strobe is okay like that before actual drop") and
named the real error: sections start "2-4 beats off". Measured on Safir's fresh v19
blob: the marked moments sit 1.3 and 2.5 beats AFTER the barTimes the grid uses, at
meter confidence 0.52 - the bar boundaries are correct in bar numbers while the
downbeat PHASE is displaced roughly half a bar from the felt one. Every gesture on the
track fires beats ahead of the music's own count. Hypothesis to test next: the
remaining "boundary off" residue on low-meterConf tracks (Cigo 0.32, Thinkin 0.36,
SICKO 0.39, Safir 0.52) is phase-class, not section-class - which would also explain
why bar-level fixes kept reading "a bit off" to the ear. Instruments: beatscore's
downbeat metrics (GTZAN), and a per-track phase probe against the owner's timestamped
marks (marks carry ~0.5-1 s reaction lag; the 2-4-beat report is the owner's own).

## Round 4, first slice (v19/v15, same session)

The phase probe (bench/phaseprobe.ts) REFUTED the downbeat-phase hypothesis before
any code changed: model downbeats agree with the shipped grid everywhere (the
disagreement % just re-derives meterConfidence), and owner marks are lag-dominated
(~1.5-2 s) - mid-bar positions appear on conf-1.00 praised tracks too. The real
"2-4 beats off": shapeApproaches' breath cue re-STAGED the room (bed-only) a bar
before each arrival; both owner marks sat exactly on it. Fixed with the owner's
delegated call: the breath keeps the full look and only dims (x0.6, 2-beat settle).
SHOW_VERSION 15. Verified on Safir 41 / Vitej 80 recompose, lintsweep 15/15 clean on
cache-C, suite 764. The listening question for the next A/B: do those two seams now
read as arriving ON the bar?

## Round-4 room verdict (2026-08-15 afternoon) - round 4 CLOSED

The owner listened to the final C build (breath fix + playhead fix, v19/v15) and
answered the three-item list. First marks ever taken on the heard clock.

- **Playhead: confirmed.** "Yes, it looks correct" - the heard-instant readout ships
  as-is and every future mark is more trustworthy than the pre-fix ones.
- **Safir seam: STILL EARLY.** Fresh mark t=67.4, "THIS is where the second chorus
  should start (it still starts early)". Third press on the same instant in three
  rounds (67.3 / 67.1 / 67.4) against the bar-42 line at 66.56; the press cluster
  sits ~2 beats after the grid line, and the half-bar flip would put the downbeat at
  67.38 - inside the cluster. Boundary is on the marked bar, the breath no longer
  re-stages, the clock is fixed: the remaining suspect is the model-plurality phase
  itself (meterConf 0.52), exactly the branch the round-4 refutation left open.
  OPENS the phase path: owner taps "one" per track, lag-calibrated on a praised
  high-confidence track; never a local discriminator.
- **Vitej seam: resolved to bar 82, NOT phase.** Fresh mark t=158.4, "THIS is where
  the last drop should start (it starts too early)" - the press lands 0.3 s before
  the bar-82 line (158.72) and the prose settles the contested 81-vs-82 pair: true
  bar 82, agreeing with round 1 and with the physics (e95 k4 at 82 vs e72 k0 at 81).
  Reread, round 3's "should start here" at the identical instant said the same thing;
  the truncated bar field misled. meterConf 0.99 - this is a plain one-bar-early
  boundary for the earlybars queue, unblocked now that the direction is answered.

Round 4 closes here: both round-4 changes shipped and verified, the playhead
confirmed by the room, and the seam residue reclassified - one phase suspect
(Safir), one ordinary boundary pair (Vitej 81 -> 82).

## Boundary-slice diagnoses (same day, instrument: bench/stagetrace.ts)

New instrument: `bench/stagetrace.ts` mirrors analyze.ts's structure pass stage by
stage on the CACHED earlybars beats (never a fresh BeatThis - boundlab's fresh grids
have disagreed with the cache by a bar) and self-checks every run by diffing its
final table against a real analyzeTrack on identical inputs (MATCH on all three
tracks below). Three pairs, three mechanisms, all named:

- **Vitej 81 -> 82: the DP phrase-rounds unpinned-but-correct bounds.** segmentBars
  and refine both put bounds at 80 and 82 (the 2-bar kickless cut before the last
  drop; arrival 5.89 at 82). Neither bound MOVED in refine, so neither earned a pin
  (pins are minted from moves only, analyze.ts), and arrange re-drew them onto the
  phrase line: 72->73, 80->81, the 82 bound deleted - the drop ships starting on a
  kickless rms-0.135 bar. Fix shape: mint pins for STAY-decisive bounds (unmoved,
  arrival >= pinScore), so facts outrank the phrase preference at unmoved bounds too.
- **Way Too Self Aware 84 -> 82/83: same stay-pin hole.** The drop-in at 83 is the
  biggest arrival traced so far (7.22, rms 0.082 -> 0.255), unmoved in refine, hence
  unpinned; the DP rounded it to the 4-bar line at 84. No snap involved. The owner's
  mark (t=120.2 at 169 bpm) reads 82 with 83 inside press ambiguity - the stay-pin
  fix cuts the error to at most one bar; re-listen decides the rest.
- **Kisses 61 -> 63: restart windows bypass the physics veto.** Refine's 62->63 move
  scored 5.44 and WAS pinned; the DP respected it; then snapToHooks pulled 63->61
  because the hook window at 61 is a RESTART and the R3 doctrine exempts restarts
  from the veto entirely (`!w.restart`). The singer runs continuously (vocal 1.00
  throughout), so a repeated line mid-flow read as a restart with nothing arriving
  under it (physics 0.23 at 61). Le Freak - the sentinel the doctrine protects -
  traced for the distinguisher: its correct pull 47->45 lands on an edge the band
  corroborates (physics 1.57 at 45), so an incumbent-strength veto would wrongly
  kill it, but the R2 NOISE-FLOOR test on the target (< 0.6) separates them
  cleanly: Kisses 0.23 refused, Le Freak 1.57 proceeds. Fix shape: restart windows
  keep their exemption from the RATIO veto but not from the absolute
  decisive-incumbent + noise-target refusal.

Both fixes are analysis-side (one ANALYSIS_VERSION bump), sweepable behind
earlybars 28 rows + structscore + judged-after + the full gate battery.
The owner chose "boundary fixes now"; Safir phase awaits the owner's taps.

## Round 5, boundary slice (v20): implementation

Tests first, proven failing: the Kisses restart pull reproduced against the veto
(pull [{23 -> 21}] where [] was demanded), the Vitej fold reproduced against
snapToPhrases (pinned 82 dragged to 81 by the sliver fold). The Le Freak guard and
the pinned-yield guard passed before and after. Suite 764 -> 768.

**The first form failed its own ladder and was revised before anything else ran.**
Stay-pins minted at pinScore from FULL arrivals scored 18 hit but 3 WORSE - Titi
73 -> 74, and the praised KITN 49 sentinel to 50. Two mechanisms, both instructive:

- KITN 50's full arrival (2.09) is voice-lifted - physics only 0.89 - so the pin
  minted itself from the hook term: evidence on trial grading itself, the exact R2
  lesson, now proven to apply to pin minting too.
- The stays joined the REPHASE VOTE and diluted KITN's unanimous move-pin phase
  {9,69,81} below the 0.8 agreement, silently switching re-phasing off track-wide -
  which is what had been producing the praised 49 (and Titi's 73) all along.

Final form, all shipped in one v20 bump:

- **Stay-pins**: physics-only, at `stayPinScore` 3 (not pinScore 2) - a moved pin
  proved itself against a contested neighbour, a stayed bound never did, so it pins
  only where no contest is conceivable. On-file cases split wide around the value:
  legitimate stays tower (5.9 / 6.0 / 7.2), the displacing ones sat at 2.4 and 0.89.
- **Vote split**: `rephaseToPins` gained a `voting` set (move-pins only). Stays are
  PROTECTED from re-phasing and the phrase snap but do not vote the track's phase -
  deciding one bar is a smaller claim than deciding the grid.
- **Pin-aware fold**: snapToPhrases' sliver fold redirects leftward when folding
  forward would drag a pinned startBar off its arrival.
- **Restart noise floor**: restart windows stay exempt from the RATIO veto (Le
  Freak's whole case) but cannot pull a decisive incumbent onto an edge below 0.6 -
  a "restart" nothing arrives under is a repeated line mid-flow, not a section.
- **Instrument**: earlybars scores against non-build section starts (a build's
  start is the approach, not the seam; verified against every v19 blob that this
  shifts no prior row). stagetrace now prints the real analyzeTrack table
  unconditionally - a mid-pipeline grep got read as the final table during
  diagnosis (rephase drags KITN's 58 to 57 and the restart hook snap corrects it
  back; the sentinel was never actually in danger in either version).

Ladder after revision: **19 hit / 1 closer / 8 same / 0 worse of 28** (v19 floor
was 15/0). New hits: Vitej 82, Kisses 63, Titi 54 (chorus on the owner's slam, with
its 2-bar build kept), Lose Yourself 23, KITN 21 -> 22 reverted to same (it was a
by-product of the diluted vote, not a designed fix). WTSA 84 -> 83 closer; whether
the owner's 82 or the physics' 83 is the felt bar goes on the listening list.
Suite 768, typecheck clean.

Corpus gate, v20 vs the sweep3 v19 baselines (cons16): raveform F0.5 0.383 ->
0.394, F3 0.540 flat, sections 18.1 flat; harmonix F0.5 0.196 -> 0.202, F3 0.528
-> 0.532, sections 10.7 flat. Boundaries on physical arrivals beat phrase-rounded
bars inside the tight window, on both corpora. Adversary follow-up shipped in the
same bump: the pin-aware fold refuses to grow a VOID over a played bar (a dark bar
in the room outranks a one-bar pin shift; test proven failing unguarded). Suite
769.

Named risks recorded, not fixed: An Ending (Ascent) phantomShare 0.53 -> 0.82
(ambient seams shifted off rounded bars; global phantom flat at 28%, 1* track,
listening-flagged); Praha's refused restart edge measures 0.63 bench-side -
a hair above the 0.6 noise floor, so a kick-detector change could flap it (the
app-path Adtof reading is what shipped the refusal).

App-path verification (reanalyse with BeatThis + Adtof, the build the room hears):
judged-36 scratch at v20 - 36/36 lint-clean, 10 buttons; judged-after vs snapshot
shows the intended moves (Vitej peak 81 -> 82 following its drop; Titi peak 37 ->
54 onto the corrected chorus; Safir's 2-bar build absorbed into one clean
breakdown 33-42 + chorus 42) and no sentinel drift. Kisses and WTSA (no cache-A
audio) verified in a separate mini-scratch: drop@63 and chorus@83 under model
drums too, both lint-clean. v19 -> v20 diff over the six tracks with cache-C
blobs: Vitej 81 -> 82 (the fix, alone) and one collateral, **Praha chorus 39 ->
41**: under Adtof kicks the band's bar pins and the restart noise floor refuses
the pull onto the singer at 39 - the Kisses mechanism on a second track, at an
unmarked seam. Praised Praha sentinels 24 and 64 hold; 39-vs-41 goes on the
listening list (1:26.8 vs 1:30.5).

## Round-5 room verdict, first pass (2026-08-15 evening, v20 installed as C)

- **Vitej mezi nama: GOOD.** The 82 fix confirmed in the room.
- **EARFQUAKE: GOOD.** Still holds at v20.
- **Way Too Self Aware: GOOD.** The stay-pin bar 83 is the ear-confirmed truth -
  the round-3 mark's 82 was press ambiguity at 169 bpm. Pair updated to true@83
  (now a HIT; ladder floor becomes 20 hit / 0 worse of 28).
- **Safir: STILL EARLY, now in the owner's own words a SUB-BAR error** - "starts
  at ~1:06, but should be ~1:07". The grid line is 66.56; the felt moment ~67.
  New instrument `bench/phasepick.ts` (strongest onset per bar, beat-phase
  histogram): BOTH owner-marked seams slam at +2 beats of the grid (breakdown
  +2.08 = 53.83 s, chorus +2.03 = 67.39 s - dead on the three-round press
  cluster), track-wide onset mass 67% in the back half of the bar. The half-bar
  flip hypothesis is all but confirmed by the record itself. New harness
  `bench/phaseflip.ts` staged a +2-beat variant into cache-C (doctored downbeats
  through the real pipeline, original hash/version, .orig backup, restore mode):
  flipped bar 42 starts 67.40 s and the chorus lands on it. AWAITING the owner's
  flip listen; their ear picks phase, then the general fix gets designed (the
  pin-class beat-phase vote at low meterConf - never a local discriminator).
- **NEW THREAD - Ponyboy (SOPHIE): "completely lost its energy in effects, does
  not work in A or B, was good way before."** First diagnosis (kick blindness)
  was WRONG and is retracted: it read `section.kicksPerBeat` off raw blobs where
  the field does not exist - undefined printed as 0. A measured investigation
  (subagent, full numbers in its report): both drum paths hear the kick fine
  (ADTOF 342, DSP 572, blob kick-rich at F=0.990 vs the model; the kick is a
  pitched sub gliding ~100 -> 60-90 Hz with no transient, and the flux that
  survives the bass-subtraction is 4-8x the picker floor). The REAL mechanism:
  **no section can earn drop class** - hasDrops (arrange.ts) demands an energy
  step >= 0.22 or kick step >= 0.3 between consecutive sections, and a
  wall-to-wall banger has no step (Ponyboy: 0.11 / 0.125) - so every loud
  section is groove, both peak rescues are gated off, hits are two bumps, and
  the show never escalates. Fix design (A): a third hasDrops arm - club
  vocabulary AND sustained pounding (loudKickRate >= ~0.8, kit in >= ~90% of
  non-outro bars) counts as having drops, letting the existing peak-group rescue
  assign one. No detector change (measured as unjustified; it would move TOWARD
  the Self Aware failure). Gates: judged-36 zero sentinel drift, the beatless
  ambient counter-case stays excluded via `audible`, flat rock via genre.
  Second finding kept: the undefined-reads-as-0 diagnostic hole - per-section
  kit rates exist only in mining scripts, not on SectionSpan; give the tooling
  one shared computation off bars[].kicks so this cannot happen again.
- Kisses 1:47.8, Titi 1:59.0, Praha 1:30.5: no verdict reported yet.

## Safir resolved to a PIECEWISE-PHASE track (2026-08-15 evening, flip listen)

The owner listened to the +2 flip and prescribed the whole section map in five
marks (mined 17:10). Joined against both grids, the marks are bimodal: 14.8 and
106.8 sit ON the ORIGINAL grid's lines, 53.8 and 67.3 sit ON the FLIPPED lines
("this chorus start is CORRECT" - the flip won the 1:07 seam), 132.8 is +-1 beat
ambiguous. Beat-counting between marks: chorus start -> end spans 24 bars + 2
beats, and chorus start -> divide spans 24 bars + 2 beats again - the track
carries TWO half-bar edits, and NO single phase can serve it (meterConf 0.52 was
the pipeline noticing). bench/phasepick.ts's onset evidence agrees per passage;
the model's own downbeat stream wanders all four phases (cannot adjudicate).
Direction: a grid that absorbs 2-beat short bars at detected phase-shift points
(sustained local onset-phase plateaus, low-meterConf only) - variable barTimes
are already representable in the contract; every uniform-bar assumption
downstream is the design's risk surface. Next concrete step: hand-build the
owner-prescribed grid as a cache-C experiment (bench-side custom barSynchronous)
so the target state is HEARD before the general detector is designed.

Also mined: Praha "build should start there" at 15.1 (bar 4) - the v20 refine
move 4 -> 3 (score 5.19, pinned) contradicts the owner's ear; candidate pair for
earlybars once the current threads settle. The v20 room verdicts and the
section-editing UI request (drag boundaries in the judge panel, hand the map to
the analysis session) arrived in the same message; UI work opens as its own
track.

## The section-editing UI (2026-08-15 evening, apps/web - on the owner's ask)

The judge panel grew "Adjust sections": arming it opens the timeline drawer and
the section lane becomes editable - drag a boundary (snapped to the BEAT grid via
barAtTime/barTimeAt, so a hand mark is never rounded onto a wrong bar phase),
double-click splits, alt-click a handle merges, click a section for a kind picker
(the nine SECTION_KINDS with their swatches). Every gesture commits once, into the
judgement as `sections: JudgedSection[]` - kind + startTime/endTime (authoritative)
+ fractional bars on the pinned analysisHash grid - so a hand-drawn map survives
re-analysis and reads directly as mining ground truth. Server type + client mirror
updated in lockstep; the POST route needed nothing (it spreads). Two writers share
the judgement file (panel vs editor), merged through the page's map, and a save
racing the first judgements load now awaits it - the unguarded merge nulled the
sections field once during verification. Verified in the browser end to end: drag
-> bar 30.75 beat-snap, kind chorus -> drop, split at 21.50, merge back - one save
per gesture, all four confirmed through GET /api/judge. Typecheck + suite green.

## Safir piecewise grid: CONFIRMED by the room (2026-08-15 evening)

"Safir now looks correct!" - the staged two-cut grid (53.8, 106.8) lands every
seam. The hypothesis chain closed: sub-bar complaint -> phasepick evidence ->
five-mark prescription -> gridedit experiment -> ear confirmation. The staged
blob STAYS in cache-C as the owner's listening copy until the real fix ships.
The general fix (automatic half-bar-edit detection: sustained local onset-phase
plateaus at low meterConfidence producing 2-beat short bars) is the campaign's
next analysis design; the owner's confirmed cut points and, once drawn, their
hand-drawn section map are its gates. Ponyboy design A approved in the same
breath - implemented next.

## Ponyboy slice (v21): the pounding arm, implemented

`hasDrops` gained its third arm: on a club-family track (isClubFamily, the genre
half of speaksClub, passed into arrange), sustained pounding counts as having
drops - every inner section holding >= half the track's own q90 kick bar
(POUND_KICK 0.5) with the kit in >= 90% of bars (POUND_KIT 0.9). The existing
peak rescue then assigns WHICH group is the drop. Threshold chosen by
measurement, not taste: a blob-side probe over Ponyboy + every club-family track
of the judged 36 showed Ponyboy's inner grooves at kick 0.50-0.73 / kit 1.0 and
NO other dropless club track anywhere near the floor (An Ending and Someone You
Loved, the ambient/ballad sentinels, far under). ANALYSIS_VERSION 21.

Proof: Ponyboy app-path reanalyse -> `intro, groove, groove, groove, DROP@72,
outro` - the loudest passage is the drop, lint-clean. Gates: suite 769, typecheck
clean, judged-after at v21 BYTE-IDENTICAL to v20 (zero drift across the 36),
36/36 + Ponyboy lint-clean, earlybars 20 hit / 0 worse of 28, structscore both
corpora identical to v20 (raveform 0.394/0.540, harmonix 0.202/0.532). The
staged Safir piecewise blob and Ponyboy's fixed blob were re-staged at v21 in
cache-C so the version bump cannot lazily destroy the owner's listening copies.

## Safir strobe-edge complaint -> the piecewise design's first hard requirement

The owner: "the strobe at the end should be right on the edge of the last drop."
Composed the staged blob: the pre-arrival strobe sat in bar 65 - the LONG-BAR
WART (2.46 s, the bar that absorbed the cut's two deleted beats) - so a 4-beat
strobe stretched to six real beats and led the slam by 2.46 s instead of 1.64.
Requirement for the real detector, now measured in the room: **edits must be
absorbed as SHORT bars (2 listed beats), never long ones - pre-arrival gestures
keep their true duration.** The beats-deletion staging trick cannot express a
short bar; the real fix needs barSynchronous over explicit bar starts.

Staged copy healed meanwhile: the deletion point moved to a gesture-free
mid-passage bar (cuts now 53.8, 100.0 - the wart sits at bar 61 where only
bed/rhythm breathe), every owner seam still lands on a bar line, and the strobe
now runs 105.16 -> 106.80, ending exactly on the slam. Re-listen pending.

Also mined: the owner's first HAND-DRAWN MAP (Ponyboy, via the new editor):
groove 0-16, drop 16-32, drop 32-48, groove 48-64, drop 64-72, drop 72-80,
outro 80-81. Against the analyser's v21 single drop@72: the map wants TWO drop
blocks and a mid-track valley - the first concrete eval case for both the
sectioning-model research and any future peak/drop-assignment work.

## Hit marking in the judge panel (agent-built, same evening)

MomentNote gained `hit?: 'strobe' | 'slam' | 'blackout'` (server type + client
mirror in lockstep); the judge panel's mark row grew three compact typed-mark
buttons using ShowStrip's glyph language, and typed notes render their glyph in
the timestamp chip. The free text still says which way the complaint runs; the
kind makes it minable. Save path unchanged (the route spreads). Typecheck 0
errors, web tests 92/92. Mining rule for future rounds: a note with a `hit`
kind is a ground-truth statement about a hard hit at that instant - join it
against the composed show's hits the way boundary notes join against sections.

## bench/judgemap.ts - the hand-map eval harness (same evening)

Scores the analyser against every judgement carrying a hand-drawn map or typed
hit marks: per-second kind agreement (exact + sectionBase-folded), per-boundary
deltas, and hit marks joined against the composed show. First measurement,
Ponyboy v21 vs the owner's map: **boundaries largely right (4 of 6 on), kinds
35%** - the analyser calls the owner's drops grooves. The failure is LABELS,
not boundaries, which is precisely the applyHeadLabels contract's frame (the
head names sections, the DP keeps the seams) and the strongest argument yet for
the labels-first training target the research memo is evaluating.

## Sectioning-model research: memo landed at docs/SECTIONING_MODEL.md

Agent-researched with verified citations. The recommendation: resurrect P6's
machinery (frozen MusicFM int8 embeddings + a small head) under a new evaluation
protocol whose first law is "the owner's maps are an eval before they are ever
training data"; labels only, boundaries stay DP-owned; the room is the final
gate. Phase 0 runs with today's one map: build bench/mapscore.ts, score the
rules AND the rolled-back P6 head against the owner's maps. 15-20 maps freeze
the eval; 30-50 adapt the head. judgemap's first numbers (boundaries right,
kinds 35%) already point the same direction.

## The piecewise grid ships as the CUTS PATH; the automatic detector died on its instruments

Package A of the finishing campaign, v22, all in one evening:

- **barSynchronousAt**: the bar table over explicit bar-start beat indices; the
  uniform path delegates to it (equivalence proven by the whole suite).
- **The cuts path (SHIPPED)**: analyzeTrack accepts `gridCuts` (seconds) or
  `sectionMapBoundaries` (a hand map's internal boundaries; cuts derived from beat
  residues against the uniform grid - a map on a correct grid implies nothing).
  Each cut becomes one TRUE SHORT BAR ending exactly at it. ingest and reanalyse
  read the cache's judgement automatically: the owner draws a map, the next
  analysis obeys it. Safir through this path: every mark 0.00-0.10s off, 0.82s
  short bars at 53.80 and 106.80, the DP finding the owner's structure unforced -
  better than the staged long-bar hack it replaces, and staged into cache-C at v22.
- **The automatic plateau detector: built, measured, KILLED.** Unit-tested clean
  on synthetics; on the real track its evidence is structurally blind - a backbeat
  is symmetric under a half-bar shift, and Safir's phase-0 truth region voted
  0/0/5/2 by broadband strongest-onsets. It declined on the verified edits and
  hallucinated one on KITN, renumbering the praised 49 sentinel (the one WORSE the
  floor exists to catch). Deleted per the house rule; may return only with an
  asymmetric voter (chord/bass change at candidate lines - the research thread's
  boundary-evidence path), behind the same instruments.

Gates: suite 775, typecheck clean, earlybars 20 hit / 0 worse of 28 restored
after the kill. Corpus + judged-36 + cache114 formal runs at v22 in flight
(cut path provably inert without maps; expected identical).

## The finishing wave, packages B through G (same night, v22 / SHOW 16)

- **E: group-final peaks.** `peakSection` - the peak is the LAST statement of the
  loudest group, kind held so a degenerate grouping cannot leak it into an outro -
  single-sourced into the planner AND the linter (which had its own copy of the old
  rule and would have warned against the fix). Proven failing first on a doctored
  fixture (rank-1 on a group's first statement). Fixes on file: EARFQUAKE's skipped
  reserved master, Ine Plemena, Self Aware's peak, Hannah's tension drop.
- **D: the record leaving.** `trackTheLeaving`: where the final bars decline
  decisively (tail under 65% of the closing cue's head), the closing look steps
  down WITH the record - same layers throughout (the outro inheritance gesture),
  level and clock following, never to black, fadeBeats 8. The linter learned the
  decline step as sanctioned sameness. Cold endings stay the button's business;
  T4 afterglow stays with the lounge dissolve (already covers it; recorded, not
  built). SHOW_VERSION 16.
- **B: evidence-gated settle - a measured NEGATIVE, kept.** The gate (settle votes
  only under decisive physics; tried at 2 and 2.4) suppresses the harm AND the
  gain: ungated 1.2's one win travelled through a decisive bar the gate rightly
  silences. settleWeight stays 0; the gate and the result are documented in the
  tuning docblock so the next candidate weight starts from here.
- **F: the SOPHIE fixture guard**, as characterisation: a clipped pitched-sub kick
  over a legato bassline; recall > 0.8 guards the class staying heard, precision
  pinned at today's 0.4 - the clip synthetically REPRODUCES the Self Aware
  bassline-as-drums complaint, and raising that floor is the fix's win condition
  (the classes overlap physically; the model path carries precision in the app).
- **G: context provenance.** `audioGenres` split from metadata `genres` (the
  effnet echo made re-votes circular - Get Lucky wore "ballad" on its own
  reflection), CONTEXT_VERSION 2, lazy re-enrich heals every cached context on
  next play.
- **C: lyric-assertive placement - DEFERRED to its own session, by design.** The
  riskiest remaining package (four lyric-good sentinels gate it; the v16 snap's
  conservatism was deliberate) does not ship as the last act of a marathon; it
  opens the next session with hookcheck as its instrument.

**A method violation, caught and paid for**: the first v22 battery chain was
contaminated - its reanalyse process started during the settle-1.2 experiment
window, exactly the background-run hygiene the handover warns about. The chain
was killed and both batteries re-run on frozen code. The invariant stands: land
edits BETWEEN runs, always.

## Finishing-wave gates: ALL GREEN (final, on frozen code after the contamination redo)

Suite 778, typecheck clean, earlybars 20/0 of 28, structscore both corpora
identical, judged-36 analysis-side zero drift vs v21 with the composition moved
by design (peaks Vitej 82 and Titi 54; EARFQUAKE stays 8 - the choruses do not
group as kin, a grouping-question ledger entry; decline steps on the five
fade-class tracks), 36/36 + cache114 lint-clean, showprobe 0/0/100% with the two
ledger dark bars, contrast 2.76 / hue jumps 2585 (softened by the leaving pass;
coverage holds). Committed b5c3fbc..49bf891 plus this record.

## Round-6 room verdict (2026-08-16): the wave confirmed, five hand maps landed

Ratings: Vitej 5*, Kisses 4*, Praha 4*, Safir 4*, Someone You Loved 4*, Az na
mesic 4*, Blinding Lights 3*, Titi 3*, Ponyboy 2*. "Overall good/great"
across the board in prose; no regressions reported. HAND MAPS drawn on five
tracks (Safir 9 sections, Blinding Lights 11, Praha 10, Az na mesic 12 - a
bonus track - and Ponyboy re-saved): 5 of the 15 needed to freeze the model
eval. Blinding Lights' map IS package C's ground truth (choruses at 39.4,
61.9, 95.6, 118.0, 162.9 with the verses and builds drawn between).

Three findings for the next session, in priority order:

1. **The map->cuts derivation is wrong for maps drawn on a PIECEWISE grid.**
   Safir's map (drawn on the staged cut grid) derives cuts 54.20/67.40/106.80
   where the confirmed grid needs 53.80/106.80 - the residue walk measures
   against the uniform grid, but the map's boundaries carry piecewise
   positions. No immediate loss (the blob is current and will not re-derive
   until the next ANALYSIS_VERSION bump), but the next bump would corrupt
   Safir's grid. Fix shape: the judgement pins analysisHash - when the pinned
   analysis' own barTimes are non-uniform, carry ITS cut positions forward
   instead of re-deriving from residues (a map drawn on a correct piecewise
   grid confirms it; only a map drawn on a UNIFORM grid can imply new cuts).
2. **Ponyboy 2*: the map-adoption gap.** The owner's map wants drops 37-108
   and 144-180; the analyser's single drop@72-80 is a fraction of it, and the
   room still reads flat. The cuts loop honours a map's GRID but not its
   SECTIONS. Design: when a judgement carries a hand map, the analysis adopts
   the map's kinds and boundaries wholesale (snapped to the grid, spans
   rebuilt from bars) - the owner's truth outranks the DP on mapped tracks.
   apps/web/src/lib/server/previewArrangement.ts (applyHandSections) is the
   reference implementation of the rebuild; it belongs analysis-side, driven
   from the same judgement read ingest already does.
3. **Someone You Loved wears genreFamily "house"** (the owner: "described as
   house for some reason") - a piano ballad. CONTEXT_VERSION 2 re-enriched it
   on today's play, so the fresh METADATA vote itself says house - inspect its
   context genres and mapGenres' vote; likely a metadata-vote bug, now clean
   of the effnet echo.

## Round 7 (2026-08-17): the map loop closed, package C refuted

ANALYSIS_VERSION 23, CONTEXT_VERSION 3, engine untouched. Round-6 verdicts were
already mined; no newer saves existed (the judge files' mtimes are the cache copy,
their updatedAt is round 6).

### The map->cuts derivation (finding 1): FIXED

`cutsFromBarTimes` reads a piecewise grid's own cuts back out by COUNTING BEATS per
bar - a cut bar is the one holding fewer beats than the meter. Bar durations cannot
answer it: Safir drifts 146 -> 190 bpm, so its tail bars are half a second shorter
than its head bars while every one of them still holds four. `handMapGrid` then
carries those cuts forward instead of re-deriving from residues, because a map drawn
on a piecewise grid carries positions from a grid whose bar lines have moved. Safir
at v23 through the real reader: cuts 53.80 / 106.80, every map boundary 0.00 off,
the verse rounding back from its 54.21 nudge onto bar 34. The new test fails against
the bug when the carry-forward is reverted (verified both directions).

Second half, on the owner's call: a residue change now counts only when the NEXT
boundary carries it too. An inserted half bar shifts everything after it, so real
evidence comes in twos; the editor snaps to BEATS, so a lone nudge onto a mid-bar
beat says nothing about meter. Blinding Lights' outro (185.345, 35 ms off a mid-bar
beat, one boundary of eleven) was cutting that track's grid and no longer does. The
cost, documented: an edit evidenced only by a map's last boundary cannot be
corroborated and must come in as explicit `gridCuts`.

### Map adoption (finding 2): SHIPPED

`handSectionBars` + the `hand` branch in analyze.ts. A judgement carrying a map now
decides its track: boundaries snap to the nearest bar line, kinds are the owner's
words, and the label passes, the hook snap and consolidation all stand down (that
last one matters - consolidation would fuse Ponyboy's two adjacent drops). Grouping
still runs `groupSegments` over the map's bounds, so repeats stay measured by
self-similarity rather than guessed from matching lengths as the preview's
`applyHandSections` has to.

All five maps adopt exactly, verified end to end through `bench/reanalyse.ts`:

    Safir      intro build@2 chorus@9 verse@34 chorus@43 build@66 chorus@68 breakdown@88 outro@96
    Ponyboy    groove drop@16 drop@32 groove@48 drop@64 drop@72 outro@80
    Blinding   intro verse@3 verse@7 chorus@23 chorus@39 chorus@63 build@77 chorus@79 build@111 chorus@113 outro@130
    Praha      intro build@3 chorus@8 build@16 chorus@24 chorus@40 chorus@48 build@56 chorus@64 outro@76
    Az na mesic intro build@8 chorus@16 build@40 chorus@48 verse@56 chorus@60 breakdown@70 breakdown@72 breakdown@80 chorus@88 outro@96

Worst internal snap delta 0.41 s (Safir's verse nudge, half a bar is 0.82 s); every
other boundary on every map lands 0.00 off. 5/5 lint-clean including the drop|drop
and breakdown|breakdown|breakdown seams the maps ask for.

`bench/reanalyse.ts --no-hand-maps` reproduces the un-adopted reading. This is not
optional hygiene: adoption would otherwise make `mapscore` measure the adoption
rather than the analyser and quietly end the model eval. Baseline before adoption,
for the eval's record: strict agreement 99 / 98 / 100 / 100 / 35 % (Az na mesic,
Blinding Lights, Praha, Safir, Ponyboy), macro F1 79 %, degenerate 0/5. Read those
numbers knowing four of the five maps were drawn by EDITING the analyser's own
sections, so they are partly derivative - high agreement there is not high quality.

### Package C, lyric-assertive chorus placement: REFUTED, not shipped

The owner's Blinding Lights map is what killed it. The map's choruses sit at bars
23 / 39 / 63 / 79 / 113; the sung hook windows sit at 33 / 72 / 104. The voice
arrives about TEN BARS inside the chorus the owner drew - on this record the synth
riff IS the chorus - so placing chorus starts on hook windows would move three of
five choruses ten bars late on the very track the package was gated by. What the
analyser actually gets wrong there is smaller and different: 22/38/62 against the
map's 23/39/63, one bar early three times, plus an extra seam at 128 the map does
not want. Refine-margin class, not lyric class.

Snooze points the other way (window 23 IS the owner's true bar against the DP's 17),
so the narrow form the owner approved was: place only where no boundary is already
within reach AND the lead-in is not the chorus's own material. Measured through
`bench/stagetrace.ts`, which grew a hook-placement readout for it (material ratio,
lead/body lengths, energy, vocal coverage, hook-bar coverage):

    track     window  must move  ratio  lead vocal  lead hookbars
    Snooze      23      YES      0.964     1.00         0.00
    KITN        64      no       1.021     1.00         0.00
    KITN        86      no       0.908     1.00         0.00
    Hannah      79      no       1.000     1.00         0.00
    Blinding    33      no       1.106     0.89         0.00
    Praha       30      no       0.912     1.00         0.17

Snooze's window is inside the sentinel range on every column measured, and KITN's
window 64 is Snooze's row with the digits shuffled. The only rule that separates
them - first chorus of the track AND lead fully sung AND no hook bar in the lead -
is three conditions fitted to one positive example with no reason why only a first
chorus would suffer it, so it was not shipped. The fifth design to die on an
instrument in this campaign, and the cheapest: two measurement passes.

What would settle it is hand maps on lyric tracks (Snooze, KITN, Hannah): the maps
are the only evidence that distinguishes a riff-chorus from a verse lead-in. Until
then a mapped Snooze fixes Snooze exactly, with no rule and no risk to the rest.

### Someone You Loved's "house" (finding 3): a measurement, not a vote

Not a metadata bug. The classifier itself heard Tropical House 0.63, House 0.48,
Pop Ballad 0.45; two house labels outvote its own ballad label on any weighting, and
the metadata ("Alternative") never gets a say. No vote arithmetic overturns that, so
the fix is physical: `familyCorroborated` takes a kick-claiming family's promise to
the record, using the loud-bar kick rate the drop vocabulary is already gated on
(CLUB_KICK_FLOOR 0.4). Ambient is deliberately exempt - silence corroborates ambient
rather than refuting it. The replacement family comes from the same labels with the
kick-claiming ones struck out, since the model was not hearing nothing.

Over the judged library, three tracks fail the floor and two have somewhere to go:
Someone You Loved house -> ballad (kick 0.00), Take Me (To The Moon) bass -> ambient
(0.31), and Way Too Self Aware (house, 0.31) keeps its verdict because its labels
offer no non-club family - the conservative direction. Every genuinely club track
sits at 0.61-1.38, Ponyboy at 1.12, so the pounding arm is untouched. The pass runs
after the analysis because that is where the measurement exists, and that order is
safe rather than lucky: the club privileges inside the analysis are kick-gated too,
so all three tracks had already been refused the drop vocabulary (chorus/verse
before this existed). CONTEXT_VERSION 3; the corrected family is persisted, so the
show, the picker and the panel all see it.

### Round-7 gates

Suite 799, typecheck clean. earlybars 20 hit / 0 closer / 8 same / 0 worse of 28 -
the floor, unmoved, which is the point: adoption and the cuts carry-forward are
INERT without a map, and earlybars calls analyzeTrack directly with no judgement in
sight. structscore identical to the v22 baselines on both corpora (raveform
F0.5 0.394 / F3 0.540, harmonix 0.202 / 0.532). Judged-36 re-analysed in a scratch
from the A cache (whose judgements carry no maps, so the DP path is what was
measured): 36/36 lint-clean, 10 buttons, phantom share 28% unchanged.

The real drift check is v22-vs-v23 rather than judged-after's v16 snapshot: of the
ten judged tracks with a frozen v22 blob in cache-C, NINE are byte-identical in
their section tables and the tenth is Safir, where cache-C holds the hand-staged
piecewise blob and the fresh run had no map to read. cache114 regenerated at v23:
showprobe 0 lint / 0 misfires / 100% quiet coverage, dark bars 2, contrast mean
2.76, hue jumps 2585, 111 palettes - the v22 numbers to the decimal.

### Two threads this round opened

- **gridTrust now judges the owner's own map.** Fragmentation routes a track to the
  lounge above ~4.5 sections a minute, and on a mapped track those sections are the
  owner's rather than the analyser's confusion. Nothing is close today (the densest
  map, Az na mesic, is 3.3/min), so nothing was changed - but a busy map could have
  the app answer it by refusing to trust the grid. A map arguably CONFIRMS its grid,
  which is the argument for exempting adopted tracks; it needs the owner's call.
- **A context correction lands one play before the show hears it.** `settleGenreFamily`
  writes the corrected family before ingest returns, so the show composed in the same
  pass uses it - but a track whose analysis and show are both already current keeps
  its show, because nothing hashes the context into it. Harmless for this change
  (the version bump re-analyses everything anyway) and pre-existing for every context
  change before it; worth knowing before the next one.

## Round-7 verdicts (2026-08-17 evening): four answers, one new complaint

The owner listened to the adoption round: **Blinding Lights 5*** ("almost perfect
this time", up from 3*), **Ponyboy "way better than before"** (up from 2*, with one
complaint below), **Hannah Montana "sectioning is nice"** - a PRAISE sentinel now,
not a silence one - and **Snooze arranged by hand**, the map package C had been
asking for. Also on the record, in the owner's words: the hand maps are "NOT 100%
fully the best", and measurements are available on request.

### Package C: killed by the owner's own two maps

The maps answer C's question directly, and they answer it both ways:

| track | map choruses (bars) | lyric hook starts | verdict |
|---|---|---|---|
| Snooze | 24, 56, 79, 83 | 23, 55, 79, 82 | agrees 4/4 within a bar |
| Blinding Lights | 23, 39, 63, 79, 113 | 33, 72, 104, 128 | disagrees by 10+ bars |

Hook-placed choruses would fix Snooze and wreck the track the owner had just rated
5*. The instrument cannot tell the two cases apart from inside: Snooze's repeated-line
runs start where its choruses start, Blinding Lights' start a third of the way into
each one. That is the same vocabulary-blind failure the P6 rollback is on file for,
so C stays dead in its assertive form and the four lyric sentinels were never put at
risk. Snooze is fixed by its map instead, which is strictly better evidence.

Also measured while C was on trial: Snooze's map first chorus is bar 24 where the
owner's earlier live mark said 23 and the DP says 17. The DP is seven bars early
there, which is the same refine-margin class as the remaining earlybars pairs - the
map does not tell us how to fix it, only that it is wrong.

### The map loop had a hole: a map drawn on a CURRENT analysis was never heard

Snooze exposed it within minutes of the round shipping. Adoption happens when the
analysis re-derives, and an analysis is kept while its version is current, so a map
drawn on a v23 blob would have waited for v24 - and a map REDRAWN after a listen
would never have been heard at all. Closed by stamping the map into the analysis
(`TrackAnalysis.handMap`, a fingerprint of the drawn kinds and times) and comparing
it in ingest's cached path: any difference re-analyses. Proven end to end through
the real `ingest()`: map heard once (re-analyse) -> next play cached -> chorus
redrawn 94->107s (re-analyse, bar 57 -> 65) -> next play cached -> map deleted
(re-analyse, sections revert to the DP's own reading).

Found on the way, and worth more than the fix: `handMapStamp` was referenced in
ingest without being imported, and the cached path's `try` swallowed the resulting
TypeError into a silent FULL RE-ANALYSIS on every play - a 40-second bug wearing a
policy's clothes. `npm run check` had not run since the reference was added. The
catch now covers only the read, so anything the cached blob is put through throws
loudly. The general rule, third time paid for in this campaign: a catch around more
than one operation is a catch that will one day hide the wrong one.

### The pounding band raise (SHOW 17), from Ponyboy's complaint

The owner: "I think there are A LOT of kicks/bass, so the effects should be a bit
more aggressive." Instrumented before designing: Ponyboy pounds at 0.95-1.25
kicks/beat in EVERY section, and its `bass` profile was already spending the hardest
punctuation it has (slam peak, 4 strobes, 4 slams, 3 bumps). What sat mid-scale was
the effect VOCABULARY: the picker's energy band comes from mean loudness
(`1 + round(energy * 4)`), this record is mastered flat at 57-78, so four of six
sections drew from band 3 of 5.

Shipped: a drop-class slot measuring >= `POUNDING_KICK` (0.8 kicks/beat, now one
constant serving all three of its consequences) draws one band harder, capped at 5.
Swell families exempt, on the same grounds their punctuation is. The owner chose this
axis over an impact-character preference and over raising intensity/motion.

Measured, corpus-wide (114 shows, 1548 cues): mean layer band 2.814 -> 2.825,
drop-class cues 3.270 -> 3.296 over 653 of them. Surgical because grooves are
untouched - which also preserves the contrast a track like Ponyboy has little of.
On Ponyboy itself the drops now draw rollerChase, doubleKickGatling, moshSlam,
lightning and silhouette where they drew chorusBloom and vuTowers; its grooves are
unchanged, so the drops STEP UP from them instead of matching them.

Judged 36 recomposed at SHOW 16 vs 17 on identical analyses: **9 changed, 27
identical**, and every diff is in the transient layer alone (snareBlade ->
pyroBursts, kitStage -> snareBlade, snareBlade -> lightning). Two of the nine are
the praise sentinels - **Pistacie 5*** (5 of 12 cues) and **EARFQUAKE 5*** (2 of 11,
including a lightning on its peak bar) - so they head the re-listen list. The rule
says a sentinel built from praise is the strongest one there is; this change moves
two of them and only the room can clear it.

### Round-7 gates

Suite 806, typecheck clean, earlybars 20 hit / 0 worse of 28 (the floor), 47/47
lint-clean with 0 rejected, judged-36 lint-clean, showprobe 0 lint / 0 misfires /
100% quiet coverage with the two ledger dark bars, 111 palettes. Two numbers drifted
and both are the change being visible: contrast mean 2.76 -> 2.75, hue jumps 2585 ->
2745 (+6%, harder effects move more colour). structscore untouched this round - the
analyser did not change after the v23 battery.

## Round-7 close: the sentinels cleared, and the next goal scoped

The owner re-listened after SHOW 17: **Pistacie "sectioning is almost perfect"**
(5*, one adjustment drawn), **EARFQUAKE "almost perfect"**, **Ponyboy "way
better"**, **Snooze one adjustment**. Both praise sentinels the band raise moved
came back clean, so SHOW 17 stands. Two new maps mined: Pistacie's is a strict
build/drop alternation (11 sections, no map before this), Snooze's verse and outro
moved by a bar. Six maps now, and the stamp means both adopt on their next play.

### The next goal, named by the owner: MULTI-SONG tracks

"I think a BIG gap is in multi-songs - such as Melanz by Yzomandias, SICKOMODE by
Travis Scott" - tracks that are two or three records stitched together. Scoped and
instrumented before any design, and the instruments came back with two refusals.

What the analysis sees today (both tracks already know something is wrong):

| track | reported | meterConf | flags | switch |
|---|---|---|---|---|
| SICKO MODE | 77.7 bpm | 0.39 | constant false, ambiguous, alt 116/155 | one, 63.5s, 136 -> 77 |
| Melanz | 79.7 bpm | 0.40 | constant false, alt 120/159 | a dozen level flips, 60 <-> 273 |

**Refuted candidate 1: timing discontinuity.** The biggest sustained local-tempo
step over a 16-beat window fires at x1.5 or more on 15 of 47 dev-cache tracks (32%)
and 30 of 114 in cache114 (26%) - including Praha/Viden (4*), Sapphire, EARTH -
Naporad and Snooze, all single-song tracks. A detector on this would re-grid a
quarter of the library to fix two tracks. This is the plateau detector's failure
mode exactly: a symmetric voter with no idea what it is voting on.

**Refuted candidate 2: material break.** If a beat switch swaps the record, the band
profile should jump. Measured as cosine distance between the 12s before and after,
against the same measurement at ten other points in the same track: SICKO MODE's
real switch scores 0.002 where the track's own median elsewhere is 0.024 - the
switch is TEN TIMES LESS of a spectral event than an average moment of the track.
Melanz at 266s: 0.002 against 0.009. Only Melanz's opening (28s) lights up, at 80x.
Both records keep their spectral balance across the switch; what changes is pattern
and tempo, which this cannot see.

**The recommendation: the owner marks movements, the way the owner draws maps.**
The channel already exists and has just proved itself twice over - the judge panel
draws, the judgement carries, the stamp makes it audible on the next play, and the
owner's truth outranks the DP on the track they marked. A movement mark would say
"a new song starts here", and the analysis would give what follows its own metrical
level and phase and its own energy normalisation, while the show re-stages: fresh
vocabulary, and the question of whether each movement earns its own palette and its
own peak arc is the owner's to answer. Accumulated marks then become the eval set
for a detector, which is the only honest order after two refutations - the same
protocol the sectioning-model memo sets out, and the reason the plateau postmortem
is on file.

### Multi-song, slice 1: the movement mark (SHIPPED, unheard)

The channel the two refutations pointed at, built and verified end to end. A movement is
marked by hand in the judge panel ("New song starts here", beside the typed hit marks),
carried on the judgement as `movements` seconds, and does four things in the analysis:

- **A grid cut.** The new song starts its own bar count instead of inheriting the old
  song's phase, through the same `barStartsAtCuts` walk listener edits already use.
- **A section boundary that survives.** It is pinned, forced into the table, and protected
  from BOTH merge passes. This is where the slice nearly died: `arrange()` has its own
  same-material merge, separate from `consolidateSections`, and it was eating the seam one
  pass after it was created. Guarding only the outer pass looked like it worked, because the
  seam was in `bounds` and gone from the output - the instrument that found it was printing
  the table at four stages, not reasoning about it.
- **Its own energy normalisation.** Every band and the loudness curve are levelled within
  the movement (`spansFor`/`normaliseWithin`, minimum 8 bars), so a quiet movement is not
  read as one long intro to the loud one.
- **Published**, as `TrackAnalysis.movements` (bar indices), for the engine slice to come.

Measured on SICKO MODE with its switch marked at 63.5s: the mark lands on bar 32 exactly,
the seam holds, the section table gains `chorus@32`, and THE PEAK MOVES TO BAR 32 - the beat
switch becomes the biggest moment of the show, which is what the record is famous for.

Verified through the app on Melanz: mark -> judgement -> automatic re-analysis (the stamp
covers movements too) -> `movements: [7]` at 12.2s. The test mark was removed afterwards so
it does not sit in the library as false ground truth.

Inert without a mark, and proven so rather than argued: `analyzeTrack` with `movements: []`
is BYTE-IDENTICAL to the same call without the field (a test asserts the JSON equality), so
no ANALYSIS_VERSION bump and no cached blob goes stale. Gates: 811 tests, typecheck clean,
earlybars 20 hit / 0 worse of 28, 47/47 lint-clean.

**Deliberately not shipped in the same breath: the engine slice** - per-movement palette,
peak arc and vocabulary, which the owner asked for and chose. The analysis slice is itself
unheard, and stacking a second unheard composition change on top of it is the one thing this
campaign's method forbids. The design is settled and waiting: a cue with no palette resolves
against the SHOW palette (`player.ts:130`), never the previous cue, so a movement's palette
has to be written concretely into every cue of that movement - including resolving the
'swap' that `paletteFor` returns for even drops, which would otherwise reach back to the
first song's colour. The reserved peak master stays ONE per show (the owner's standing rule);
what each movement gets is its own peak SLOT.

### Known interaction: a movement inside a MAPPED track

The map's boundaries are law, so a movement marked mid-section of a mapped track does not
add a boundary - it still cuts the grid and levels its own energy. In practice a new song
starts a new section and the owner draws it that way, but if a mapped track ever needs a
movement seam the map is where to put it.

### The preview arrangement was showing the map's cues against the old sections

Reported by the owner while asking for a working preview to map Melanz and SICKO MODE
with: "the subsections stay the same un-updated, and that is from where effects are taken".
Exactly right, and in two places.

**The deep half.** `applyHandSections` replaced `sections` and `moments` and left
`bars[].section` alone - its docblock even claimed a shallow copy of those two was "exactly
deep enough". It is not: `player.ts:226` builds `barSection` from the PER-BAR column and
line 467 hands it to every frame, so `ctx.f.section` in every effect was the OLD
arrangement while the cues around it were written for the new one. The linter reads the
same column (`lint.ts:451`), and `engine.test.ts:44` asserts cue and bar label agree - an
invariant the preview analysis was quietly violating. Fixed by rewriting the column with
the spans; the endpoint now returns 0 cue/bar-label mismatches on Melanz where it is the
only thing that could have been wrong.

**The shallow half.** The route returned only the show, and the client called
`viz.loadShow(analysis, previewShow)` with the ORIGINAL analysis - so the strip, the
scrubber and the inspector all described the arrangement the preview was replacing. The
route now returns the re-sectioned analysis with its show, and the client stages both,
shelving the real analysis beside the real show and restoring both on toggle-off (and on
a track change).

Two tests, both proven failing against the bug first. Note for the future: with adoption
shipped, the preview's window is narrower than it was - a map is adopted on the next play
anyway - but it is what makes iterating on a map bearable, since the alternative is a
30-60 second re-analysis per edit.

### The preview, round two: the map was being ERASED, and adoption had made the button inert

The first fix (per-bar labels + staging the re-sectioned analysis) was right and shipped, and
the owner still reported the preview not working. Driving the owner's own flow rather than
the endpoint found two further causes, one of them serious.

**A judgement write could erase a hand-drawn map.** Three writers share one judgement file -
the panel (rating, tags, notes, movements), the section editor (the map), and the mining
scripts - and each sends a WHOLE judgement built from whatever it happened to know. The
client merged `sections` defensively; nothing merged `movements` (so a section edit wiped
movement marks, a bug this session introduced), an empty list counted as an erasure, and the
server wrote whatever it was handed, so any writer that did not carry a field blanked it. A
map is an hour of listening and it was losable by pressing a star. The merge now lives in
`writeJudgement` where the file is: a missing field means LEAVE IT, an empty list means the
writer carried nothing, and only an explicit null erases - which is what the discard button
sends. Six tests, four of which fail against the old behaviour.

**Adoption had quietly made the button pointless.** A saved map is adopted by the next
analysis, so by the time the owner pressed Preview the current show WAS the map's show and
nothing changed - "it does not work" was an accurate description of a button with nothing
left to say. The preview now composes the map under the owner's hands: the endpoint takes
the sections in the request body (POST), the panel sends the live editor draft, and the
saved map is only the fallback. That also removes the save-then-read race entirely, and it
is what makes iterating on a map bearable - the alternative is a 30-60 second re-analysis
per edit.

Verified end to end in the browser: an unsaved three-block draft previews as three sections
and twenty cues while the sixteen-section map on disk stays untouched; the toggle posts 200,
the room, the section lane, the scrubber and the readout all follow, and toggling back
restores. Gates: 821 tests, typecheck clean.

Method note, paid for here: two of the three causes were invisible from the endpoint, which
answered correctly the whole time. They only appeared by DRIVING THE OWNER'S SEQUENCE -
mark, edit, preview - in the real app. A verification that stops at the API stops one layer
above where this class of bug lives.

### The actual cause: the editor drew on BEATS, the engine hears BARS

Third report, and the owner named it exactly: "the sub-sections do not actually snap to the
drawn sections. It creates new boundaries that are OFF the ones that I drawn."

Measured on the owner's own Melanz map, against the grid it was drawn over:

| drawn | nearest bar line | off by |
|---|---|---|
| 25.60 | 25.84 | -0.24 s |
| 41.60 | 39.60 | **+2.00 s** |
| 89.60 | 90.10 | -0.50 s |
| 121.35 | 121.10 | +0.25 s |
| 286.77 | 285.92 | +0.85 s |
| 300.31 | 301.14 | -0.84 s |

Every one of the sixteen boundaries sits EXACTLY on a beat; six of them are off a bar line.
The section editor snapped drags to the beat grid - deliberately, per the round-5 note, "so a
hand mark is never rounded onto a wrong bar phase" - but a section is addressed by whole bars
everywhere downstream: the adoption rounds, the preview rounds, every cue starts on a bar. So
the boundary the owner drew and the boundary the room played were up to half a bar apart, and
on Melanz's irregular grid two whole bars apart. The lane showed one thing and the arrangement
did another, which is precisely what was reported three times.

The beat snap is now a bar snap, in the editor and on the way in: `snapT` rounds to bar lines,
the drag and split limits are a bar rather than a beat, stored bars are whole, and seeding the
editor from a saved map snaps it too - so arming shows where each boundary WILL be heard
rather than where it was once drawn. Proven end to end: feeding the bar-snapped map through
the preview returns a section table IDENTICAL to what was drawn, and every drawn boundary
opens a cue. (Cues still split within a long section every 8 bars; that is the look changing,
not a boundary.)

The rationale that put the beat snap there is superseded rather than wrong: a listener whose
boundary genuinely falls between bar lines is describing a GRID error, and the answers to that
are the listener cut and the movement mark - both of which move the bar lines themselves
instead of pretending a section can start off one. The existing maps keep their drawn times on
disk until edited; adoption rounds them the same way it always did.

### And the correction to the correction: bars by default, beats on shift

Snapping the editor to bars fixed the mismatch and immediately cost the owner the ability to
work: "the step now is WAY TOO BIG". Measured on Melanz, they were right in the strongest
possible way - in a four-second window around 41s the bar snap offers exactly TWO positions,
because that track's bar table runs four seconds to the bar there. Beat resolution offers
five. A bar is 2 s at 120 bpm even on a well-behaved track, which is far too coarse to place
a boundary by ear.

Shipped: bar snap remains the default, so what is drawn is what is heard, and holding SHIFT
drags on the beat grid for the case bars cannot express. The panel says so while the editor
is armed ("bars · shift drags beats"), the drag and split minimum spans follow the same step,
and the adoption still rounds a beat-placed mark onto a bar.

The honest reading of a boundary that will not sit on a bar line: it is a statement about the
GRID, not about the section. Melanz's four-second bars are the multi-song grid problem in
plain view - the tracker reading one level across several songs - and the durable answers are
the movement mark and the listener cut, both of which move the bar lines themselves. The
shift modifier is the workaround until the marks exist for that track.

Three reports, three distinct causes, and only the third was the one the owner could see from
the room: the per-bar column, then the erasing writes and the button made inert by adoption,
then the snap resolution. Each was found by measuring the owner's own data rather than by
reading the code again.

### The save that ate the placement, and why bars are so long on this library

"After I adjust to beat, it DOES NOT save properly and I can't preview it like that."

One bug, two symptoms, and it was mine: `seedSections` snapped the saved map onto bar lines
every time the editor was armed. So a boundary shift-dragged to a beat position was rewritten
to the nearest bar the moment the editor re-opened, and the preview - which now sends the
draft - sent the rewritten one. The map on disk was fine; the editor forgot it on the way
back in. Seeding now takes the map exactly as saved, and stored bars are fractional again: a
hand map records what was HEARD, and it is the arrangement's job to round, not the editor's
job to forget.

Proven end to end on a scratch track (never on a track carrying the owner's own map): a
boundary placed one beat off bar 16 saves at 30.510s, reads back at 30.510s, survives
re-arming, and is what the preview request carries (`chorus@30.51`, not the bar line at
30.04). The rounding that remains is the engine's own - a section starts on a bar line or not
at all - and the preview now SAYS so: "N boundaries rounded onto a bar line, up to X.XXs".
Silent rounding is what made this look like the map was being ignored.

**Why the bar step felt enormous, measured.** Every track the owner is mapping is gridded at
a half-time reading:

| track | reported | median bar |
|---|---|---|
| Melanz | 79.7 bpm | 3.02 s |
| SICKO MODE | 77.7 bpm | 3.10 s |
| Ibalgin | 64.2 bpm | 3.74 s |
| Je mi fajn | 81.9 bpm | 2.92 s |

A three-second bar is a three-second snap step, and it is why only 10 of Melanz's 16 drawn
boundaries sit on a bar line. The editor is not the problem there - the metrical level is.
The shipped control is the inspector's re-read-at-this-level (x2), which halves the bar; the
owner's ear decides whether trap at 155 should be gridded at 155 or felt at 77. Worth
knowing before the next mapping session, and it is the same root as the multi-song grid work:
one level chosen for a whole track that does not hold one.

### The judge file audited, and it was losing data in five ways

The owner asked for verification rather than another patch, so the save path was audited
independently (subagent, read-only, runnable repros on a scratch cache). It found that the
merge shipped earlier that day closed one hole and left five open. All are now fixed and each
repro re-run against the real `writeJudgement`.

1. **A star reverted a redrawn map.** The panel's draft is seeded when the panel opens and
   carried `sections`; a map redrawn afterwards was overwritten by the next rating, because
   the merge's rule ("a non-empty array wins") cannot tell a stale array from a fresh one.
   Measured: 4 sections on disk, press a star, 2 sections on disk.
2. **A debounce in flight undid a discard.** Same root: discard, then the pending panel save
   lands and restores the map the owner had just deleted.
3. **A section save could blank the rating, tags, notes and comment.** The editor composed a
   whole judgement from a `judgements` map loaded ONCE per page and never refreshed, so a
   second writer (another tab, the desktop app, or a transient GET failure) meant the section
   save wrote page-load values over everything since.
4. **The write was an unlocked read-modify-write into the real file.** Twenty concurrent note
   adds left ONE note on disk, and a crash mid-write left a torn file that reads as no
   judgement at all - which then invites a blank save over an evening's work.
5. **The 500 ms debounce was dropped on track change**, so a rating given in the last half
   second of a song was written against the next song or lost entirely. Auto-advance makes
   that routine.

The fix is one idea rather than five patches: **each writer owns its fields and sends a
PATCH**. The panel sends rating/tags/notes/comment/movements and never the map; the editor
sends the map and the grid it was drawn against and never the panel's fields; the server
merges over the file, where absent means leave it, a value means take it, null means erase,
and an EMPTY ARRAY is a value (which is how the panel deletes its last movement mark - the
old rule restored it from disk forever). Writes are serialised per track and land through a
temp file and a rename, so concurrent saves cannot lose one another and a crash cannot tear
the file. Save failures are now surfaced instead of swallowed.

Re-run against the real path: the redraw survives a star with its sub-bar boundary intact at
30.51, a blind section save leaves rating/tags/notes/comment/movements untouched, the last
movement mark can be deleted, and twenty concurrent writes leave twenty notes.

Two smaller ones from the same audit: the boundary drag clamped AFTER snapping, so a drag
against its stop committed an off-grid boundary on any track whose bars vary (clamp first,
snap second now), and stored bars were rounded to two decimals, which misreports a beat in
3/4 by 5 ms (three decimals now). Left as noted: the panel re-pins `analysisHash` while a map
keeps bars computed on the grid it was drawn over - times are the authoritative coordinate
for mining, so nothing reads wrong today, but the stored bars can be stale after a
re-analysis.

### The preview and the room rounded a tie in OPPOSITE directions

The second audit (subagent, read-only, fuzzed against real grids) found the bug behind the
whole class of complaints, and it is a one-line disagreement between two copies of the same
idea:

- the preview rounded a fractional bar with `Math.round` - ties go UP, to the later bar;
- the adoption walked the bar table keeping the first nearest - ties go DOWN, to the earlier.

A boundary drawn on beat 3 of a 4/4 bar sits at EXACTLY bar + 0.5 by construction, so the
beat-snapping editor produced that tie constantly: 34.6% of beat-snapped maps in a 5000-map
fuzz, against 0% for maps drawn on bar lines. On Melanz the drawn boundary at 41.600s is bar
25.5 to fifteen decimal places - the preview put it at bar 26, the analysis at bar 25, FOUR
SECONDS apart on a track whose bars run four seconds there. The owner previewed one
arrangement and the room played another, which is exactly what was reported three times and
what no amount of staring at either side alone would have shown.

Fixed by giving the rule one home, the way `hitSeconds` and `strobePerBeat` already are:
`nearestBar` / `nearestBarIn` in `packages/core/src/grid.ts`, ties to the EARLIER bar because
that is what the adoption already did and what the room has been confirming by ear. Both
consumers call it. Proven on Melanz's real sixteen-boundary map: adopted and previewed
startBars are now identical, tie included.

Two more from the same audit, both fixed:

- **A map with a non-finite time produced a garbage preview rather than an error.** NaN spans,
  70 of 141 bars covered by no section, and `composeShow` quietly lighting the whole track as
  one outro. Non-finite boundaries are now dropped before the rebuild.
- **The preview accepted maps the analyser refuses.** A single-section map, or one whose
  boundaries all round onto the same bar, previewed as one span end to end where adoption
  returns null and keeps the DP table. Both now refuse the same maps; the route answers 422.

Noted, not fixed, with numbers on file: the preview's repeat grouping is approximate (it
matches on kind and length, adoption uses audio self-similarity - `group` differs on 11 of
16 sections on Melanz), so a preview repeats a different set of looks than the adopted show;
`spectrum` bakes a per-section scaling that the preview does not rebuild; `rawSectionCount`
is carried from cache and feeds only the show's brief text; and `meanEnergy` double-rounds by
at most one point. None of these move a boundary.

### The last of it: a fine-placed boundary now MOVES THE BAR LINE

"I can normally adjust the sections both with the fine grain and without, it persists
correctly. The problem is that when I click Preview arrangement, the subsections are NOT
correctly on the drawn boundaries. They move slightly and snap to something different."

The save was fixed; this was the rounding itself, and it had been treated as a law of nature
for three rounds: a section is addressed by whole bars, so a boundary between two bar lines
can only be rounded onto one. That is true of the SECTION. It is not true of the GRID, and
the repo has known how to move a bar line since Safir - the listener cut, which absorbs the
offset as one short bar ending exactly at the mark, room-confirmed.

So a boundary placed off the grid ON PURPOSE now cuts the grid to itself, in both consumers:
the preview rebuilds the bar table locally (`regridForMap`, using the same `barStartsAtCuts`
walk the analysis uses, with each new bar taking its measurements from the old bar its middle
falls in), and `handMapGrid` hands the same positions to the next analysis as `gridCuts`, which
re-derives them properly from the audio. Measured on Ibalgin: a boundary drawn 0.94 s past
bar 16 previews at exactly 30.980s, every section sits on a bar line of the previewed grid,
and the next analysis cuts at 30.98.

"On purpose" is a recorded flag, not an inference. The editor sets `offGrid` when a commit
lands between bar lines, which the default drag cannot produce - it snaps to bars. Maps drawn
BEFORE that, whose off-bar boundaries are beat-snapping artefacts (Safir's verse a beat past
its confirmed bar line, Blinding Lights' outro 35 ms off a mid-bar beat), carry no flag and
still imply nothing: the first attempt inferred intent from position instead, and two tests
caught it re-cutting Safir's confirmed grid.

The rule now reads: the plain drag says WHICH BAR, the fine drag says the bar line belongs
HERE. Both are honoured exactly, and the room plays what the preview showed.

Gates: 827 tests, typecheck clean, earlybars 20 hit / 0 worse of 28, 47/47 lint-clean.

## Round 8: the multi-tempo gap, researched and opened

The owner, after trying to map SICKO MODE: "the songs contain sections that have completely
different BPM and they might start offbeat compared to each other. That is the BIGGEST gap
that the whole LightningStrike analysis have. It should be somehow displayed in the UI, and
properly know the boundaries."

### What the research found, and how it shrank the problem

**The timing substrate is already piecewise.** `barTimes` is built from tracked beat times
through `barSynchronousAt`, so the grid already follows a tempo change. Measured on SICKO
MODE: bars run 1.74 s before the switch (138 bpm) and 3.10 s after (77 bpm). What lied was
the SUMMARY - `tempo.bpm` is a median, and the composition decisions all read it.

**The model already knows too.** Beat This reports 136.4 bpm to 58.3 s and 76.9 after, with
101 of its 119 downbeat intervals holding exactly four beats. Its paper names the case
directly - it refuses a global tempo head because that "assumes an (almost) constant tempo",
and lists "audio tracks containing multiple concatenated songs" as motivation. It emits
per-frame beat and downbeat probabilities and no tempo at all, which is the right shape for
this and is what we already run.

**But nothing may decide automatically.** The model's downbeats imply 18 phase resets on
SICKO MODE (3 holding four clean bars) and 48 on Melanz (8) - and 27 on Je mi fajn, an
ORDINARY track, because the model emits 2-beat bars when unsure. A detector on that signal
would re-grid a quarter of the library to fix two tracks: the plateau detector's wall again.
Splitting at the switch and fitting a uniform grid per part recovers only 53% (Melanz 49%),
so the naive fix does not work either.

**What the tools do, and it is what we already have.** Rekordbox stores tempo per beat,
Serato stores markers with beats-till-next, Ableton stores warp markers as (seconds, beats)
with "Warp From Here", Melodyne builds a tempo map and lets you correct it. All four store
ANCHORS and derive tempo - which is exactly what `barTimes` is. The correction gesture to
steal is Ableton's: pin a marker, re-derive to the right. That is the movement mark.

**A caution for any future gate:** CMLt/AMLt penalise a CORRECT tempo change, because they
demand continuity with the previous beat. `bench/beatscore.ts` would report this work as a
regression. The literature's answer is per-beat annotation coverage (ACR), and there is no
published task, dataset or metric for tempo-change-point detection at all.

### Slice 1 (shipped): read the tempo at the bar

`beatPeriodAt` / `bpmAt` in core, over the existing `barDurationAt`. The sharp fix is the
strobe: it was sized off the median AND checked off the median, so the planner and the linter
agreed with each other while both asked about a tempo the track never plays - licensing 4
flashes a beat at 138 bpm, 9.2 Hz, past the 8 Hz ceiling the room set at 9.4. Both sides now
ask at the firing bar; SICKO MODE picks 2/beat for 4.6 Hz, Melanz 4/beat for exactly 8.00.

Three clocks were already wrong on any drifting track, each hand-rolling a bar from
`firstBeat`/`beatPeriod` while the correct table-driven call sat in the same file: the agent's
onset tool, the timeline's hit markers (75% overdrawn on a fast movement), and the scrubber's
tooltip. Corpus unmoved - 47/47 lint-clean, showprobe 0/0/100%, contrast 2.75, hue jumps
2745 - because on a constant-tempo track the local value IS the median. SHOW_VERSION 18.

### Slices 2 and 3 (shipped): show it, and offer the boundaries

`tempoSegments` reads the map off the bar table: gather bars while their length holds within
12%, admit a segment once it lasts four bars. That threshold separates a tempo change (SICKO
MODE's switch is 78%) from the short bar a listener cut leaves behind. SICKO MODE reads
108/135/78, Melanz seven, Je mi fajn and Desire exactly one.

The player bar reads the tempo at the playhead (140 bpm in SICKO MODE's fast movement, where
it said 78) with a chip listing how many there are; the timeline grows a tempo lane with
dividers above the sections; the inspector lists the segments. All three appear only where
there is more than one segment.

And the judge panel offers the change points as movement candidates - "the grid changes tempo
here", one click to mark. SICKO MODE offers 0:29 and 1:01. Offered, never applied, for the
reason the measurements above make plain.

### Still open on this gap

- The remaining half is PHASE: only 47 of 120 model downbeats sit on a shipped bar line,
  because one uniform four-beat walk cannot follow the resets the model implies. A marked
  movement cuts the grid there; scattered resets do not have an answer yet, and phase-reset
  candidates would need the model's downbeats stored in the analysis (they are not today).
- Three decisions still read the median and all three change how a show LOOKS, so they want
  the owner's ear rather than a mechanical fix: palette heat (`(bpm-90)/85`, which clamps to
  zero on a track half of which runs at 136), `lapBars`, and the genre flash budget (which
  zeroes below 90 bpm and would silence a medley whose median is 79).
- Owed regardless of this feature: eight effects and `Presence` rescale retroactively when
  the beat period steps, and they already misfire on the idle transition (40 bpm against a
  track's 130). The effect gate has never run a tempo step - all 97 effects were admitted on
  constant-tempo evidence.

### The section editor is still wrong, and three fixes in a row missed it

The owner, after the scrubber and editor work landed: "The editor is STILL fucked up and
does not care about my drawn sections. They get saved correctly, but the switching between
Preview/Original is broken - only the Preview remained there? Also the subsections ignore
my boundaries. They rescale and snap to other beats."

Measured on the owner's real 16-section Melanz map, with ONE boundary nudged a beat off its
bar line and flagged `offGrid` - exactly what the editor's shift-drag produces:

**11 of 16 drawn boundaries did not land where they were drawn**, by up to 1.68 s. One of
them moved even though it sits BEFORE the cut. Two compounding faults:

1. A cut re-walks the whole bar table through `barStartsAtCuts` instead of splitting the
   one bar that contains it, so every later bar line shifts and every boundary that WAS on
   a line rounds onto a different one.
2. The re-walk does not reproduce the cached table even before the cut, so the preview's
   grid can differ everywhere.

The surgical shape - a cut SPLITS one bar and leaves the rest of the table alone - is
recorded in the brief rather than built here, because this needs measuring before designing
and the session that found it had already shipped three fixes that each addressed something
real and left the complaint standing.

The second half, unverified and written up as a hypothesis: `togglePreview` restores the
shelved show only when `show === previewShow`, and saving a map now triggers a re-analysis
(the map stamp) which replaces `show` - so the identity fails, the shelved show is dropped
and the preview stays on stage. That matches "only the Preview remained there" and must be
reproduced before it is fixed; the identity check itself guards a real case and must not
simply be deleted.

Written up in full, with the measurement table, the file:line suspects, the rules, the mute
protocol for testing and a definition of done: `docs/BRIEF-section-editor.md`. (That brief
was spent and deleted once the defect closed; the section below carries what it held.)

**The method failure worth keeping.** Three rounds of fixes, each correct about something:
the per-bar section column really was stale, the writers really were erasing each other,
the two consumers really did round a tie in opposite directions. None of them was what the
owner was looking at. What finally found it was feeding the owner's OWN map through the real
code path and printing where every boundary landed - four lines of arithmetic that should
have been the first move each time, not the fourth.


## The section editor closed: two grid faults and a proxy (2026-08-18)

The brief's own instruction paid for itself twice. Feeding the owner's REAL map through the
real code path before touching anything reproduced the brief's table exactly - and then showed
that the map on disk TODAY was in worse shape than the synthetic case the brief had measured,
and that the second defect was not the thing the brief hypothesised at all.

### Defect 1, fault A: a cut re-phased the grid for the rest of the track

`barStartsAtCuts` absorbs a cut as one short bar and then counts full bars FROM the mark, so
every bar line after it moves. That is right for the case it was built for - Safir's record
really did insert beats, and a movement mark really does start a new song's count - and wrong
for a map's fine drag, which says "this section starts here" and nothing about the rest.

Measured on the owner's live Melanz map, whose single `offGrid` boundary at 41.60 sits three
beats into bar 24:

| | before | after |
|---|---|---|
| Melanz, the owner's live map | 10 of 16 boundaries moved, up to 2.24 s | **0** |
| SICKO MODE | 11 of 15 moved | **1**, by 0.08 s |
| the brief's synthetic nudge | 11 moved, 13 preview/adoption disagreements | 6 moved, **0 disagreements** |
| the other seven judged maps | unchanged | unchanged |

Every one of those ten was drawn EXACTLY on a bar line; the cut is what took them off it. The
six that remain on the brief's older map are its unflagged off-bar boundaries, which round by
policy - the same six that moved with no nudge at all, so the cut itself now costs nothing.
SICKO's 0.08 s is a boundary drawn between two tracked beats, and a bar line can only sit on
a beat.

The owner chose the shape, given the alternative: **the count re-starts at the mark and is
handed back at the next drawn boundary already on a bar line**, absorbing the offset as one
short bar ending there. The rejected alternative was splitting the containing bar, which
disturbs nothing but opens the new section with a one-beat bar - and a section's first bar is
where slams land. Both cost the same number of odd bars; this one puts them at a section's
END, which is the shape the listener cut already uses and the reason it never stretches a
pre-arrival gesture.

An unflagged off-bar boundary is passed over rather than snapped to, so a map with no fine
drag implies nothing and Safir's confirmed grid stays put. A movement mark deliberately does
NOT hand the count back: the rest of the track belongs to the new song.

### Defect 1, fault B: the preview threw away the cuts the grid already carried

`regridForMap` re-derived the whole bar table from a uniform walk, discarding the three cuts
Melanz's cached table already held (12.20 / 137.60 / 181.64). That is why the brief saw 41.60
move when the cut was at 106.60 - a boundary moving BEFORE the cut that supposedly caused it -
and it split the two consumers apart on 13 of 16 boundaries. The preview now asks `handMapGrid`
for its cut list instead of deriving one, including the residue branch, so the two cannot read
one map two ways again. That was the whole class: `nearestBar` gave the ROUNDING one home last
round, and this gives the CUTS one home.

### And the re-sync must not depend on a cached blob

First shipped inside `handMapGrid`, measuring "already on a bar line" against the grid the map
was drawn on - which is read out of the cached analysis. Driving a real ingest with that blob
deleted put all ten Melanz boundaries back where they had been: `drawnOn` is null, so there was
nothing to measure against and the re-sync silently did nothing. A cache cleared behind a kept
judgement would have degraded a map permanently, since the next analysis would then carry the
re-phased grid forward.

The rule now lives at the WALK (`resyncedCuts`), which both consumers always have, and walks
its own reference grid instead of reading one. Re-verified through a real ingest with no cached
analysis present: all 16 boundaries land exactly, same two short bars, identical to the run
with the blob.

### Defect 2 was a Svelte proxy, not the re-analysis

The brief's hypothesis - that saving a map triggers a re-analysis which replaces `show` and
breaks the `show === previewShow` identity - is wrong, and the app said so in one measurement:
with no edit at all, no save and no re-analysis, the cue count went 21 -> 22 -> 22. Probing the
real branch: `identical:false` while `sameCues:true, sameSeed:true`. The preview WAS still on
stage; the check could not see it.

`$state` wraps a plain object in a proxy per variable, so `previewShow = data.show` and
`show = data.show` hold two different proxies of one object and the identity can never hold.
Svelte's `proxy()` short-circuits only on a value that is already a proxy - so reading the
stage back (`previewShow = show`) hands over the same one. The identity check itself is kept:
it guards the case where something else legitimately replaced the show, and both branches now
say which case they serve.

Verified by driving the app: 21 -> 22 -> 21 -> 22 -> 21, and with a boundary nudged while
previewing, 21 -> 22 -> edit -> 22 -> **21**.

### What was deliberately left, with its number

**A short bar reports a fast local tempo.** `f.beatPeriod` is the bar's duration over
`beatsPerBar`, so the one-beat re-sync bar reads 4x fast for the second it lasts, and the
three-beat cut bar 33% fast for three. It is NOT a strobe-ceiling risk, and that is worth
stating because it was first written up as one: `strobePerBeat` allows FEWER flashes as bpm
rises, and the planner, the linter and the renderer all read the same local bpm off the same
bar table, so the delivered rate stays under the ceiling by construction. What remains is
cosmetic - a second of fast flicker in the bar before a drawn boundary. The class is not new
(every listener cut since Safir has a short bar, room-confirmed), and the honest fix needs the
per-bar BEAT COUNT, which the bar table does not carry: durations cannot tell a cut bar from a
fast one, which is exactly what `cutsFromBarTimes` says. That is a `TempoGrid` change and an
`ANALYSIS_VERSION` bump - the whole library re-analysed and composition moved on every cut
track - so it wants the owner's ear rather than a quiet ship.

**No component-level regression test for defect 2.** The trap is an assignment inside a
component; reaching it needs a harness that mounts the page with the real runtime, and vitest
here is plain node with no svelte plugin. The guard that exists is a source-level one that does
fail before and pass after, and its docblock says why it is a string.

### Gates and where it landed

Committed as `607ab59` (the grid), `1448ff1` (the preview and its toggle) and `a1e32e9`
(the scrubber's section names, removed at the owner's ask along with the preview
recomposing on every edit while it is up).

836 tests (827 + 9, every one proven failing against its bug first - the re-sync ones by
neutering the re-sync rather than by removing the function, so they fail on behaviour and not
on a missing symbol), typecheck clean, 2/2 lint-clean on the shows composed over the cut grid.
The owner's 117 judge files across all four stores verified byte-identical to backup with no
files added; every app test ran against a scratch cache.

The instrument is `bench/mapland.ts`: it prints, for one track, where every drawn boundary
lands in the preview and in the adoption and whether the two agree, and it never writes.

## Round 9 (2026-08-27/28): the backbeat, the palette fact, and four calm kick effects

Three fronts, all opened by measurement rather than by argument, and all four of the room's
answers came back the same session.

### SICKO MODE was lit on the backbeat for 232 seconds

The tracked beat stream switches tempo at beat 123 (59.600 s): beats 110-122 run at ~0.43 s
(136-143 bpm), beat 123 onward at ~0.78 s (77 bpm). Three independent substrates put the new
song's downbeat on beat 124 (60.380 s):

- the owner's judge mark, 60.5 s;
- the kit's own phase profile over the whole second movement - kick owns phases 1 and 3
  (0.364, 0.424), snare owns 0 and 2 (0.636, 0.644), so the shipped downbeat sat on a SNARE.
  Scored as kick-minus-snare the shipped phase is -0.565 and the best is +0.412: a gain of
  +1.024, against a largest whole-track disagreement of 0.175 anywhere in cache114;
- a Viterbi over Beat This's own downbeats, whose first restart produces a bar line at
  60.380.

The shipped grid put bar 32 at 61.160 s. Every one of the ~75 bars after it inherited that.
The owner confirmed by ear ("kicks I think") and, separately, confirmed the walk's SECOND
restart at 175.8 s as a real third song - a point nothing else in the pipeline sees.

### The phase walk, and why it ships scoped

`packages/analysis/src/downbeatPhase.ts`. State is each beat's position in the bar, stepping
on is free, restarting costs a fixed price. Measured as PHASE CARRY (share of the model's own
downbeats landing on a shipped bar line), unrestricted at cost 4:

- 60 Harmonix: **43 of 60 take zero resets**, median carry 99.6% -> 100.0%, and the ones it
  does touch are repaired (68.7% -> 100.0%, 67.2% -> 98.5%).
- Every praise sentinel takes zero resets: Le Freak, EARFQUAKE, Pistacie, Vitej, Hannah
  Montana, Praha/Viden, Kisses - all unchanged.
- The whole named phase-suspect cohort improves: Cigo 32->66, Thinkin 36->69, SICKO 39->86,
  bad guy 47->76, KITN 47->87, Safir 52->87, Titi 54->89, Snooze 56->79, Melanz 40->80.

That is the round-4 hypothesis, which was recorded as REFUTED. It was right; the instrument
was wrong. The old probe found low-confidence tracks have INTERNALLY inconsistent model
downbeats and concluded the model could not help. The cause is the opposite: the model tracks
resets a single uniform four-beat walk cannot express, so its downbeats only look inconsistent
when forced through that walk.

**It still ships scoped to listener-marked movements**, and that is measured, not cautious.
Re-phasing re-bars a track. `bench/phasegrid.ts` scored the unrestricted run at 2 hit / 4
closer / 17 same / **5 worse**, including a praised KITN seam moving 0.64 s. Carry is not
something the room has heard; a praised boundary is. Scoped, `earlybars` returns to its exact
floor. On a marked track the walk also supplies the OPENING phase (SICKO MODE 70.8% -> 85.8%),
because a mark asserts the track is several records and the first one is owed its own count of
one; no bar line moves that a mark did not ask for.

**Two carry numbers for SICKO MODE, and they are both real.** 39.2% -> 85.8% is the walk
against the model's downbeats with no other grid edits. The SHIPPED blob reads 54.2%, and the
misses cluster at 0-53 s and 104-175 s while agreeing exactly around the switch: those are the
stretches where the owner's 14 off-grid map boundaries cut the grid to where they were drawn,
and the map beats the model there by design. Worth putting to the owner: that map was drawn
against the OLD wrong-phase grid, so some of its cuts may now be fighting a phase that is
right. Redrawing SICKO MODE's map is the cheapest way to find out.

**A bar-numbered instrument cannot gate anything that re-phases**, which is why phasegrid
exists. A reset renumbers every bar after it: one KITN "WORSE" row was the same instant to the
millisecond (142.18 s both sides), and a Safir row scored WORSE while moving CLOSER to the
owner's mark (66.56 -> 67.40 against a mark at 67.1). Known limit of phasegrid: it converts the
target bar through the A-side grid, so A scores 0.00 by construction wherever A's boundary IS
the target bar. `bench/targets.ts` now holds the frozen ground truth for both instruments, so
they cannot drift apart.

### Three effect repairs, each measured before and after

- **`chromaBurst` was dark for the first half of its life.** `g.dist` on this fixture spans
  0.554..0.998 and never reaches 0, because every LED is coplanar and head height is a constant
  floor under the radius. Swept against the raw figure its shells first lit at u = 0.447-0.488,
  by which point the `(1-u)^2` gain was down to 0.26-0.31. Measured through the mixer over its
  own life: **8 frames lit, peak byte 40** - barely over the 24 where a pixel reads as lit.
  Re-based the way kickTunnel and subSwell already were: **62 frames, peak byte 145**, which
  sits with tideBloom (159) and shutterCut (162), so the authored gain needed no scaling. This
  is the effect the picker hands the peak of nearly every track. (Bytes re-taken 2026-08-31 at
  the owner's new GAMMA 2.45 / MASTER 0.7; at the 2.2 calibration they read 43 -> 211.)
- **`subSwell` read a signal that cannot move inside a bar.** It asked for a 12 ms attack from
  `f.bands[Band.Sub]`, which steps once a beat. Moved to `bandBetween(f, 0, 0.12)`; gain 1.4 ->
  2.1, chosen by measuring the two scales on the gate's own journey (band p90 is 1.46x the
  spectrum's, and bassRing paid 1.47 for the same move). Level stays on the envelope: how loud
  a passage is, is what the band is good for.
- **`base -> glow` is not a brightness ramp.** Measured over 24 hues through the real ramp:
  deep->base **x12.50** flux, base->glow **x1.03** flux and **x0.86** peak channel, glow->white
  **x2.66**. CLAUDE.md said all three were "one hue at three lightnesses"; that is right for the
  first and wrong for the second, which is a SATURATION move at constant light. Five effect
  comments also claimed white is 3.7x glow. All corrected. The consequence is a mechanism the
  catalog never used: `glow -> base` on a hit is punch that costs no light, cannot move the
  auto-exposure and cannot trip the highlight compressor.

### Four restrained kick effects, and the instrument that judged them

The catalog had **eleven** effects declaring `taste.kit: 'kick'` and **none below energy 3**;
nine of the eleven are impacts, bursts or whole-room level pulses, and six are in the burst
family of which at most one appears per show. Meanwhile intro, outro and breakdown draw their
texture from exactly **three** carrying accents, none of which reads the kit at all. The
owner's complaint was structural, not taste: there was no restrained kick-forward band for the
picker to reach into.

`react` from the character probe cannot judge these - it measures bytes moved over a journey,
which a constant-flux design minimises by construction. So the question was asked directly:
how far does the room move at the instant a kick lands, taking the WEAKEST tenth of the hits
rather than the strongest, because an effect whose average kick reads and whose quiet ones
vanish stutters.

| effect | weakest | median | max | approach | |
|---|---|---|---|---|---|
| `emberBump` | 26 | 27 | **27** | 26 | new: `glow -> base` on the kick, constant flux |
| `crossbeam` | 20 | 26 | **31** | 24 | new: conserved trade, perimeter <-> beam |
| `lean` | 1 | 1 | 1 | **58** | new: leans over the last quarter-beat, stops dead on it |
| counterweight | 17 | 29 | 53 | 19 | the one restrained incumbent |
| pump | 36 | 52 | 71 | 48 | wild |
| impulseSpin | 80 | 118 | 133 | 105 | wildest |
| moshSlam / ricochet | 0 / 158 | 0 / 164 | 155 / 170 | | fires rarely, enormously |

The two arrival-shaped ones land with counterweight and well under pump, and their weakest and
median are nearly equal - every kick reads and none dominates, which is the shape "punchy but
not distracting" actually has. Their MAXIMA are the lowest of any kick effect in the catalog:
they cannot spike. The wild ones invert it, with a weakest of ZERO and a maximum near the top.

`lean` is a third shape and it nearly got mis-read as dead. It reads 1/1/1 at the arrival and
58 in the APPROACH, because all of its movement is in the quarter-beat before the hit. Worse,
it scored a healthy-looking 33/35/72 BEFORE a bug in it was fixed - and those numbers were
measuring the bug, a snap at the beat the gesture was written not to have. The approach column
was added to the instrument for exactly this, and the lesson is on the record: a punch reading
that looks healthy is not evidence the effect is right.

All of these are BYTES and they move with the room's calibration. First taken at GAMMA 2.2 with
no master dimmer they read about 40% higher; the table above is at the owner's shipped GAMMA
2.45 / MASTER 0.7. The ordering did not move at all.

`subBreath` (bed, carries) is the fourth and does not punch (3/3/13) on purpose: it answers the
BASS, holding the room's mean level dead flat and moving only the depth of a two-lobe standing
pattern, so the eye's adaptation never shifts and the hundredth note lands like the first. It
is the carrying, room-filling, sub-driven bed the planner could not previously reach - subThrob
and bassRing are the same signal and both declare `carries: false` because both go dark between
notes. Journey reactivity 0.249 against breathe's 0.312.

### The editing loop, and the blocker the owner reported

"switch is exactly THERE (I can't drag the section there exactly, only slightly after it)" was
a real defect with an exact cause: `ShowStrip.svelte` took its minimum-section margin from the
MEDIAN bar (`beatPeriod * beatsPerBar` = 3.09 s on SICKO MODE) while the local bar there is
1.72 s, so a plain drag was clamped to >= 61.81 s and could not reach 60.4 at all. The keyboard
nudge already argued this in its own comment; the pointer drag never got it. Now both read
`barDurationAt`.

Two normalisation faults, both live only on marked tracks and both shipped BY the movement
slice:

- `arrange` passed `movements` to `levelEnvelopes` and `analyze.ts` did not, so cue levels were
  levelled per movement while `envelopes` - what every effect actually modulates with - was
  levelled across the whole file.
- `segEnergy` is per-movement normalised and was then compared ACROSS movements in four places
  plus `energyRank`. Two movements each levelled against themselves both reach 1.0, so the peak
  - the one look the catalog reserves - went to whichever song had the tighter distribution.
  `levelEnvelopes` now returns `energyGlobal` beside `energy`, and every "which of these is
  biggest" question reads it. Identical on a single-span track, so nothing unmarked can tell.

### Round-9 gates

858 tests (836 + 22), typecheck clean, `earlybars` **20 hit / 0 closer / 8 same / 0 worse of
28** - the floor, unmoved. ANALYSIS_VERSION 24 (the model's downbeats are now stored, ~900
bytes a track, so the walk is re-runnable and phasegrid is answerable from a blob).
SHOW_VERSION 20.

### One app, one cache

The owner asked for a single build: "the old AB tests were finished and C won every time".
cache-C was verified a strict superset of A and B - nothing in either that was not in C,
judge files included - so it is now simply `cache`, and the other two are renamed to
`cache-A-archive` / `cache-B-archive` rather than deleted. `/Applications/LightningStrike.app`
is the only bundle, so `bundle_suffix()` returns None and it reads that one cache.

Note for anyone reading the judge files: the owner's "NEW SONG HERE" marks arrived as NOTES,
not as movement marks, so `movements` was still empty and the phase fix would not have applied.
They were converted (SICKO MODE 60.5/176.2, Melanz 169.7/205.8) as a patch leaving every other
field alone. A note describes; only a movement mark cuts the grid.

### The download path, delegated mid-round

The owner, while judging: "The youtube downloading fails at least twice for almost EVERY song
now. I don't know what happened, but this has been going on for a long time now." Handed to a
subagent so the room work could continue, with hard boundaries: the ingest path only, no
commits, and nothing near the uncommitted round-9 tree.

The standing hypothesis going in was wrong in the way that mattered. It read as yt-dlp's own
client fallback chain logging harmless attempts as failures - a noise problem. It was a total
outage. yt-dlp on the machine was 2026.07.04, and YouTube had stopped honouring media URLs
signed for the `android_vr` player client, which that binary asks for on every track. Six
cached tracks at three attempts each: 18 of 18 failures. The same six on 2026.08.19: 6 of 6
first try, picking `visionos` instead.

The owner's "fails twice then succeeds" was the earlier, intermittent stage of the same decay -
which `decode.ts` already documents from measurement ("of fifty tracks, twelve failed this way
and a plain re-run recovered seven"). As YouTube completed the client migration it went from
intermittent to absolute. Because metadata lookups kept working, tracks still resolved and
displayed and only died at the download, which is very likely why a total failure still felt
partial. Worth remembering as a diagnostic shape: a report of PARTIAL failure can be a total
one seen through a path that still half-works.

What made it opaque was two nested retry layers - three in-process, then up to three
queue-level a minute apart - which against a deterministic 403 is up to nine identical
downloads and several minutes per track, ending in a bare "HTTP Error 403". The fix is about
honesty rather than mechanism: a 403 from a binary older than 45 days is not retried and says
why. 250 s and two retries becomes 2.6 s and none.

Deliberately not done: pinning `--extractor-args youtube:player_client=...`. On the stale
binary only `web_embedded` worked, so pinning would have masked the symptom while hard-coding a
workaround that goes stale itself and overrides a current binary's working default chain - the
argument README:434 already makes about not bundling yt-dlp. Also left: there is still no
staleness check at STARTUP. `apps/desktop/src-tauri/src/env.rs` names MISSING tools only. The
naming went on the failure path instead, which covers `npm run dev` as well and speaks only
when something actually broke, but an age line at launch is still worth having.

## Round 10 (2026-09-01): multi-song tracks split themselves

The owner, asked directly what was still wrong with SICKO MODE and Melanz: "Everything you said
basically - the thing is that everything should be AUTOMATIC. (the hand markings are mostly for
judging)". Movement definition and thresholds delegated ("decide for the best option, please, so
everything looks nice"); detections apply immediately with a one-click refusal; "anything you need
for testing, do not feel constrained". ANALYSIS_VERSION **25**, SHOW_VERSION **21**.

### What was measured before anything was designed

Two research passes (multi-song boundary detection; structure analysis 2023-2026) found no
published model that handles a stitched second song or a tempo break - the DJ-mix literature
treats the song change as a detection stage ahead of structure, which is the shape built here.
Then an instrument, `bench/movements.ts`, over 245 single-song tracks (129 app cache, 60 Harmonix,
60 Raveform) and 330 candidate seams: the four real switches sat at centred-chroma recurrence
0.57-0.67 against a control median of 0.98, and key distance 3.5-6.5 fifths against a median of
0. Thresholds fitted on that alone then scored **0 of 23** on a fetched 18-track multi-song
corpus (`bench/fetch-multisong.ts`: Nights, DNA., m.A.A.d city, STARGAZING, family ties, Bohemian
Rhapsody, Paranoid Android, Jesus of Suburbia, 911/Mr. Lonely, A Day in the Life, Happiness Is a
Warm Gun, Know Yourself, Sing About Me, and the negatives Stairway, Free Bird, This Is America,
Runaway, Knights of Cydonia). The key witness is a guess on rap (confidence 0.2-0.5) and stays in
related keys across multi-movement rock. The rule was redrawn from that corpus, not the two tracks.

### What shipped (`packages/analysis/src/movements.ts`)

- **Grid repair, every track.** Tempo regimes from a 16-beat median change-point on log beat
  period; songs are runs related by a tracker flip (2:1, 3:1; 3:2 and 4:3 only when the new beats
  sit on the old grid within 40 ms, anchored on the previous song's beats); the song's level is
  the tempo with the most seconds; flipped stretches are resampled by walking the song's period;
  a short half/double passage with the same song either side folds in (an EDM break read at
  another level); chaotic stretches (steady < 0.4) are written at the neighbour's period at the
  edges up to 45 s and in interior gaps up to 20 s. Melanz's third song was read at 143 bpm for
  a third of its length; its spoken intro at 250. Free Bird's first half was being rewritten for
  500 s before the edge cap; Knights of Cydonia for 300 before the interior cap.
- **Seams.** A tempo step between two steady songs (ratio >= 1.10, both >= 20 s) with the step
  a step (two constants against one quadratic, transition guards 3/8/16 beats) OR a pause >= 2
  periods stands alone. A same-tempo seam (downbeat break + walk restart, or a beatless gap)
  needs >= 45 s before and >= 40 s after, timbre AND centred-chroma recurrence that stops across
  it, and a pause >= 2 s or a key change >= 2.5 fifths at confidence >= 0.45. A beatless
  interlude >= 20 s between two songs is a movement at both edges unless the song after recurs
  with the song before. Nothing before 45 s. A pause <= 12 s belongs to the incoming song and the
  seam is where the outgoing beat stopped; longer belongs to the outgoing song.
- **Analysis per song.** Segmented, refined (movement bars are walls), grouped (never across a
  song), labelled and vocabulary-chosen song by song via `arrangeMovements`; energy levelled per
  song, ranked across the file. `SectionSpan.movement`, `TrackAnalysis.movements: MovementSpan[]`
  (bpm, key, source, note). Marks within 8 s outrank a detection; `movementVetoes` on the judgement
  refuse one within 5 s, and both are in the cache stamp.
- **Show per song.** A palette per song from its own tempo and key, kept a quarter turn from the
  one before and written concretely into every cue; the switch arrives on its downbeat with a slam
  (a bump where it does not kick); each song's loudest passage gets 0.96, under the one peak the
  show reserves; the drop count restarts per song; the hue cap is six per song.
- **The panel.** Detected seams listed with their reason and an x that refuses them; refusals
  listed and liftable; the lane's dividers come from the analysis, alt-click refuses; the tempo
  candidates no longer offer what was already found.

### Measured

- App cache, no marks, no maps: SICKO MODE 59.6 / 176.6 s, Melanz 171.6 / 207.8 s - all within 2 s
  of the owner's marks (60.5 / 176.2, 169.7 / 205.8). Three other tracks get a movement: Hallowed
  Be Thy Name 59.7 (the song proper after its slow intro), bad guy 148.5 (the slowed coda), Fear
  of the Dark 103 (the band entering). Defensible re-staging points; the owner can refuse them.
- Raveform 60 EDM tracks: 0. Harmonix 60: Five Magics only (its thrash tempo sections).
- Multi-song corpus: 911/Mr. Lonely, DNA., family ties, m.A.A.d city, Nights, STARGAZING, Paranoid
  Android (the third part), Jesus of Suburbia (two of four), Happiness Is a Warm Gun (both) found;
  This Is America, Free Bird, Runaway, Knights of Cydonia clean; the Stairway cover splits at its
  real tempo change. Known misses: Bohemian Rhapsody and A Day in the Life (A-B-A with a middle
  section the tempo alone cannot tell from an EDM half-time break), Know Yourself (chroma 0.73, a
  near miss), Sing About Me.
- Gates: `phasegrid` **0 hit / 1 closer / 27 same / 0 worse of 28** - the time-based instrument,
  and the one that can judge this change. `earlybars` reads 17/0/6/5 because the grid repair
  renumbers bars ahead of five seams (Killing In the Name x3, Safir, Praha) whose instants did
  not move; phasegrid shows every one of them at 0.00 s. `lintsweep` 130 clean / 0 rejected.
  `npm test` 887 with the one pre-existing calibration failure (`wash`/`spectrumBed` under GAMMA
  2.45). `npm run check` clean.

### Wrong turns, kept

A key-change requirement; a chroma threshold fitted on two tracks; a phase test anchored on the
regime's own first beat (passes itself); 70 ms tolerance on a 0.33 s lattice (a coin flip); the
seam-zone walk with no length cap (a live band drifting for 98 s became a "pause"); one steady
interval as proof of a song's edge (two stray beats a period apart, by chance, on Melanz); merging
seams within 8 s regardless of class (family ties needs two, Runaway's coda must not get three).

## Round 11 (2026-09-01, later the same day): the switches, to the bar

The owner installed Round 10, listened, and judged: "the switches are NOT good". Two new maps
(`bench/judged/round-2026-09-01/{NQbkGDoD7B0,jojRxf2qvqs}.map.json`, frozen; the 43 old judge
files are archived under `cache/judge-archive-2026-09-01/`, the owner's word: "remove every
judgement, it is WAY TOO old"), and one rule: "Not every song part has to have intro/outro."

### What the maps said the round had wrong

- **Melanz's first song was half a bar off for 120 s.** The model's downbeats sit at 1.6 s mod
  4 in 33 of 36 bars; the shipped bar lines sat at 3.6. The opening phase was read from the
  walk's FIRST segment, and on this track that segment is fitted to hallucinated downbeats in
  the spoken intro before the walk restarts at the song. A leftover of the 2:1 relevel near
  88 s (three extra beats: the regime cut sits a beat or two before the flip really ends, and
  the unflipped regime pushed the tail of the doubled stretch as heard) is what re-synced it by
  accident at 125 s.
- **Both Melanz seams were a bar late**, for two different reasons. The pause seam sat on the
  last beat the tracker heard before the 7 s pause (171.62, a stray downbeat two beats after
  the real bar line) instead of the outgoing song's last regular bar line (169.64). The tempo
  seam sat where Beat This finally changed period (209.02), one bar after the new song's first
  downbeat (205.66), which the tracker rode through at the old rate.
- **SICKO MODE's first switch was a beat early** (59.60 against the owner's 60.38): the regime
  cut takes the last old-song beat that happens to fit the new period, and the seam took it.
  Every bar line of the second song was a beat off after that.
- **SICKO MODE's intro was not hallucinated**, which the previous round assumed: the model's
  downbeats run at a clean 1.72 s from 0.04 to 27.66, and only the beats between them are
  missing, three per bar. Counting four beats to a bar over that stream shifted every bar line
  in the first song.
- **Outros before a switch.** The position rule made each song's last low section an outro
  and carved a ring-out; the owner's maps end SICKO's second song on a breakdown and Melanz's
  first on a chorus.

### What shipped

- **Opening phase from the first steady song**, not the first walk segment.
- **Pause seams on the outgoing song's last complete bar**: at that bar's end, or at the start
  of an incomplete one, with everything to the new song's first steady beat written at the
  incoming period as its pickup. Only after a real gap (more than a beat and a half of the
  incoming period past the last steady beat): SICKO's old song ends on a three-beat bar with
  no pause, and that bar is the old song's.
- **Handshake**: a tempo seam with no pause, where one incoming bar back from the new song's
  first steady beat lands on an outgoing bar line within 40 ms, is cut there and the bar
  rewritten at the incoming period.
- **A no-pause tempo seam lands on the incoming song's first model downbeat** within a bar.
- **The lead-in is written at the first song's period** when fewer than nine in ten of its
  intervals hold that period (SICKO's holds it on two beats in three), up to 45 s.
- **Leftover-level cleanup**: a beat under six tenths of its song's period from the one before
  is the other level's and goes.
- **Exact seams bypass the phase-walk snap** (`Movement.exact`): the walk counts beats across a
  rewritten stretch and its lines there name nothing the record plays.
- **Outro and ring-out only where the record ends** (`arrange(..., endsTheRecord)`); intro
  anywhere.
- **The fold test counts a filled pickup or a handshake as a break** up to the regime's first
  eight beats. Without it the 80 bpm song, whose pickup is now in phase with the 60 bpm bar
  line by construction, folded into the first song as a 4:3 flip.
- **Witnesses skip a written zone**: bars of silence resemble nothing, and counted as the
  incoming song they made every pause look like new material.
- **`SAME_TEMPO_KEY` 3, `MATERIAL_CHROMA` 0.70**: Know Yourself (d2.5, 8 s late) and
  Runaway's coda (0.72 exactly) were riding the old thresholds.
- **A long pause needs the timbre under the breakdown standard too** (< 0.95): "i'm
  waiting." rests for 16 s and comes back into the same sound (timbre 1.39, same key at
  0.81) and was splitting once the honest windows read its chroma at 0.64.
- **`TrackAnalysis.heard`**: the model's own beats and downbeats, before the repair. The probe
  and the app-set bench were reading the blob's `beats`, which are repaired, and repairing them
  again - a seam the app never has to find. The probe now tracks the audio itself when a blob
  lacks it and caches the count in `bench/corpus/.beats/app-<id>.json` for the bench.
- **ANALYSIS_VERSION 26.**

### Measured, against the frozen maps (`node bench/mapdiff.ts`)

- **Melanz**: seams 2:49.64 and 3:25.66 against the owner's 2:49.64 and 3:25.65; 9 of 12
  boundaries to the frame. Off: the owner's chorus at 3:01.65 (the analysis cuts at 2:58.64,
  the first heard beat after the pickup, one bar early); a one-bar outro at 3:22.63 (below
  any section minimum); the chorus restatement at 4:46.76, a two-bar bass dip inside a
  forty-bar chorus that the consolidation merges (same kind, same group, no arrival). Labels:
  1:29.73 is the owner's breakdown and the analysis's chorus; 2:49.64 the owner's build and
  the analysis's intro.
- **SICKO MODE**: seams 1:00.38 and 2:56.56, both exact; 12 of 15 boundaries. The second song
  ends on the breakdown at 2:36.38 with no outro; the third song matches every boundary. Off:
  0:48.36 build / 0:55.28 chorus (the analysis cuts 0:41.48 and 0:53.54, the fill bar before
  the drop) and 1:40.64 build (analysis 1:37.54, the transition bar). Three of the off
  boundaries are one bar EARLY on the transitional bar - a pattern worth a sweep with a
  fill-bar witness, not a two-track tune.
- **Multi-song corpus** 11 hit / 11 missed of 22 (family ties re-judged to one seam: a 15 s
  pause is the old song's ending, so the seam is the new beat); the known misses unchanged
  (Bohemian Rhapsody, A Day in the Life, Know Yourself, Sing About Me, Paranoid Android's
  first and third, Suburbia's first and third); one false, the Stairway cover's real tempo
  change, as before. Harmonix: Five Magics only, now four splits (its thrash sections, one
  more at 4:41 through the honest windows). Raveform: 0 of 60. App library: 4 hit / 0 missed of 4, both
  tracks to the frame, 0 false; five of 135 tracks get a movement - the two, Hallowed Be Thy
  Name 1:00, bad guy 2:28, Fear of the Dark 1:43 and now also its 6:37 coda.
- **Gates**: `phasegrid` 0 hit / 0 closer / 28 same / 0 worse; `lintsweep` 136 clean / 0
  rejected; suite 889 green with the one known calibration failure; check clean.

### Wrong turns, kept

- **A pause is quiet.** A zone no quieter than its sides (median bar level, 6 dB) was read as
  the tracker losing the beat while the band played, and denied the pause credit. It removed
  Stairway and two Five Magics splits and also removed Jesus of Suburbia's 3:38, and family
  ties' 15 s pause measured 1 dB below its sides: a real switch in hip-hop carries the hook a
  cappella through the pause, Suburbia a drum fill. Level says nothing about the beat.
- **The lead-in's median interval** as the test for rewriting it: SICKO's intro median IS the
  song's period, on two beats in three.
- **The last regular bar line as the seam whatever the gap**: it moved SICKO's switch to
  58.72, a bar and a half before the new downbeat.
