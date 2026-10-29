# Drum evaluation

These tools measure the drums the app hears, through Striker 2.0 and the real `analyzeTrack`, on
labelled corpora, and score them under the published benchmark protocols. They read corpora from
ignored `bench/corpus/` and write to ignored `bench/reports/drumeval/`.

## Corpora

| Corpus | Contents | Labels | Role |
|---|---|---|---|
| `mdb` | MDB Drums, 23 MedleyDB full mixes | hand annotations (subclass files) | benchmark |
| `mdbsolo` | the same 23 recordings, drums only | same | benchmark |
| `enst` | ENST-Drums minus-one pieces, wet mix plus accompaniment at equal gain | hand annotations | benchmark |
| `enstsolo` | the same 64 wet drum mixes without accompaniment | same | benchmark |
| `enst23` | the same pieces, drums at 2/3 and accompaniment at 1/3 (ADTOF's published ENST mix) | same | benchmark |
| `rwc` | RWC 2.0 pop songs with drums and genre tracks 1-27 | DTW-aligned MIDI, bass notes too | noisy reference |
| `a2md` | A2MD popular songs, alignment tiers 0.0 and 0.1 | automatically aligned cover MIDI, bass notes too | noisy reference |
| `idmt` | IDMT-SMT-Drums V2 drum-only loops | hand annotations | benchmark |
| `rbma` | RBMA13 electronic tracks (purchased audio), public three-class labels | hand annotations | benchmark |
| `star` | STAR Drums excerpts over real non-drum stems (`convert-star.ts --every=6`) | drums re-rendered from pseudo-labels | reference |
| `mdbpp` | MDBDrums++: the 23 MDB drum recordings, re-annotated as MIDI | MIDI with velocities | benchmark |
| `gmd` | Groove MIDI Dataset test split: 124 Roland TD-11 performances with audio | performance MIDI | benchmark |
| `synth` | electronic drum machine tracks rendered for Striker 1.x's training | the sequencer's own trigger times | reference, `light` only |
| `owner` | 24 s clips of library songs, hand confirmed in [bench/annotate](../annotate/README.md) | the owner's annotations | the product's own music, `light` only |
| `fsl30` | 28 Freesound loops, house and techno, hip-hop, jungle and breakbeat | hand annotations (Yi and Barthet 2026) | benchmark |
| `drumloop101` | 150 loops of the 101-200 Drum Loop Dataset, the effects and loudness condition | the renderer's own step vectors | benchmark |
| `grid` | four-on-the-floor library tracks, kicks read off the beat grid | [gridkicks.ts](gridkicks.ts) | kicks only |
| `library` | the desktop app's songs | none | run comparisons and owner reviews |

Convert a downloaded corpus with the matching `convert-*.ts` script; each writes `tracks.json`
(`convert-enst.ts --solo` writes `enstsolo`, `--two-thirds` writes `enst23`; `convert-mdbpp.ts`
points MDBDrums++ at the local MDB drum files, whose samples it shares). A variant corpus
(`variantOf`) holds the same recordings rendered or labelled differently and is scored like its
original. striker-2's `tools/convert_drumeval.py` reads these same `tracks.json` files.

`fsl30` and `drumloop101` hold loops of a few seconds, repeated to 24 s so a beat tracker has
something to follow. In `drumloop101` a step is a sixteenth whatever its `beat_type` field says,
and each render is cut to a flat four seconds, so the last repeat is partial and its hits still
have to be labelled.

Two kinds of reference are neither required nor counted, and both carry `sub: 'unreviewed'` so
that holds under `strict` as well as `light`: the drums the synthetic corpus's backing
subtraction left behind, and the stretches of an owner clip nobody has confirmed. Read `synth`
and `owner` with `light`: `strict` promotes every reference of a class to required, the
`unreviewed` markers included.

Two label policies exist. `light`, the product's: ghost notes, brush strokes, side sticks,
pedal hats and shaker-like percussion are optional references, neither required nor counted as
false positives. `strict`, the benchmarks': every reference of the class counts; `benchmark.py`
drops tambourine and shakers as ADTOF's `MIDI_REDUCED_5` does, while the `evaluate.ts`
summaries still count them as hats. Hats also score against hats plus cymbals (`metal`), the
stream the lights receive.

## Workflow

```sh
node bench/drumeval/evaluate.ts --label=s2 --corpus=mdb,enst,rbma,idmt [--striker2=DIR] [--compare=LABEL]
node bench/drumeval/judged.ts --label=s2     # listener-confirmed partial labels
node bench/drumeval/reviews.ts --label=s2    # the owner's saved drum reviews
```

`evaluate.ts` decodes each track at 44.1 kHz as ingest does, runs Striker 2.0 (the manifest and
graph in `--striker2`, by default `models/`), replays `analyzeTrack` on its beats and
transcription, and scores what the lights receive (`final`) and the hits from level 0.05 up
(`final05`, the effects' gate) at 50 ms. It needs only each track's audio and labels. Each record
keeps the final streams, each class as analysis emits it alone (`classes`: the hat without
cymbals, and toms) and the analysis's beats; `summary.json` records the manifest's name. Each
`--jobs` holds its own model session, so keep it at 1 on a machine short of memory.

## Published benchmarks

`benchmark.py` (needs Python with `mir_eval`) scores a run the way ADTOF (Zehren et al. 2023) and
Vogl et al. did: `MIDI_REDUCED_5` classes from each dataset's own labels, `mir_eval` matching
within 50 ms, F summed over every onset of the scored classes, and for MDB, ENST and RBMA13 the
mean over Vogl's three folds.

```sh
node bench/drumeval/evaluate.ts --label=s2 --corpus=mdb,enst,enst23,rbma,idmt,mdbsolo,enstsolo,mdbpp,gmd
python bench/drumeval/benchmark.py --run=s2 --corpora=mdb,enst,enst23,rbma,idmt,mdbsolo,enstsolo,mdbpp,gmd
```

RBMA13's public labels follow Vogl's three-class map, which leaves claps and side sticks out of
the snare class, while every other corpus and the product count them as snares. The Striker 1.x
results these replaced are kept as history in [reports/](reports/).

`errors.ts` attributes false positives and misses to neighbouring instruments; `diff.ts` lists
the hits two runs disagree on.

## Measuring without labels

`fourfloor.ts` reports how much of the beat grid the kick stream covers, on the grid the run's
own analysis took. In hardstyle, hard techno, house and trance the kick is on every beat, so on
that music this is close to recall on the product's own library, with no annotation at all. It
tries the beat grid and both half-tempo readings of it, because a grid locked an octave high would
otherwise show half coverage for a perfect kick. It says nothing about music that does not play
that way, so read it per track.

```sh
node bench/drumeval/fourfloor.ts --run=lib-a --compare=lib-b --genres=bass,techno,trance,edm,house
```

`gridkicks.ts` turns the same idea into labels: on Striker 2.0's beats (bench/hearing.ts), where a
phrase stands clearly above that track's own off-grid moments, each beat becomes a kick. The band
it measures is chosen per track among 30 to 1500 Hz, because a house kick shows in 80 to 200 Hz,
a hard techno kick in 30 to 80, and a hardstyle kick only in 500 to 1500, its sub ringing through
the whole beat. Bands above 1500 Hz are not allowed to choose, or the rule starts following the
hi-hat. Everything it cannot vouch for is `unreviewed`.
