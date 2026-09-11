import { describe, expect, it } from 'vitest';
import { DEFAULT_ROOM, buildGeometry } from './geometry.ts';
import { EffectRegistry } from './effects/index.ts';
import { Mixer } from './mixer.ts';
import { ShowPlayer } from './player.ts';
import { fixtureAnalysis, fixtureShow } from './ambient/fixture.ts';

const g = buildGeometry(DEFAULT_ROOM);

describe('hits across cue boundaries', () => {
	/**
	 * A cue installed on a boundary must receive the hit already consumed by the anticipation
	 * lead.
	 */
	it('re-asserts a kick consumed just before the switch to the incoming effect', () => {
		const analysis = fixtureAnalysis(120);
		const show = fixtureShow(analysis);
		expect(show.cues.length).toBeGreaterThan(1);

		// One kick, exactly on the second cue's downbeat.
		const boundaryBar = show.cues[1].bar;
		const boundaryTime = analysis.tempo.barTimes[boundaryBar];
		analysis.onsets.kick = { times: [boundaryTime], levels: [1] };
		analysis.onsets.snare = { times: [], levels: [] };
		analysis.onsets.hat = { times: [], levels: [] };

		const player = new ShowPlayer(new Mixer(g), new EffectRegistry());
		player.load(analysis, show);

		const dt = 1 / 60;
		let kickOnOrAfterBoundary = false;
		// Offset so no frame lands exactly on the boundary: the lead consumes the kick one
		// to two frames early, which is the precise shape of the bug.
		for (let t = boundaryTime - 0.5 + 0.003; t < boundaryTime + 0.1; t += dt) {
			const f = player.update(t, dt);
			if (t >= boundaryTime && f.kick) kickOnOrAfterBoundary = true;
		}
		expect(kickOnOrAfterBoundary).toBe(true);
	});
});
