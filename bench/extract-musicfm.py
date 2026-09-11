# Development embedding extraction for the temporal section head; inference uses ONNX.
#
#   uv run --python 3.12 --with torch --with torchaudio --with transformers \
#     --with einops python bench/extract-musicfm.py
#
# Reads bench/corpus/{harmonix,raveform}/audio, writes bench/corpus/.musicfm/<set>-<id>.npz
# holding the layer-9 hidden states at 25 Hz mean-pooled by 3 (~8.33 Hz), float16.
import json
import subprocess
import sys
from pathlib import Path

import numpy as np
import torch

ROOT = Path(__file__).parent
REPO = ROOT.parent
sys.path.insert(0, str(REPO / 'bench' / '.musicfm-src'))

from musicfm.model.musicfm_25hz import MusicFM25Hz  # noqa: E402

OUT = ROOT / 'corpus' / '.musicfm'
OUT.mkdir(parents=True, exist_ok=True)

device = 'mps' if torch.backends.mps.is_available() else 'cpu'
print(f'device: {device}')

model = MusicFM25Hz(
    is_flash=False,
    stat_path=str(REPO / 'bench' / '.musicfm-weights' / 'msd_stats.json'),
    model_path=str(REPO / 'bench' / '.musicfm-weights' / 'pretrained_msd.pt'),
)
model = model.to(device).eval()

# Layer 9 centres the 8-10 range favoured by the local and Sony probes.
LAYER = 9
# Discard 5 s padding around 30 s windows to avoid artificial edge effects at joins.
WIN = 30 * 24000
PAD = 5 * 24000


def decode(path: Path) -> np.ndarray:
    """ffmpeg is on PATH by project requirement; torchaudio's backends are not."""
    out = subprocess.run(
        ['ffmpeg', '-v', 'error', '-i', str(path), '-ac', '1', '-ar', '24000',
         '-f', 'f32le', '-'],
        capture_output=True,
        check=True,
    )
    return np.frombuffer(out.stdout, dtype=np.float32).copy()


def embed(path: Path) -> np.ndarray:
    wav = torch.from_numpy(decode(path))

    chunks = []
    at = 0
    while at < wav.shape[0]:
        lo = max(0, at - PAD)
        hi = min(wav.shape[0], at + WIN + PAD)
        piece = wav[lo:hi]
        with torch.no_grad():
            _, hidden = model.get_predictions(piece.unsqueeze(0).to(device))
        h = hidden[LAYER].squeeze(0).float().cpu().numpy()  # [t25, 1024]
        # 25 Hz tokens: 100 mel frames -> conv /4. Drop the pad's worth of tokens.
        pad_tokens_lo = int(round((at - lo) / 24000 * 25))
        want_tokens = int(round(min(WIN, wav.shape[0] - at) / 24000 * 25))
        h = h[pad_tokens_lo : pad_tokens_lo + want_tokens]
        chunks.append(h)
        at += WIN
    seq = np.concatenate(chunks, axis=0)
    # Mean-pool by 3 to ~8.33 Hz: SongFormer's rate, and a third of the disk.
    n = (seq.shape[0] // 3) * 3
    pooled = seq[:n].reshape(-1, 3, seq.shape[1]).mean(axis=1)
    return pooled.astype(np.float16)


def run(dataset: str, limit: int = 0) -> None:
    audio = ROOT / 'corpus' / dataset / 'audio'
    if not audio.exists():
        print(f'{dataset}: no audio dir')
        return
    files = sorted(audio.iterdir())
    if limit > 0:
        files = files[:limit]
    done = 0
    for f in files:
        if f.suffix.lower() not in ('.mp3', '.m4a', '.wav', '.flac', '.ogg', '.opus'):
            continue
        out = OUT / f'{dataset}-{f.stem}.npz'
        if out.exists():
            continue
        try:
            emb = embed(f)
            np.savez_compressed(out, emb=emb, fps=8.333333)
            done += 1
            print(f'[{done}] {dataset}/{f.stem}: {emb.shape[0]} frames')
        except Exception as e:  # noqa: BLE001 - one bad decode must not kill the corpus
            print(f'{dataset}/{f.stem}: {e}')
    print(f'{dataset} complete')


json.dump({'layer': LAYER, 'poolTo': 3, 'dim': 1024}, open(OUT / 'config.json', 'w'))
limit = int(sys.argv[sys.argv.index('--limit') + 1]) if '--limit' in sys.argv else 0
run('harmonix', limit)
run('raveform', limit)
