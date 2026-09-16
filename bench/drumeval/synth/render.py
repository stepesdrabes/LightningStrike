"""Render electronic drum tracks with exact onset labels.

Striker 1.0 hears a distorted hardstyle kick as a snare because nothing in its training set is a
distorted kick. This builds that training set: drum machine one-shots sequenced into the patterns
the product meets, put through the production chain that breaks detection (pitched sub layers,
saturation, clipping, bitcrush, filter sweeps, sidechain ducking, bus limiting) and mixed over
drum-free backing at a range of balances. Every hit's trigger time is known exactly.

    python bench/drumeval/synth/render.py --tracks=64 --seconds=150 --seed=11

Writes bench/corpus/synth/audio/*.wav and tracks.json in the drumeval corpus format.
"""
import argparse
import json
import os
import subprocess

import numpy as np
from scipy.io import wavfile
from scipy import signal
from scipy.ndimage import maximum_filter1d

RATE = 44100
STEPS = 96          # per bar of four beats: 16ths every 6, 32nds every 3, 8th triplets every 8
BEAT = STEPS // 4

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..', '..'))
POOL = os.path.join(REPO, 'bench', 'corpus', 'downloads', 'oneshots', 'drums')
BACKING = os.path.join(REPO, 'bench', 'reports', 'drumeval', 'synth', 'backing')
OUT = os.path.join(REPO, 'bench', 'corpus', 'synth')

# Role to the class a benchmark scores. Percussion is decided by its brightness when it is placed.
CLASS_OF = {
    'kick': 'kick', 'snare': 'snare', 'clap': 'snare', 'rim': 'snare',
    'hat': 'hat', 'hat_open': 'hat', 'ride': 'cymbal', 'crash': 'cymbal', 'tom': 'tom',
}


# ---------------------------------------------------------------- audio helpers

def load(path):
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
    if rate != RATE:
        x = resample(x, rate / RATE)
    peak = np.abs(x).max()
    return (x / peak).astype(np.float32) if peak > 0 else x.astype(np.float32)


def resample(x, factor):
    """Linear resampling; factor > 1 shortens and raises the pitch."""
    if abs(factor - 1) < 1e-6 or x.size < 2:
        return x
    n = max(2, int(x.size / factor))
    at = np.arange(n, dtype=np.float64) * factor
    left = np.clip(at.astype(np.int64), 0, x.size - 2)
    frac = (at - left).astype(np.float32)
    return (x[left] * (1 - frac) + x[left + 1] * frac).astype(np.float32)


def place(bus, x, at, gain, pan=0.0):
    start = int(at)
    end = min(bus.shape[1], start + x.size)
    if start >= bus.shape[1] or end <= 0:
        return
    piece = x[max(0, -start):end - start] * gain
    lo = max(0, start)
    bus[0, lo:end] += piece * np.sqrt(0.5 * (1 - pan))
    bus[1, lo:end] += piece * np.sqrt(0.5 * (1 + pan))


def sub_kick(rng, f0, f1, seconds, curve=0.02):
    """A pitched sine drop: the body of an 808 or a hardstyle kick."""
    n = int(seconds * RATE)
    t = np.arange(n) / RATE
    freq = f1 + (f0 - f1) * np.exp(-t / curve)
    phase = 2 * np.pi * np.cumsum(freq) / RATE
    envelope = np.exp(-t / (seconds * rng.uniform(0.22, 0.4)))
    return (np.sin(phase) * envelope).astype(np.float32)


def distort(x, kind, drive):
    if kind == 'tanh':
        return np.tanh(x * drive) / np.tanh(drive)
    if kind == 'clip':
        return np.clip(x * drive, -1, 1)
    if kind == 'fold':
        y = x * drive
        return np.where(np.abs(y) <= 1, y, np.sign(y) * (2 - np.abs(y) % 2))
    # Asymmetric soft clipping keeps even harmonics, as a driven transformer would.
    y = x * drive
    return np.where(y >= 0, 1 - np.exp(-y), -1 + np.exp(y * 0.7)) * 0.9


def bitcrush(x, bits, decimate):
    levels = 2 ** (bits - 1)
    y = np.round(x * levels) / levels
    if decimate > 1:
        held = y[::decimate]
        y = np.repeat(held, decimate)[:x.shape[-1]] if y.ndim == 1 else y
    return y.astype(np.float32)


def sweep(x, cutoffs, kind):
    """Time-varying one-pole filter; cutoffs holds one cutoff in Hz per block."""
    out = np.empty_like(x)
    blocks = len(cutoffs)
    size = int(np.ceil(x.shape[-1] / blocks))
    state = np.zeros(x.shape[0]) if x.ndim > 1 else 0.0
    for b, cutoff in enumerate(cutoffs):
        piece = x[..., b * size:(b + 1) * size]
        if piece.shape[-1] == 0:
            break
        a = float(np.exp(-2 * np.pi * cutoff / RATE))
        low = signal.lfilter([1 - a], [1, -a], piece, axis=-1,
                             zi=(np.atleast_1d(state) * (1 - a))[..., None] if np.ndim(state) else None)
        low, state = (low if isinstance(low, np.ndarray) else low[0], 0.0) if not isinstance(low, tuple) \
            else (low[0], low[1][..., 0])
        out[..., b * size:(b + 1) * size] = low if kind == 'lp' else piece - low
    return out.astype(np.float32)


def reverb(x, seconds, rng):
    n = int(seconds * RATE)
    tail = rng.standard_normal(n).astype(np.float32) * np.exp(-np.arange(n) / (seconds * RATE / 4))
    tail[0] = 0
    wet = np.stack([signal.fftconvolve(channel, tail, mode='full')[:x.shape[-1]] for channel in x])
    peak = np.abs(wet).max()
    return (wet / peak).astype(np.float32) if peak > 0 else wet.astype(np.float32)


def compress(x, threshold, ratio, attack, release):
    """Peak compressor: the attack is a running maximum, the release a one-pole decay."""
    level = np.abs(x).max(axis=0)
    span = max(1, int(attack * RATE))
    peak = maximum_filter1d(level, size=span, mode='nearest')
    a = float(np.exp(-1 / (release * RATE)))
    envelope = signal.lfilter([1 - a], [1, -a], peak)
    over = np.maximum(np.maximum(envelope, peak * 0.5), 1e-6) / threshold
    gain = np.where(over > 1, over ** (1 / ratio - 1), 1.0)
    return (x * gain).astype(np.float32)


def ducking(times, length, depth, hold, release):
    """One over the sidechain envelope: a dip at every kick that recovers over `release`."""
    gain = np.ones(length, dtype=np.float32)
    shape_n = int((hold + release) * RATE)
    t = np.arange(shape_n) / RATE
    shape = np.where(t < hold, 0.0, np.minimum(1.0, (t - hold) / release))
    shape = 1 - depth * (1 - shape)
    for time in times:
        at = int(time * RATE)
        end = min(length, at + shape_n)
        if at >= length:
            continue
        gain[at:end] = np.minimum(gain[at:end], shape[:end - at])
    return gain


def limit(x, ceiling=0.97):
    peak = np.abs(x).max()
    if peak <= 0:
        return x
    y = x * min(1.0, 0.9 / peak) if peak > 0 else x
    y = np.tanh(y * 1.35) / np.tanh(1.35)
    peak = np.abs(y).max()
    return (y * (ceiling / peak)).astype(np.float32)


# ---------------------------------------------------------------- patterns

def euclid(hits, steps):
    """Bjorklund positions, the spacing syncopated electronic patterns fall into."""
    return [i for i in range(steps) if (i * hits) % steps < hits]


def pattern(genre, bar, rng, section):
    """Role to list of (step, velocity) for one bar."""
    out = {role: [] for role in
           ['kick', 'snare', 'clap', 'rim', 'hat', 'hat_open', 'ride', 'crash', 'tom', 'perc']}
    full = section != 'quiet'

    def add(role, steps, low=0.75, high=1.0):
        for s in steps:
            out[role].append((s % STEPS, float(rng.uniform(low, high))))

    if genre in ('house', 'techno', 'trance', 'disco', 'hardtechno', 'hardstyle'):
        add('kick', range(0, STEPS, BEAT), 0.9, 1.0)
        if genre == 'hardstyle' and rng.random() < 0.25:
            add('kick', [s + BEAT // 2 for s in (0, 2 * BEAT)], 0.7, 0.85)
        if genre == 'hardtechno' and rng.random() < 0.3:
            add('kick', [BEAT + BEAT // 2], 0.7, 0.9)
        if full:
            if genre in ('house', 'trance', 'disco') or rng.random() < 0.6:
                add('clap' if rng.random() < 0.6 else 'snare', [BEAT, 3 * BEAT], 0.8, 1.0)
            step = 6 if rng.random() < 0.5 else 12
            if genre not in ('hardstyle', 'hardtechno') or rng.random() < 0.4:
                add('hat', range(step // 2 if step == 12 else 0, STEPS, step), 0.35, 0.8)
            if genre in ('trance', 'disco', 'house') and rng.random() < 0.7:
                add('hat_open', range(BEAT // 2, STEPS, BEAT), 0.6, 0.9)
    elif genre == 'gabber':
        add('kick', range(0, STEPS, BEAT // 2), 0.85, 1.0)
        if full and rng.random() < 0.4:
            add('clap', [2 * BEAT], 0.8, 1.0)
    elif genre == 'trap':
        add('kick', [0] + [s * 6 for s in rng.choice(range(1, 16), size=rng.integers(1, 4), replace=False)], 0.85, 1.0)
        add('clap' if rng.random() < 0.5 else 'snare', [2 * BEAT], 0.85, 1.0)
        if full:
            base = 12 if rng.random() < 0.5 else 6
            add('hat', range(0, STEPS, base), 0.3, 0.7)
            for _ in range(int(rng.integers(0, 3))):
                beat = int(rng.integers(0, 4)) * BEAT
                step = int(rng.choice([3, 4, 6, 8]))
                add('hat', range(beat, beat + BEAT, step), 0.3, 0.75)
    elif genre in ('dnb', 'dubstep'):
        add('kick', [0] if genre == 'dubstep' else [0, int(rng.choice([54, 60, 66]))], 0.85, 1.0)
        add('snare', [2 * BEAT], 0.85, 1.0)
        if genre == 'dnb' and rng.random() < 0.5:
            add('snare', [int(rng.choice([36, 84, 90]))], 0.2, 0.4)
        if full:
            add('hat', range(0, STEPS, 12 if genre == 'dubstep' else 6), 0.3, 0.7)
            if rng.random() < 0.4:
                add('ride', range(0, STEPS, 12), 0.4, 0.7)
    elif genre == 'boombap':
        add('kick', [0] + [int(rng.choice([36, 42, 60, 66]))], 0.85, 1.0)
        add('snare', [BEAT, 3 * BEAT], 0.85, 1.0)
        if full:
            add('hat', range(0, STEPS, 12), 0.35, 0.75)
            if rng.random() < 0.5:
                add('snare', [int(rng.choice([6, 18, 78]))], 0.12, 0.28)
    else:  # breaks and electro
        add('kick', [0] + [s * 6 for s in euclid(3, 16)][1:], 0.8, 1.0)
        add('snare', [BEAT, 3 * BEAT], 0.85, 1.0)
        if full:
            add('hat', range(0, STEPS, 6), 0.3, 0.75)

    if full and rng.random() < 0.25:
        add('perc', [s * 6 for s in euclid(int(rng.integers(3, 6)), 16)], 0.3, 0.7)
    return out


def fill(genre, rng):
    """A bar ending a phrase: a roll whose hits sit closer than any evaluation window."""
    out = {role: [] for role in
           ['kick', 'snare', 'clap', 'rim', 'hat', 'hat_open', 'ride', 'crash', 'tom', 'perc']}
    kind = rng.random()
    if kind < 0.4:
        step = int(rng.choice([3, 4, 6]))
        start = int(rng.choice([2 * BEAT, 3 * BEAT]))
        for s in range(start, STEPS, step):
            out['snare'].append((s, float(rng.uniform(0.4, 1.0) * (0.55 + 0.45 * (s - start) / max(1, STEPS - start)))))
    elif kind < 0.65:
        step = int(rng.choice([3, 4]))
        for s in range(3 * BEAT, STEPS, step):
            out['hat'].append((s, float(rng.uniform(0.4, 0.9))))
    elif kind < 0.85:
        for i, s in enumerate(range(2 * BEAT, STEPS, 6)):
            out['tom'].append((s, float(rng.uniform(0.7, 1.0))))
    else:
        # An accelerating roll: 8ths into 16ths into 32nds, the build before a drop.
        s = 0
        step = 12
        while s < STEPS:
            out['snare'].append((s, float(min(1.0, 0.35 + 0.75 * s / STEPS))))
            s += step
            if s > STEPS * 0.5:
                step = 6
            if s > STEPS * 0.8:
                step = 3
    return out


GENRES = ['house', 'techno', 'trance', 'hardtechno', 'hardstyle', 'gabber', 'trap',
          'dnb', 'dubstep', 'boombap', 'disco', 'breaks']
TEMPO = {'house': (120, 128), 'techno': (128, 145), 'trance': (134, 142), 'hardtechno': (145, 165),
         'hardstyle': (148, 160), 'gabber': (175, 200), 'trap': (130, 160), 'dnb': (168, 178),
         'dubstep': (138, 145), 'boombap': (82, 98), 'disco': (112, 126), 'breaks': (124, 136)}


# ---------------------------------------------------------------- the kit

class Kit:
    """One track's chosen sounds and how each is voiced."""

    def __init__(self, pool, genre, rng):
        self.rng = rng
        self.genre = genre
        self.samples = {}
        for role in ['kick', 'snare', 'clap', 'rim', 'hat', 'hat_open', 'ride', 'crash', 'tom', 'perc']:
            group = pool['classes'].get(role) or pool['classes']['perc']
            pick = group[int(rng.integers(len(group)))]
            self.samples[role] = {'audio': load(os.path.join(pool['root'], pick['path'])),
                                  'centroid': pick['centroid']}
        self.pitch = {role: float(rng.uniform(0.85, 1.18)) for role in self.samples}
        self.hard = genre in ('hardstyle', 'gabber', 'hardtechno')
        self.sub = self.hard or rng.random() < 0.55
        self.kick_drive = float(rng.uniform(6, 26)) if self.hard else float(rng.uniform(1.0, 4.0))
        self.kick_kind = str(rng.choice(['clip', 'tanh', 'asym'])) if self.hard else 'tanh'
        # How far this kit's kick is pushed. The kit separator keeps 99% of a clean synthesised
        # kick in its kick source and none of an extreme one, while a real hardstyle record sits
        # near 43%; drawing severity across that whole range is what stops the classifier from
        # believing the kick source whenever it happens to be full. See kickprobe.py.
        self.severity = float(rng.uniform(0, 1)) ** 0.7 if self.hard else float(rng.uniform(0, 0.35))
        self.scream = 3.2 * self.severity
        self.scream_kind = str(rng.choice(['clip', 'fold']))
        self.oneshot = float(rng.uniform(0.5, 0.9)) * (1 - 0.9 * self.severity)
        self.clap_spread = float(rng.uniform(0.006, 0.022))
        self.choke = rng.random() < 0.7

    def voice(self, role, velocity):
        """The audio for one hit, already shaped for this kit."""
        sample = self.samples[role]['audio']
        rng = self.rng
        x = resample(sample, self.pitch[role] * float(rng.uniform(0.97, 1.03)))
        if role == 'kick':
            if self.sub:
                top = float(rng.uniform(280, 900)) if self.hard else float(rng.uniform(110, 190))
                bottom = float(rng.uniform(42, 58))
                tail = float(rng.uniform(0.35, 0.9)) if self.hard else float(rng.uniform(0.25, 1.4))
                body = sub_kick(rng, top, bottom, tail, curve=float(rng.uniform(0.008, 0.05)))
                if self.scream > 0:
                    # The distortion products between 400 Hz and 5 kHz are what a driven kick
                    # screams with, and what a separator trained on acoustic kits hears as a snare.
                    band = signal.butter(2, [400 / (RATE / 2), 5000 / (RATE / 2)], btype='band')
                    body = body + self.scream * signal.lfilter(
                        *band, distort(body, self.scream_kind, self.kick_drive * 2)).astype(np.float32)
                n = max(x.size, body.size)
                mixed = np.zeros(n, dtype=np.float32)
                mixed[:x.size] += x * (self.oneshot if self.hard else float(rng.uniform(0.4, 0.9)))
                mixed[:body.size] += body * float(rng.uniform(0.7, 1.2))
                x = mixed
            x = distort(x, self.kick_kind, self.kick_drive).astype(np.float32)
            if self.hard:
                # A hardstyle kick is limited into one solid block, which is why its attack reads wrong.
                x = np.tanh(x * (1.6 + 2.4 * self.severity)).astype(np.float32)
        elif role == 'clap':
            taps = int(rng.integers(2, 4))
            spread = self.clap_spread
            n = x.size + int(taps * spread * RATE) + 1
            spread_out = np.zeros(n, dtype=np.float32)
            for tap in range(taps):
                at = int(tap * spread * RATE * float(rng.uniform(0.7, 1.3)))
                spread_out[at:at + x.size] += x * (1.0 if tap == 0 else float(rng.uniform(0.4, 0.8)))
            x = spread_out
        peak = np.abs(x).max()
        if peak > 0:
            x = x / peak
        return (x * velocity).astype(np.float32)


# ---------------------------------------------------------------- one track

def choose(rng, backings):
    """A backing and a genre that can share its tempo, or no backing and a free choice.

    Drums at one tempo over music at another is a mixture no recording contains, so the backing
    decides the tempo and the genre is drawn from those whose range can hold it at some metrical
    level. A track whose tempo no genre wants plays without backing.
    """
    pick = backings[int(rng.integers(len(backings)))] if backings and rng.random() < 0.8 else None
    if pick and pick.get('bpm'):
        options = [(genre, pick['bpm'] * multiple)
                   for genre in GENRES for multiple in (0.5, 1.0, 2.0)
                   if TEMPO[genre][0] <= pick['bpm'] * multiple <= TEMPO[genre][1]]
        if options:
            genre, bpm = options[int(rng.integers(len(options)))]
            return pick, genre, float(bpm)
    genre = str(rng.choice(GENRES))
    lo, hi = TEMPO[genre]
    return None, genre, float(rng.uniform(lo, hi))


def render(pool, backings, seed, seconds):
    rng = np.random.default_rng(seed)
    pick, genre, bpm = choose(rng, backings)
    kit = Kit(pool, genre, rng)
    bar_seconds = 4 * 60 / bpm
    bars = int(np.ceil(seconds / bar_seconds))
    length = int((bars * bar_seconds + 2) * RATE)
    bus = np.zeros((2, length), dtype=np.float32)
    events = []
    kick_times = []
    swing = float(rng.uniform(0, 0.16)) if genre in ('boombap', 'house') else 0.0
    jitter = float(rng.uniform(0.0004, 0.004)) if genre in ('house', 'techno', 'trance', 'hardstyle',
                                                            'gabber', 'hardtechno') else float(rng.uniform(0.002, 0.012))
    phrase = int(rng.choice([4, 8, 8, 16]))
    section = 'full'
    last_hat_end = -1.0

    for bar in range(bars):
        if bar % phrase == 0:
            roll = rng.random()
            section = 'quiet' if roll < 0.18 else 'out' if roll < 0.26 else 'full'
        if section == 'out':
            continue
        bar_start = bar * bar_seconds
        steps = fill(genre, rng) if (bar % phrase == phrase - 1 and rng.random() < 0.55) \
            else pattern(genre, bar, rng, section)
        if bar % phrase == 0 and rng.random() < 0.5:
            steps['crash'].append((0, float(rng.uniform(0.7, 1.0))))
        placed = []
        for role, hits in steps.items():
            for step, velocity in hits:
                position = step / STEPS
                if swing and (step // (BEAT // 2)) % 2 == 1:
                    position += swing * (BEAT / 2) / STEPS
                at = bar_start + position * bar_seconds + float(rng.normal(0, jitter))
                if 0 <= at and at * RATE < length:
                    placed.append((at, role, velocity))
        placed.sort()
        hats = [at for at, role, _ in placed if role in ('hat', 'hat_open')]
        for at, role, velocity in placed:
            audio = kit.voice(role, velocity)
            if role in ('hat', 'hat_open') and kit.choke:
                # One hat voice: the next stroke cuts the one ringing, which is what an open hat
                # on the offbeat sounds like and why its decay cannot be assumed.
                following = next((t for t in hats if t > at + 0.005), last_hat_end)
                room = int((following - at) * RATE) if following > at else audio.size
                if 0 < room < audio.size:
                    fade = min(room, int(0.004 * RATE))
                    audio = audio[:room].copy()
                    audio[-fade:] *= np.linspace(1, 0, fade, dtype=np.float32)
                last_hat_end = max(last_hat_end, at + audio.size / RATE)
            place(bus, audio, at * RATE, 1.0, pan=float(rng.uniform(-0.35, 0.35))
                  if role in ('hat', 'perc', 'tom', 'ride') else float(rng.uniform(-0.06, 0.06)))
            if role == 'kick':
                kick_times.append(at)
            if role == 'perc':
                # A shaker keeps time like a hat, so it is an optional hat reference under the same
                # rule MDB's tambourine follows; anything darker is simply not a kit class.
                bright = kit.samples['perc']['centroid'] > 5000
                events.append({'time': round(at, 4), 'cls': 'hat', 'sub': 'TMB', 'optional': True}
                              if bright else {'time': round(at, 4), 'cls': 'other', 'sub': 'perc'})
            else:
                events.append({'time': round(at, 4), 'cls': CLASS_OF[role], 'sub': role,
                               **({'optional': True} if velocity < 0.3 else {})})

    # Bus processing: what a producer does to a drum bus, and what it costs a detector.
    if rng.random() < 0.35:
        bus = bitcrush(bus, int(rng.integers(6, 13)), int(rng.integers(1, 4)))
    if rng.random() < 0.6:
        bus = distort(bus, str(rng.choice(['tanh', 'clip', 'asym'])), float(rng.uniform(1.2, 6.0))).astype(np.float32)
    if rng.random() < 0.4:
        blocks = max(4, bars)
        kind = 'lp' if rng.random() < 0.65 else 'hp'
        start, end = (float(rng.uniform(300, 2000)), 16000.0) if kind == 'lp' else (16000.0, float(rng.uniform(200, 1500)))
        cutoffs = np.geomspace(start, end, blocks) if rng.random() < 0.5 else np.geomspace(end, start, blocks)
        bus = sweep(bus, cutoffs, kind)
    if rng.random() < 0.45:
        wet = reverb(bus, float(rng.uniform(0.15, 0.7)), rng)
        bus = (bus + wet * float(rng.uniform(0.05, 0.3))).astype(np.float32)
    bus = compress(bus, float(rng.uniform(0.1, 0.4)), float(rng.uniform(2, 8)), 0.003, float(rng.uniform(0.05, 0.2)))

    # Backing, ducked under the kick the way a club mix is.
    backing_name = ''
    residue = {}
    if pick:
        rate, data = wavfile.read(pick['wav'])
        music = (data.astype(np.float32) / 32768.0).T
        if music.shape[1] < length:
            music = np.tile(music, (1, int(np.ceil(length / music.shape[1]))))
        # Start on one of the backing's own downbeats, so its bar line is the drums' bar line.
        backing_bar = 4 * 60 / pick['bpm']
        room = max(0, (music.shape[1] - length) / RATE - pick['firstBar'])
        bars_in = int(rng.integers(0, max(1, int(room / backing_bar) + 1)))
        offset = int((pick['firstBar'] + bars_in * backing_bar) * RATE)
        offset = min(offset, max(0, music.shape[1] - length))
        music = music[:, offset:offset + length]
        level = np.sqrt((music ** 2).mean()) + 1e-9
        music = music / level * float(rng.uniform(0.04, 0.16))
        if kick_times and rng.random() < 0.6:
            music = music * ducking(kick_times, length, float(rng.uniform(0.3, 0.9)),
                                    float(rng.uniform(0.01, 0.05)), float(rng.uniform(0.08, 0.3)))
        drums_level = np.sqrt((bus ** 2).mean()) + 1e-9
        bus = bus / drums_level * float(rng.uniform(0.06, 0.20)) + music
        backing_name = pick['name']
        shift = offset / RATE
        residue = {cls: [round(t - shift, 4) for t in times if 0 <= t - shift < length / RATE]
                   for cls, times in pick['residueBy'].items()}

    if rng.random() < 0.7:
        bus = distort(bus, 'tanh', float(rng.uniform(1.1, 2.5))).astype(np.float32)
    bus = limit(bus)
    # The backing's own drums survive subtraction. They are unknown, not absent, so an `unreviewed`
    # reference stands there: neither policy teaches or counts a detection on one. Per class, because
    # marking every class at every residual hit covered most of the track and left the corpus unable
    # to penalise a false positive at all.
    for cls, times in residue.items():
        for time in times:
            events.append({'time': time, 'cls': cls, 'sub': 'unreviewed', 'optional': True})
    events.sort(key=lambda e: e['time'])
    keep = int(min(length, seconds * RATE))
    return bus[:, :keep], events, {'genre': genre, 'bpm': round(bpm, 2), 'backing': backing_name,
                                   'hard': kit.hard, 'swing': round(swing, 3)}


def codec(path, bitrate='128k'):
    """Encode to AAC and back, in place: the compression every downloaded track has been through."""
    encoded = path + '.m4a'
    quiet = ['-nostdin', '-hide_banner', '-loglevel', 'error', '-y']
    if subprocess.run(['ffmpeg', *quiet, '-i', path, '-c:a', 'aac', '-b:a', bitrate, encoded]).returncode:
        return
    subprocess.run(['ffmpeg', *quiet, '-i', encoded, '-ar', str(RATE), '-ac', '2', path])
    os.remove(encoded)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--tracks', type=int, default=64)
    parser.add_argument('--seconds', type=float, default=150)
    parser.add_argument('--seed', type=int, default=11)
    parser.add_argument('--genres', default='', help='comma separated genres to draw from; repeat one to weight it')
    parser.add_argument('--out', default=OUT)
    args = parser.parse_args()
    if args.genres:
        chosen = args.genres.split(',')
        unknown = set(chosen) - set(TEMPO)
        if unknown:
            raise SystemExit(f'unknown genres {sorted(unknown)}')
        GENRES[:] = chosen

    with open(os.path.join(POOL, 'pool.json'), encoding='utf-8') as f:
        pool = json.load(f)
    backings = []
    if os.path.isdir(BACKING):
        for name in sorted(os.listdir(BACKING)):
            if name.endswith('.json') and name != 'index.json':
                with open(os.path.join(BACKING, name), encoding='utf-8') as f:
                    meta = json.load(f)
                wav = os.path.join(BACKING, name[:-5] + '.wav')
                if os.path.exists(wav) and 'bpm' in meta:
                    backings.append({'name': meta['name'], 'wav': wav, 'bpm': meta['bpm'],
                                     'firstBar': meta.get('firstBar', 0.0),
                                     'residueBy': meta.get('residueBy', {})})
    print(f'{sum(len(v) for v in pool["classes"].values())} one-shots, {len(backings)} backings')

    audio_dir = os.path.join(args.out, 'audio')
    os.makedirs(audio_dir, exist_ok=True)
    tracks = []
    for i in range(args.tracks):
        audio, events, meta = render(pool, backings, args.seed + i, args.seconds)
        name = f'{i:03d}-{meta["genre"]}'
        path = os.path.join(audio_dir, name + '.wav')
        wavfile.write(path, RATE, (np.clip(audio.T, -1, 1) * 32767).astype(np.int16))
        # The library is downloaded audio, so half of the corpus goes through a lossy codec too.
        if np.random.default_rng(args.seed + i).random() < 0.5:
            codec(path)
        counts = {}
        for e in events:
            if not e.get('optional'):
                counts[e['cls']] = counts.get(e['cls'], 0) + 1
        tracks.append({'name': name, 'audio': f'audio/{name}.wav', 'genre': meta['genre'], 'events': events})
        print(f'{name:18s} {meta["bpm"]:6.1f} bpm  {len(events):5d} events  '
              + ' '.join(f'{k}:{v}' for k, v in sorted(counts.items()))
              + (f'  over {meta["backing"]}' if meta['backing'] else '  drums only'))
    with open(os.path.join(args.out, 'tracks.json'), 'w', encoding='utf-8') as f:
        json.dump({'corpus': 'synth', 'labeled': True,
                   'source': 'bench/drumeval/synth/render.py, drum machine one-shots over drum-free backing',
                   'tracks': tracks}, f)
    print(f'\n{len(tracks)} tracks in {args.out}')


if __name__ == '__main__':
    main()
