"""Cache individual DrumSep stems for the labelled MDB drum-only oracle."""
import hashlib
import json
from pathlib import Path
import subprocess
import time

import numpy as np
import torch
from demucs.apply import apply_model
from demucs.states import load_model

root = Path(__file__).resolve().parents[2]
model_path = root / "bench/reports/audio-reliability/habibi-drumsep/model_drumsep.th"
out = root / "bench/reports/audio-reliability/drumsep-mdb-oracle"
out.mkdir(parents=True, exist_ok=True)
torch.set_num_threads(4)
torch.manual_seed(0)
model = load_model(torch.load(model_path, map_location="cpu", weights_only=False), strict=True)
model.eval()
names = {"bombo": "kick", "redoblante": "snare", "platillos": "cymbals", "toms": "toms"}
rows = []
for audio in sorted((root / "bench/corpus/mdb-drums/audio/drum_only").glob("*_Drum.wav")):
    name = audio.stem.removesuffix("_Drum")
    target = out / name
    target.mkdir(parents=True, exist_ok=True)
    meta_path = target / "manifest.json"
    if meta_path.exists():
        rows.append(json.loads(meta_path.read_text()))
        print(name, "cached", flush=True)
        continue
    raw = subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-i", str(audio),
                          "-ar", "44100", "-ac", "2", "-f", "f32le", "-"],
                         check=True, capture_output=True).stdout
    pcm = np.frombuffer(raw, dtype="<f4").reshape(-1, 2).T.copy()
    wav = torch.from_numpy(pcm)
    reference = wav.mean(0)
    mean, std = reference.mean(), reference.std()
    started = time.perf_counter()
    with torch.inference_mode():
        estimates = apply_model(model, ((wav - mean) / std)[None], device="cpu",
                                shifts=0, split=True, segment=8, overlap=.25, progress=False)[0]
        estimates = estimates * std + mean
    elapsed = time.perf_counter() - started
    for source, estimate in zip(model.sources, estimates):
        estimate.mean(0).numpy().astype("<f4").tofile(target / f"{names[source]}.f32")
    metadata = {"name": name, "input": str(audio), "seconds": pcm.shape[1] / 44100,
                "sampleRate": 44100, "elapsedSeconds": elapsed,
                "audioSha256": hashlib.sha256(audio.read_bytes()).hexdigest(),
                "modelSha256": hashlib.sha256(model_path.read_bytes()).hexdigest(),
                "note": "True drum-only input, not a production full-mix evaluation."}
    meta_path.write_text(json.dumps(metadata, indent=2))
    rows.append(metadata)
    (out / "progress.json").write_text(json.dumps(rows, indent=2))
    print(name, f"{elapsed:.1f}s for {metadata['seconds']:.1f}s audio", flush=True)
print("Finished", len(rows), "tracks", flush=True)
