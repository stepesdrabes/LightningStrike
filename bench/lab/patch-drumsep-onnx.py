"""Make boolean EyeLike portable without changing its diagonal attention mask."""
from pathlib import Path
import argparse
import hashlib
import onnx
from onnx import helper, numpy_helper
import numpy as np

parser = argparse.ArgumentParser()
parser.add_argument('--source', type=Path, default=Path('bench/reports/audio-reliability/model-exports/drumsep.onnx'))
parser.add_argument('--out', type=Path, default=Path('bench/reports/audio-reliability/model-exports/drumsep-portable.onnx'))
args = parser.parse_args()
if onnx.__version__ != '1.22.0':
    raise RuntimeError('Use onnx==1.22.0 for the reproducible model serialization.')
source = args.source
expected = '313dcb93e0ed60f52280cd20f2145f32110ffa6f450ce157a69846e16642dd5f'
assert hashlib.sha256(source.read_bytes()).hexdigest() == expected
model = onnx.load(source)
replaced = []
nodes = []
for node in model.graph.node:
    if node.name == '/Constant_31':
        # The exporter annotated samples as dynamic but captured the final time-branch
        # reshape length as a Python integer. Recover it from the waveform input.
        original = numpy_helper.to_array(node.attribute[0].t)
        assert original.tolist() == [1764000]
        model.graph.initializer.append(numpy_helper.from_array(np.array([2], np.int64), 'portable_samples_axis'))
        nodes.extend([
            helper.make_node('Shape', ['waveform'], ['portable_waveform_shape']),
            helper.make_node('Gather', ['portable_waveform_shape', 'portable_samples_axis'], list(node.output), axis=0),
        ])
        continue
    if node.op_type != 'EyeLike':
        nodes.append(node)
        continue
    # torch.eye(..., dtype=bool) becomes unsupported bool EyeLike in ORT CPU.
    # Equality of row/column indices computes precisely the same dynamic matrix.
    prefix = node.name + '_portable'
    for name, array in [('zero', np.array(0, np.int64)), ('one', np.array(1, np.int64)), ('axis0', np.array([0], np.int64)), ('axis1', np.array([1], np.int64))]:
        model.graph.initializer.append(numpy_helper.from_array(array, prefix + '_' + name))
    nodes.extend([
        helper.make_node('Shape', [node.input[0]], [prefix + '_shape']),
        helper.make_node('Gather', [prefix + '_shape', prefix + '_zero'], [prefix + '_n'], axis=0),
        helper.make_node('Range', [prefix + '_zero', prefix + '_n', prefix + '_one'], [prefix + '_range']),
        helper.make_node('Unsqueeze', [prefix + '_range', prefix + '_axis0'], [prefix + '_row']),
        helper.make_node('Unsqueeze', [prefix + '_range', prefix + '_axis1'], [prefix + '_column']),
        helper.make_node('Equal', [prefix + '_row', prefix + '_column'], list(node.output)),
    ])
    replaced.append(node.name)
assert len(replaced) == 4
del model.graph.node[:]
model.graph.node.extend(nodes)
onnx.checker.check_model(model)
destination = args.out
destination.parent.mkdir(parents=True, exist_ok=True)
onnx.save(model, destination)
print(destination, destination.stat().st_size, hashlib.sha256(destination.read_bytes()).hexdigest(), flush=True)
