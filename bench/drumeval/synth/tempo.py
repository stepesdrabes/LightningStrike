"""Record each backing's own tempo and bar phase, from the beats already cached for that track.

A synthetic track whose drums run at one tempo over music at another is a mixture no recording
contains: the separator and the transcriber were never trained on it, and a beat tracker lands
between the two. The renderer therefore takes its tempo from the backing, which needs the backing
to carry one.

    python bench/drumeval/synth/tempo.py
"""
import json
import os

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
BACKING = os.path.join(REPO, 'bench', 'reports', 'drumeval', 'synth', 'backing')
EVIDENCE = os.path.join(REPO, 'bench', 'reports', 'drumeval', 'evidence', 'library')


def main():
    written = skipped = 0
    for name in sorted(os.listdir(BACKING)):
        if not name.endswith('.json') or name == 'index.json':
            continue
        path = os.path.join(BACKING, name)
        with open(path, encoding='utf-8') as f:
            meta = json.load(f)
        beats_path = os.path.join(EVIDENCE, meta['name'], 'beats.json')
        if not os.path.exists(beats_path):
            skipped += 1
            continue
        with open(beats_path, encoding='utf-8') as f:
            tracked = json.load(f)
        beats = np.array(tracked.get('beats', []), dtype=float)
        downbeats = np.array(tracked.get('downbeats', []), dtype=float)
        inside = beats[(beats >= meta['start']) & (beats < meta['start'] + meta['seconds'])] - meta['start']
        if inside.size < 8:
            skipped += 1
            continue
        # The median step resists a tracker that drops or doubles a beat somewhere.
        period = float(np.median(np.diff(inside)))
        if not (0.2 < period < 1.2):
            skipped += 1
            continue
        bars = downbeats[(downbeats >= meta['start'])
                         & (downbeats < meta['start'] + meta['seconds'])] - meta['start']
        meta['bpm'] = round(60.0 / period, 3)
        meta['firstBeat'] = round(float(inside[0]), 4)
        meta['firstBar'] = round(float(bars[0]), 4) if bars.size else round(float(inside[0]), 4)
        with open(path, 'w', encoding='utf-8') as f:
            json.dump(meta, f)
        written += 1
    print(f'{written} backings carry a tempo, {skipped} had no usable beats')


if __name__ == '__main__':
    main()
