"""Numerical oracle for adtof-parity.ts; dependencies are isolated by uv."""
import ast
import hashlib
import json
from pathlib import Path
import sys
import urllib.request

import librosa
import numpy as np

out = Path(sys.argv[1])
manifest = json.loads((out / 'inputs.json').read_text())
sources = {
    'port': 'https://raw.githubusercontent.com/xavriley/ADTOF-pytorch/85c192e78f716ea0b111cc8a5ee4a8f6a3a4f8a9/src/adtof_pytorch/audio.py',
    'madmom': 'https://raw.githubusercontent.com/CPJKU/madmom/27f032e8947204902c675e5e341a3faf5dc86dae/madmom/audio/filters.py',
}
provenance = {}


def definitions(name, selected, namespace):
    """Run only reviewed numerical definitions, without package import side effects."""
    source = urllib.request.urlopen(sources[name]).read()
    provenance[name] = {'url': sources[name], 'sha256': hashlib.sha256(source).hexdigest()}
    tree = ast.parse(source)
    tree.body = [node for node in tree.body if isinstance(node, (ast.FunctionDef, ast.ClassDef)) and node.name in selected]
    exec(compile(tree, sources[name], 'exec'), namespace)
    return namespace


port = definitions('port', {'AudioProcessor'}, {'np': np, 'librosa': librosa})['AudioProcessor']()
madmom = definitions('madmom', {'log_frequencies', 'frequencies2bins', 'Filter', 'TriangularFilter'},
                     {'np': np, 'A4': 440., 'FILTER_DTYPE': np.float32})
targets = madmom['log_frequencies'](12, 20, 20000)
bins = madmom['frequencies2bins'](targets, np.fft.fftfreq(2048, 1 / 44100)[:1024], unique_bins=True)
triangles = madmom['TriangularFilter'].filters(bins, norm=True, overlap=True)
original_bank = np.zeros((len(triangles), 1024), dtype=np.float32)
for i, triangle in enumerate(triangles):
    original_bank[i, triangle.start:triangle.stop] = triangle
port.filterbank.tofile(out / 'port-bank.f32')
original_bank.tofile(out / 'original-bank.f32')
rows = []
for case in manifest['cases']:
    pcm = np.fromfile(out / (case['id'] + '.pcm.f32'), dtype='<f4')
    port_spec = port.apply_filterbank(port.compute_stft(pcm)).T.copy()
    port_spec.tofile(out / (case['id'] + '.port-reference.f32'))
    # Original madmom defaults: ceil(N/hop), centre at sample t*hop, symmetric
    # float64 Hann, complex64 STFT, no Nyquist, unit-area log filterbank.
    frames = int(np.ceil(len(pcm) / 441))
    padded = np.pad(pcm, (1024, 1024))
    windows = np.lib.stride_tricks.sliding_window_view(padded, 2048)[::441][:frames]
    fft = np.fft.fft(windows * np.hanning(2048), axis=1)[:, :1024].astype(np.complex64)
    magnitude = np.abs(fft)
    original_spec = np.log10(1 + magnitude @ original_bank.T).astype(np.float32)
    original_spec.tofile(out / (case['id'] + '.original-reference.f32'))
    rows.append({'id': case['id'], 'originalFrames': frames, 'portFrames': len(port_spec)})
(out / 'oracle.json').write_text(json.dumps({'sources': provenance, 'numpy': np.__version__,
    'librosa': librosa.__version__, 'originalBins': bins.tolist(), 'cases': rows}, indent=2))
