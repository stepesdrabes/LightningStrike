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
| `library` | the desktop app's songs | none | run comparisons and owner reviews |

Convert a downloaded corpus with the matching `convert-*.ts` script; each writes `tracks.json`
(`convert-enst.ts --solo` writes `enstsolo`, `--two-thirds` writes `enst23`; `convert-mdbpp.ts`
points MDBDrums++ at the local MDB drum files, whose samples it shares). A variant corpus
(`variantOf`) holds the same recordings rendered or labelled differently: it trains only the
classes `train-striker.py --train-variants` names, in exactly the folds that train its original,
and is scored like it.

RBMA13's public snare labels leave claps and side sticks out, and STAR's non-drum stems carry
unlabelled clap residue; either one teaches the classifier to reject claps and snaps, so
`train-striker.py` ignores RBMA snare labels by default (`--ignore=rbma:snare`). The shipped
recipe also ignores STAR's snare, kick and tom labels: STAR raised hi-hat and cymbal F across
the benchmarks but lowered kick and tom F, as the drums-only variants did for kicks and toms.

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
  --ignore=rbma:snare,star:snare,star:kick,star:tom --noisy=a2md,rwc --agreement-runs=base \
  --balance=0.5 --seeds=5 --labels=strict --score=light --out=bench/reports/drumeval/striker/v19-cv-strict
node bench/drumeval/evaluate.ts --label=striker --model=bench/reports/drumeval/striker/v19-cv-strict --compare=base
node bench/drumeval/judged.ts --label=striker          # listener-confirmed partial labels
node bench/drumeval/reviews.ts --label=striker         # the owner's saved drum reviews
```

That recipe's `model.json` is Striker 1.0, the installed `models/striker.json`. `--noisy` keeps
an aligned-MIDI class only where ADTOF agrees with it and ignores its pedal hats and soft
strokes; `--balance` weights corpora by size to that negative power.

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
change. Thresholds sit on a 0.05 grid whose neighbours often score alike, so retraining can
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
