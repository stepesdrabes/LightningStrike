"""Compare Node FFT/reconstruction and one ONNX forward with the original checkpoint."""
import argparse
import json
from pathlib import Path
import time
import numpy as np
import torch
from demucs.states import load_model
from demucs.pretrained import get_model

p = argparse.ArgumentParser()
p.add_argument('--mode', choices=['drumsep', 'demucs'], default='drumsep')
p.add_argument('--out', type=Path, required=True)
p.add_argument('--checkpoint', type=Path, default=Path('bench/reports/audio-reliability/habibi-drumsep/model_drumsep.th'))
p.add_argument('--fft-only', action='store_true')
a = p.parse_args()
torch.set_num_threads(4)
torch.manual_seed(0)
length = 1764000 if a.mode == 'drumsep' else 343980
if a.mode == 'drumsep':
    model = load_model(torch.load(a.checkpoint, map_location='cpu', weights_only=False), strict=True).eval()
else:
    model = get_model('htdemucs').models[0].eval()
print({k: getattr(model, k, None) for k in ['sources', 'hybrid', 'hybrid_old', 'cac', 'segment']}, flush=True)
x = torch.from_numpy(np.fromfile(a.out / 'input-normalized.f32', '<f4').reshape(1, 2, length))
def diff(ref, actual):
    e = ref - actual
    return {'maxAbs': float(np.max(np.abs(e))), 'rmsError': float(np.sqrt(np.mean(e * e))), 'referenceRms': float(np.sqrt(np.mean(ref * ref))), 'correlation': float(np.corrcoef(ref.ravel(), actual.ravel())[0,1])}
report = {}
with torch.inference_mode():
    if a.mode == 'drumsep':
        expected = model._magnitude(model._spec(x)).numpy()
        actual = np.fromfile(a.out / 'input-spec.f32', '<f4').reshape(expected.shape)
        report['spec'] = diff(expected, actual)
        print('spec', report['spec'], flush=True)
        f = torch.from_numpy(np.fromfile(a.out / 'output-freq.f32', '<f4').reshape(1, 4, 4, 2048, -1))
        expected = model._ispec(model._mask(None, f), length).numpy()
        actual = np.fromfile(a.out / 'output-ispec.f32', '<f4').reshape(expected.shape)
        report['ispec'] = diff(expected, actual)
        print('ispec', report['ispec'], flush=True)
    if not a.fft_only:
        start = time.perf_counter()
        expected = model(x).numpy()
        report['nativeSeconds'] = time.perf_counter() - start
        expected.astype('<f4').tofile(a.out / 'native-output.f32')
        actual = np.fromfile(a.out / 'output-time.f32', '<f4').reshape(expected.shape)
        if a.mode == 'drumsep': actual = actual + np.fromfile(a.out / 'output-ispec.f32', '<f4').reshape(expected.shape)
        report['forward'] = diff(expected, actual)
        report['sources'] = {name: diff(expected[:, i], actual[:, i]) for i, name in enumerate(model.sources)}
        print(json.dumps(report, indent=2), flush=True)
(a.out / 'parity.json').write_text(json.dumps(report, indent=2))
