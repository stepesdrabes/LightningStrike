"""Isolated Demucs experiment; writes diagnostics outside the audio library."""
import argparse
import hashlib
import json
from pathlib import Path
import subprocess
import time

import numpy as np
import torch
from demucs.apply import apply_model
from demucs.pretrained import get_model

parser = argparse.ArgumentParser()
parser.add_argument("audio", type=Path)
parser.add_argument("--out", type=Path, required=True)
parser.add_argument("--from", dest="start", type=float, default=0)
parser.add_argument("--seconds", type=float)
parser.add_argument("--device", default="cpu")
args = parser.parse_args()
args.out.mkdir(parents=True, exist_ok=True)
torch.set_num_threads(4)
torch.manual_seed(0)
cmd = ["ffmpeg", "-nostdin", "-v", "error", "-i", str(args.audio), "-ss", str(args.start)]
if args.seconds:
    cmd += ["-t", str(args.seconds)]
cmd += ["-ar", "44100", "-ac", "2", "-f", "f32le", "-"]
raw = subprocess.run(cmd, check=True, capture_output=True).stdout
pcm = np.frombuffer(raw, dtype="<f4").reshape(-1, 2).T.copy()
wav = torch.from_numpy(pcm)
model = get_model("htdemucs")
model.eval()
ref = wav.mean(0)
mean, std = ref.mean(), ref.std()
started = time.perf_counter()
with torch.inference_mode():
    estimates = apply_model(model, ((wav - mean) / std)[None], device=args.device,
                            shifts=0, split=True, overlap=0.25, progress=True)[0]
    estimates = estimates * std + mean
elapsed = time.perf_counter() - started
for name, stem in zip(model.sources, estimates):
    stem.mean(0).cpu().numpy().astype("<f4").tofile(args.out / f"{name}.f32")
pcm.mean(0).astype("<f4").tofile(args.out / "mix.f32")
(args.out / "manifest.json").write_text(json.dumps({
    "audio": str(args.audio.resolve()), "sha256": hashlib.sha256(args.audio.read_bytes()).hexdigest(),
    "from": args.start, "seconds": pcm.shape[1] / 44100, "sampleRate": 44100,
    "model": "htdemucs", "device": args.device, "shifts": 0, "overlap": 0.25,
    "torch": torch.__version__, "elapsedSeconds": elapsed,
}, indent=2))
print(f"Stem separation: {elapsed:.1f}s -> {args.out}")
