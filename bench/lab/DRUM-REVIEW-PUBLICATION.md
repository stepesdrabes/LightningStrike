# Publishing prepared analyses to drum listening

The live listening server is `http://127.0.0.1:5197`, backed by
`bench/reports/audio-reliability/drum-review-ui/cache`. Read-only API verification found
Habibi review revision 4 with analysis SHA
`adc66c9458d1368be7760183468d44c00420145a383b3cd25d518f22510df923`.
No live cache was changed while preparing this workflow.

`bench/publish-drum-reviews.ts` validates each candidate track ID, complete decoded PCM
hash/duration and event arrays. Existing encoded audio must be identical. Dry run is the
default. Applying requires a new backup directory and copies exact current track files
plus every saved review into it, with SHA-256 provenance. Each analysis is atomically
replaced only after its exact old bytes and audio identity are archived under
`drum-review-analyses/`. Original audio and existing metadata/context are retained; missing
full audio, metadata and context for new tracks are added before their analysis appears.

Prepared source audio for all six songs lives in
`bench/reports/audio-reliability/judgement-correction/cache`. The source cache still contains
older analyses (Back In Black v34 and bad guy v33), so use a directory containing the final
combined candidate analyses and require v36 or later. Do not publish the older source-cache
analyses merely because the full audio is ready.

```sh
node bench/publish-drum-reviews.ts --source-cache=bench/reports/audio-reliability/judgement-correction/cache --target-cache=bench/reports/audio-reliability/drum-review-ui/cache --analysis-dir=FINAL_ANALYSIS_DIRECTORY --minimum-version=36 --ids=tWEaUKCQ8Fg,jOLT6ukrQSg,tN6YYPs3g3c,wy7_PFy-ztQ,9vWNauaZAgg,ZD6rXLXZOEI
```

Run the identical command with `--apply --backup=NEW_BACKUP_DIRECTORY` after reviewing the
dry-run output. Back In Black is `9vWNauaZAgg` (255.499 seconds); bad guy is `ZD6rXLXZOEI`
(194.106 seconds). Direct callers can give `publishDrumReviews` a separate `analysisPath`
for each track if final files reside in multiple directories.

Publication is atomic per analysis, not a multi-song transaction. If a later write fails,
previous songs may already be updated; `publication.json` remains `applied: false`, exact
backups remain available, and the error identifies the stopping point. Never overwrite
live reviews with a backup to undo an analysis change: they may contain newer user notes.

## Review and draft continuity

The API accepts saves pinned to an existing saved marker snapshot after current analysis
replacement, provided the track, analysis SHA and current audio SHA match. If no saved
review exists, the archived analysis and matching audio identity reconstruct the old
review so its browser draft can be restored. Review revisions retain optimistic conflict
checks independently for every analysis hash.

The page displays analysis version/hash and notes revision. Load latest analysis opens
the replacement; Earlier notes / drafts reopens historical markers and saved notes, and
also discovers browser draft keys for the same audio. Selecting an old review restores
its own draft instead of applying old annotations to new markers. New songs appear after
Refresh songs. A playing page is not silently switched to a new analysis.

Browser localStorage is outside the publisher's reach. The helper never clears it, but
cannot rescue drafts already removed by the browser or notes stored in a different browser
profile. Archives cover the analysis being replaced; earlier unsaved drafts require their
original archive, while saved historical reviews already contain their marker snapshots.

Validation: publication tests cover dry-run immutability, exact backups/archives, changed
audio/decode rejection, adding new tracks and backup reuse rejection. Storage tests cover
saving an old pinned page, first saving an archived draft, and rejecting altered audio or
archive bytes. Focused tests pass; web check reports no errors or warnings. No browser
automation, navigation or server restart was used.
