import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodeAudio } from '@mv/analysis';
import { MusicFm, MusicFmHead, MUSICFM_RATE, melSpectrogram } from '../packages/analysis/src/musicfm.ts';
import { MODEL_DIR } from '../packages/analysis/src/paths.ts';

/**
 * Compare the TS MusicFM stages and one corpus track with export-musicfm.py probe vectors.
 * node bench/musicfm-parity.ts
 */
const PROBE_DIR = join(import.meta.dirname, 'corpus', '.musicfm');

const f32 = (name: string): Float32Array => {
	const raw = readFileSync(join(PROBE_DIR, name));
	return new Float32Array(raw.buffer.slice(raw.byteOffset, raw.byteOffset + raw.byteLength));
};
const maxErr = (a: Float32Array, b: Float32Array): number => {
	if (a.length !== b.length) throw new Error(`length ${a.length} vs ${b.length}`);
	let m = 0;
	for (let i = 0; i < a.length; i++) m = Math.max(m, Math.abs(a[i] - b[i]));
	return m;
};

if (!existsSync(join(PROBE_DIR, 'probe_manifest.json'))) {
	console.log('no probes: run bench/export-musicfm.py first');
	process.exit(1);
}

// --- 1. the mel frontend ---------------------------------------------------------------
const wav = f32('probe_wav.bin');
const fbRaw = readFileSync(join(MODEL_DIR, 'musicfm_mel_fb.bin'));
const fb = new Float32Array(fbRaw.buffer.slice(fbRaw.byteOffset, fbRaw.byteOffset + fbRaw.byteLength));
const melRef = f32('probe_mel.bin');
const mel = melSpectrogram(wav, fb);
// The reference is [128, frames] channel-major; ours is frame-major.
const frames = mel.length / 128;
const melT = new Float32Array(mel.length);
for (let f = 0; f < frames; f++) {
	for (let m = 0; m < 128; m++) melT[m * frames + f] = mel[f * 128 + m];
}
console.log(`mel: ${frames} frames, max err ${maxErr(melT, melRef).toExponential(2)}`);

// --- 2. the head graph through its public seam -----------------------------------------
const head = await MusicFmHead.create();
if (!head) {
	console.log('models absent from models/: run bench/export-musicfm.py first');
	process.exit(1);
}
const headIn = f32('probe_head_in.bin');
const headOutRef = f32('probe_head_out.bin');
const t = headIn.length / 1024;
const post = await head.label({ frames: t, data: headIn });
console.log(`head: ${t} frames, posterior max err ${maxErr(post, headOutRef).toExponential(2)}`);
await head.close();

// Compare encoder tokens by cosine similarity: reference Torch is fp32, the shipped graph is
// int8.
const model = await MusicFm.create();
if (!model) {
	console.log('encoder absent from models/: run bench/export-musicfm.py first');
	process.exit(1);
}
{
	const hiddenRef = f32('probe_hidden.bin');
	const emb = await model.embed(wav);
	const pooledRef = new Float32Array(emb.frames * 1024);
	for (let f = 0; f < emb.frames; f++) {
		for (let p = 0; p < 3; p++) {
			const row = (f * 3 + p) * 1024;
			for (let k = 0; k < 1024; k++) pooledRef[f * 1024 + k] += hiddenRef[row + k] / 3;
		}
	}
	let worst = 1;
	for (let f = 0; f < emb.frames; f++) {
		let dot = 0;
		let na = 0;
		let nb = 0;
		for (let k = 0; k < 1024; k++) {
			const a = emb.data[f * 1024 + k];
			const b = pooledRef[f * 1024 + k];
			dot += a * b;
			na += a * a;
			nb += b * b;
		}
		worst = Math.min(worst, dot / Math.sqrt(na * nb));
	}
	console.log(`encoder: ${emb.frames} pooled frames, worst cosine ${worst.toFixed(4)}`);
}

// --- 4. one whole corpus track through the real windowing ------------------------------
if (existsSync(join(PROBE_DIR, 'probe_track.json'))) {
	const ref = JSON.parse(readFileSync(join(PROBE_DIR, 'probe_track.json'), 'utf8')) as {
		id: string;
		shape: [number, number];
	};
	const audioDir = join(import.meta.dirname, 'corpus', 'harmonix', 'audio');
	const { readdirSync } = await import('node:fs');
	const audio = readdirSync(audioDir).find((f) => f.startsWith(ref.id));
	if (audio) {
		const decoded = await decodeAudio(join(audioDir, audio), MUSICFM_RATE);
		const trackEmb = await model.embed(decoded.mono);
		const embRef = f32('probe_track_emb.bin');
		const n = Math.min(trackEmb.frames, ref.shape[0]);
		console.log(`track ${ref.id}: ${trackEmb.frames} frames (ref ${ref.shape[0]})`);
		// The reference is float16 on disk, and the int8 graph adds its own noise, so the
		// meaningful number is cosine similarity per frame, not absolute error.
		let worst = 1;
		for (let f = 0; f < n; f++) {
			let dot = 0;
			let na = 0;
			let nb = 0;
			for (let k = 0; k < 1024; k++) {
				const a = trackEmb.data[f * 1024 + k];
				const b = embRef[f * 1024 + k];
				dot += a * b;
				na += a * a;
				nb += b * b;
			}
			worst = Math.min(worst, dot / Math.sqrt(na * nb));
		}
		console.log(`track cosine similarity: worst frame ${worst.toFixed(4)}`);

		// The number that decides whether int8 + the TS frontend ship: does the head give
		// the same answers on our embeddings as on the fp32 ones it was trained beside?
		const headForTrack = await MusicFmHead.create();
		if (headForTrack) {
			const postOurs = await headForTrack.label(trackEmb);
			const postRef = await headForTrack.label({
				frames: ref.shape[0],
				data: embRef
			});
			const classes = headForTrack.kinds.length;
			let agree = 0;
			for (let f = 0; f < n; f++) {
				const arg = (p: Float32Array): number => {
					let b = 0;
					for (let c = 1; c < classes; c++) if (p[f * classes + c] > p[f * classes + b]) b = c;
					return b;
				};
				if (arg(postOurs) === arg(postRef)) agree++;
			}
			console.log(`head label agreement: ${((100 * agree) / n).toFixed(1)}% of ${n} frames`);
			await headForTrack.close();
		}
	} else {
		console.log(`track ${ref.id}: audio not in corpus, skipped`);
	}
}

await model.close();
