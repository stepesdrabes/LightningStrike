# Development training for the temporal section head, evaluated with track-grouped CV.
#
#   uv run --python 3.12 --with torch --with numpy python bench/train-sectionhead.py
#
# Reads extract-musicfm.py's .npz embeddings and both annotation sets. Reports five-fold
# CV, fits all tracks, and writes bench/corpus/.musicfm/sectionhead.pt + sectionhead.json.
import json
import re
from pathlib import Path

import numpy as np
import torch
from torch import nn

ROOT = Path(__file__).parent
EMB = ROOT / 'corpus' / '.musicfm'
FPS = 25 / 3

KINDS = ['intro', 'groove', 'verse', 'build', 'drop', 'chorus', 'breakdown', 'void', 'outro']
KIND_INDEX = {k: i for i, k in enumerate(KINDS)}

KIND_SONG = {
    'intro': 'intro', 'fadein': 'intro', 'outro': 'outro', 'fadeout': 'outro', 'end': 'outro',
    'verse': 'verse', 'rap': 'verse', 'bridge': 'breakdown', 'inst': 'groove',
    'instrumental': 'groove', 'solo': 'groove', 'gtr': 'groove', 'section': 'groove',
    'chorus': 'chorus', 'altchorus': 'chorus', 'postchorus': 'chorus', 'instchorus': 'chorus',
    'prechorus': 'build', 'build': 'build', 'transition': 'build', 'break': 'breakdown',
    'breakdown': 'breakdown', 'quiet': 'breakdown', 'silence': 'void',
}
RAVEFORM_KIND = {
    'intro': 'intro', 'ambient intro': 'intro', 'buildup': 'build', 'breakdown': 'breakdown',
    'drop': 'drop', 'cooldown': 'breakdown', 'bridge': 'breakdown', 'outro': 'outro',
    'ambient outro': 'outro',
}


def harmonix_spans(track_id: str):
    seg = ROOT / 'corpus' / 'harmonixset-main' / 'dataset' / 'segments' / f'{track_id}.txt'
    if not seg.exists():
        return None
    rows = []
    for line in seg.read_text().splitlines():
        parts = line.split()
        if len(parts) < 2:
            continue
        label = re.sub(r'[0-9_]+$', '', parts[1].lower())
        rows.append((float(parts[0]), KIND_SONG.get(label)))
    spans = []
    for i in range(len(rows) - 1):
        if rows[i][1]:
            spans.append((rows[i][0], rows[i + 1][0], rows[i][1]))
    return spans or None


RAVE = None


def raveform_spans(track_id: str):
    global RAVE
    if RAVE is None:
        data = json.load(open(ROOT / 'corpus' / 'raveform' / 'structures' / 'segments.json'))
        RAVE = {e['key']: e.get('sections', []) for e in data}
    sections = RAVE.get(track_id)
    if not sections:
        return None
    spans = []
    for s in sections:
        kind = RAVEFORM_KIND.get(s['name'].lower())
        if kind:
            spans.append((s['start'], s['end'], kind))
    return spans or None


def load_tracks():
    tracks = []
    for f in sorted(EMB.glob('*.npz')):
        dataset, _, track_id = f.stem.partition('-')
        spans = harmonix_spans(track_id) if dataset == 'harmonix' else raveform_spans(track_id)
        if spans is None:
            continue
        emb = np.load(f)['emb'].astype(np.float32)
        labels = np.full(emb.shape[0], -1, dtype=np.int64)
        for start, end, kind in spans:
            lo = int(round(start * FPS))
            hi = min(emb.shape[0], int(round(end * FPS)))
            labels[lo:hi] = KIND_INDEX[kind]
        if (labels >= 0).sum() < FPS * 30:
            continue
        tracks.append({'id': f.stem, 'dataset': dataset, 'emb': emb, 'labels': labels})
    return tracks


class SectionHead(nn.Module):
    """Two-layer transformer at 25/3 Hz; append position so intro/outro can observe the clock."""

    def __init__(self, dim=1024, width=256, classes=len(KINDS)):
        super().__init__()
        self.proj = nn.Linear(dim + 1, width)
        layer = nn.TransformerEncoderLayer(
            d_model=width, nhead=4, dim_feedforward=512, dropout=0.1,
            batch_first=True, norm_first=True, activation='gelu',
        )
        self.encoder = nn.TransformerEncoder(layer, num_layers=2)
        self.out = nn.Linear(width, classes)

    def forward(self, x):  # [b, t, dim+1]
        h = self.proj(x)
        h = self.encoder(h)
        return self.out(h)


def with_position(emb: np.ndarray) -> np.ndarray:
    pos = np.linspace(0, 1, emb.shape[0], dtype=np.float32)[:, None]
    return np.concatenate([emb, pos], axis=1)


def train_one(train, device, epochs=8, seed=0):
    torch.manual_seed(seed)
    model = SectionHead().to(device)
    counts = np.zeros(len(KINDS))
    for t in train:
        for k in range(len(KINDS)):
            counts[k] += (t['labels'] == k).sum()
    weights = 1 / np.sqrt(np.maximum(counts, 1))
    weights = weights / weights.sum() * len(KINDS)
    loss_fn = nn.CrossEntropyLoss(
        weight=torch.tensor(weights, dtype=torch.float32).to(device), ignore_index=-1
    )
    opt = torch.optim.AdamW(model.parameters(), lr=3e-4, weight_decay=0.01)
    order = np.arange(len(train))
    rng = np.random.default_rng(seed)
    for epoch in range(epochs):
        rng.shuffle(order)
        total = 0.0
        for i in order:
            t = train[i]
            x = torch.from_numpy(with_position(t['emb'])).unsqueeze(0).to(device)
            y = torch.from_numpy(t['labels']).unsqueeze(0).to(device)
            logits = model(x)
            loss = loss_fn(logits.reshape(-1, len(KINDS)), y.reshape(-1))
            opt.zero_grad()
            loss.backward()
            opt.step()
            total += float(loss)
        print(f'  epoch {epoch + 1}: loss {total / len(train):.4f}')
    return model


@torch.no_grad()
def evaluate(model, tracks, device):
    model.eval()
    hit = np.zeros(len(KINDS))
    ref = np.zeros(len(KINDS))
    est = np.zeros(len(KINDS))
    per_dataset = {}
    for t in tracks:
        x = torch.from_numpy(with_position(t['emb'])).unsqueeze(0).to(device)
        pred = model(x).argmax(-1).squeeze(0).cpu().numpy()
        mask = t['labels'] >= 0
        y = t['labels'][mask]
        p = pred[mask]
        cell = per_dataset.setdefault(t['dataset'], [0, 0])
        cell[0] += (y == p).sum()
        cell[1] += len(y)
        for k in range(len(KINDS)):
            ref[k] += (y == k).sum()
            est[k] += (p == k).sum()
            hit[k] += ((y == k) & (p == k)).sum()
    model.train()
    acc = hit.sum() / max(1, ref.sum())
    f1 = {}
    for k, name in enumerate(KINDS):
        precision = hit[k] / max(1, est[k])
        recall = hit[k] / max(1, ref[k])
        f1[name] = 2 * precision * recall / max(1e-9, precision + recall)
    macro = np.mean([f1[n] for n in KINDS if ref[KIND_INDEX[n]] > 0])
    return acc, macro, f1, {d: c[0] / max(1, c[1]) for d, c in per_dataset.items()}


def main():
    device = 'mps' if torch.backends.mps.is_available() else 'cpu'
    tracks = load_tracks()
    print(f'{len(tracks)} tracks with embeddings + annotations, device {device}')
    if len(tracks) < 20:
        print('not enough data yet - run extract-musicfm.py first')
        return

    rng = np.random.default_rng(11)
    order = rng.permutation(len(tracks))
    folds = 5
    accs, macros = [], []
    per_ds_all = {}
    for fold in range(folds):
        test_idx = set(order[fold::folds].tolist())
        train = [t for i, t in enumerate(tracks) if i not in test_idx]
        test = [t for i, t in enumerate(tracks) if i in test_idx]
        print(f'fold {fold + 1}/{folds}: train {len(train)}, test {len(test)}')
        model = train_one(train, device, seed=fold)
        acc, macro, f1, per_ds = evaluate(model, test, device)
        print(f'  acc {100 * acc:.1f}%  macroF1 {100 * macro:.1f}  ' +
              '  '.join(f'{k} {100 * v:.0f}' for k, v in f1.items()))
        print('  per-dataset: ' + '  '.join(f'{d} {100 * a:.1f}%' for d, a in per_ds.items()))
        accs.append(acc)
        macros.append(macro)
        for d, a in per_ds.items():
            per_ds_all.setdefault(d, []).append(a)

    print(f'\nCV: acc {100 * np.mean(accs):.1f}% +- {100 * np.std(accs):.1f}  '
          f'macroF1 {100 * np.mean(macros):.1f}')
    for d, a in per_ds_all.items():
        print(f'  {d}: {100 * np.mean(a):.1f}%')

    print('\nfinal fit on everything')
    model = train_one(tracks, device, epochs=10, seed=99)
    torch.save(model.state_dict(), EMB / 'sectionhead.pt')
    json.dump(
        {'kinds': KINDS, 'dim': 1024, 'width': 256, 'layers': 2, 'fps': 25 / 3,
         'position_channel': True},
        open(EMB / 'sectionhead.json', 'w'), indent=1,
    )
    print('saved sectionhead.pt')


main()
