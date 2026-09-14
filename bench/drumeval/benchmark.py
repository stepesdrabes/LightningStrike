# Published-benchmark scoring for drumeval runs, following ADTOF (Zehren et al. 2023) and Vogl et al.:
# MIDI_REDUCED_5 classes from each dataset's own labels, mir_eval matching within 50 ms, F summed over
# every onset of the scored classes, and for MDB, ENST and RBMA13 the mean of that sum F over Vogl's three
# folds. --adtof scores the released ADTOF model on the cached mix activations with its own peak picking.
#   python bench/drumeval/benchmark.py --run=LABEL [--corpora=mdb,enst,rbma,idmt] [--window=0.05] [--json=FILE]
#   python bench/drumeval/benchmark.py --adtof [--corpora=...]
import argparse
import json
import os

import mir_eval
import numpy as np
from scipy.ndimage import maximum_filter, uniform_filter

parser = argparse.ArgumentParser()
parser.add_argument('--run', default='')
parser.add_argument('--adtof', action='store_true', help='score the released ADTOF weights instead of a run')
parser.add_argument('--corpora', default='mdb,enst,rbma,idmt')
parser.add_argument('--window', type=float, default=0.05)
parser.add_argument('--json', default='')
args = parser.parse_args()
if bool(args.run) == args.adtof:
    raise SystemExit('pass exactly one of --run and --adtof')

here = os.path.dirname(os.path.abspath(__file__))
root = os.path.join(here, '..', '..')
corpus_root = os.path.join(root, 'bench', 'corpus')
report_root = os.path.join(root, 'bench', 'reports', 'drumeval')
CLASSES = ['kick', 'snare', 'tom', 'hat', 'cymbal']
THREE = ['kick', 'snare', 'hat']
# MIDI_REDUCED_5 drops tambourine and shakers, which drumeval keeps as optional hat references.
DROPPED_SUBS = {'TMB', 'GM54', 'GM69', 'GM70', 'GM82'}
MDB_CLASSES = {
    'KD': 'kick', 'SD': 'snare', 'SDB': 'snare', 'SDD': 'snare', 'SDF': 'snare', 'SDG': 'snare', 'SDNS': 'snare',
    'SST': 'snare', 'CHH': 'hat', 'OHH': 'hat', 'PHH': 'hat', 'HIT': 'tom', 'MHT': 'tom', 'HFT': 'tom', 'LFT': 'tom',
    'RDC': 'cymbal', 'RDB': 'cymbal', 'CRC': 'cymbal', 'CHC': 'cymbal', 'SPC': 'cymbal'
}
CONVERTED = {'enst': 'enst-drums', 'enstsolo': 'enst-solo', 'enst23': 'enst-23', 'rwc': 'rwc', 'a2md': 'a2md', 'rbma': 'rbma13',
    'idmt': 'idmt-smt-drums', 'gmd': 'gmd', 'mdbpp': 'mdb-drums-pp'}
# ADTOF model/hyperparameters.py thresholds and madmom NotePeakPickingProcessor settings, in class order.
ADTOF_THRESHOLDS = {'kick': 0.22, 'snare': 0.24, 'tom': 0.32, 'hat': 0.22, 'cymbal': 0.30}
ADTOF_CHANNEL = {'kick': 0, 'snare': 1, 'tom': 2, 'hat': 3, 'cymbal': 4}

# ADTOF ressources/splits.py (Vogl et al. 2018).
MDB_FOLDS = [
    ['Punk', 'CoolJazz', 'Disco', 'SwingJazz', 'Rockabilly', 'Gospel', 'BebopJazz'],
    ['FunkJazz', 'FreeJazz', 'Reggae', 'LatinJazz', 'Britpop', 'FusionJazz', 'Shadows', '80sRock'],
    ['Beatles', 'Grunge', 'Zeppelin', 'ModalJazz', 'Country1', 'SpeedMetal', 'Rock', 'Hendrix'],
]
RBMA_FOLDS = [
    [2, 8, 13, 22, 4, 11, 30, 25, 21],
    [12, 29, 19, 14, 24, 10, 5, 15, 27],
    [1, 3, 16, 18, 20, 9, 28, 23, 17],
]


def fold_of(corpus, name):
    if corpus in ('mdb', 'mdbsolo', 'mdbpp'):
        return next(i for i, fold in enumerate(MDB_FOLDS) if name in fold)
    if corpus == 'rbma':
        return next(i for i, fold in enumerate(RBMA_FOLDS) if int(name.split('-')[1]) in fold)
    if corpus in ('enst', 'enstsolo', 'enst23'):
        # ENST folds are the three drummers.
        return int(name[1]) - 1
    return None


def references():
    out = {}
    for corpus in args.corpora.split(','):
        tracks = {}
        if corpus in ('mdb', 'mdbsolo'):
            base = os.path.join(corpus_root, 'mdb-drums', 'annotations', 'subclass')
            for file in sorted(os.listdir(base)):
                events = {c: [] for c in CLASSES}
                for line in open(os.path.join(base, file)):
                    parts = line.split()
                    if len(parts) >= 2 and parts[1] in MDB_CLASSES:
                        events[MDB_CLASSES[parts[1]]].append(float(parts[0]))
                tracks[file[len('MusicDelta_'):-len('_subclass.txt')]] = events
        else:
            data = json.load(open(os.path.join(corpus_root, CONVERTED[corpus], 'tracks.json'), encoding='utf-8'))
            if data.get('labeled') is False:
                continue
            for track in data['tracks']:
                events = {c: [] for c in CLASSES}
                for event in track['events']:
                    if event['cls'] in events and event.get('sub') not in DROPPED_SUBS:
                        events[event['cls']].append(event['time'])
                tracks[track['name']] = events
        classes = data.get('classes') if corpus not in ('mdb', 'mdbsolo') else None
        # ADTOF's label reader drops exact duplicates; RBMA13's public files repeat some lines.
        out[corpus] = {'tracks': {n: {c: np.unique(np.asarray(v, dtype=float)) for c, v in e.items()} for n, e in tracks.items()},
            'classes': [c for c in CLASSES if not classes or c in classes]}
    return out


def combine_left(onsets, delta):
    # madmom.utils.combine_events(..., 'left')
    delta += 1e-12
    if len(onsets) <= 1:
        return onsets
    events = np.array(onsets, dtype=float)
    idx = 0
    for right in events[1:]:
        if right - events[idx] > delta:
            idx += 1
            events[idx] = right
    return events[:idx + 1]


def adtof_onsets(activation, threshold, fps=100):
    # madmom NoteOnsetPeakPickingProcessor.process with ADTOF's settings (smooth 0, pre_avg .1, post_avg .01,
    # pre_max .02, post_max .01, combine .02 s) on one class column, including its peak_picking arithmetic.
    act = np.asarray(activation, dtype=np.float32).reshape(-1, 1)
    pre_avg, post_avg, pre_max, post_max = 10, 1, 2, 1
    mov_avg = uniform_filter(act, [pre_avg + post_avg + 1, 1], mode='constant', origin=int(np.floor((pre_avg - post_avg) / 2)))
    detections = act * (act >= mov_avg + threshold)
    mov_max = maximum_filter(detections, [pre_max + post_max + 1, 1], mode='constant', origin=int(np.floor((pre_max - post_max) / 2)))
    detections *= (detections == mov_max)
    frames = np.nonzero(detections)[0]
    # madmom returns no notes when the only peak is at frame 0.
    if not frames.any():
        return np.array([])
    return combine_left(frames.astype(float) / fps, 0.02)


def estimates(corpus, name):
    if args.adtof:
        path = os.path.join(report_root, 'evidence', corpus, name, 'adtof-mix.f32')
        act = np.fromfile(path, dtype=np.float32).reshape(-1, 5)
        return {c: adtof_onsets(act[:, ADTOF_CHANNEL[c]], ADTOF_THRESHOLDS[c]) for c in CLASSES}
    path = os.path.join(report_root, 'runs', args.run, 'tracks', f'{corpus}__{name}.json')
    if not os.path.exists(path):
        return None
    result = json.load(open(path))
    streams = result.get('classes') or result['final']
    return {c: np.asarray(streams[c]['times'], dtype=float) if c in streams else None for c in CLASSES}


def prf(tp, fp, fn):
    # ADTOF eval.getF1: empty predictions are fully precise, empty references fully recalled.
    p = tp / (tp + fp) if tp + fp else 1.0
    r = tp / (tp + fn) if tp + fn else 1.0
    return p, r, (2 * p * r / (p + r) if p * r else 0.0)


refs = references()
summary = {}
for corpus, entry in refs.items():
    counts = {}
    missing = 0
    unscored = set()
    for name, truth in sorted(entry['tracks'].items()):
        est = estimates(corpus, name)
        if est is None:
            missing += 1
            continue
        fold = fold_of(corpus, name)
        for c in entry['classes']:
            if est[c] is None:
                unscored.add(c)
                est_c = np.array([])
            else:
                est_c = np.sort(est[c])
            tp = len(mir_eval.util.match_events(truth[c], est_c, args.window))
            for key in ((c, 'all'), (c, fold)):
                a = counts.setdefault(key, [0, 0, 0])
                a[0] += tp
                a[1] += len(est_c) - tp
                a[2] += len(truth[c]) - tp
    scored = len(entry['tracks']) - missing
    if not scored:
        continue
    folds = sorted({k[1] for k in counts if k[1] not in ('all', None)})

    def pooled(classes, group):
        tp = sum(counts[(c, group)][0] for c in classes if (c, group) in counts)
        fp = sum(counts[(c, group)][1] for c in classes if (c, group) in counts)
        fn = sum(counts[(c, group)][2] for c in classes if (c, group) in counts)
        return prf(tp, fp, fn)[2], (tp, fp, fn)

    row = {'tracks': scored, 'classes': {}, 'unscored': sorted(unscored)}
    for c in entry['classes']:
        p, r, f = prf(*counts[(c, 'all')])
        row['classes'][c] = {'p': p, 'r': r, 'f': f, 'tp': counts[(c, 'all')][0], 'fp': counts[(c, 'all')][1], 'fn': counts[(c, 'all')][2]}
    for label, classes in (('3', [c for c in THREE if c in entry['classes']]), ('5', entry['classes'])):
        f, totals = pooled(classes, 'all')
        row[f'sum{label}'] = f
        row[f'totals{label}'] = totals
        if folds and not missing:
            row[f'folds{label}'] = float(np.mean([pooled(classes, g)[0] for g in folds]))
    summary[corpus] = row

source = 'released ADTOF Frame_RNN (reproduction)' if args.adtof else args.run
print(f'# Benchmark protocol: {source}, {int(args.window * 1000)} ms\n')
print('| corpus | tracks | BD | SD | TT | HH | CY+RD | 3-class sum F | 3-class fold mean | 5-class sum F | 5-class fold mean |')
print('|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|')
for corpus, row in summary.items():
    cell = lambda c: (f"{row['classes'][c]['f']:.3f}" + ('*' if c in row['unscored'] else '')) if c in row['classes'] else '-'
    fold = lambda key: f'{row[key]:.3f}' if key in row else '-'
    five = f"{row['sum5']:.3f}" if len(row['classes']) == 5 else '-'
    print(f"| {corpus} | {row['tracks']} | {cell('kick')} | {cell('snare')} | {cell('tom')} | {cell('hat')} | {cell('cymbal')} | "
        f"{row['sum3']:.3f} | {fold('folds3')} | {five} | {fold('folds5') if len(row['classes']) == 5 else '-'} |")
if any(row['unscored'] for row in summary.values()):
    print('\n* no estimates for this class in the run; scored as all misses')
if args.json:
    json.dump({'source': source, 'window': args.window, 'corpora': summary}, open(args.json, 'w'), indent=1)
