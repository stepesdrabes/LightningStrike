"""Rewrite a rendered corpus's label policy without re-rendering its audio.

The renderer's event list is derived from the same trigger times the audio was built from, so a
change in how a class is *marked* is a change to tracks.json alone.

    python bench/drumeval/synth/relabel.py [--corpus=bench/corpus/synth]
"""
import argparse
import json
import os

CLASSES = ('kick', 'snare', 'hat', 'cymbal')


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--corpus', default=os.path.join(
        os.path.dirname(os.path.abspath(__file__)), '..', '..', 'corpus', 'synth'))
    args = parser.parse_args()
    path = os.path.join(os.path.abspath(args.corpus), 'tracks.json')
    with open(path, encoding='utf-8') as f:
        corpus = json.load(f)

    changed = 0
    for track in corpus['tracks']:
        events = []
        for e in track['events']:
            if e.get('sub') == 'residue':
                for cls in CLASSES:
                    events.append({'time': e['time'], 'cls': cls, 'sub': 'unreviewed', 'optional': True})
                changed += 1
            elif e.get('sub') == 'perc':
                if e['cls'] == 'hat':
                    events.append({'time': e['time'], 'cls': 'hat', 'sub': 'TMB', 'optional': True})
                else:
                    events.append({'time': e['time'], 'cls': 'other', 'sub': 'perc'})
                changed += 1
            else:
                events.append(e)
        track['events'] = sorted(events, key=lambda e: e['time'])
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(corpus, f)
    print(f'{changed} events rewritten in {len(corpus["tracks"])} tracks')


if __name__ == '__main__':
    main()
