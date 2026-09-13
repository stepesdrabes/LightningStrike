import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { decodeAudio, resamplePcm } from '../../packages/analysis/src/decode.ts';
import { onsetsFromActivations } from '../../packages/analysis/src/adtof.ts';
import { mergeKickEvidence } from '../../packages/analysis/src/kickEvidence.ts';
import assert from 'node:assert/strict';
import { kickSourceCandidate } from './kick-source-candidate.ts';
import { loadLabels, readF32, score } from './mdb.ts';

const root = 'bench/reports/audio-reliability';
const read = (path: string) => JSON.parse(readFileSync(path, 'utf8'));
const reports: unknown[] = [];
for (const set of ['native', 'oracle']) {
	const directory = join(root, set === 'native' ? 'mdb-native-separation' : 'drumsep-mdb-oracle');
	for (const name of readdirSync(directory).filter(name => name.startsWith('MusicDelta_'))) {
		const sourcePath = join(directory, name, set === 'native' ? 'kit/bombo.f32' : 'kick.f32');
		if (!existsSync(sourcePath)) continue;
		const frozen = read(join(root, 'mdb/detail-session-baseline', name + '.json'));
		const audio = await decodeAudio(join(root, '../../corpus/mdb-drums/audio/full_mix', name + '_MIX.wav'));
		const source = await resamplePcm(readF32(sourcePath), 44100);
		// Unknown frozen levels are deliberately below the veto gate, testing every possible removal.
		const legacy = { ...frozen.final.kick, levels: frozen.final.kick.times.map(() => .5), invented: frozen.invented.kick };
		const model = onsetsFromActivations(readF32(join(root, 'mdb/activations', name + '.f32')));
		const result = kickSourceCandidate(legacy, frozen.dsp.kick, source, audio.mono, model.kick);
		assert.deepEqual(mergeKickEvidence(legacy, frozen.dsp.kick, source, audio.mono, model.kick, 22050),
			{ times: result.times, levels: result.levels, invented: result.invented });
		const labels = loadLabels(name).kick;
		const before = score(labels, legacy.times, .05), after = score(labels, result.times, .05);
		const row = { set, name, before, after, added: result.added, removed: result.removed };
		reports.push(row);
		if (result.added.length || result.removed.length) console.log(JSON.stringify({set, name, added: result.added, removed: result.removed, delta: {tp: after.tp-before.tp, fp: after.fp-before.fp}}));
	}
}
writeFileSync(join(root, 'judgement-correction/kick-source-candidate.json'), JSON.stringify(reports, null, 2));
