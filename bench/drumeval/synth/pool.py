"""Index drum one-shot pools by class.

Names carry the instrument, in the file or in the folder above it, so a name rule sorts the pool;
a spectral check then rejects the ones the name got wrong, because a kick labelled as a hat
teaches the wrong thing everywhere it is used.

    python bench/drumeval/synth/pool.py [root ...] --out=PATH

Several roots merge into one index, which is how a pack that names its folders sits beside one
that names its files.
"""
import json
import os
import re
import sys

import numpy as np
from scipy.io import wavfile

# Order matters: the first rule that matches a basename wins.
RULES = [
    ('hat_open', r'ohh|open.?h|hat.?op|op.?hat|\boh\b|\boh\d'),
    ('hat', r'chh|hi.?hat|hihat|\bhats?\b|\bhats?\d|\bhh|closed.?h|\bch\b|\bch\d'),
    ('ride', r'ride|\brd\b|\brd\d|rdc'),
    ('crash', r'crash|cymb|splash|china|\bcr\b|\bcr\d|\bcy\b|\bcy\d|crc'),
    ('clap', r'clap|\bcp\b|\bcp\d|clp|hand.?cl'),
    ('rim', r'rim|\brs\b|\brs\d|side.?st|\bsst\b|cross.?st'),
    ('snare', r'snare|\bsd\b|\bsd\d|snr|\bsn\b|\bsn\d|rullo'),
    ('tom', r'\btom|\blt\b|\bmt\b|\bht\b|\blt\d|\bmt\d|\bht\d|lowtom|midtom|hitom|floor.?t'),
    ('kick', r'kick|\bbd\b|\bbd\d|bass.?d|\bkd\b|\bkd\d|\bkik|boom|\bbdrum'),
    ('perc', r'cowbell|\bcb\b|clave|\bcl\d|conga|bongo|shaker|cabasa|maraca|\bma\d|tamb|agogo|'
             r'wood|block|triangle|whistle|guiro|timbale|\bperc|vibra|bell|cuica|tabla'),
]

# Each class must look like itself: centroid range in Hz, and how long it may ring, in seconds.
SHAPE = {
    'kick': (20, 400, 0.02, 3.0),
    'snare': (300, 4500, 0.02, 2.0),
    'clap': (500, 6000, 0.02, 2.0),
    'rim': (400, 8000, 0.005, 1.0),
    'hat': (2500, 16000, 0.005, 1.2),
    'hat_open': (2000, 16000, 0.04, 3.0),
    'ride': (1500, 14000, 0.05, 6.0),
    'crash': (1200, 14000, 0.10, 8.0),
    'tom': (60, 1400, 0.03, 3.0),
    'perc': (100, 16000, 0.005, 4.0),
}


def read(path):
    rate, data = wavfile.read(path)
    if data.dtype == np.int16:
        x = data.astype(np.float32) / 32768.0
    elif data.dtype == np.int32:
        x = data.astype(np.float32) / 2147483648.0
    elif data.dtype == np.uint8:
        x = (data.astype(np.float32) - 128.0) / 128.0
    else:
        x = data.astype(np.float32)
    if x.ndim > 1:
        x = x.mean(axis=1)
    return rate, x


def describe(x, rate):
    """Spectral centroid of the first 120 ms and the time the tail falls 40 dB, in seconds."""
    head = x[:int(0.12 * rate)]
    if head.size < 64:
        return 0.0, 0.0
    window = np.hanning(head.size)
    spectrum = np.abs(np.fft.rfft(head * window))
    freqs = np.fft.rfftfreq(head.size, 1 / rate)
    power = spectrum ** 2
    centroid = float((freqs * power).sum() / max(1e-20, power.sum()))
    envelope = np.abs(x)
    peak = envelope.max()
    if peak <= 0:
        return centroid, 0.0
    loud = np.flatnonzero(envelope > peak * 0.01)
    return centroid, float((loud[-1] + 1) / rate) if loud.size else 0.0


def classify(folder, name):
    # The folder counts too: a pack may name the instrument there and number the files.
    low = re.sub(r'[\s_\-]+', ' ', f'{os.path.basename(folder)} {name}'.lower())
    for cls, pattern in RULES:
        if re.search(pattern, low):
            return cls
    return None


def main():
    plain = [a for a in sys.argv[1:] if not a.startswith('--')]
    out = next((a[6:] for a in sys.argv[1:] if a.startswith('--out=')), None)
    roots = [os.path.abspath(r) for r in plain] or [os.path.abspath(os.path.join(
        os.path.dirname(os.path.abspath(__file__)), '..', '..', 'corpus', 'downloads', 'oneshots', 'drums'))]
    pool = {cls: [] for cls, _ in RULES}
    named = rejected = unmatched = 0
    for root in roots:
      for folder, _, names in os.walk(root):
        for name in names:
            if not name.lower().endswith('.wav'):
                continue
            cls = classify(folder, os.path.splitext(name)[0])
            if cls is None:
                unmatched += 1
                continue
            named += 1
            path = os.path.join(folder, name)
            try:
                rate, x = read(path)
            except Exception:
                rejected += 1
                continue
            if x.size < 128 or not np.isfinite(x).all() or np.abs(x).max() < 1e-4:
                rejected += 1
                continue
            centroid, tail = describe(x, rate)
            lo, hi, shortest, longest = SHAPE[cls]
            if not (lo <= centroid <= hi) or not (shortest <= tail <= longest):
                rejected += 1
                continue
            pool[cls].append({'path': path.replace('\\', '/'),
                              'rate': int(rate), 'centroid': round(centroid), 'tail': round(tail, 3)})
    out = out or os.path.join(roots[0], 'pool.json')
    with open(out, 'w', encoding='utf-8') as f:
        json.dump({'root': '', 'classes': pool}, f, indent=1)
    print(f'{named} named, {rejected} rejected by shape, {unmatched} unmatched')
    for cls, items in pool.items():
        print(f'  {cls:9s} {len(items):5d}')
    print(out)


if __name__ == '__main__':
    main()
