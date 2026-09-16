"""Check a rendered corpus against its own labels before any of it reaches training.

Two questions. Does every labelled hit have an attack in the band its class owns? And does every
strong attack in the audio have a label near it? A renderer bug that silently drops a voice, or
places a hit where nothing sounds, would otherwise teach exactly the wrong lesson.

    python bench/drumeval/synth/verify.py [--corpus=bench/corpus/synth] [--tracks=8]
"""
import argparse
import json
import os

import numpy as np
from scipy.io import wavfile

RATE = 44100
N = 2048
HOP = 441          # 100 frames a second, the analysis grid
BANDS = {'kick': (25, 130), 'snare': (200, 3500), 'hat': (5000, 15000), 'cymbal': (3000, 15000),
         'tom': (80, 700)}


def spectrogram(x):
    frames = 1 + (x.size - N) // HOP
    window = np.hanning(N).astype(np.float32)
    strided = np.lib.stride_tricks.as_strided(
        x, shape=(frames, N), strides=(x.strides[0] * HOP, x.strides[0]))
    return np.abs(np.fft.rfft(strided * window, axis=1))


def flux(spec, lo, hi):
    """Half-wave rectified log-magnitude difference inside one band, per frame."""
    bins = np.fft.rfftfreq(N, 1 / RATE)
    take = (bins >= lo) & (bins < hi)
    band = np.log1p(spec[:, take] * 20)
    difference = np.diff(band, axis=0, prepend=band[:1])
    return np.maximum(0, difference).sum(axis=1)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--corpus', default=os.path.join(
        os.path.dirname(os.path.abspath(__file__)), '..', '..', 'corpus', 'synth'))
    parser.add_argument('--tracks', type=int, default=8)
    args = parser.parse_args()
    root = os.path.abspath(args.corpus)
    with open(os.path.join(root, 'tracks.json'), encoding='utf-8') as f:
        corpus = json.load(f)

    totals = {}
    unexplained = []
    for track in corpus['tracks'][:args.tracks]:
        rate, data = wavfile.read(os.path.join(root, track['audio']))
        x = (data.astype(np.float32) / 32768.0)
        x = x.mean(axis=1) if x.ndim > 1 else x
        x = np.ascontiguousarray(x)
        spec = spectrogram(x)
        curves = {cls: flux(spec, lo, hi) for cls, (lo, hi) in BANDS.items()}
        marked = np.zeros(spec.shape[0], dtype=bool)
        for cls, curve in curves.items():
            events = [e for e in track['events'] if e['cls'] == cls and not e.get('optional')]
            if not events:
                continue
            floor = np.quantile(curve, 0.5)
            strong = 0
            for e in events:
                frame = int(round(e['time'] * RATE / HOP))
                window = curve[max(0, frame - 2):frame + 3]
                if window.size and window.max() > floor:
                    strong += 1
            row = totals.setdefault(cls, [0, 0])
            row[0] += strong
            row[1] += len(events)
        for e in track['events']:
            frame = int(round(e['time'] * RATE / HOP))
            marked[max(0, frame - 3):frame + 4] = True
        # Anything loud the labels do not explain, measured on the broadband flux.
        broad = flux(spec, 30, 16000)
        threshold = np.quantile(broad, 0.98)
        peaks = [i for i in range(1, len(broad) - 1)
                 if broad[i] > threshold and broad[i] >= broad[i - 1] and broad[i] > broad[i + 1]]
        missed = [i for i in peaks if not marked[i]]
        unexplained.append((track['name'], len(missed), max(1, len(peaks))))

    print('class    labelled  with an attack in its band')
    for cls, (strong, total) in sorted(totals.items()):
        print(f'{cls:8s} {total:8d}  {strong / max(1, total) * 100:5.1f}%')
    share = sum(m for _, m, _ in unexplained) / max(1, sum(p for _, _, p in unexplained))
    print(f'\nstrong attacks with no label within 30 ms: {share * 100:.1f}%')
    for name, missed, peaks in sorted(unexplained, key=lambda r: -r[1] / max(1, r[2]))[:5]:
        print(f'  {name:18s} {missed:4d} of {peaks}')


if __name__ == '__main__':
    main()
