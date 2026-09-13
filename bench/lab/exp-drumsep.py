"""DrumSep sub-stem feasibility probe on a previously separated diagnostic excerpt."""
import argparse
import hashlib
import json
from pathlib import Path
import time

import numpy as np
import torch
from demucs.apply import apply_model
from demucs.hdemucs import HDemucs
from demucs.states import load_model

parser = argparse.ArgumentParser()
parser.add_argument("--input", type=Path, required=True)
parser.add_argument("--model", type=Path, required=True)
parser.add_argument("--out", type=Path, required=True)
parser.add_argument("--offset", type=float, default=32)
args = parser.parse_args()
args.out.mkdir(parents=True, exist_ok=True)
torch.set_num_threads(4)
torch.manual_seed(0)
package = torch.load(args.model, map_location="cpu", weights_only=False)
print("Checkpoint keys:", list(package)[:12], flush=True)
if "klass" in package:
    model = load_model(package, strict=True)
else:
    model = HDemucs(sources=["kick", "snare", "cymbals", "toms"], channels=48)
    model.load_state_dict(package.get("state", package.get("state_dict", package)), strict=True)
model.eval()
print("Model:", type(model).__name__, model.sources, flush=True)
pcm = np.fromfile(args.input, dtype="<f4")
wav = torch.from_numpy(np.stack([pcm, pcm]))
mean, std = wav.mean(), wav.std()
started = time.perf_counter()
with torch.inference_mode():
    estimates = apply_model(model, ((wav - mean) / std)[None], device="cpu",
                            shifts=0, split=True, segment=8, overlap=0.25, progress=True)[0]
    estimates = estimates * std + mean
elapsed = time.perf_counter() - started
targets = [39.594, 40.410, 41.224, 42.040, 43.478, 44.301, 45.925]
report = {"input": str(args.input), "model": str(args.model),
          "modelSha256": hashlib.sha256(args.model.read_bytes()).hexdigest(),
          "offset": args.offset, "sampleRate": 44100, "elapsedSeconds": elapsed,
          "note": "Mono input duplicated as stereo; no labelled threshold fitting; spectral onset evidence only.",
          "sources": {}}
for name, estimate in zip(model.sources, estimates):
    audio = estimate.mean(0).numpy().astype("<f4")
    audio.tofile(args.out / f"{name}.f32")
    frames = np.lib.stride_tricks.sliding_window_view(np.pad(audio, (512, 512)), 1024)[::220]
    magnitude = np.abs(np.fft.rfft(frames * np.hanning(1024), axis=1))
    flux = np.maximum(0, np.diff(np.log1p(magnitude), axis=0)).sum(1)
    flux = np.pad(flux, (1, 0))
    rms = np.sqrt((frames * frames).mean(1))
    fps = 44100 / 220
    scale = float(np.quantile(flux, .95))
    rms_scale = float(np.quantile(rms, .95))
    points = []
    for timepoint in targets:
        if not args.offset <= timepoint < args.offset + len(audio) / 44100:
            continue
        frame = round((timepoint - args.offset) * fps)
        vicinity = np.arange(max(0, frame - 10), min(len(flux), frame + 11))
        best = int(vicinity[np.argmax(flux[vicinity])])
        points.append({"time": timepoint, "fluxPeakTime": best / fps + args.offset,
                       "fluxP95Ratio": float(flux[best] / max(scale, 1e-12)),
                       "rmsP95Ratio": float(max(rms[vicinity]) / max(rms_scale, 1e-12))})
    peaks = [i for i in range(1, len(flux) - 1)
             if flux[i] >= max(flux[i - 1], flux[i + 1]) and flux[i] >= scale * .25]
    report["sources"][name] = {"targets": points, "peaks": [
        {"time": i / fps + args.offset, "fluxP95Ratio": float(flux[i] / max(scale, 1e-12))}
        for i in peaks]}
    print(name, json.dumps(points), flush=True)
(args.out / "report.json").write_text(json.dumps(report, indent=2))
print(f"Separated in {elapsed:.1f}s", flush=True)
