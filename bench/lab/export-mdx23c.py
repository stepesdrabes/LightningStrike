# Export jarredou's MDX23C 5-stem DrumSep core (without STFT) to ONNX for onnxruntime.
#   python bench/lab/export-mdx23c.py --ckpt=... --config=... --model-code=DIR --out=models/drumsep-mdx23c.onnx
#     [--frames=1024] [--bench]
# bench/setup-drum-separation.py runs this with pinned sources; production feeds 1024 frames.
# Input `spec` [1, 4, 1024, frames]: stereo STFT real/imaginary channels (n_fft 2048, hop 512,
# periodic Hann, centred), bins 0-1023. Output `sources` [1, 5, 4, 1024, frames] in the same layout for
# kick, snare, toms, hi-hat, cymbals. Weights are CC BY-NC-SA; keep the export local.
import argparse
import sys
import time
import types

import numpy as np
import torch
import torch.nn as nn
import yaml

parser = argparse.ArgumentParser()
parser.add_argument('--ckpt', required=True)
parser.add_argument('--config', required=True)
parser.add_argument('--model-code', required=True)
parser.add_argument('--out', required=True)
parser.add_argument('--frames', type=int, default=1024)
parser.add_argument('--bench', action='store_true')
args = parser.parse_args()


class Config(dict):
    def __getattr__(self, name):
        value = self[name]
        return Config(value) if isinstance(value, dict) else value

    def get(self, name, default=None):
        value = dict.get(self, name, default)
        return Config(value) if isinstance(value, dict) else value


utils = types.ModuleType('utils')
model_utils = types.ModuleType('utils.model_utils')
model_utils.prefer_target_instrument = lambda config: (
    [config.training.target_instrument] if config.training.get('target_instrument') else config.training.instruments)
sys.modules['utils'] = utils
sys.modules['utils.model_utils'] = model_utils
sys.path.insert(0, args.model_code)
from mdx23c_tfc_tdf_v3 import TFC_TDF_net  # noqa: E402

config = Config(yaml.safe_load(open(args.config)))
net = TFC_TDF_net(config)
state = torch.load(args.ckpt, map_location='cpu', weights_only=True)
missing, unexpected = net.load_state_dict(state, strict=False)
if missing or unexpected:
    raise SystemExit(f'checkpoint mismatch: {missing[:3]} {unexpected[:3]}')
net.eval()


class Core(nn.Module):
    """TFC_TDF_net.forward between its STFT and inverse STFT."""

    def __init__(self, inner):
        super().__init__()
        self.inner = inner

    def forward(self, spec):
        n = self.inner
        x = n.cac2cws(spec)
        mix = x
        first = x = n.first_conv(x)
        x = x.transpose(-1, -2)
        skips = []
        for block in n.encoder_blocks:
            x = block.tfc_tdf(x)
            skips.append(x)
            x = block.downscale(x)
        x = n.bottleneck_block(x)
        for block in n.decoder_blocks:
            x = block.upscale(x)
            x = torch.cat([x, skips.pop()], 1)
            x = block.tfc_tdf(x)
        x = x.transpose(-1, -2)
        x = x * first
        x = n.final_conv(torch.cat([mix, x], 1))
        x = n.cws2cac(x)
        b, c, f, t = x.shape
        return x.reshape(b, n.num_target_instruments, -1, f, t)


core = Core(net).eval()
example = torch.randn(1, 4, 1024, args.frames)
with torch.no_grad():
    reference = core(example)
torch.onnx.export(core, (example,), args.out, input_names=['spec'], output_names=['sources'], opset_version=17,
    dynamo=False)
print('exported', args.out, tuple(reference.shape))

import onnxruntime as ort  # noqa: E402

options = ort.SessionOptions()
options.intra_op_num_threads = 6
session = ort.InferenceSession(args.out, options, providers=['CPUExecutionProvider'])
out = session.run(None, {'spec': example.numpy()})[0]
print('max abs diff vs torch', float(np.abs(out - reference.numpy()).max()))
if args.bench:
    for _ in range(2):
        start = time.time()
        session.run(None, {'spec': example.numpy()})
        seconds = time.time() - start
        audio = args.frames * 512 / 44100
        print(f'CPU 6 threads: {seconds:.2f} s for {audio:.2f} s of audio ({audio / seconds:.2f}x real time without overlap)')
