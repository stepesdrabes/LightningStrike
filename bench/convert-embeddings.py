# Convert float16 corpus embeddings to raw f32 for the TS head-gate harness.
# Outputs stay gitignored beside the source .npz files in bench/corpus/.musicfm.
#
#   uv run --python 3.12 --with numpy python bench/convert-embeddings.py
import json
from pathlib import Path

import numpy as np

SRC = Path(__file__).parent / 'corpus' / '.musicfm'
DST = SRC / 'bin'
DST.mkdir(exist_ok=True)

manifest = {}
done = 0
for f in sorted(SRC.glob('*.npz')):
    out = DST / f'{f.stem}.bin'
    d = np.load(f)
    emb = d['emb'].astype(np.float32)
    if not out.exists():
        emb.tofile(out)
    manifest[f.stem] = list(emb.shape)
    done += 1
json.dump(manifest, open(DST / 'manifest.json', 'w'), indent=1)
print(f'{done} tracks converted into {DST}')
