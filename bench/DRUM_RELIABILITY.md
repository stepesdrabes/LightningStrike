# Drum reliability study, September 2026

The target failure is missed claps in STEIN27's Habibi, especially bar 24. Listening feedback
confirmed claps at 39.594, 40.410 and 41.224 seconds, then confirmed another at 46.940.
The old model has little or no snare
evidence there, so lowering a peak threshold cannot recover all three reliably. The listener
also identified probable non-snares at 43.478 and 44.301 seconds. A longer-context follow-up
confirmed that 45.925 is not a snare. A full-chorus review identified the 46.744 detection
as early; an isolated follow-up confirmed the correct attack at 46.940.
These are partial labels, not complete annotation of the passage.

## Implemented candidate

With both optional models installed, analysis uses full mix -> HTDemucs drums -> DrumSep
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

This is analysis version 35. The model revision is recorded as `drumSeparation` on ingested
analyses. Missing or failed separator models retain the previous ADTOF/DSP pipeline. No
runtime Python dependency is introduced. Setup, checksums, export corrections and licenses
are documented in [lab/SEPARATION.md](lab/SEPARATION.md).

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

## Measurements and limitations

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
tail that exposed an ONNX dynamic-shape failure. Production always supplies fixed 8-second
DrumSep windows with context padding and trimming.

No claim of state-of-the-art general drum transcription is established by these results.
Quiet ghost notes, simultaneous instruments, separator leakage and transfer between genres
remain important sources of error. Additional listener annotation and complete full-mix
evaluation are needed before claiming broad superiority.

## September 13 listener refinements (analysis v36)

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

## Alternatives investigated

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

- `exp-drum-stem.py`, `exp-drumsep.py`, `exp-drumsep-corpus.py`: Python reference separation.
- `exp-native-separation.ts`, `exp-onnx-parity.py`: native forward and export comparison.
- `prepare-drum-evidence.ts`, `collect-review-evidence.ts`: full-song source estimates and
  current detector replay; the collector uses the local `judgement-correction` report root.
- `exp-kick-source-candidate.ts`, `validate-reviewed-kicks.ts`: the admitted kick rule's
  development-corpus and listener comparisons, including exact production/prototype parity.
- `../score-drum-review.ts`, `../publish-drum-reviews.ts`: identity-aware review scoring and
  safe publication. See [review continuity](lab/DRUM-REVIEW-PUBLICATION.md).

Superseded one-off scripts and audit notes were removed from the maintained tool set during
pre-commit cleanup. Their source is retained locally under
`reports/audio-reliability/cleanup-2026-09-13/`, alongside an archive manifest. Relative imports
there require restoration before execution. Existing result snapshots remain unchanged.
The next session starts from [the current handover](../docs/HANDOVER.md).
