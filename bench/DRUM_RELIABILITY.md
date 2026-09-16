# Drum reliability study, September 2026

## Striker 1.0 and published benchmarks (analysis v38, September 14)

Analysis now separates the mix with HTDemucs and then jarredou's MDX23C DrumSep into kick,
snare, hi-hat and cymbal sources. ADTOF transcribes the mix, the drum stem and each 44.1 kHz
source. Onset candidates from those transcriptions and from the separated sources' attacks are
classified per class by Striker 1.0, LightningStrike's gradient-boosted trees
(`packages/analysis/src/striker.ts`, model `models/striker.json`, trained with
[drumeval](drumeval/README.md)). Hats merge with ride and crash hits. Kick and snare levels also
follow each hit's own separated-source loudness, so a clap under a loud kick lights as loudly as
its peers. The rules in the sections below remain the fallback when the model or an input is
missing.

Cross-dataset results: every benchmark is scored by a model that never saw that dataset, with
thresholds chosen on the other corpora (`train-striker.py --loco --labels=strict`). Scoring
follows ADTOF and Vogl et al.: `MIDI_REDUCED_5` classes, `mir_eval` matching within 50 ms and F
summed over all onsets of the scored classes (`drumeval/benchmark.py`). Each cell gives that F
averaged over Vogl's three folds (for ENST its three drummers), as ADTOF reports, and then
pooled over the whole dataset, as Weber et al. report; IDMT and Groove MIDI have no folds. The
ADTOF column runs the released weights through the same scorer with ADTOF's own peak picking;
its fold means land within 0.012 of ADTOF's published MDB and ENST numbers.

| Benchmark | Classes | Best published cross-dataset | ADTOF, reproduced | Striker 1.0 |
|---|---:|---:|---:|---:|
| MDB Drums, full mix | 5 | 0.81 (ADTOF, Zehren 2023) | 0.798 / 0.795 | **0.858 / 0.854** |
| MDB Drums, full mix | 3 | 0.83 (Weber 2025) | 0.801 / 0.800 | **0.865 / 0.860** |
| ENST-Drums, 2/3 drums + 1/3 accompaniment | 5 | 0.80 (Weber 2025) | 0.781 / 0.785 | **0.829 / 0.832** |
| ENST-Drums, 2/3 drums + 1/3 accompaniment | 3 | 0.80 (Weber 2025) | 0.794 / 0.798 | **0.837 / 0.841** |
| RBMA13, public labels | 3 | 0.67 (Weber 2025) | 0.709 / 0.713 | **0.747 / 0.753** |
| IDMT-SMT-Drums V2 | 3 | 0.949 (Yeung 2026) | 0.950 | **0.971** |
| MDB Drums, drums only | 5 | 0.89 (Riley and Dixon 2024) | 0.854 / 0.850 | **0.913 / 0.911** |
| ENST-Drums, drums only | 5 | 0.85 (Riley and Dixon 2024) | 0.831 / 0.834 | **0.883 / 0.884** |
| Groove MIDI, test split | 3 | 0.702 (Khanal and Lee 2026) | 0.791 | **0.870** |

ADTOF's published ENST 0.78 matches the 2/3 + 1/3 mix (reproduced 0.781; 0.700 at equal
gain). Weber et al. do not state their ENST mix, but their ADTOF-trained models land near
ADTOF's own number there. With drums and accompaniment at equal gain Striker scores 0.789 /
0.794 with five classes and 0.805 / 0.809 with three. Khanal and Lee do not state which Groove
MIDI sequences they scored; here it is the official test split's 124 performances with audio.
The best published numbers come from [Zehren et al.
2023](https://doi.org/10.3390/signals4040042), [Weber et al.
2025](https://transactions.ismir.net/articles/10.5334/tismir.244), [Yeung et al.
2026](https://arxiv.org/abs/2509.21739) (ICASSP), [Riley and Dixon
2024](https://arxiv.org/abs/2509.24853) (ISMIR late-breaking demo) and [Khanal and Lee
2026](https://doi.org/10.3390/app16136746).

In-dataset results remain higher on IDMT and on ENST with three classes. Southall et al. 2017
divided tracks between training and test, so drummers, kits and rooms recur in both, and report
a mean instrument F of 0.988 on IDMT, 0.929 on ENST drums and 0.927 on the 2/3 mix; Khanal and
Lee 2026 report 0.900 pooled on accompanied ENST with a session-level split. Five-fold track
cross-validation of Striker over all corpora reaches 0.983, 0.906 and 0.869 (pooled 0.874), with
thresholds chosen on the same cross-validated scores; trained on IDMT alone it reaches 0.987,
and on ENST's three renderings alone 0.924 on the drums and 0.891 on the 2/3 mix (pooled 0.891).
Drummer-disjoint in-dataset results (Wu et al. 2018, Jacques and Roebel 2018) stay below
cross-dataset Striker, and so do Wu et al.'s leave-one-subset-out IDMT results on RealDrum and
WaveDrum (0.928 each, against 0.976 and 0.965). On TechnoDrum Striker's 0.977 beats their 0.972
only when mean F skips classes a track does not label: one loop has no hi-hat labels but 32
detected hats, and scoring it as zero gives 0.948. At Vogl et al. 2017's 20 ms tolerance Striker
leads on RBMA13 (0.702 / 0.706 against their in-dataset 0.673) but falls just short on the ENST
2/3 mix (0.779 / 0.783 against 0.784) and on IDMT (0.917 against 0.952): hi-hat onsets carry the
largest timing errors.

On MDBDrums++, which re-annotates the MDB drum recordings as MIDI (`mdbpp`), the released ADTOF
scores 0.822 / 0.808 with five classes and Striker 0.880 / 0.867; ADTOF-pytorch's README reports
0.887 for ADTOF there without stating its protocol, a number this scorer cannot reproduce or
compare. Not evaluated: STAR Drums' test split (most of it must be rebuilt from MUSDB18, which
also trained HTDemucs), Slakh2100 (Khanal and Lee's zero-shot 0.720; a 104 GB download), E-GMD
and TMIDT (in-dataset results under other class sets), RBMA13 with five classes (Vogl's full
labels are not public) and the ADTOF-RGW and ADTOF-YT test sets (spectrograms on request).

Three smaller changes also count. Snare candidates reach fainter transcription peaks and source
attacks than the other classes' (`striker.ts`), because ghost notes leave little of either: on
MDB drums the share of snares with a candidate rose from 0.855 to 0.951 and snare F from 0.864
to 0.905, while the library's snare count stayed within one hit. ADTOF peak picking treats
frames outside the audio as silence, as madmom does, so a hit on the first frame is found:
IDMT's loops start on one, and with the same models IDMT kick F rose from 0.981 to 0.993. Each
class averages five classifiers trained with different seeds (`train-striker.py --seeds=5`): a
single classifier moved class F by up to 0.016 (toms 0.036) after changes that touched a handful
of training candidates. Thresholds on the 0.05 grid still step between neighbours that score
alike.

The shipped model trains on MDB, ENST, RBMA13 kicks and hats, IDMT and the automatically
aligned RWC and A2MD MIDI. Two sources help only some classes, so they train only those
(`--train-variants=snare,hat,cymbal`, `--ignore=rbma:snare,star:snare,star:kick,star:tom`);
both effects were measured before the snare and first-frame changes:

- The drums-only renderings of MDB and ENST raised snare, hi-hat and cymbal F across the
  benchmarks by 0.003, 0.006 and 0.001 but cost 0.011 kick F and 0.028 tom F.
- STAR Drums training excerpts raised hi-hat and cymbal F by 0.003 and 0.008 but cost 0.013 kick
  F and 0.009 tom F. Their non-drum stems carry unlabelled clap residue, and like RBMA13's public
  snare labels, which follow Vogl's three-class map without claps, they taught the classifier to
  reject claps and snaps: bad guy's confirmed snaps fell from 8/9 to 0/9. Neither trains snares.

Aligned MIDI keeps a class only where ADTOF agrees with it, ignores its pedal hats and soft
strokes, and corpora are weighted by size to the power -0.5. An earlier model with unvetted RWC
MIDI, no corpus weighting and an older candidate set scored MDB and ENST 0.02 to 0.03 and
RBMA13 hats 0.08 below the hand-annotated corpora alone, and MDB drums below the published
0.89; the hand-annotated corpora alone fell short on IDMT (0.947).

On the owner's partial labels Striker keeps 18 of 19 confirmed snares (the rule-based v36
analysis 17), emits 1 of 5 confirmed wrong hits (v36 4) and hits 22 of 37 reviewed missed-hit
clicks (v36 23). Desire's reviewed snares remain missed by every model trained on the full
corpus set: the separated snare source has attacks there, but ADTOF gives them almost no snare
activation, so every candidate scores below the snare threshold, and most reviewed grid positions
sit 40 to 60 ms after those attacks. On the 39 library songs both analyses cover, it emits 4%
fewer kicks, 24% fewer snares and 21% fewer hat and cymbal hits than v36.

Costs: preparation now runs the MDX23C kit stage (0.9 times the audio length on the Ryzen 5 3600
CPU with two lanes, 1.2 to 1.4 with other work running, a tenth on DirectML) and five more ADTOF
passes. A full CPU preparation of Habibi (146.9 s) with the shipped model took 202 s with a
6.3 GB peak; its onsets matched the DirectML-evidence benchmark replay hit for hit (one hat level
differs by 0.01), and a rerun from cached evidence took 11 s. The M1 Pro remains unmeasured.

Limitations: toms are weak (0.45 to 0.72 on MDB and ENST), RBMA13 snares stay near 0.65 partly
because its labels leave claps out, and quiet ghost notes and dense electronic percussion remain
the main errors; on Groove MIDI most misses are notes played below MIDI velocity 40. Benchmark
results informed the training-set and per-class choices.

## Why electronic music fails (September 16)

Striker 1.0 leads every published benchmark and still misses most of the kicks in the room's own
music. On `library/AHaIdOXzzuE`, a hardstyle track, a 24 s window holding 67 beats produced 78
kick candidates and two accepted hits: the candidates existed, and the classifier rejected them
with a maximum probability of 0.624 and a median of 0.122. In the same window it accepted 55
snares at probabilities up to 0.982. Hard techno behaves the same way (`library/j8VRLPa1za4`, 20
kicks accepted of 78 beats). Across the 34 electronic tracks in the library the kick stream covers
51% of the beat grid (`fourfloor.ts`), in music where the kick is on every beat.

So it is neither thresholds nor candidate generation. `ceiling.ts` puts candidate recall before
any filtering at 94.1% for kicks and 93.6% for hats, and `inspect.ts` shows the proposals are
present on exactly the tracks that fail. The cause is what the candidates are described by.

Measuring where the kit separator sends the energy at a track's kick positions:

| | kick source | snare | hi-hat | cymbal |
|---|---:|---:|---:|---:|
| real hardstyle | 43% | 32% | 5% | 20% |
| real hard techno | 53% | 35% | 5% | 7% |
| a clean synthesised kick | 99% | 0% | 0% | 0% |

MDX23C was trained on acoustic kits and does not put a driven electronic kick in the kick source;
a third of it arrives in the snare source instead. Striker's most important kick feature is
`fromSource` at 0.33 gain, which asks whether the separated kick source had an attack. On these
tracks it has six of 98. The classifier is not wrong about its evidence; its evidence is wrong.

Weber et al. 2024 measured the same profile from the other side, splitting RBMA13 into acoustic
and electronic tracks and reporting kick F 0.67 against 0.41 and snare 0.50 against 0.38, with
hi-hats unchanged. No published work covers 808s, drum machines or electronic percussion directly.

Two hypotheses this ruled out. The ADTOF port's timing is correct: centred frames, a 441 sample
hop, activation index over 100, 84 logarithmic bands and `log10(mag + 1)`, checked against the
reference implementation, and the signed matching offsets are a median of 0 ms on ENST and RBMA13
and -10 ms on MDB, which is MDB's annotation convention rather than a bug. And the hi-hats missing
from dense material are not a peak-picking parameter: of the trap hats with a neighbour inside
30 ms, 188 of 403 have no candidate, but loosening the refractory gap and the local-maximum window
recovered three of them, because the limit is the 93 ms analysis window of the source onset
detector rather than the picker on top of it.

## What Striker 1.1 changes

**Supervision in the failing domain.** `bench/drumeval/synth/` renders 140 electronic tracks from
4,159 drum machine one-shots over drum-free backing, which is a library track minus its cached
HTDemucs drum stem. The tempo and bar phase come from that backing, because drums at one tempo
over music at another is a mixture no recording contains and no separator, transcriber or beat
tracker was trained on. Every hit's trigger time is exact, and 96 to 99% of them have an attack in
the band their class owns (`verify.py`).

The part that matters is the kick. A `severity` drawn per kit sets how much of the 400 Hz to 5 kHz
distortion band the kick screams with, and that alone decides whether the kit separator keeps it:
across the corpus the share of energy landing in the kick source at a kick runs from 97% down to
1%, with several tracks on the 43% of a real hardstyle record. A corpus that spans that range is
what stops the classifier believing the kick source whenever it happens to be full.

**Evidence that survives a failed separation.** Sixteen features measure the attack on the mixture
itself rather than on the separated sources: seven band rises, seven band levels, where the attack
sits between the drum bands, and whether its low end falls into the sub over the first 50 ms, as a
pitched 808 or hardstyle kick does and a snare never does.

**Duplicate removal separated from evaluation tolerance.** `SELECT_GAP_S` is per class now, 50 ms
for kicks but 28 for snares and 25 for hi-hats. The old flat 50 ms was the benchmark's matching
window used as a duplicate radius, and 8.9% of snare reference pairs sit closer than that: flams,
drags and trap hat rolls could not be emitted at all.

**Two electronic sets nobody here made.** FSL-30 (28 hand-annotated Freesound loops) and 150 loops
of the 101-200 Drum Loop Dataset, both looped to 24 s. A model trained on our own renderer has to
be asked whether it generalises to electronic drums or only to our way of making them.

**A measurement that needs no annotation.** `fourfloor.ts` reports how much of the beat grid the
kick stream covers on the library. In four-on-the-floor music the kick is on every beat, so it is
close to recall on the product's own songs.

## Where Striker 1.1 still falls short, and why

Two different constraints remain, and neither is the one this started with. Counting kick
candidates against beats in a 60 second window of the owner's four-on-the-floor tracks:

| track | beats | kick candidates | accepted |
|---|---:|---:|---:|
| hardstyle | 168 | 167 | 44 |
| house, `tN6YYPs3g3c` | 122 | 42 | 27 |
| house, `SOJpE1KMUbo` | 113 | 73 | 61 |
| hard techno | 155 | 122 | 88 |

On the hardstyle track every beat has a candidate and the classifier keeps a quarter of them. On
`tN6YYPs3g3c` only a third of the beats have a candidate at all, so nothing downstream can help:
ADTOF's kick channel barely fires and the separated kick source is empty, and those are the only
two places kick proposals come from. Dropping the kick threshold from 0.475 to 0.30 moves the
library from 56% to 58%, so the misses are not sitting just under the line either.

That prediction was right, and the section below is what came of building it.

## The proposal stage was the binding constraint (September 16)

Fixing what the classifier was told did not finish the job. Candidate recall before any filtering
was 78.2% for kicks and 77.9% for hi-hats on the synthetic corpus, against a model already scoring
0.834 there on kicks: the filter was at its own ceiling and the proposals were the limit. Sorted by
how much evidence reached the classifier, the worst tracks were not close: `047-gabber` reached a
candidate for 7.7% of its 312 kick references, `013-gabber` 12.2% of 368, `105-hardtechno` 12.6%
of 191, and `083-hardtechno` 16.4% of its 220 hi-hats.

Two explanations were plausible and both were measured, because the peak picker here is ADTOF's
verbatim (`pre_avg` 0.1 s, `post_avg` 0.01, `pre_max` 0.02, `post_max` 0.01, combine 0.02) and
madmom's own documentation says to set `pre_avg = post_avg = 0` for neural activations, which do
not scale with signal level.

- **A sustained kick defeating the trailing average.** Wrong. The kick activation on `047-gabber`
  is not a plateau, it is flat zero: median 0.001, p90 0.007, max 0.206 on the mixture pass, and
  max 0.013 on the separated kick pass. There is nothing to pick. The transcriber does not
  represent a gabber kick as a drum.
- **The 120 ms mean window spanning a whole 1/16 hi-hat period.** Also wrong, here. Over twelve
  synthetic tracks with at least 150 hat references, shortening it to the 30 ms of Vogl et al.
  moves recall from 81.7% to 81.9%; removing it altogether drops it to 76.6%.

All four proposal streams read either that network or the separator, so on this material they go
silent together. The fifth stream is the mixture's own onset function, `inputs.odf`, which the beat
tracker already computes and Striker already carried as a feature. It has no opinion about which
drum it heard, which is exactly why it survives a transcriber and a separator that both have one.
On `047-gabber` its peaks cover 92.3% of the kick references where the existing streams cover 7.7%.

It is offered to every class, flagged `fromOdf` so the classifier knows where a candidate came
from, and it raises candidate recall on every corpus in the harness, not only the electronic ones.
The largest gains are the classes that had no separated source at all: toms rise 25.5 points on
A2MD, 13.8 on ENST and 10.6 on RWC, and cymbals 16.2 on A2MD and 8.3 on RWC. IDMT is the control
and does not move, because at 99.9% it had all of the evidence already. The cost is roughly twice
as many proposals per reference for the main classes, and much more for the two that had no source
view.

**What it is worth, measured against the right control.** Retraining on the new proposals moved
every class threshold down (kick 0.475 to 0.425, snare 0.425 to 0.400, hat 0.475 to 0.425), and a
lower operating point buys recall on electronic material by itself, so the headline difference
confounds the two. Scoring the new model at the old thresholds separates them: the stream is worth
**+0.003 on the kick on both independent electronic sets, +0.005 and +0.007 on the snare, and
-0.005 to +0.004 on the hi-hat**. On the synthetic corpus, whose gabber and hard techno are far
past anything in those sets, the kick gains 0.042. It does not transfer to them, or to the owner's
library, because there the kicks already reached a candidate: a fix aimed at silence pays only
where there is silence. The most consistent class is the snare, not the kick this was built for.
For scale, an unrelated recipe change measured the same night, on a model with no mixture stream at
all, moved FSL-30 by 0.005 on its own.

`CANDIDATE_REVISION` is 5. Models trained on earlier proposals are refused, and the analyser falls
back to the rule-based path rather than failing, so the repository must never be left with the
installed model and the analyser out of step. `bench/drumeval/ceiling.ts` measures this stage
directly and is the tool to re-run before assuming the classifier is the limit.

## What the 1.1 experiments showed

**The first synthetic corpus failed, and the failure was informative.** Built before the separator
mechanism was understood, it kept 82 to 91% of each kick in the kick source. Trained on it, kick
acceptance on the owner's hardstyle track went from 2 to 15 of 135 beats, and kick coverage of the
library's beat grid from 53% to 56%. It had taught the classifier to trust the kick source, which
is the habit that fails on real records. `kickprobe.py` then rendered eight candidate kick designs,
separated each and measured where the energy went; the band of distortion products between 400 Hz
and 5 kHz is what moves a kick out of its own source.

**The mix-band features buy nothing on acoustic corpora.** Same corpora, same three seeds, the only
difference being whether the sixteen features exist: kick 0.908 against 0.907, snare 0.838 against
0.838, hat 0.884 against 0.883, cymbal 0.656 against 0.657. That is the expected result. Those
corpora are acoustic drums, where the kit separator works and the source features already carry the
answer; the bands can only pay where it fails.

**The hi-hat misses are classification, not missing evidence.** On one hip-hop track the drum-stem
view proposes no hi-hat candidates at all, which looks like separation destroying them. Scanning
all 122 library tracks for that pathology finds one track, and not that one. 144 candidates and
five accepted is the same shape of error as the kick.

**A rule cannot replace the classifier here.** `gridkicks.ts` reads kicks off the beat grid where
a phrase of beats stands clearly above that track's own off-grid moments. It captures 1,289 kicks
across eleven house, techno, disco and edm tracks at 94.7% candidate recall, and captures nothing
at all on hardstyle, where only 16% of beats clear the floor because the kick's sub never falls.

**Candidate recall on the rebuilt corpus is 78% for kicks**, against 94% on the clean one, because
its severe end is harder than any real record: on one track 102 of 171 kick references have no
candidate. Those teach nothing. The same tracks are valuable for the snare class, where 360 of 421
candidates come from attacks in the snare source and every one sits on a kick.

## Comparing cross-dataset runs: a trap worth naming (September 16)

`rbma` is `heldOut: true`, so it joins the training pool only under `--train-held-out`. Striker
1.0's cross-dataset run used that flag and therefore has folds over **mdb, enst, idmt, rbma**; the
first 1.1 cross-dataset run did not, and has folds over **mdb, enst, idmt, synth**. Both are honest
leave-one-corpus-out protocols and every published cell is still scored by a model that never saw
its corpus. But the two runs train on different pools, so differencing their tables measures the
model change **and** a recipe change together, and the difference lands hardest on exactly the
corpus whose status differs.

Read `folds.json` before comparing two cross-dataset runs. If the fold corpora differ, the tables
are not comparable and one of them has to be re-run.

Two hypotheses about the 1.1 cross-dataset numbers were tested and rejected along the way. The
per-class selection gap is **not** the cause: scoring the same model with the gap forced back to a
flat 50 ms moves MDB, ENST and ENST 2/3 by less than 0.001, so the tighter gap that lets flams and
rolls through costs nothing at a 50 ms metric. And the proposal stream is not the cause either: on
matched folds it accounts for about a fifth of the difference.

## What Striker 1.1 costs, and the one dial that controls it

On Striker 1.0's own cross-dataset protocol, the shipped model gives up **0.007** of three-class
sum F, and it is worse on all eight corpora, not only in the mean: MDB 0.860 to 0.855, ENST 0.809 to
0.798, ENST 2/3 0.841 to 0.832, RBMA13 0.753 to 0.744, IDMT 0.971 to 0.971, MDB drums 0.920 to
0.914, ENST drums 0.893 to 0.885, MDBDrums++ 0.862 to 0.852. Most of it is acoustic **snare
recall**. (An earlier draft of this section quoted an intermediate build's numbers, which were
0.008 and had RBMA13 at 0.750.)

Half of the original 0.010 was a labelling bug rather than a trade. The synthetic corpus recorded
residue as one set of times for all four classes and marked every class at every one of them, so an
optional reference covered 63% of a track for each class. Per class it is 13% for kicks and 26% for
snares, and retraining on the corrected labels moves ENST 0.791 to 0.795, ENST 2/3 0.824 to 0.828,
RBMA13 0.745 to 0.750, ENST drums 0.879 to 0.882 and MDBDrums++ 0.847 to 0.851, at a cost of 0.006
on FSL-30's 28 tracks. `synth/residue.ts` rewrites existing backings, `backing.ts` writes
`residueBy` for new ones, and the renderer is deterministic so only the candidate export is redone.

One change accounts for it. Training the same recipe with `--ignore=...,synth:snare` leaves kick,
hi-hat, cymbal and tom bit-identical and moves the snare both ways at once:

| snare F | ENST | ENST drums | MDB | FSL-30 | drumloop101 |
|---|---|---|---|---|---|
| synthetic snare taught | 0.720 | 0.848 | 0.792 | **0.839** | **0.827** |
| synthetic snare ignored | **0.731** | **0.868** | **0.805** | 0.816 | 0.809 |

The first three columns are cross-dataset; the last two are the independent electronic sets scored
with the track-fold model. Do not read a row as one protocol.

A dial, not a bug: that corpus's snare is worth about 0.02 of electronic snare and costs the same
in acoustic snare. It was built to stop the classifier trusting the kick source on distorted
electronic music, and it does; it also teaches the snare class to distrust the separated snare
source, which is wrong on a real kit. Dropping it returns `fromSource` from 0.02 to 0.11 of the
snare model's gain.

The shipped model keeps the synthetic snare because the room plays electronic music. The other end
is trained and kept at `bench/reports/drumeval/striker/v24-cv-strict`. Neither end is the answer:
that corpus marks backing residue optional across 69% of its timeline and labels its claps as
snares, and both teach the snare class carelessly. Narrowing the residue and deciding deliberately
what a synthetic clap should teach should give both ends at once, and is a corpus rebuild.

## The snare was never worse, the threshold was (September 16)

Comparing 1.0's and 1.1's detections against ENST's references one by one, 1.1 loses 415 of them
and gains 33. The 415 are not a kind of drum, they are a region of confidence: median separated
source -25.7 dB against -12.4 for the ones both models find, transcription activation 0.197 against
0.681, and 8.7% of the energy in the snare stem against 40.2%. Marginal hits. Scoring the same model
at lower snare thresholds recovers them exactly: at 0.25 the cross-dataset ENST snare reads 0.756
against Striker 1.0's 0.757, and MDB 0.824 against 0.825.

The cause is in how the operating point is chosen. `best_threshold` averages F over every corpus in
the fold, and three of them do not have complete annotations: `a2md` and `rwc` are aligned MIDI,
`star` is re-rendered from pseudo-labels. A real hit their labels miss reads as a false positive
when it is detected, so the objective pushes the threshold up to hide those, and the corpora that
are annotated properly pay for it in recall. `--noisy` stops a bad label teaching; it cannot stop a
missing one counting.

`--threshold-corpora=mdb,mdbsolo,enst,enstsolo,idmt,synth` restricts the vote to complete
annotations. It remains a leave-one-corpus-out threshold, because the fold has already removed the
scored corpus and its variants. Snare thresholds fall from 0.375 to 0.325, and ENST reads 0.735,
ENST drums 0.864, MDB 0.813, held-out 0.874, with a2md, rwc and synth unmoved.

Three other explanations were tested and rejected first, and the first is worth remembering.
Per-track context columns (`viewAlive`, `sourceAlive`) improve every training corpus and **damage**
every cross-dataset one, because a value constant within a track is a handle on track identity that
the trees use to separate domains. The same information per candidate and track-relative is a wash.
And the synthetic snare is mis-centred by 7 to 9 dB but spans properly and has more quiet hits than
MDB, RWC or A2MD, so it is not short of ghost notes; weighting it down buys nothing.

## The next thing to build, already measured

The classifier sees only the candidate. Nothing in its 102 features says whether the transcription
view it is reading is alive on this track, which is what decides whether a mixture-only proposal is
worth anything: where the class activation is flat the fifth stream recovers 60% of the kick
references at six false candidates each, and where it is healthy it recovers 3% at thirty-five.
1,079 of 1,350 kick tracks sit in the healthy bucket and contribute 83% of the new negatives.

Three per-track columns fix that, tested by deriving them inside `train-striker.py` with no
re-export: `viewAlive` (the 99th percentile of `max(mix[channel], stem[channel])` over the track's
candidates), `viewMean`, and `odfOnlyShare`. They are used, `viewAlive` being the fifth most
important kick feature, and the hi-hat recovers 0.005 held-out and 0.006 on the synthetic corpus.
Porting them into `drumCandidates` needs `CANDIDATE_REVISION` 6 and a re-export; the curves are
already in scope there, so the computation is the same three lines.

## What the harness does not prove (audited September 16)

Two independent reviews of the measurement code. What they found that stands:

**The published cross-dataset table is sound.** `--loco` genuinely excludes the held-out corpus
and every variant of it, for every class and every seed, because folds resolve a variant through
`variantOf` before excluding. Thresholds come from inner folds of the remaining corpora only.
Tolerance is 50 ms on both sides, matching is optimal one-to-one for both systems, the class
mapping is `MIDI_REDUCED_5` verbatim and identical for baseline and model, and the track lists are
the same set with no corpus where one system could score and the other be skipped. Every number in
the table reproduces from the stored artifacts.

**Striker's operating point is tuned and ADTOF's is not.** ADTOF keeps its shipped per-class
thresholds on every dataset; Striker's are chosen by maximising a macro mean over the corpora it
was allowed to see. There is no leakage into the scored corpus, but it is a tuned system measured
against an untuned one, and the harness offers ADTOF no equivalent. The check that keeps this
honest is reproducing ADTOF's own published MDB and ENST figures to within 0.012.

**Optional references absorb most false positives on the two unpublished corpora.** The synthetic
corpus marks backing residue `unreviewed`, and casts that net far too wide: across 40 tracks the
share of the timeline within 50 ms of an optional marker is a median of 69% for kicks, 68% for
snares and 69% for hi-hats, from about 1,020 optional markers per track against 56 to 326 required
ones. Two thirds of a false positive there goes uncounted. No published cell is affected, because
`benchmark.py` cannot score `synth`, `grid` or `owner` at all, but the shipped thresholds are, since
they maximise a macro mean in which synth votes with its precision penalty muted. Narrowing that
label is the first thing to fix in the next corpus build.

**The owner's clips are not strictly held out.** The synthetic backing is a library track minus its
cached drum stem, and 16 of the 36 annotation clips are recordings used that way. Their real drums
and labels were never seen, but the recording was. `clips/index.json` marks `heldOut` and orders
the 20 clean clips first; keep `render.py` off any recording that becomes a clip.

**`fourfloor.ts` cannot tell the classifier from the fallback.** Kick coverage of the beat grid over
the 38 four-on-the-floor tracks reads 53% for Striker 1.0, 56% for Striker 1.1 and **56% for a run
with no model at all** on the 1.1 analyser. The three points belong to the fifth proposal stream
feeding the rule-based path, not to the classifier, so the metric measures the analyser and must not
be quoted as evidence for a model. What the classifier does on the library is filter: same analyser,
model against none, kick 30,009 to 29,304, snare 24,236 to 21,087, hat 69,296 to 60,311.

**`evaluate.ts` without `--model` silently scores the rule-based fallback.** This was not caught by
reading the numbers, which looked plausible and slightly better. The tells are a missing `classes`
key in every track record and, now, a `model` and `modelVersion` in `summary.json`. It cost a round
of published room figures: 19 of 19 confirmed hits and 26 of 37 missed-hit clicks belong to the
fallback, and the shipped model reads 18 of 19 and 24 of 37 against 1.0's 18 of 19 and 22 of 37.

**Smaller things to know before quoting a number.** `synth` and `grid` share library audio without
declaring `variantOf`, so a fold over that pair would leak. `fourfloor.ts` takes the best of three
metrical readings per track, which is an oracle choice, and half its library is synth backing.
RBMA's published snare figure includes a class `--ignore=rbma:snare` deliberately never teaches,
which understates rather than flatters. STAR's stems come from MUSDB18, which also trained
HTDemucs, so separation there is optimistic. `evaluate.ts` does not record the `--model` path, so a
run's provenance rests on its label. The `all` row of `summary.md` pools variants and counts MDB
and ENST three times over; it is not a result.

## Rule-based fallback (analysis v35-v36)

These rules were developed and measured with the inagoy DrumSep kit model, whose cymbal stem
also held hats; with MDX23C sources they read hats and cymbals summed as that stem.

The target failure is missed claps in STEIN27's Habibi, especially bar 24. Listening feedback
confirmed claps at 39.594, 40.410 and 41.224 seconds, then confirmed another at 46.940.
The old model has little or no snare
evidence there, so lowering a peak threshold cannot recover all three reliably. The listener
also identified probable non-snares at 43.478 and 44.301 seconds. A longer-context follow-up
confirmed that 45.925 is not a snare. A full-chorus review identified the 46.744 detection
as early; an isolated follow-up confirmed the correct attack at 46.940.
These are partial labels, not complete annotation of the passage.

### Implemented candidate

With both separation models installed, the rules use full mix -> HTDemucs drums -> kit
kick/snare/cymbal sources. Original audio supplies the final attack placement, within 50 ms of a
source onset. Relative source RMS and source/mix RMS reject weak leakage. Existing primary
transcription can support quiet source peaks, or survive a missing source peak when the
source still has an energy rise. Source detections are combined with the legacy final snare
stream, including its pattern completion. Unmatched legacy hits need source/mix RMS >= .005
and must pass the cymbal veto. One-to-one pairing within 50 ms avoids duplicate detections;
matched events retain the larger confidence so separation attenuation cannot weaken an
existing lighting trigger.
New source detections are never completed from a rhythmic grid. Kicks and hats retain the
existing production paths: individual-source kick proposals regressed full-mix precision.

This was introduced in analysis version 35. The model revision is recorded as `drumSeparation`
on ingested analyses. Missing or failed separator models retain the previous ADTOF/DSP pipeline.
No runtime Python dependency is introduced. Setup, checksums and licenses are documented in
[lab/SEPARATION.md](lab/SEPARATION.md).

The selected source peak thresholds are .4 kick and .1 snare; both need relative RMS >= .25
unless supported by a primary event within 50 ms. Source/mix RMS must be >= .01. Unmatched
primary events need a positive source energy rise and source/mix RMS >= .03 kick or .01 snare.
Levels are source RMS over [-20,+60] ms divided by the 90th percentile of source-peak RMS.
The detector does not reject a real snare merely because a simultaneous kick is louder.
Cymbal-like events are vetoed when cymbal/snare RMS > 1.5 and snare 1-3 kHz power fraction
< .1, or when the ratio > 1 and the fraction < .01. This uses a 2048-point Hann FFT centered
40 ms after the source attack at 22.05 kHz, not a logarithmic filterbank power approximation.

A quiet clap under a kick can survive only as a small snare residue. At actual kick-source
attacks, residual snare/mix RMS >= .005, snare midrange fraction > .7 and cymbal/snare ratio
<= 1.5 admit a snare candidate. These recovered hits receive at least .1 confidence because
separation attenuates their amplitude; the existing effect trigger floor is .05. This finds
the confirmed 46.940 clap and three provisional Habibi candidates at 18.398, 68.980 and
84.488. The listener thought those three sounded correct but found the two-second context
hard to judge. They are not scored as confirmed positives. This narrow recovery branch adds
no detections on the 23 oracle tracks, six native full mixes, or the two other native review
excerpts, so its generalization remains less established than the main path.

### Measurements and limitations

Restored MDB Drums: 23 full mixes plus reference drum-only recordings and labels. The frozen
shipping baseline, including pattern completion, has kick P .836 / R .873 / F .854 and snare
P .830 / R .612 / F .705 at a 50 ms one-to-one matching tolerance. It misses 1,030 of 2,654
annotated snares. Snare pattern completion adds 47 true and 66 false events. Signed timing
medians are -6 ms kick and -9 ms snare; absolute error p90 is 16 and 19.7 ms respectively.

Separating the *reference drum-only recordings* establishes an oracle, not production quality.
An ungated source detector raises oracle snare F to .777 and kick F to .937, but adds too many
false snares on several rock tracks. Conservative fusion calibration gives snare P .898 /
R .655 / F .757 (1,738 TP, 197 FP, 916 FN), track-mean F .848; kick P .947 / R .982 /
F .964 (1,512 TP, 85 FP, 27 FN), track-mean F .963. Those oracle numbers use raw source
times and 44.1 kHz RMS; the application resamples to 22.05 kHz and snaps/deduplicates attacks.
The conservative filter trades some of the recall gain for more consistent track results. Parameters were explored on this corpus,
so it is development evaluation, not a held-out estimate of generalization.

The final native full-mixture development evaluation uses Rockabilly, Rock, Reggae, Shadows,
Disco and CoolJazz. With legacy fusion, snares improve from 308 TP / 12 FP / 202 FN to
311 TP / 12 FP / 199 FN (F .7422 -> .7467). This is a modest aggregate improvement; the
largest practical gains are the listener-confirmed pop/rap claps outside this labeled set.
The corresponding exact-helper oracle fusion gives 1760 TP / 239 FP, F .7565, against
the shipping baseline's 1624 TP / 332 FP, F .7046. Oracle and full-mixture scores must not
be combined or compared as if they used the same input conditions.

Full-mixture kick proposals instead change 231 TP / 11 FP to 236 TP / 27 FP, reducing F
from .8733 to .8582. Raising amplitude thresholds, requiring agreement with ADTOF, and
running ADTOF on the estimated drums did not provide a reliable repair. Production therefore
keeps the existing kick detections and their quantisation, preserving baseline performance.

Native stereo pipeline checks on the complete 146.946-second Habibi recording preserve all
four confirmed claps at 39.594, 40.410, 41.224 and 46.940, with levels .39, 1, .30 and .10.
Both confirmed wrong detections and the two probable non-snares are excluded. For Back in Black,
the first proposal included kick clicks at 7.238 and 9.874; for bad guy it included a delayed
duplicate at 37.903. Listener feedback identified those problems. The conservative native
candidate removes those three events. The listener reviewed both corrected passages and
reported that they sounded correct with no wrong clicks. Their click times are retained as
partial positive labels, without claiming manually measured onset timing or full-track recall.
All 19 confirmed positives across the three tracks pass at the .05 lighting level. Three
additional Habibi candidates remain provisional. Native full-Habibi separation took 332.6
seconds with two inference threads under concurrent development load; this is not an isolated
throughput benchmark. The runtime preserves exact output length, including the irregular
final chunk. Real-model regressions cover both a 1025-sample input and the 129920-sample
tail that exposed an ONNX dynamic-shape failure. The DrumSep runtime supplied fixed 8-second
windows with context padding and trimming.

These rule-based results established no state-of-the-art claim; the benchmarks above do.
Quiet ghost notes, simultaneous instruments, separator leakage and transfer between genres
remain important sources of error. Additional listener annotation and complete full-mix
evaluation are needed before claiming broad superiority.

### September 13 listener refinements (analysis v36)

Manual missed-hit clicks are rough anchors. The review scorer preserves their original
timestamps and associates them with the reviewed beat grid's sixteenth subdivisions.
Acoustic attack positions remain separate: a coarse grid must not move a measured sound.
Like a Prayer's eight uncertain snare judgements remain provisional, excluded from hard
negative scoring by `judged/drum-review-evaluation.json` with exact review identities.

The accepted snare changes restore weak measured legacy hits only with independent DSP
and midrange source evidence, admit quieter corroborated source attacks, and recheck the
cymbal veto after acoustic snapping. A separate strong-source recovery branch requires
the snare source to outweigh kick leakage. It restores eight marked Habibi snares and
seven Desire attack associations, and removes Habibi's early 98.999-second click. Five
Habibi and two Desire marked snares remain unresolved. Three posterboy snare negatives
remain unresolved; broad speculative rejection was not admitted.

Kick recovery combines weak ADTOF evidence, an independent full-mix attack, a rising
separated source and predominantly 20–90 Hz energy. It restores all five marked Habibi
kicks and ten Like a Prayer kicks, while a conservative absence test removes posterboy's
48.920-second vocal false kick. Two rough Like a Prayer clicks select an adjacent grid
slot; the recovered measured attacks remain 33.325 and 101.495 seconds. No timestamps or
track IDs are embedded in the production rules.

Strict snare totals after all refinements: six native full-mix tracks have 312 TP, 13 FP,
198 FN; 23 oracle tracks have 1769 TP, 239 FP, 885 FN. The additional native false positive
at 14.246 seconds in Reggae is an annotated side-stick (SST, 14.259); the user approved
that articulation as quieter snare lighting. The strict dataset taxonomy is unchanged.
The final strong-source branch adds 1 native TP and 9 oracle TP without additional FP.
Kick candidate replay adds 15 oracle TP without new FP; a worst-case low-confidence veto
screen removes one native and five oracle FP without removing a labeled kick.

These are development-set results, not held-out estimates of general performance. All
earlier excerpt listener regressions are retained. Full-song source context differs:
Back In Black retains 6/6 judged snares, while bad guy retains 7/9 at 50 ms before and
after the latest rule (32.446 absent; 35.931 measured at 36.000). Fresh full-song candidates
also contain unjudged additions, which should be reviewed rather than counted as true.
Reports and preserved review snapshots are under `reports/audio-reliability/judgement-correction`.

### Alternatives investigated

| Candidate | Finding |
|---|---|
| Lower ADTOF snare threshold | .18 improves pooled snare F from .705 to .720 but adds 66 false positives; cannot recover Habibi's first clap. Kick threshold reductions degrade F. |
| Original ADTOF frontend | Does not improve snare results over the current port across 23 tracks. |
| DSP-supported weak model events | Small pooled improvement, insufficient Habibi recovery. |
| Timbral recurrence | Recovers the excerpt but adds 59 false positives for only 4 additional true positives on MDB. |
| HTDemucs then ADTOF | Habibi snare classification gets worse despite a useful drum estimate. |
| DrumSep directly on full mix | Misclassifies the 43.478-second Habibi sound. The first separation stage is necessary. |
| Reject all kick-dominated snares | Removes a confirmed simultaneous Habibi clap and valid bad guy snares. |
| Reject only weak kick-dominated snares | Better pooled oracle recall, but loses real Reggae snares and adds false Shadows snares on full-mix evaluation. |

ADTOF already maps General MIDI clap 39 into snare; this is not a missing clap class. Primary
sources: [instrument mapping](https://github.com/MZehren/ADTOF/blob/master/adtof/ressources/instrumentsMapping.py),
[ADTOF](https://github.com/MZehren/ADTOF), [Demucs](https://github.com/facebookresearch/demucs),
[DrumSep](https://github.com/inagoy/drumsep). Recent work supports studying individual drum
separation for transcription, but does not establish this combination as SOTA:
[2025 separation/transcription study](https://arxiv.org/abs/2509.24853),
[Noise-to-Notes](https://arxiv.org/abs/2509.21739),
[ADT_STR](https://arxiv.org/abs/2601.09520).

## Reproduce and extend

All large diagnostic outputs live in ignored `bench/reports/audio-reliability/`. Reference
labels in `judged/drums/habibi.json` deliberately distinguish confirmed positives, probable
negatives and uncertainty. Unknown detections must not be counted as false positives.

```sh
node bench/drum-regressions.ts habibi --analysis=PATH --min-level=0.05 --strict
node bench/lab/review-separated.ts --dir=STEM_DIR --id=TRACK_ID --offset=32
node bench/lab/habibi-listen.ts --id=TRACK_ID --from=32 --to=40 --times=32.446,33.337 --name=review
```

`review-separated.ts` runs the production analysis with native kick/snare float32 files and
fresh ADTOF evidence. Listening overlays record the source hash, excerpt and exact click
times; they refuse to overwrite an existing review. They never replace saved user analyses.

Maintained tools:

- [drumeval](drumeval/README.md): corpora, Striker training and benchmark scoring.
- `exp-drum-stem.py`, `mdx23c-reference.py`: PyTorch reference separation (HTDemucs, MDX23C).
- `exp-native-separation.ts`: the production separation API on planar stereo PCM.
- `prepare-drum-evidence.ts`, `collect-review-evidence.ts`: full-song source estimates and
  current detector replay; the collector uses the local `judgement-correction` report root.
- `exp-kick-source-candidate.ts`, `validate-reviewed-kicks.ts`: the admitted kick rule's
  development-corpus and listener comparisons, including exact production/prototype parity.
- `../score-drum-review.ts`, `../publish-drum-reviews.ts`: identity-aware review scoring and
  safe publication. See [review continuity](lab/DRUM-REVIEW-PUBLICATION.md).

Superseded one-off scripts and audit notes were removed from the maintained tool set during
pre-commit cleanup. Their source is retained locally under
`reports/audio-reliability/cleanup-2026-09-13/` and, for the DrumSep-only tools,
`cleanup-2026-09-14/`, alongside archive manifests. Relative imports
there require restoration before execution. Existing result snapshots remain unchanged.
The next session starts from [the current handover](../docs/HANDOVER.md).
