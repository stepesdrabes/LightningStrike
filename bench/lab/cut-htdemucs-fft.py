"""Pinned HTDemucs extraction: unchanged learned network, host FFT boundaries."""
import argparse
import hashlib
from pathlib import Path
import onnx
from onnx import helper, TensorProto

parser = argparse.ArgumentParser()
parser.add_argument('--source', type=Path, default=Path('bench/reports/audio-reliability/model-exports/htdemucs-original.onnx'))
parser.add_argument('--out', type=Path, default=Path('bench/reports/audio-reliability/separation-performance/htdemucs-host-fft.onnx'))
args = parser.parse_args()
with args.source.open('rb') as source:
    assert hashlib.file_digest(source, 'sha256').hexdigest() == '68d0bf16428ef66e692cdff8a9ccf28f1ef3f69440d57e58605a4cc55fcc5e74'
model = onnx.load(args.source)
cut = '/Cast_1_output_0'
frequency = '/Add_3_output_0'
time = '/Add_4_output_0'
producers = {output: i for i, node in enumerate(model.graph.node) for output in node.output}
assert all(name in producers for name in [cut, frequency, time])
needed = set()
pending = [frequency, time]
while pending:
    value = pending.pop()
    if value in ['mix', cut] or value not in producers:
        continue
    index = producers[value]
    if index in needed:
        continue
    needed.add(index)
    pending.extend(model.graph.node[index].input)
nodes = [node for i, node in enumerate(model.graph.node) if i in needed]
for node in nodes:
    for i, name in enumerate(node.input):
        if name == cut:
            node.input[i] = 'magnitude'
assert not any('real_stft' in node.name or 'real_istft' in node.name for node in nodes)
used = {name for node in nodes for name in node.input}
initializers = [value for value in model.graph.initializer if value.name in used]
for name, value in [('drum_start', 0), ('drum_end', 1), ('source_axis', 1)]:
    initializers.append(helper.make_tensor(name, TensorProto.INT64, [1], [value]))
nodes.extend([
    helper.make_node('Slice', [frequency, 'drum_start', 'drum_end', 'source_axis'], ['freq_output']),
    helper.make_node('Slice', [time, 'drum_start', 'drum_end', 'source_axis'], ['time_output']),
])
graph = helper.make_graph(nodes, 'HTDemucs learned network with host Fourier transforms',
    [helper.make_tensor_value_info('mix', TensorProto.FLOAT, [1, 2, 343980]),
     helper.make_tensor_value_info('magnitude', TensorProto.FLOAT, [1, 4, 2048, 336])],
    [helper.make_tensor_value_info('freq_output', TensorProto.FLOAT, [1, 1, 4, 2048, 336]),
     helper.make_tensor_value_info('time_output', TensorProto.FLOAT, [1, 1, 2, 343980])],
    initializer=initializers)
model.graph.CopyFrom(graph)
onnx.checker.check_model(model)
args.out.parent.mkdir(parents=True, exist_ok=True)
onnx.save(model, args.out)
with args.out.open('rb') as result:
    print({'path': str(args.out), 'nodes': len(nodes), 'bytes': args.out.stat().st_size,
           'sha256': hashlib.file_digest(result, 'sha256').hexdigest()}, flush=True)
