# Development export: Beat This! checkpoint -> the host's ONNX interface.
# CPJKU/beat_this is MIT; outputs remain uncommitted in models/.
#
#   uv run --python 3.12 --with torch --with onnx --with onnxruntime \
#     --with "beat_this @ https://github.com/CPJKU/beat_this/archive/main.zip" \
#     python bench/export-beatthis.py --checkpoint small0
#
# Compare alternative checkpoints through bench/beatscore.ts on the actual host pipeline.
import argparse
from pathlib import Path

import numpy as np
import torch
from beat_this.inference import load_model
from beat_this.model import beat_tracker

# One window per call avoids a windows x 32 x 1500 x 1500 attention allocation.
CHUNK = 1500
MEL_BINS = 128

parser = argparse.ArgumentParser()
parser.add_argument('--checkpoint', default='small0')
parser.add_argument('--out', default=None)
args = parser.parse_args()

# Both transformer forwards trace len(x) as a constant. Batch 1 matches the host contract;
# only a variable-window exporter would need to replace it with a dynamic shape read.
assert hasattr(beat_tracker, 'PartialFTTransformer'), 'upstream layout moved; re-read the forwards'

model = load_model(args.checkpoint, 'cpu')
model.eval()
params = sum(p.numel() for p in model.parameters())
print(f'{args.checkpoint}: {params} parameters ({params * 4 / 1e6:.1f} MB fp32)')


class Wrapped(torch.nn.Module):
    """The reference returns a dict; ONNX wants named outputs in a fixed order."""

    def __init__(self, inner):
        super().__init__()
        self.inner = inner

    def forward(self, spect):
        out = self.inner(spect)
        return out['beat'], out['downbeat']


wrapped = Wrapped(model).eval()
example = torch.randn(1, CHUNK, MEL_BINS)

out = Path(args.out or f'models/beat_this_{args.checkpoint}.onnx')
out.parent.mkdir(parents=True, exist_ok=True)
torch.onnx.export(
    wrapped,
    (example,),
    str(out),
    input_names=['spect'],
    output_names=['beat', 'downbeat'],
    opset_version=17,
    dynamo=False
)
print(f'wrote {out} ({out.stat().st_size / 1e6:.1f} MB)')

# Compare ONNX with torch on identical probes.
import onnxruntime as ort  # noqa: E402

session = ort.InferenceSession(str(out), providers=['CPUExecutionProvider'])
worst = 0.0
for seed in range(3):
    torch.manual_seed(seed)
    probe = torch.randn(1, CHUNK, MEL_BINS)
    with torch.no_grad():
        ref = wrapped(probe)
    got = session.run(None, {'spect': probe.numpy()})
    for a, b in zip(ref, got):
        worst = max(worst, float(np.abs(a.numpy() - b).max()))
print(f'max abs error vs torch over 3 probes: {worst:.3g}')
