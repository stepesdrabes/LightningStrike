# Drum annotation

Ground truth in the music the product actually plays. Every public benchmark is acoustic drums;
the library is hardstyle, drum and bass, house and trap, and that is where detection fails. These
clips are the only measurement that speaks for the room. Clips from outside the library, such as
jazz with brushes, give striker-2's validation what its training sets lack.

```sh
node bench/annotate/prepare.ts --corpus=library --clips=10   # cut clips from library songs
node bench/annotate/prepare.ts --list=clips.json             # cut clips from any audio files
node bench/annotate/server.ts                                # http://localhost:5190
node bench/annotate/export.ts                                # library reviews -> `owner` corpus
node bench/annotate/export-striker2.ts --tag=jazz            # reviews -> striker2-reviews.json
node bench/drumeval/evaluate.ts --label=owner --corpus=owner
```

Score the `owner` corpus with the `light` metric. Under `strict` every reference of a class is
required, including the `unreviewed` markers that stand for the pages nobody confirmed.

## Cutting clips

`prepare.ts` hears each whole song with Striker 2.0 through `bench/hearing.ts`: the settings'
model in `MV_MODEL_DIR` (or `models/`), on the CPU, kept under `bench/corpus/.striker2/` so a song
is heard once. From the library it cuts the 30 s that start on a downbeat and hold the most
proposals; `--only`, `--genres` and `--clips` choose the songs. From a clip list it cuts where the
list says. A list is a JSON array; only `file` and `start` are required, and a relative file is
read beside the list:

```json
[{ "file": "brushes/song.mp3", "start": 63.2, "id": "song", "tags": ["jazz", "heldOut"],
   "title": "Song", "artist": "Band", "genre": "jazz", "seconds": 30, "align": true }]
```

Any file ffmpeg reads works; it is decoded at 44.1 kHz as ingest decodes it. `--seconds` sets the
length, and `--align` (or `align` per entry) moves the end to the nearest page end, so the last
page is two whole bars. [example/clips.json](example/clips.json) cuts a synthetic groove.

Each clip gets the mix as a 44.1 kHz mono WAV and `clip.json`: the DBN beats and downbeats,
Striker's hits at the manifest's thresholds, and the proposals: every peak of each class's onset
probability from `--floor` (0.02) up, timed as Striker times its hits, so its hits are among them.
A proposal from `--support` (0.1) up is evidence: drawn as a ring, counted by `n` and accepted by
`a`. Both are low on purpose: Striker's misses sit far below its thresholds. A clip id that has a
review is never cut again; `--force` recuts one that has none.

## Reviewing

A page is two bars, and confirming it is what makes the work count. Pick a class with `1`-`5`,
then:

| key | what it does |
|---|---|
| `f` | fill the page on the grid, `q` cycles 1/4, 1/8, 1/16, 1/32 and triplets |
| `b` | fill the backbeat only, for a snare or clap on 2 and 4 |
| `c` | copy the page before onto this one |
| `a` | accept every supported proposal of this class on the page |
| `x` | clear this class on the page |
| `z` | undo |
| `s` / `m` | hear this class's lane, or the mix |
| `space` | loop the page, with a click on every mark |
| `n` | jump to the page Striker and the proposals disagree on most |
| `enter` | confirm the page and move on |

A Striker 2.0 clip has five lanes, tom included. Each shows a band of the mix (kick below 150 Hz,
snare 1 to 5 kHz, hi-hat above 7 kHz, cymbal above 3 kHz, tom 60 to 400 Hz, filtered both ways so
no attack moves) with Striker's onset probability over it and its threshold dashed. A band is
something to hear and snap to, not a separated source. Clicking a lane adds a mark on the nearest
proposal within 35 ms, else on the band's attack, else on the mix's; the ghost under the pointer
shows where it will land, and `shift` places it exactly where you click. Dragging moves a mark, alt
or right click deletes it. The loop with clicks is the check that matters: if a click and a drum
arrive together the mark is right, and a drum with no click is a miss.

A library clip starts from Striker's hits, as the Striker 1.x clips did, so a mark nobody
questioned is Striker's own. A clip from a list is for validation and starts empty (`prefill` in
its `clip.json`; an entry can ask for `"prefill": true`): Striker's hits and the proposals show as
rings until `a` or a click makes them marks. Loop every page before confirming it, above all the
hi-hats: acoustic hats and brushes are where Striker is known to miss, and the rings below its
threshold are where to look.

Electronic music repeats, so the fast path is `f` or `b` for the pattern, then fixing what the bar
does differently. Slow the transport to 0.5x for rolls.

## The Striker 1.x clips

The first 36 clips were cut by the retired preparation from drum separation evidence: per clip the
mix and four separated sources as WAV lanes, the beat grid, what a Striker 1.x run emitted and that
pipeline's proposals. The annotator reads them as they are, with four lanes. The synthetic corpus
built its backing by subtracting a library track's drum stem, so 16 of them come from recordings
whose accompaniment Striker 1.x trained on, and striker-2 may have too. `clips/index.json` carries
`heldOut` per entry and lists the 20 held-out clips first. Annotate those first.

## Partial reviews count

Only pages you confirm become references. `export.ts` fills everything else with `unreviewed`
references that neither policy teaches or counts, so a clip reviewed for eight bars scores those
eight bars honestly rather than punishing detections in the rest. Reviewing a few pages of many
clips is worth more than every page of one. `export.ts` writes library clips only; clips from a
list are not the room.

`export-striker2.ts` writes every reviewed clip, or those a list, a tag or `--ids` names, to
`striker2-reviews.json` beside the clips: per clip the source file, its SHA-256 and the start, the
classes it was reviewed for (a Striker 1.x clip has no tom), the confirmed page spans, the
unreviewed spans and the onsets on confirmed pages, in seconds from the start of ffmpeg's 44.1 kHz
decode. Spans are [from, to).

A confirmation is a page index, so the app and the exporters have to group downbeats identically
or a confirmed index silently means a different stretch of time. They import the same
[pages.js](pages.js) rather than each keeping a copy; two copies had already drifted once, over
whether to drop a page shorter than 0.2 s.
