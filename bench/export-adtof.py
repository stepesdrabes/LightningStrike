# Development export: ADTOF-pytorch Frame_RNN -> optional local ONNX.
# Upstream weights are CC-BY-NC-SA; do not commit or redistribute them.
import json
import sys

import numpy as np
import torch

sys.path.insert(0, 'adtof-pytorch/src')
from adtof_pytorch.model import calculate_n_bins, create_frame_rnn_model, load_pytorch_weights  # noqa: E402
from adtof_pytorch.audio import create_adtof_processor  # noqa: E402

n_bins = calculate_n_bins()
print('n_bins =', n_bins)
model = create_frame_rnn_model(n_bins)
model = load_pytorch_weights(model, 'adtof-pytorch/data/adtof_frame_rnn_pytorch_weights.pth', strict=False)
model.eval()

T = 400
example = torch.randn(1, T, n_bins, 1)
with torch.no_grad():
    ref = model(example)
print('output shape', tuple(ref.shape))

torch.onnx.export(
    model,
    (example,),
    'adtof_frame_rnn.onnx',
    input_names=['spectrogram'],
    output_names=['activations'],
    dynamic_axes={'spectrogram': {1: 'time'}, 'activations': {1: 'time'}},
    opset_version=17,
    dynamo=False,
)
print('exported adtof_frame_rnn.onnx')

# Save the training filterbank for TS parity, including deduplicated FFT-bin triangles.
proc = create_adtof_processor()
fb = proc.filterbank  # [n_filters, n_fft_bins]
np.save('adtof_filterbank.npy', fb)

# Reference vectors for the Node-side numerics check.
rng = np.random.default_rng(7)
probe = rng.standard_normal((1, 96, n_bins, 1)).astype(np.float32)
with torch.no_grad():
    probe_out = model(torch.from_numpy(probe)).numpy()
np.save('adtof_probe_in.npy', probe)
np.save('adtof_probe_out.npy', probe_out)
json.dump(
    {
        'nBins': int(n_bins),
        'fps': 100,
        'frameSize': 2048,
        'sampleRate': 44100,
        'classes': ['kick', 'snare', 'tom', 'hat', 'cymbal'],
        'thresholds': [0.22, 0.24, 0.32, 0.22, 0.30],
    },
    open('adtof_config.json', 'w'),
    indent=1,
)
print('probe + config written')
