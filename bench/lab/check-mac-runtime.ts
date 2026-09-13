// Inspect bundled ARM64 Mach-O deployment targets; this does not execute macOS code.
import assert from 'node:assert/strict';
import { openSync, closeSync, readSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const directory = 'node_modules/onnxruntime-node/bin/napi-v6/darwin/arm64';
const version = (value: number) => [value >>> 16, (value >>> 8) & 255, value & 255];
const packed = (value: string) => value.split('.').map(Number).reduce((total, n, i) => total + n * 256 ** (2 - i), 0);
const config = JSON.parse(readFileSync('apps/desktop/src-tauri/tauri.conf.json', 'utf8'));
const declared = config.bundle.macOS.minimumSystemVersion;
const libraries = ['onnxruntime_binding.node', 'libonnxruntime.1.27.0.dylib'].map(name => {
	const descriptor = openSync(join(directory, name), 'r');
	const bytes = Buffer.alloc(65536);
	try { readSync(descriptor, bytes, 0, bytes.length, 0); } finally { closeSync(descriptor); }
	assert.equal(bytes.readUInt32LE(0), 0xfeedfacf, 'Expected little-endian Mach-O 64');
	assert.equal(bytes.readUInt32LE(4), 0x100000c, 'Expected native ARM64');
	let offset = 32;
	const minimumVersions: string[] = [];
	for (let i = 0; i < bytes.readUInt32LE(16); i++) {
		const command = bytes.readUInt32LE(offset), size = bytes.readUInt32LE(offset + 4);
		assert.ok(size >= 8 && offset + size <= bytes.length, 'Invalid load command');
		if (command === 0x32 || command === 0x24) {
			if (command === 0x32) assert.equal(bytes.readUInt32LE(offset + 8), 1, 'Expected macOS platform');
			const minimum = bytes.readUInt32LE(offset + (command === 0x32 ? 12 : 8));
			assert.ok(packed(declared) >= minimum, `App minimum ${declared} is below ${name}'s ${version(minimum).join('.')}`);
			minimumVersions.push(version(minimum).join('.'));
		}
		offset += size;
	}
	assert.ok(minimumVersions.length > 0, 'No deployment target found');
	return { name, architecture: 'arm64', minimumVersions };
});
const report = { declaredMinimum: declared, libraries, nativeExecutionTested: false };
const output = process.argv.find(a => a.startsWith('--out='))?.slice(6);
if (output) writeFileSync(output, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report, null, 2));
