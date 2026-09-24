import fs from 'node:fs';
import { getBestCameraPosition } from 'circuit-json-to-gltf';
import { renderGLTFToPNGFromGLB } from 'poppygl';

const circuit = JSON.parse(fs.readFileSync('dist/index/circuit.json', 'utf8'));
const bytes = fs.readFileSync('dist/lightningstrike.glb');
const glb = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
const camera = getBestCameraPosition(circuit);
const png = await renderGLTFToPNGFromGLB(glb, {
	...camera, width: 1600, height: 1200, supersampling: 2,
	backgroundColor: '#e8ecef', ambient: 0.6,
});
fs.writeFileSync('dist/preview-3d.png', png);
