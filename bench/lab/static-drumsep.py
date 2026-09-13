"""Bench-only fixed 8-second DrumSep metadata for CPU/CoreML shape specialization."""
import argparse
import hashlib
import json
from pathlib import Path
import onnx

SOURCE_SHA = 'e35619cef17d1aeaf410dae9d9895f3814cccc51b7a0deecbf543fe0131d7002'
parser = argparse.ArgumentParser()
parser.add_argument('--source', type=Path, default=Path('models/drumsep.onnx'))
parser.add_argument('--out', type=Path, default=Path('bench/reports/audio-reliability/model-exports/drumsep-static-8s.onnx'))
parser.add_argument('--infer-shapes', action='store_true')
args = parser.parse_args()
if onnx.__version__ != '1.22.0':
    raise RuntimeError('Use onnx==1.22.0 for a reproducible export.')

def sha(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()

def protobuf_sha(values):
    digest = hashlib.sha256()
    for value in values:
        digest.update(value.SerializeToString())
    return digest.hexdigest()

if sha(args.source) != SOURCE_SHA:
    raise RuntimeError('Source must be the verified portable DrumSep graph.')
if args.source.resolve() == args.out.resolve():
    raise RuntimeError('The static experiment must not overwrite its source model.')
model = onnx.load(args.source)
original_nodes = protobuf_sha(model.graph.node)
original_weights = protobuf_sha(model.graph.initializer)
shapes = {
    'waveform': [1, 2, 352800],
    'magnitude': [1, 4, 2048, 345],
    'freq_output': [1, 4, 4, 2048, 345],
    'time_output': [1, 4, 2, 352800],
}
for value in list(model.graph.input) + list(model.graph.output):
    expected = shapes[value.name]
    if len(value.type.tensor_type.shape.dim) != len(expected):
        raise RuntimeError(f'Unexpected rank: {value.name}')
    for dim, size in zip(value.type.tensor_type.shape.dim, expected):
        dim.ClearField('dim_param')
        dim.dim_value = size
if args.infer_shapes:
    model = onnx.shape_inference.infer_shapes(model, check_type=True, strict_mode=True, data_prop=True)
onnx.checker.check_model(model)
assert protobuf_sha(model.graph.node) == original_nodes
assert protobuf_sha(model.graph.initializer) == original_weights
args.out.parent.mkdir(parents=True, exist_ok=True)
onnx.save(model, args.out)
report = {'source': str(args.source), 'sourceSha256': SOURCE_SHA, 'out': str(args.out),
          'sha256': sha(args.out), 'bytes': args.out.stat().st_size, 'onnx': onnx.__version__,
          'inferred': args.infer_shapes, 'shapes': shapes, 'nodes': len(model.graph.node),
          'valueInfo': len(model.graph.value_info), 'graphNodesSha256': original_nodes,
          'initializerSha256': original_weights, 'weightsAndOperationsUnchanged': True}
args.out.with_suffix('.json').write_text(json.dumps(report, indent=2) + '\n')
print(json.dumps(report, indent=2), flush=True)
