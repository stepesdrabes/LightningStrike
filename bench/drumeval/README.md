# Drum evaluation and Striker training

These tools measure kick, snare and hi-hat detection on labelled corpora with the production
analysis, score it under the published benchmark protocols, and train Striker, the optional drum
hit classifier (`models/striker.json`). They read corpora from ignored `bench/corpus/` and write
to ignored `bench/reports/drumeval/`.

## Corpora

| Corpus | Contents | Labels | Role |
|---|---|---|---|
| `mdb` | MDB Drums, 23 MedleyDB full mixes | hand annotations (subclass files) | training and benchmark |
| `mdbsolo` | the same 23 recordings, drums only | same | training variant and benchmark |
| `enst` | ENST-Drums minus-one pieces, wet mix plus accompaniment at equal gain | hand annotations | training and benchmark |
| `enstsolo` | the same 64 wet drum mixes without accompaniment | same | training variant and benchmark |
| `enst23` | the same pieces, drums at 2/3 and accompaniment at 1/3 (reproduces ADTOF's published ENST score) | same | benchmark only |
| `rwc` | RWC 2.0 pop songs with drums and genre tracks 1-27 | DTW-aligned MIDI | training |
| `a2md` | A2MD popular songs, alignment tiers 0.0 and 0.1 | automatically aligned cover MIDI | training where ADTOF agrees |
| `idmt` | IDMT-SMT-Drums V2 drum-only loops | hand annotations | training and benchmark |
| `rbma` | RBMA13 electronic tracks (purchased audio), public three-class labels | hand annotations | kick and hat training; benchmark |
| `star` | STAR Drums training excerpts over real non-drum stems (`convert-star.ts --every=6`) | drums re-rendered from pseudo-labels | hi-hat and cymbal training |
| `mdbpp` | MDBDrums++: the 23 MDB drum recordings, re-annotated as MIDI | MIDI with velocities | benchmark only |
| `gmd` | Groove MIDI Dataset test split: 124 Roland TD-11 performances with audio | performance MIDI | benchmark only |
| `synth` | electronic drum machine tracks rendered by [synth/render.py](synth/render.py) | the sequencer's own trigger times | training |
| `owner` | 24 s clips of library songs, hand confirmed in [bench/annotate](../annotate/README.md) | the owner's annotations | benchmark, the product's own music |
| `fsl30` | 28 Freesound loops, house and techno, hip-hop, jungle and breakbeat | hand annotations (Yi and Barthet 2026) | benchmark |
| `drumloop101` | 150 loops of the 101-200 Drum Loop Dataset, the effects and loudness condition | the renderer's own step vectors | benchmark |
| `grid` | four-on-the-floor library tracks, kicks read off the beat grid | [gridkicks.ts](gridkicks.ts) | training, optional |
| `library` | the desktop app's songs | none | run comparisons and owner reviews |

Convert a downloaded corpus with the matching `convert-*.ts` script; each writes `tracks.json`
(`convert-enst.ts --solo` writes `enstsolo`, `--two-thirds` writes `enst23`; `convert-mdbpp.ts`
points MDBDrums++ at the local MDB drum files, whose samples it shares). A variant corpus
(`variantOf`) holds the same recordings rendered or labelled differently: it trains only the
classes `train-striker.py --train-variants` names, in exactly the folds that train its original,
and is scored like it.

`synth` exists because the kit separator and ADTOF were both trained on acoustic drums, so a
distorted electronic kick arrives at the classifier described as something else. It renders drum
machine one-shots into house, techno, hardstyle, gabber, trance, trap, drum and bass, dubstep,
boom bap, disco and breaks patterns, through the production chain that breaks detection (pitched
sub layers, saturation, clipping, bitcrush, filter sweeps, sidechain ducking, bus limiting, and
an AAC round trip on half the corpus), over drum-free backing built by subtracting the cached
HTDemucs drum stem from a library track. [synth/verify.py](synth/verify.py) checks the result
against its own labels before any of it trains: each class should have an attack in its band at
better than 95% of its labelled hits.

`fsl30` and `drumloop101` are electronic sets nobody here made, which is what makes them worth
having: a model trained on our own renderer should be asked whether it generalises to electronic
drums or only to our way of making them. Both hold loops of a few seconds, repeated to 24 s
because a beat tracker and a separator have nothing to work with otherwise. In `drumloop101` a
step is a sixteenth whatever its `beat_type` field says, and each render is cut to a flat four
seconds, so the last repeat is partial and its hits still have to be labelled; read another way,
half the attacks in the audio have no label near them.

Two kinds of reference are neither taught nor counted, and both carry `sub: 'unreviewed'` so
that holds under `--labels=strict` as well as `light`: the drums the backing subtraction leaves
behind, and the stretches of an owner clip nobody has confirmed. Marking them `optional` alone
would not do it, because `strictReferences` ignores `optional`.

Residue is recorded **per class**, and that matters more than it sounds. Marking every class at the
union of four high-recall detectors put an optional reference within 50 ms of 63% of a synthetic
track for every class, so the corpus stopped penalising false positives and taught the snare class
to distrust its own separated source. Per class it is 13% for kicks and 26% for snares, and the
cross-dataset acoustic snare recovers by 0.005 to 0.016. [synth/residue.ts](synth/residue.ts)
rewrites existing backings without re-deriving them; `backing.ts` now writes `residueBy` directly.
The renderer is deterministic, so re-rendering after a label change gives byte-identical audio and
every cached separation and ADTOF pass still applies: only the candidate export has to be redone.

RBMA13's public snare labels leave claps and side sticks out, and STAR's non-drum stems carry
unlabelled clap residue; either one teaches the classifier to reject claps and snaps, so
`train-striker.py` ignores RBMA snare labels by default (`--ignore=rbma:snare`). The shipped
recipe also ignores STAR's snare, kick and tom labels: STAR raised hi-hat and cymbal F across
the benchmarks but lowered kick and tom F, as the drums-only variants did for kicks and toms.

The synthetic corpus and the owner's clips are read with the `light` policy, not `strict`.
`strict` promotes every reference of a class to required, including the optional ones, so the
`unreviewed` stretches would become hits a detector must find. `train-striker.py` and
`benchmark.py` both drop them correctly; only the `evaluate.ts` strict summary would not, which is
why `benchmark.py` is pointed at the published datasets and not at these two.

Two label policies exist. `light`, the product's: ghost notes, brush strokes, side sticks,
pedal hats and shaker-like percussion are optional references, neither required nor counted as
false positives. `strict`, the benchmarks': every reference of the class counts; the candidate
export and `benchmark.py` drop tambourine and shakers as in ADTOF's `MIDI_REDUCED_5`, while the
`evaluate.ts` summaries still count them as hats. Hats also score against hats plus cymbals
(`metal`), the stream the lights receive.

## Workflow

```sh
node bench/drumeval/prepare.ts --corpus=rwc --batch=8  # beats, ADTOF, separation, ADTOF per source
node bench/drumeval/evaluate.ts --label=base --export-candidates=v12e
bench/reports/drumeval/py/Scripts/python bench/drumeval/train-striker.py --candidates=v12e --name="Striker 1.0" \
  --train-held-out --corpora=mdb,enst,rbma,idmt,rwc,a2md,mdbsolo,enstsolo,star --train-variants=snare,hat,cymbal \
  --ignore=rbma:snare,star:snare,star:kick,star:tom --noisy=a2md,rwc --agreement-runs=base20 \
  --balance=0.5 --seeds=5 --labels=strict --score=light --out=bench/reports/drumeval/striker/v19-cv-strict
node bench/drumeval/evaluate.ts --label=striker --model=bench/reports/drumeval/striker/v19-cv-strict --compare=base
node bench/drumeval/judged.ts --label=striker          # listener-confirmed partial labels
node bench/drumeval/reviews.ts --label=striker         # the owner's saved drum reviews
```

That recipe's `model.json` is Striker 1.0. The installed `models/striker.json` is Striker 1.1,
whose recipe differs in the candidate set, the synthetic corpus and the snare's operating point:

```sh
bench/reports/drumeval/py/Scripts/python bench/drumeval/train-striker.py --candidates=v23   --name="Striker 1.1" --train-held-out --train-variants=snare,hat,cymbal   --corpora=mdb,enst,rbma,idmt,rwc,a2md,mdbsolo,enstsolo,star,synth   --ignore=rbma:snare,star:snare,star:kick,star:tom --noisy=a2md,rwc --agreement-runs=base20   --balance=0.5 --seeds=5 --labels=strict --score=light   --threshold-corpora=mdb,mdbsolo,enst,enstsolo,idmt,synth --threshold-classes=snare   --out=bench/reports/drumeval/striker/v29-cv-strict
```

That is the installed `Striker 1.1 (bb74c4e6)`, and it regenerates the model byte for byte. Swap
`--train-held-out` for `--loco --loco-corpora=mdb,enst,rbma,idmt --train-held-out` and drop
`--score=light` for the cross-dataset models the published table is scored with.

Pass `--model` to every `evaluate.ts` run that is meant to score a model. Without it the run uses
the rule-based fallback and says so only by omitting `classes` from each track record; the run's
`summary.json` now also records the model path and its version. `--noisy` keeps
an aligned-MIDI class only where ADTOF agrees with it and ignores its pedal hats and soft
strokes; `--balance` weights corpora by size to that negative power.

`--threshold-corpora` decides which corpora vote on the operating point, and it matters more than
it looks. Dropping an untrustworthy label stops it teaching, but it does not stop its **absence**
counting: where `a2md`, `rwc` or `star` miss a real hit, detecting it scores as a false positive,
so the threshold objective raises the threshold to hide those detections and the higher threshold
then costs recall everywhere else. Restricting the vote to corpora whose annotations are complete
(`mdb,mdbsolo,enst,enstsolo,idmt,synth`, the last because its labels are the sequencer's own
trigger times) moves the cross-dataset snare threshold from 0.375 to 0.325 and recovers ENST 0.725
to 0.735, ENST drums 0.855 to 0.864 and MDB 0.808 to 0.813, with the training corpora unmoved. It
stays honest under `--loco`, which already removes the scored corpus and its variants from the
fold, so ENST's threshold is voted on by MDB, IDMT and the synthetic corpus.

`prepare.ts` separates on DirectML on Windows (`--provider=cpu` elsewhere) and caches every model
input by the decoded audio's hash: beats, ADTOF on the mix and on the separated drum stem, the
kick, snare, hi-hat and cymbal sources at 22.05 kHz, and ADTOF on each 44.1 kHz source. A kit
model change reuses the cached stereo drum stem (`--force=drums` reruns HTDemucs).
`evaluate.ts` replays `analyzeTrack` from that evidence, so an analyser change is measured in
minutes. With a model directory it applies each track's fold model (`folds.json`); tracks
outside every fold use `model.json`. Runs with a model also record each class's hits,
the hat without cymbals and the toms, for benchmark scoring.

`train-striker.py` needs Python 3.12 with LightGBM, NumPy and SciPy. It trains one classifier
per class (kick, snare, hat, cymbal, tom) with `--labels=light|strict`, and `--score` scores
against the other policy. Track folds (default) score every trainable track with a model that
never saw it and choose one threshold per class on those scores. `--loco` leaves each corpus
out: its model and threshold (chosen by inner track folds) come from the other corpora only, the
cross-dataset protocol. `--seeds` averages the log-odds of that many classifiers per class:
single classifiers move class F by up to 0.016 (toms 0.036) when a few training candidates
change. Thresholds sit on a 0.025 grid whose neighbours often score alike, so retraining can
still step a class's threshold. Candidate files and models carry `CANDIDATE_REVISION` from
`striker.ts`: `train-striker.py` refuses candidates of mixed revisions and analysis refuses a
model trained on another revision, so re-export candidates whenever proposals or features
change. `--name` gives the exported models their release name, such as `Striker 1.0`; analyses
record it with the model's content hash.

## Published benchmarks

`benchmark.py` (also needs `mir_eval`) scores a run the way ADTOF (Zehren et al. 2023) and
Vogl et al. did: `MIDI_REDUCED_5` classes from each dataset's own labels, `mir_eval` matching
within 50 ms, F summed over every onset of the scored classes, and for MDB, ENST and RBMA13
the mean over Vogl's three folds. `--adtof` scores the released ADTOF weights on the cached mix
activations with ADTOF's own peak picking, a local reproduction of the published baseline.

```sh
node bench/drumeval/evaluate.ts --label=loco --model=bench/reports/drumeval/striker/v19-loco-strict \
  --corpus=mdb,enst,enst23,rbma,idmt,mdbsolo,enstsolo,mdbpp,gmd
bench/reports/drumeval/py/Scripts/python bench/drumeval/benchmark.py --run=loco \
  --corpora=mdb,enst,enst23,rbma,idmt,mdbsolo,enstsolo,mdbpp,gmd
bench/reports/drumeval/py/Scripts/python bench/drumeval/benchmark.py --adtof \
  --corpora=mdb,enst,enst23,rbma,idmt,mdbsolo,enstsolo,mdbpp,gmd
```

Cross-dataset claims need `--loco --loco-corpora=mdb,enst,rbma,idmt` models trained with
`--labels=strict`; the other corpora always train. RBMA13's public labels follow Vogl's
three-class map, which leaves claps and side sticks out of the snare class, while every other
corpus and the product count them as snares. ADTOF's published ENST 0.78 fits the `enst23` mix:
the local reproduction scores 0.781 there and 0.700 at equal gain, close to the 0.709 Hsu et
al. 2026 measured on an unstated ENST mix. Results: [DRUM_RELIABILITY.md](../DRUM_RELIABILITY.md).

`errors.ts` attributes false positives and misses to neighbouring instruments; `diff.ts` lists
the hits two runs disagree on.

## Measuring without labels

`fourfloor.ts` reports how much of the beat grid the kick stream covers. In hardstyle, hard
techno, house and trance the kick is on every beat, so on that music this is close to recall on
the product's own library, with no annotation at all. It tries the beat grid and both half-tempo
readings of it, because a tracker that locked an octave high would otherwise show half coverage
for a perfect kick. It says nothing about music that does not play that way, so read it per track.

```sh
node bench/drumeval/fourfloor.ts --run=lib-v19 --compare=lib-v22 --genres=bass,techno,trance,edm,house
```

`gridkicks.ts` turns the same idea into training labels: where a phrase of beats stands clearly
above that track's own off-grid moments, each beat becomes a kick. The band it measures is chosen
per track among 30 to 1500 Hz, because a house kick shows in 80 to 200 Hz, a hard techno kick in
30 to 80, and a hardstyle kick only in 500 to 1500, its sub ringing through the whole beat and in
fact louder between beats than on them. Bands above 1500 Hz are not allowed to choose, or the rule
starts following the hi-hat in music whose kick is not on every beat. Everything it cannot vouch
for is `unreviewed`.

## Where an error came from

Five views propose candidates: ADTOF's activations on the mixture, on the drum stem and on each
separated source, the spectral-flux attacks of the separated source itself, and the mixture's own
onset function (`fromOdf`). The fifth exists because the first four all read either the transcriber
or the separator, and on hardcore and hard techno those fail together: the activation is flat zero,
not merely weak. It has no opinion about which drum it heard, so every class proposes from it and
the classifier decides.

`ceiling.ts` reads a candidate export and reports, per corpus and class, how many references any
view proposed at all. A selector cannot keep what nothing proposed, so that recall bounds the
achievable F at `2R / (1 + R)`. Report candidate density beside it: proposing everywhere raises
recall and costs precision downstream.

```sh
node bench/drumeval/ceiling.ts --candidates=v23 --labels=strict [--by=track]
node bench/drumeval/inspect.ts --track=library/AHaIdOXzzuE --from=24.4 --to=48.4
```

`inspect.ts` runs one track and prints, per class, how many candidates each view proposed, the
spread of the model's probabilities and how many the threshold accepts, with the references
nothing proposed when the corpus has labels. Between them the two answer the question that
decides where effort belongs: whether a miss is a candidate that was never proposed, or a
candidate the classifier rejected. It is worth asking again after every change to either stage:
on the owner's electronic tracks the answer was the second, and once that was fixed the binding
constraint moved to the first, on hardcore and hard techno where no proposal stream fired at all.
