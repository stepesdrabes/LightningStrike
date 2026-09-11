# Lighting and drum review tools

These harnesses read cached tracks and write diagnostic artifacts. They do not replace saved
analyses, shows or user settings. Cache selection defaults to the desktop cache;
`MV_CACHE_DIR` selects another library.

- `node bench/compositionprobe.ts --snapshot=bench/reports/before.json` captures composition.
  Use `--compare=FILE --render=8 --ids=ID,ID` to compare rendered shows with that snapshot.
- `node bench/drumprobe.ts ID ID --out bench/reports/drums.json` compares model evidence and
  pattern completion on the same inference. Its counts are predictions, not labelled accuracy.
- `node bench/effectpolish.ts --save bench/reports/effects-before.json` captures isolated effect
  output. Use `--compare FILE --html bench/reports/effects.html` for visual comparison.
- `node bench/quietprobe.ts --limit 8 --effects chorusBloom,ambientDrift` measures responsiveness
  in real quiet passages. Compare the whole candidate pool on the same corpus before updating
  ranking metadata.
- `node bench/showreview.ts ID --out bench/reports/review.html` exports audio with actual ceiling
  and bounce-lamp output. `--analysis FILE` and `--show FILE` select diagnostic inputs. The HTML
  is self-contained, with opening/chorus selection, seeking and optional snare clicks.

`showreview` renders at 60 Hz and stores 30 Hz display samples. For comparisons, supply
`--before-shows FILE` from `compositionprobe` and `--before-core DIR` pointing to the baseline
core source directory. Otherwise both shows use the current renderer. Each renderer warms
from the start of the track, and both sides use the same audio interval. Snare clicks follow
analysis timestamps; visual envelopes retain the renderer's transport anticipation.

Room kick contrast compares a 133 ms approach window with the next 167 ms around each
anticipated kick. It complements visible shape, timing and listening judgement; a brighter
bed can increase absolute light while reducing perceived punch.
