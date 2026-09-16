"""Find a hard kick design the kit separator mishandles the way it mishandles a real one.

At the kick positions of a real hardstyle track the separator leaves only 43% of the energy in
the kick source and sends a third of it to the snare, which is why the classifier calls those
kicks snares. The first synthetic corpus kept 82% in the kick source, so it taught the opposite
lesson. This renders one short track per candidate design; prepare and measure them, and keep the
design whose split matches the real one.

    python bench/drumeval/synth/kickprobe.py
    node bench/drumeval/prepare.ts --corpus=kickprobe --batch=6
"""
import json
import os

import numpy as np
from scipy.io import wavfile
from scipy import signal

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
POOL = os.path.join(REPO, 'bench', 'corpus', 'downloads', 'oneshots', 'drums')
OUT = os.path.join(REPO, 'bench', 'corpus', 'kickprobe')
RATE = 44100
SECONDS = 30
BPM = 152

# oneshot: how much acoustic kick sits under the synthesised tone.
# top: where the pitch envelope starts, Hz. curve: how fast it falls, seconds.
# drive: distortion gain. scream: gain of a band-passed distorted copy, the midrange a hardstyle
# kick screams with. tail: length of the tone, seconds.
DESIGNS = [
    dict(name='a-clean', oneshot=0.75, top=420, curve=0.03, drive=8, scream=0.0, tail=0.45, kind='tanh'),
    dict(name='b-noshot', oneshot=0.0, top=420, curve=0.03, drive=8, scream=0.0, tail=0.45, kind='tanh'),
    dict(name='c-scream', oneshot=0.3, top=420, curve=0.03, drive=14, scream=0.6, tail=0.5, kind='clip'),
    dict(name='d-screamer', oneshot=0.0, top=520, curve=0.02, drive=22, scream=1.2, tail=0.55, kind='clip'),
    dict(name='e-longtail', oneshot=0.0, top=620, curve=0.015, drive=30, scream=1.6, tail=0.9, kind='clip'),
    dict(name='f-hardclip', oneshot=0.15, top=700, curve=0.012, drive=45, scream=2.2, tail=0.7, kind='clip'),
    dict(name='g-fold', oneshot=0.0, top=560, curve=0.018, drive=18, scream=1.8, tail=0.6, kind='fold'),
    dict(name='h-extreme', oneshot=0.0, top=900, curve=0.01, drive=60, scream=3.0, tail=0.8, kind='clip'),
]


def load(path):
    rate, data = wavfile.read(path)
    x = data.astype(np.float32) / 32768.0 if data.dtype == np.int16 else data.astype(np.float32)
    if x.ndim > 1:
        x = x.mean(axis=1)
    peak = np.abs(x).max()
    return x / peak if peak > 0 else x


def distort(x, kind, drive):
    if kind == 'tanh':
        return np.tanh(x * drive) / np.tanh(drive)
    if kind == 'clip':
        return np.clip(x * drive, -1, 1)
    y = x * drive
    return np.where(np.abs(y) <= 1, y, np.sign(y) * (2 - np.abs(y) % 2))


def kick(design, shot):
    n = int(design['tail'] * RATE)
    t = np.arange(n) / RATE
    freq = 48 + (design['top'] - 48) * np.exp(-t / design['curve'])
    tone = np.sin(2 * np.pi * np.cumsum(freq) / RATE) * np.exp(-t / (design['tail'] * 0.35))
    body = distort(tone.astype(np.float32), design['kind'], design['drive'])
    if design['scream'] > 0:
        # The distortion products between 400 Hz and 5 kHz, lifted: what makes a hardstyle kick
        # read as a snare to a separator trained on acoustic kits.
        b, a = signal.butter(2, [400 / (RATE / 2), 5000 / (RATE / 2)], btype='band')
        body = body + design['scream'] * signal.lfilter(b, a, distort(tone, 'clip', design['drive'] * 2))
    out = np.zeros(max(n, shot.size), dtype=np.float32)
    out[:n] += body.astype(np.float32)
    if design['oneshot'] > 0:
        out[:shot.size] += shot * design['oneshot']
    out = np.tanh(out * 2.2).astype(np.float32)
    peak = np.abs(out).max()
    return out / peak if peak > 0 else out


def main():
    with open(os.path.join(POOL, 'pool.json'), encoding='utf-8') as f:
        pool = json.load(f)
    shot = load(os.path.join(pool['root'], pool['classes']['kick'][0]['path']))
    os.makedirs(os.path.join(OUT, 'audio'), exist_ok=True)
    beat = 60 / BPM
    tracks = []
    for design in DESIGNS:
        voice = kick(design, shot)
        length = int(SECONDS * RATE)
        bus = np.zeros(length, dtype=np.float32)
        events = []
        at = 0.0
        while at < SECONDS - 1:
            start = int(at * RATE)
            end = min(length, start + voice.size)
            bus[start:end] += voice[:end - start]
            events.append({'time': round(at, 4), 'cls': 'kick'})
            at += beat
        bus = np.tanh(bus * 1.4)
        bus = bus / max(1e-9, np.abs(bus).max()) * 0.97
        stereo = np.stack([bus, bus], axis=1)
        wavfile.write(os.path.join(OUT, 'audio', design['name'] + '.wav'),
                      RATE, (stereo * 32767).astype(np.int16))
        tracks.append({'name': design['name'], 'audio': f"audio/{design['name']}.wav",
                       'genre': 'hardstyle', 'events': events})
        print(f"{design['name']:12s} {len(events)} kicks")
    with open(os.path.join(OUT, 'tracks.json'), 'w', encoding='utf-8') as f:
        json.dump({'corpus': 'kickprobe', 'labeled': True, 'heldOut': True, 'classes': ['kick'],
                   'source': 'bench/drumeval/synth/kickprobe.py', 'tracks': tracks}, f)
    print(f'\n{len(tracks)} designs in {OUT}')


if __name__ == '__main__':
    main()
