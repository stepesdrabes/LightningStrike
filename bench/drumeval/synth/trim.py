"""Shorten the rendered tracks that have no cached evidence yet.

Separation and six transcription passes cost the same per second whatever the material, and the
corpus's variety is per track, not per bar: every track has its own kit, pattern, processing and
backing. Trimming buys tracks rather than minutes. Tracks already prepared keep their length, so
the corpus ends up mixed, which is fine.

    python bench/drumeval/synth/trim.py --seconds=75
"""
import argparse
import json
import os

import numpy as np
from scipy.io import wavfile

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..'))


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--seconds', type=float, default=75)
    parser.add_argument('--corpus', default=os.path.join(REPO, 'bench', 'corpus', 'synth'))
    parser.add_argument('--evidence', default=os.path.join(
        REPO, 'bench', 'reports', 'drumeval', 'evidence', 'synth'))
    args = parser.parse_args()
    root = os.path.abspath(args.corpus)
    path = os.path.join(root, 'tracks.json')
    with open(path, encoding='utf-8') as f:
        corpus = json.load(f)

    trimmed = kept = 0
    for track in corpus['tracks']:
        prepared = os.path.exists(os.path.join(args.evidence, track['name'], 'separation.json'))
        audio = os.path.join(root, track['audio'])
        rate, data = wavfile.read(audio)
        if prepared or data.shape[0] <= args.seconds * rate:
            kept += 1
            continue
        wavfile.write(audio, rate, data[:int(args.seconds * rate)])
        track['events'] = [e for e in track['events'] if e['time'] < args.seconds]
        trimmed += 1
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(corpus, f)
    print(f'{trimmed} trimmed to {args.seconds:.0f} s, {kept} left alone')


if __name__ == '__main__':
    main()
