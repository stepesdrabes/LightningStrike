# PyTorch reference for the MDX23C kit stage: splits cached drumeval stereo drum stems
# (drums-stereo44.f32) into mdx-<stem>44.f32 with Music-Source-Separation-Training's demix.
# Loads weights without pickle code execution; needs CUDA.
#   python bench/lab/mdx23c-reference.py --ckpt=... --config=... --model-code=DIR --dirs=bench/reports/drumeval/evidence/library/*
import argparse
import glob
import json
import os
import sys
import time
import types

import numpy as np
import torch
import torch.nn as nn
import yaml

here = os.path.dirname(os.path.abspath(__file__))
parser = argparse.ArgumentParser()
parser.add_argument('--ckpt', required=True)
parser.add_argument('--config', required=True)
parser.add_argument('--model-code', required=True, help='directory holding mdx23c_tfc_tdf_v3.py')
parser.add_argument('--dirs', nargs='+', required=True)
parser.add_argument('--overlap', type=int, default=4)
parser.add_argument('--force', action='store_true')
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
model = TFC_TDF_net(config)
state = torch.load(args.ckpt, map_location='cpu', weights_only=True)
if isinstance(state, dict) and 'state_dict' in state:
    state = state['state_dict']
missing, unexpected = model.load_state_dict(state, strict=False)
if missing or unexpected:
    raise SystemExit(f'checkpoint mismatch: missing {missing[:5]} unexpected {unexpected[:5]}')
device = torch.device('cuda')
model = model.to(device).eval()
instruments = list(config.training.instruments)
chunk = config.audio.chunk_size


def windowing(size, fade):
    w = torch.ones(size)
    w[:fade] = torch.linspace(0, 1, fade)
    w[-fade:] = torch.linspace(1, 0, fade)
    return w


@torch.inference_mode()
def demix(mix):
    # Mirrors Music-Source-Separation-Training's generic demix for MDX23C.
    mix = torch.from_numpy(mix)
    step = chunk // args.overlap
    border = chunk - step
    fade = chunk // 10
    length = mix.shape[-1]
    padded = length > 2 * border and border > 0
    if padded:
        mix = nn.functional.pad(mix[None], (border, border), mode='reflect')[0]
    window = windowing(chunk, fade)
    result = torch.zeros((len(instruments),) + tuple(mix.shape))
    counter = torch.zeros_like(result)
    i = 0
    while i < mix.shape[1]:
        part = mix[:, i:i + chunk]
        n = part.shape[-1]
        mode = 'reflect' if n > chunk // 2 else 'constant'
        part = nn.functional.pad(part[None], (0, chunk - n), mode=mode)[0] if n < chunk else part
        with torch.autocast('cuda', dtype=torch.float16):
            x = model(part[None].to(device)).float().cpu()[0]
        w = window.clone()
        if i == 0:
            w[:fade] = 1
        if i + step >= mix.shape[1]:
            w[-fade:] = 1
        result[..., i:i + n] += x[..., :n] * w[:n]
        counter[..., i:i + n] += w[:n]
        i += step
    out = result / counter.clamp_min(1e-8)
    if padded:
        out = out[..., border:-border]
    return out.numpy()


for pattern in args.dirs:
    for directory in sorted(glob.glob(pattern)):
        source = os.path.join(directory, 'drums-stereo44.f32')
        marker = os.path.join(directory, 'mdx23c.json')
        if not os.path.exists(source) or (os.path.exists(marker) and not args.force):
            continue
        started = time.time()
        planar = np.fromfile(source, dtype=np.float32)
        frames = planar.size // 2
        stereo = np.stack([planar[:frames], planar[frames:]])
        estimate = demix(stereo)
        for index, name in enumerate(instruments):
            mono = estimate[index].mean(axis=0).astype(np.float32)
            mono.tofile(os.path.join(directory, f'mdx-{name}44.f32'))
        json.dump({'model': os.path.basename(args.ckpt), 'instruments': instruments, 'overlap': args.overlap,
            'seconds': time.time() - started, 'frames': int(frames)}, open(marker, 'w'), indent=1)
        print(f'{directory}: {frames / 44100:.1f} s audio in {time.time() - started:.1f} s', flush=True)
