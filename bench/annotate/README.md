# Drum annotation

Ground truth in the music the product actually plays. Every public benchmark is acoustic drums;
the library is hardstyle, drum and bass, house and trap, and that is where detection fails. These
clips are the only measurement that speaks for the room.

```sh
node bench/annotate/prepare.ts --clips=36 --seconds=24   # cut clips from prepared drumeval evidence
node bench/annotate/server.ts                            # http://localhost:5190
node bench/annotate/export.ts                            # write the `owner` corpus
node bench/drumeval/prepare.ts --corpus=owner --batch=4  # cache its model evidence
node bench/drumeval/evaluate.ts --label=owner --corpus=owner --model=DIR
```

Score the `owner` corpus with the `light` metric. Under `strict` every reference of a class is
required, including the `unreviewed` markers that stand for the pages nobody confirmed.

`prepare.ts` reads the cached evidence `bench/drumeval/prepare.ts` already wrote, so it costs no
separation: per clip it writes the mix and the four separated sources as WAV, the beat grid, what
the `--run` run emitted, and a high-recall proposal set from every view at thresholds far below
the ones Striker selects on. That last part matters: a hit the shipped model misses is still
drawn as an unconfirmed proposal, so reviewing does not inherit the model's blind spots.

## Reviewing

A page is two bars, and confirming it is what makes the work count. Pick a class with `1`-`4`,
then:

| key | what it does |
|---|---|
| `f` | fill the page on the grid, `q` cycles 1/4, 1/8, 1/16, 1/32 and triplets |
| `b` | fill the backbeat only, for a snare or clap on 2 and 4 |
| `c` | copy the page before onto this one |
| `a` | accept every supported proposal of this class on the page |
| `x` | clear this class on the page |
| `z` | undo |
| `s` / `m` | hear this class alone, or the mix |
| `space` | loop the page, with a click on every mark |
| `n` | jump to the page Striker and the proposals disagree on most |
| `enter` | confirm the page and move on |

Clicking a lane adds a mark on the nearest attack in that source, and the ghost under the pointer
shows where it will land before you commit; `shift` places it exactly where you click. Dragging
moves a mark, alt or right click deletes it. The loop with clicks is the check that matters: if a
click and a drum arrive together the mark is right, and a drum with no click is a miss.

Electronic music repeats, so the fast path is `f` or `b` for the pattern, then fixing what the bar
does differently. Slow the transport to 0.5x for rolls.

## Which clips are worth annotating first

The synthetic corpus builds its backing by subtracting a library track's cached drum stem, so 16 of
these 36 clips come from recordings whose accompaniment the classifier has already trained on. It
never saw their real drums or any label from them, but the recording is not strictly unseen, so an
annotation there is a weaker benchmark than one on a clip held out entirely. `clips/index.json`
carries `heldOut` per entry and lists the 20 held-out clips first. Annotate those first, and keep
`render.py` off any recording that becomes an annotation clip.

## Partial reviews count

Only pages you confirm become references. `export.ts` fills everything else with `unreviewed`
references that neither policy teaches or counts, so a clip reviewed for eight bars scores those
eight bars honestly rather than punishing detections in the rest. Reviewing a few pages of many
clips is worth more than every page of one.

A confirmation is a page index, so the app and the export have to group downbeats identically or a
confirmed index silently means a different stretch of time. They import the same
[pages.js](pages.js) rather than each keeping a copy; two copies had already drifted once, over
whether to drop a page shorter than 0.2 s.
