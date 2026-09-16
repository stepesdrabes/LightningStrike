# Trains Striker: cross-validated LightGBM classifiers on bench/drumeval candidate exports.
#   python bench/drumeval/train-striker.py --candidates=NAME [--name=NAME] [--corpora=mdb,enst,rwc] [--folds=5] [--loco] [--out=DIR]
# Held-out corpora train only with --train-held-out; otherwise the model trained on everything else scores them.
# Variants of a corpus (the same recordings rendered differently) train only for the classes --train-variants
# names and are always scored like their corpus.
# --out writes fold-<k>.json and folds.json for `evaluate.ts --model=DIR`, plus model.json.
import argparse
import bisect
import glob
import hashlib
import json
import os
import re

import lightgbm as lgb
import numpy as np
from scipy.sparse import csr_matrix
from scipy.sparse.csgraph import maximum_bipartite_matching

parser = argparse.ArgumentParser()
parser.add_argument('--candidates', required=True)
parser.add_argument('--name', default='Striker dev', help='release name the exported models carry, such as "Striker 1.0"')
parser.add_argument('--corpora', default='')
parser.add_argument('--folds', type=int, default=5)
parser.add_argument('--drop', default='', help='comma-separated feature names to exclude; the export still names the full list')
parser.add_argument('--rounds', type=int, default=300)
parser.add_argument('--leaves', type=int, default=15)
parser.add_argument('--learning-rate', type=float, default=0.05)
parser.add_argument('--min-leaf', type=int, default=40)
parser.add_argument('--classes', default='', help='classes to train, for sweeping one at a time; default all')
parser.add_argument('--out', default='')
parser.add_argument('--seed', type=int, default=7)
parser.add_argument('--seeds', type=int, default=1, help='models per class, seeded from --seed on; their log-odds are averaged')
parser.add_argument('--threads', type=int, default=6)
parser.add_argument('--noisy', default='a2md', help='corpora with automatically aligned labels')
parser.add_argument('--agreement-runs', default='', help='evaluate.ts runs whose model-stage scores vet noisy labels')
parser.add_argument('--min-agreement', type=float, default=0.5)
parser.add_argument('--balance', type=float, default=0.0, help='weight rows by corpus size ** -balance')
parser.add_argument('--weight', default='', help='corpus:factor,... applied on top of --balance')
parser.add_argument('--loco', action='store_true', help='leave one corpus out: cross-dataset models and scores')
parser.add_argument('--loco-corpora', default='', help='corpora to leave out in turn; the rest always train (default all)')
parser.add_argument('--train-variants', nargs='?', const='all', default='',
    help='classes (default all) whose variants also train, in exactly the folds that train their original recordings')
parser.add_argument('--train-held-out', action='store_true', help='cross-validate held-out corpora too (final models only)')
parser.add_argument('--ignore', default='rbma:snare',
    help="corpus:class labels never used; RBMA13's public snare labels leave out the claps other corpora count")
parser.add_argument('--labels', default='light', choices=['light', 'strict'],
    help='light: optional references neither teach nor count; strict: every benchmark reference is required')
parser.add_argument('--score', default='', choices=['', 'light', 'strict'], help='references to score against; default --labels')
parser.add_argument('--threshold-corpora', default='',
    help='choose the operating point on these corpora only; default every corpus in the fold')
parser.add_argument('--threshold-classes', default='',
    help='apply --threshold-corpora to these classes only; default every class')
parser.add_argument('--threshold-by', default='macro', choices=['macro', 'pooled'],
    help='choose class thresholds by the mean of per-corpus F or by F pooled over every hit')
args = parser.parse_args()

root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'reports', 'drumeval', 'candidates', args.candidates)
ALL_KIT = ['kick', 'snare', 'hat', 'cymbal', 'tom']
KIT = [k for k in ALL_KIT if k in args.classes.split(',')] if args.classes else list(ALL_KIT)
if not KIT:
    raise SystemExit(f'--classes: none of {args.classes} is a drum class')
if args.classes and args.out:
    raise SystemExit('--classes is a sweep aid; an exported model needs every class')
unknown = set(filter(None, args.threshold_corpora.split(','))) - set(args.corpora.split(',')) if args.corpora else set()
if unknown:
    raise SystemExit(f'--threshold-corpora: {sorted(unknown)} are not in --corpora')
unknown = set(filter(None, args.threshold_classes.split(','))) - set(ALL_KIT)
if unknown:
    raise SystemExit(f'--threshold-classes: {sorted(unknown)} are not drum classes')
unknown = {p.split(':')[0] for p in filter(None, args.weight.split(','))} - set(args.corpora.split(',')) if args.corpora else set()
if unknown:
    raise SystemExit(f'--weight: {sorted(unknown)} are not in --corpora')
WINDOW = 0.05


variant_kinds = set(ALL_KIT) if args.train_variants == 'all' else set(filter(None, args.train_variants.split(',')))
if variant_kinds - set(ALL_KIT):
    raise SystemExit(f'--train-variants: unknown classes {sorted(variant_kinds - set(ALL_KIT))}')


def load():
    tracks = []
    for path in sorted(glob.glob(os.path.join(root, '*.json'))):
        meta = json.load(open(path))
        if args.corpora and meta['corpus'] not in args.corpora.split(','):
            continue
        data = np.fromfile(path[:-5] + '.f32', dtype=np.float32)
        at = 0
        classes = {}
        # Walk every class to keep the file offsets right, even when --classes trains a subset.
        for kind in ALL_KIT:
            c = meta['classes'][kind]
            width = len(c['features'])
            n = c['count']
            block = data[at:at + n * width].reshape(n, width)
            at += n * width
            if kind not in KIT:
                continue
            classes[kind] = {**c, 'X': block}
            if args.labels == 'strict':
                # Aligned MIDI marks pedal hats and soft strokes that are often inaudible: those still neither teach nor count.
                noisy_corpus = meta['corpus'] in args.noisy.split(',')
                classes[kind]['labels'] = [-1 if noisy_corpus and light < 0 else strict for light, strict in zip(c['labels'], c['strictLabels'])]
            if (args.score or args.labels) == 'strict':
                classes[kind].update(references=c['strictReferences'], optional=[])
            if f"{meta['corpus']}:{kind}" in args.ignore.split(','):
                classes[kind].update(labels=[-1] * len(c['labels']), excluded=True)
        if at != data.size:
            raise SystemExit(f'{path}: feature block size mismatch')
        held = meta.get('heldOut', False) and not args.train_held_out
        tracks.append({'corpus': meta['corpus'], 'name': meta['name'], 'heldOut': held, 'variantOf': meta.get('variantOf'),
            'revision': meta.get('candidateRevision'), 'classes': classes})
    return tracks


def matches(ref, est):
    if not len(ref) or not len(est):
        return 0, np.full(len(est), False)
    rows, cols = [], []
    j0 = 0
    for i, r in enumerate(ref):
        while j0 < len(est) and est[j0] < r - WINDOW - 1e-9:
            j0 += 1
        j = j0
        while j < len(est) and est[j] <= r + WINDOW + 1e-9:
            rows.append(i)
            cols.append(j)
            j += 1
    if not rows:
        return 0, np.full(len(est), False)
    graph = csr_matrix((np.ones(len(rows)), (rows, cols)), shape=(len(ref), len(est)))
    pairs = maximum_bipartite_matching(graph, perm_type='column')
    used = np.full(len(est), False)
    used[pairs[pairs >= 0]] = True
    return int((pairs >= 0).sum()), used


def read_select_gap():
    """The analyser owns this: a copy that drifted would choose an operating point it cannot honour."""
    here = os.path.dirname(os.path.abspath(__file__))
    source = open(os.path.join(here, '..', '..', 'packages', 'analysis', 'src', 'striker.ts'), encoding='utf-8').read()
    body = re.search(r'const SELECT_GAP_S: Record<StrikerKind, number> = \{(.*?)\};', source, re.S)
    gaps = {k: float(v) for k, v in re.findall(r'(\w+):\s*([\d.]+)', body.group(1))}
    if set(gaps) != set(ALL_KIT):
        raise SystemExit(f'SELECT_GAP_S in striker.ts names {sorted(gaps)}, not the drum classes')
    return gaps


SELECT_GAP = read_select_gap()


def select(times, probs, threshold, kind):
    # Mirrors runStriker: most probable first, ties by time, nothing within the class gap of a chosen hit.
    gap = SELECT_GAP[kind]
    order = sorted(np.nonzero(probs >= threshold)[0], key=lambda i: (-probs[i], times[i]))
    chosen, kept = [], []
    for i in order:
        at = bisect.bisect_left(kept, times[i])
        if (at < len(kept) and kept[at] - times[i] < gap) or (at and times[i] - kept[at - 1] < gap):
            continue
        kept.insert(at, times[i])
        chosen.append(i)
    return np.sort(np.array(chosen, dtype=int))


def score(entry, probs, threshold, kind):
    times = np.asarray(entry['times'])
    chosen = select(times, probs, threshold, kind) if len(times) else np.array([], dtype=int)
    est = times[chosen] if len(chosen) else np.array([])
    ref = np.asarray(entry['references'])
    tp, used = matches(ref, est)
    rest = est[~used] if len(est) else est
    absorbed, _ = matches(np.asarray(entry['optional']), rest)
    return tp, len(rest) - absorbed, len(ref) - tp


def prf(tp, fp, fn):
    p = tp / (tp + fp) if tp + fp else 1.0
    r = tp / (tp + fn) if tp + fn else 1.0
    return p, r, (2 * p * r / (p + r) if p + r else 0.0)


def flatten(node, tree, columns):
    # LightGBM numbers splits over the columns it was given, which are `keep`; the analyser indexes
    # the full feature list, so a model trained without some features still has to name the rest.
    if 'leaf_value' in node:
        tree['leaf'].append(node['leaf_value'])
        return ~(len(tree['leaf']) - 1)
    if node['decision_type'] != '<=':
        raise SystemExit('unsupported split')
    index = len(tree['feature'])
    tree['feature'].append(columns[node['split_feature']])
    tree['threshold'].append(node['threshold'])
    tree['left'].append(0)
    tree['right'].append(0)
    tree['left'][index] = flatten(node['left_child'], tree, columns)
    tree['right'][index] = flatten(node['right_child'], tree, columns)
    return index


def export(models, thresholds, names, name, recipe):
    classes = {}
    for kind in KIT:
        trees = []
        members = models[kind].models
        for member in members:
            for info in member.dump_model()['tree_info']:
                tree = {'feature': [], 'threshold': [], 'left': [], 'right': [], 'leaf': []}
                flatten(info['tree_structure'], tree, keep)
                if len(members) > 1:
                    tree['leaf'] = [value / len(members) for value in tree['leaf']]
                trees.append(tree)
        classes[kind] = {'threshold': thresholds[kind], 'trees': trees}
    # The content hash tells analyses made with a different model apart, even under the same name.
    digest = hashlib.sha256(json.dumps(classes, sort_keys=True).encode()).hexdigest()[:8]
    return {'version': f'{name} ({digest})', 'recipe': recipe, 'candidates': candidate_revision, 'features': names,
        'classes': classes}


if args.seeds < 1:
    raise SystemExit('--seeds must be at least 1')
tracks = load()
if not tracks:
    raise SystemExit(f'no candidate files for {args.corpora or "any corpus"} in {root}')
revisions = {t['revision'] for t in tracks}
if len(revisions) != 1 or None in revisions:
    raise SystemExit(f'candidate files carry revisions {sorted(map(str, revisions))}; export them again with evaluate.ts')
candidate_revision = revisions.pop()
# A noisy corpus keeps a class only where ADTOF on the mix already agrees with its labels, so a
# missing MIDI part does not teach the classifier to reject real hits or count them as errors.
noisy = set(filter(None, args.noisy.split(',')))
if noisy & {t['corpus'] for t in tracks}:
    runs_root = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..', 'reports', 'drumeval', 'runs')
    agreement = {}
    for run in filter(None, args.agreement_runs.split(',')):
        for path in glob.glob(os.path.join(runs_root, run, 'tracks', '*.json')):
            result = json.load(open(path))
            for kind in ALL_KIT[:3]:
                d = result['scores']['model'][kind]['light']
                agreement[(result['corpus'], result['name'], kind)] = 2 * d['tp'] / max(1, 2 * d['tp'] + d['fp'] + d['fn'])
    kept = 0
    for t in tracks:
        if t['corpus'] not in noisy:
            continue
        for kind in KIT:
            # Cymbals are vetted with the hats and toms with the snares they are notated beside.
            f = agreement.get((t['corpus'], t['name'], {'cymbal': 'hat', 'tom': 'snare'}.get(kind, kind)))
            if f is None:
                raise SystemExit(f'no agreement score for {t["corpus"]}/{t["name"]}; pass --agreement-runs')
            entry = t['classes'][kind]
            if f >= args.min_agreement:
                kept += 1
                continue
            entry['labels'] = [-1] * len(entry['labels'])
            entry['excluded'] = True
    print(f'noisy corpora {sorted(noisy)}: kept {kept} class labels of {sum(len(KIT) for t in tracks if t["corpus"] in noisy)}')
names = list(tracks[0]['classes'][KIT[0]]['features'])
drop = set(filter(None, args.drop.split(',')))
keep = [i for i, n in enumerate(names) if n not in drop]
train_tracks = [t for t in tracks if not t['heldOut'] and not t['variantOf']]
print(f'{len(tracks)} tracks ({len(train_tracks)} trainable) from {sorted(set(t["corpus"] for t in train_tracks))}')
corpora = sorted(set(t['corpus'] for t in train_tracks))
params = dict(objective='binary', learning_rate=args.learning_rate, num_leaves=args.leaves,
    min_data_in_leaf=args.min_leaf, feature_fraction=0.8,
    bagging_fraction=0.8, bagging_freq=1, lambda_l2=1.0, verbose=-1, seed=args.seed, num_threads=args.threads, deterministic=True)
# Finer than the old 0.05 grid, and reaching lower: electronic material wants a lower threshold
# than acoustic, and neighbouring steps on the coarse grid often scored alike anyway.
thresholds_grid = np.round(np.arange(0.15, 0.851, 0.025), 3)


def key(t):
    return (t['corpus'], t['name'])


def recording(t):
    return (t['variantOf'] or t['corpus'], t['name'])


def track_folds(members, folds):
    # Folds by recording, so a variant always shares its original's fold.
    rng = np.random.default_rng(args.seed)
    fold_of = {}
    for corpus in sorted(set(recording(t)[0] for t in members)):
        names = list(dict.fromkeys(recording(t)[1] for t in members if recording(t)[0] == corpus))
        for rank, index in enumerate(rng.permutation(len(names))):
            fold_of[(corpus, names[index])] = rank % folds
    return {key(t): fold_of[recording(t)] for t in members}


def train(members, kind):
    X = np.concatenate([t['classes'][kind]['X'][:, keep] for t in members])
    y = np.concatenate([np.asarray(t['classes'][kind]['labels']) for t in members])
    sizes = {}
    for t in members:
        sizes[t['corpus']] = sizes.get(t['corpus'], 0) + len(t['classes'][kind]['labels'])
    extra = dict(pair.split(':') for pair in filter(None, args.weight.split(',')))
    w = np.concatenate([np.full(len(t['classes'][kind]['labels']),
        sizes[t['corpus']] ** -args.balance * float(extra.get(t['corpus'], 1.0))) for t in members])
    mask = y >= 0
    return Ensemble([lgb.train({**params, 'seed': args.seed + k}, lgb.Dataset(X[mask], y[mask], weight=w[mask] / w[mask].mean()),
        num_boost_round=args.rounds) for k in range(args.seeds)])


class Ensemble:
    # Averaged log-odds, as the exported trees with leaves divided by the member count sum them.
    def __init__(self, models):
        self.models = models

    def predict(self, X):
        raw = np.mean([m.predict(X, raw_score=True) for m in self.models], axis=0)
        return 1 / (1 + np.exp(-raw))

    def feature_importance(self, importance_type):
        return np.sum([m.feature_importance(importance_type) for m in self.models], axis=0)


def predict(model, t, kind):
    X = t['classes'][kind]['X'][:, keep]
    return model.predict(X) if len(X) else np.zeros(0)


def out_of_fold(members, kind, fold_of, folds):
    probs, models = {}, {}
    for fold in range(folds):
        models[fold] = train([t for t in members if fold_of[key(t)] != fold], kind)
        for t in members:
            if fold_of[key(t)] == fold:
                probs[key(t)] = predict(models[fold], t, kind)
    return probs, models


def tally(members, kind, probs, threshold):
    acc = {}
    for t in members:
        entry = t['classes'][kind]
        if entry.get('excluded') or (all(label < 0 for label in entry['labels']) and not entry['references']):
            continue
        tp, fp, fn = score(entry, probs[key(t)], threshold if np.isscalar(threshold) else threshold[t['corpus']], kind)
        for group in (t['corpus'], 'held-out' if t['heldOut'] or t['variantOf'] else 'trainable'):
            a = acc.setdefault(group, [0, 0, 0, 0.0, 0])
            a[0] += tp
            a[1] += fp
            a[2] += fn
            if tp + fn:
                a[3] += prf(tp, fp, fn)[2]
                a[4] += 1
    return acc


def best_threshold(members, kind, probs):
    # By default each corpus counts equally, so the largest corpus does not set the operating point for every style.
    # --threshold-corpora narrows that vote to corpora whose annotations are complete: where a corpus's labels
    # miss real hits, every one of them scores as a false positive and the operating point is pushed up to hide
    # them, which then costs recall on the corpora that are annotated properly. --threshold-classes limits the
    # narrowing to the classes it is true of; aligned MIDI misses soft strokes, which are snares, not kicks.
    classes = set(filter(None, args.threshold_classes.split(',')))
    wanted = set(filter(None, args.threshold_corpora.split(','))) if not classes or kind in classes else set()

    def objective(th):
        rows = tally(members, kind, probs, th)
        if args.threshold_by == 'pooled':
            return prf(*rows['trainable'][:3])[2]
        scored = [prf(*a[:3])[2] for group, a in rows.items()
                  if group not in ('trainable', 'held-out') and (not wanted or group in wanted)]
        if not scored:
            raise SystemExit(f'--threshold-corpora matches no corpus scoring {kind} in this fold')
        return np.mean(scored)
    return float(max(thresholds_grid, key=objective))


def report(kind, rows, thresholds):
    print(f'\n== {kind}: threshold {thresholds}')
    out = {'threshold': thresholds, 'groups': {}}
    for group, a in sorted(rows.items()):
        p, r, f = prf(*a[:3])
        out['groups'][group] = {'p': p, 'r': r, 'f': f, 'trackMeanF': a[3] / max(1, a[4]), 'tp': a[0], 'fp': a[1], 'fn': a[2]}
        print(f'{group:>10}: P {p:.3f} R {r:.3f} F {f:.3f}  track-mean {a[3] / max(1, a[4]):.3f}  tp {a[0]} fp {a[1]} fn {a[2]}')
    return out


# Track folds (default): every trainable track is scored by a model that never saw it, and one threshold per
# class is chosen on those scores. Leave-one-corpus-out (--loco): each corpus is scored by a model trained on the
# other corpora, with a threshold chosen by inner track folds on those corpora only, so nothing about the scored
# corpus reaches its model: the cross-dataset protocol.
left_out = [c for c in corpora if not args.loco_corpora or c in args.loco_corpora.split(',')]
folds = len(left_out) if args.loco else args.folds
variants = [t for t in tracks if t['variantOf'] and not t['heldOut']]
fold_of = ({key(t): left_out.index(recording(t)[0]) for t in train_tracks + variants if recording(t)[0] in left_out}
    if args.loco else track_folds(train_tracks + variants, folds))
fold_models = {k: {} for k in range(folds)}
fold_thresholds = {k: {} for k in range(folds)}
final_models, final_thresholds, summary = {}, {}, {}
for kind in KIT:
    probs = {}
    learners = train_tracks + (variants if kind in variant_kinds else [])
    if args.loco:
        for fold, corpus in enumerate(left_out):
            members = [t for t in learners if recording(t)[0] != corpus]
            inner_folds = min(args.folds, 3)
            inner, _ = out_of_fold(members, kind, track_folds(members, inner_folds), inner_folds)
            fold_thresholds[fold][kind] = best_threshold([t for t in members if not t['variantOf']], kind, inner)
            fold_models[fold][kind] = train(members, kind)
            for t in train_tracks + variants:
                if fold_of.get(key(t)) == fold:
                    probs[key(t)] = predict(fold_models[fold][kind], t, kind)
            print(f'{kind} without {corpus}: threshold {fold_thresholds[fold][kind]}', flush=True)
        per_corpus = {corpus: fold_thresholds[fold][kind] for fold, corpus in enumerate(left_out)}
        final_thresholds[kind] = best_threshold([t for t in train_tracks if key(t) in probs], kind, probs)
    else:
        probs, models = out_of_fold(learners, kind, fold_of, folds)
        for fold in range(folds):
            fold_models[fold][kind] = models[fold]
        for t in variants:
            if key(t) in fold_of and key(t) not in probs:
                probs[key(t)] = predict(models[fold_of[key(t)]], t, kind)
        final_thresholds[kind] = best_threshold(train_tracks, kind, probs)
        per_corpus = None
        for fold in range(folds):
            fold_thresholds[fold][kind] = final_thresholds[kind]
    final_models[kind] = train(learners, kind)
    held = [t for t in tracks if key(t) not in probs]
    for t in held:
        probs[key(t)] = predict(final_models[kind], t, kind)
    thresholds = {**{c: final_thresholds[kind] for c in corpora}, **(per_corpus or {}),
        **{t['corpus']: final_thresholds[kind] for t in held}}
    for t in variants:
        thresholds[t['corpus']] = per_corpus[t['variantOf']] if per_corpus and t['variantOf'] in per_corpus else final_thresholds[kind]
    rows = tally(tracks, kind, probs, thresholds)
    summary[kind] = report(kind, rows, per_corpus or final_thresholds[kind])
    if not args.loco:
        curve = ' '.join(f'{th}:{prf(*tally(train_tracks, kind, probs, th)["trainable"][:3])[2]:.3f}' for th in thresholds_grid)
        print(f'   trainable F by threshold: {curve}')
    gain = final_models[kind].feature_importance('gain')
    top = np.argsort(-gain)[:12]
    print('   top features: ' + ', '.join(f'{names[keep[i]]} {gain[i] / gain.sum():.2f}' for i in top))

if args.out:
    os.makedirs(args.out, exist_ok=True)
    protocol = 'loco' if args.loco else 'cv'
    recipe = f'{args.candidates}-{"-".join(corpora)}-r{args.rounds}-l{args.leaves}-s{args.seeds}'
if args.drop:
    recipe += f'-drop{len(names) - len(keep)}'
if args.threshold_corpora:
    recipe += '-thr' + (args.threshold_classes or 'all')
    for fold in range(folds):
        label = f'without-{left_out[fold]}' if args.loco else f'fold{fold}'
        json.dump(export(fold_models[fold], fold_thresholds[fold], names, f'{args.name} {label}', f'{recipe}-{label}'),
            open(os.path.join(args.out, f'fold-{fold}.json'), 'w'))
    json.dump({f'{c}/{n}': k for (c, n), k in fold_of.items()}, open(os.path.join(args.out, 'folds.json'), 'w'), indent=1)
    json.dump(export(final_models, final_thresholds, names, args.name, recipe), open(os.path.join(args.out, 'model.json'), 'w'))
    # Record the whole recipe: a comparison between two runs is only readable if each says what it was.
    json.dump({'protocol': protocol, 'args': vars(args), 'classes': summary},
        open(os.path.join(args.out, 'report.json'), 'w'), indent=1)
    for kind in KIT:
        t = train_tracks[0]
        X = t['classes'][kind]['X'][:, keep][:5]
        print(f'parity probe {kind} {t["corpus"]}/{t["name"]}: {[round(float(v), 9) for v in final_models[kind].predict(X)]}')
    print(f'wrote {args.out}')
