import { describe, expect, it } from 'vitest';
import type { GenreFamily, TrackAnalysis } from '@mv/core';
import { BUILT_IN_EFFECTS, HIT_RULES, LAYER_ROLES, PHRASE_BARS, barDurationAt, emptyContext } from '@mv/core';
import { fixture } from './fixture.ts';
import { composeShow } from './plan.ts';
import { lintShow } from './lint.ts';
import { activityBudget } from './select.ts';

const analysis = fixture();
const effects = new Map(BUILT_IN_EFFECTS.map((e) => [e.id, e]));
const show = composeShow(analysis);
const verdict = lintShow(show, { analysis, effects });

const stackOf = (cue: (typeof show.cues)[number]) =>
	LAYER_ROLES.filter((r) => cue.layers[r])
		.map((r) => `${r}:${cue.layers[r]!.effect}`)
		.join(' ');

describe('chorus drive through a long medley', () => {
	const families: GenreFamily[] = ['hiphop', 'pop', 'rock', 'metal', 'edm'];
	for (const family of families) {
		it(`keeps the rhythm strong after the early peak in ${family}`, () => {
			const track = fixture();
			track.sections = Array.from({ length: 16 }, (_, i) => ({
				index: i, kind: i === 0 ? 'intro' as const : 'chorus' as const,
				startBar: i * 8, endBar: (i + 1) * 8,
				startTime: track.tempo.barTimes[i * 8], endTime: track.tempo.barTimes[(i + 1) * 8],
				lengthBars: 8, meanEnergy: i === 0 ? 20 : 88, peakEnergy: i === 2 ? 100 : 92,
				energyRank: i === 2 ? 1 : 2, group: i, repeatOf: null, movement: Math.floor(i / 6)
			}));
			for (const row of track.bars) {
				row.section = row.bar < 8 ? 'intro' : 'chorus';
				row.kicks = row.bar < 8 ? 0 : 4;
				row.energy = row.bar < 8 ? 20 : 88;
			}
			track.movements = [0, 48, 96].map((startBar, i, starts) => {
				const endBar = starts[i + 1] ?? 128;
				return { startBar, endBar, startTime: track.tempo.barTimes[startBar],
					endTime: track.tempo.barTimes[endBar], bpm: 128, key: track.key, source: 'auto' as const, note: '' };
			});
			for (const seed of [1, 7, 29]) {
				const composed = composeShow(track, { seed, context: { ...emptyContext(), genreFamily: family } });
				const late = composed.cues.filter((cue) => cue.section === 'chorus' && cue.bar >= 48);
				expect(late.length).toBeGreaterThanOrEqual(8);
				for (const cue of late) {
					expect(effects.get(cue.layers.rhythm?.effect ?? '')?.taste.energy).toBeGreaterThanOrEqual(4);
					expect(['kick', 'any']).toContain(effects.get(cue.layers.rhythm?.effect ?? '')?.taste.kit);
					if (!cue.layers.master) {
						const activity = Object.values(cue.layers).reduce((sum, spec) => sum + (effects.get(spec!.effect)?.taste.activity ?? 0), 0);
						expect(activity).toBeLessThanOrEqual(activityBudget(0.88, 'chorus') + 1e-9);
					}
				}
			}
		});
	}
});

describe('sparse kit and vocal builds', () => {
	it.each(['hiphop', 'pop', 'rock', 'metal', 'edm'] as const)('favours individual kick accents without losing chorus variety in %s', (family) => {
		const track = fixture();
		for (const s of track.sections) if (s.kind === 'drop') s.meanEnergy = 90;
		for (const b of track.bars) if (b.section === 'drop') b.kicks = 2;
		const neutral = BUILT_IN_EFFECTS.map(e => ({ ...e, taste: { ...e.taste, kickAccent: false } }));
		const choices = (pool: typeof BUILT_IN_EFFECTS) => [1, 7, 29].flatMap(seed =>
			composeShow(track, { seed, effects: pool, context: { ...emptyContext(), genreFamily: family } })
				.cues.filter(c => c.section === 'drop').map(c => c.layers.rhythm?.effect ?? '')
		);
		const chosen = choices(BUILT_IN_EFFECTS);
		const accents = (ids: string[]) => ids.filter(id => effects.get(id)?.taste.kickAccent).length;
		expect(accents(chosen)).toBeGreaterThan(accents(choices(neutral)));
		expect(accents(chosen)).toBeLessThan(chosen.length);
		expect(new Set(chosen).size).toBeGreaterThanOrEqual(4);
	});

	it('retains a continuous note voice through drumless builds and layer stripping', () => {
		const track = fixture();
		for (const b of track.bars) if (b.section === 'build') b.kicks = b.snares = 0;
		const pool = BUILT_IN_EFFECTS.map(e => e.role === 'bed' ? { ...e, taste: { ...e.taste, noteReactive: false } } : e);
		const composed = composeShow(track, { effects: pool });
		for (let i = 0; i < composed.cues.length; i++) {
			const cue = composed.cues[i];
			if (cue.section !== 'build') continue;
			const voices = [cue.layers.rhythm, cue.layers.accent].filter(Boolean);
			expect(voices.some(s => effects.get(s!.effect)?.taste.noteReactive)).toBe(true);
			const drop = composed.cues.slice(i + 1).find(c => c.section === 'drop');
			if (drop) expect(Object.keys(cue.layers).length).toBeLessThan(Object.keys(drop.layers).length);
		}
	});
});

describe('coverage', () => {
	it('opens at bar 0 and runs in order', () => {
		expect(show.cues[0].bar).toBe(0);
		for (let i = 1; i < show.cues.length; i++) {
			expect(show.cues[i].bar).toBeGreaterThan(show.cues[i - 1].bar);
		}
	});

	it('leaves no bar dark', () => {
		expect(show.cues.at(-1)!.bar).toBeLessThan(analysis.bars.length);
		for (const cue of show.cues) expect(cue.layers).not.toEqual({});
	});

	it('names only effects that exist, in their own role', () => {
		for (const cue of show.cues) {
			for (const role of LAYER_ROLES) {
				const spec = cue.layers[role];
				if (!spec) continue;
				const def = effects.get(spec.effect);
				expect(def, `${spec.effect} at bar ${cue.bar}`).toBeDefined();
				expect(def!.role).toBe(role);
			}
		}
	});

	it('gives every cue a section that matches the analysis', () => {
		for (const cue of show.cues) expect(cue.section).toBe(analysis.bars[cue.bar].section);
	});
});

describe('the linter', () => {
	it('accepts the show without errors', () => {
		expect(verdict.errors.map((e) => `${e.rule}: ${e.message}`)).toEqual([]);
	});

	it('warns about nothing except the effects only a model can write', () => {
		expect(verdict.warnings.map((w) => w.rule)).toEqual(['few-generated-effects']);
	});
});

describe('the arrangement', () => {
	it('gives a quiet drumless intro a visible moving gesture without adding a full stack', () => {
		const track = fixture();
		track.peakToLoudness = 4;
		for (const row of track.bars.filter((row) => row.section === 'intro')) {
			row.kicks = 0;
			row.snares = 0;
			row.hats = 0;
		}
		for (const family of ['hiphop', 'house', 'ballad', 'ambient'] as const) {
			const opening = composeShow(track, { context: { ...emptyContext(), genreFamily: family } }).cues[0];
			const lead = opening.layers.accent ?? opening.layers.rhythm;
			expect(lead).toBeDefined();
			expect(effects.get(lead!.effect)?.taste.kit).toBeUndefined();
			if (opening.layers.accent) expect(effects.get(lead!.effect)?.taste.noteReactive).toBe(true);
			expect(Object.keys(opening.layers)).toHaveLength(2);
			expect(opening.intensity).toBeGreaterThanOrEqual(0.47);
			expect(opening.motion).toBeGreaterThanOrEqual(0.35);
		}
	});

	it('lets a local note voice sit over a carrying bed while the kit rests', () => {
		const track = fixture();
		for (const row of track.bars) {
			if (row.section !== 'intro' && row.section !== 'breakdown') continue;
			row.kicks = row.snares = row.hats = 0;
		}
		const localVoice = { ...BUILT_IN_EFFECTS.find((effect) => effect.role === 'accent')!, id: 'local-note',
			taste: { energy: 2 as const, sections: ['intro', 'breakdown'] as const, minBars: 1, maxBars: 64,
				peakReserved: false, noteReactive: true, carries: false, activity: 0.1 } };
		const pool = [...BUILT_IN_EFFECTS.filter((effect) => !effect.taste.noteReactive), localVoice];
		const composed = composeShow(track, { effects: pool });
		for (const cue of composed.cues.filter((cue) => cue.section === 'intro' || cue.section === 'breakdown')) {
			expect(cue.layers.accent?.effect).toBe(localVoice.id);
			expect(cue.layers.bed).toBeDefined();
			expect(effects.get(cue.layers.bed!.effect)?.taste.carries).not.toBe(false);
			expect(Object.keys(cue.layers)).toHaveLength(2);
		}
	});

	it('keeps intro rhythm when the drums play or no continuous note voice is available', () => {
		const track = fixture();
		for (const row of track.bars.filter((row) => row.section === 'intro')) row.kicks = 4;
		expect(composeShow(track).cues[0].layers.rhythm).toBeDefined();
		for (const row of track.bars.filter((row) => row.section === 'intro')) row.kicks = row.snares = row.hats = 0;
		const fallback = composeShow(track, { effects: BUILT_IN_EFFECTS.filter((effect) => !effect.taste.noteReactive) }).cues[0];
		expect(fallback.layers.rhythm).toBeDefined();
		expect(fallback.layers.bed).toBeDefined();
		expect(Object.keys(fallback.layers)).toHaveLength(2);
	});

	it('retains a moving rhythm when the carrying bed already articulates notes', () => {
		const track = fixture();
		for (const row of track.bars.filter((row) => row.section === 'intro')) row.kicks = row.snares = row.hats = 0;
		const pool = BUILT_IN_EFFECTS.map((effect) => effect.role === 'bed'
			? { ...effect, taste: { ...effect.taste, noteReactive: true } } : effect);
		const opening = composeShow(track, { effects: pool }).cues[0];
		expect(opening.layers.rhythm).toBeDefined();
		expect(opening.layers.accent).toBeUndefined();
		expect(Object.keys(opening.layers)).toHaveLength(2);
	});

	it('prefers a continuous kinetic voice over an unresponsive bed before adding a note field', () => {
		const track = fixture();
		for (const row of track.bars.filter((row) => row.section === 'intro')) row.kicks = row.snares = row.hats = 0;
		const pool = BUILT_IN_EFFECTS.map((effect) => effect.role === 'bed'
			? { ...effect, taste: { ...effect.taste, noteReactive: false } } : effect);
		const opening = composeShow(track, { effects: pool }).cues[0];
		expect(effects.get(opening.layers.rhythm?.effect ?? '')?.taste.noteReactive).toBe(true);
		expect(opening.layers.accent).toBeUndefined();
		expect(Object.keys(opening.layers)).toHaveLength(2);
	});

	it('leaves bed headroom for a kit lead with both transient and accent, preserving sparse cues', () => {
		let reserved = 0;
		let sparse = 0;
		for (const family of ['hiphop', 'rock', 'house'] as const) {
			for (const seed of [1, 7, 29]) {
				const composed = composeShow(fixture(), { seed, context: { ...emptyContext(), genreFamily: family } });
				for (const cue of composed.cues) {
					const kit = effects.get(cue.layers.rhythm?.effect ?? '')?.taste.kit;
					if (cue.section === 'drop' && (kit === 'kick' || kit === 'any') && cue.layers.transient && cue.layers.accent) {
						expect(cue.layers.bed?.opacity).toBeCloseTo(0.36);
						reserved++;
					} else if (cue.section === 'intro' || !cue.layers.transient || !cue.layers.accent) {
						expect(cue.layers.bed?.opacity).toBeUndefined();
						sparse++;
					}
				}
			}
		}
		expect(reserved).toBeGreaterThan(0);
		expect(sparse).toBeGreaterThan(reserved);
	});

	it('keeps ordinary cue stacks inside their activity allowance across genre policies', () => {
		for (const family of ['techno', 'house', 'pop', 'hiphop', 'metal', 'ambient'] as const) {
			for (const seed of [1, 7, 31, 101]) {
				const composed = composeShow(analysis, { seed, context: { ...emptyContext(), genreFamily: family } });
				for (const cue of composed.cues) {
					if (cue.layers.master) continue;
					const energy = analysis.sections.find((span) => cue.bar >= span.startBar && cue.bar < span.endBar)!.meanEnergy / 100;
					const activity = Object.values(cue.layers).reduce((sum, spec) => sum + (effects.get(spec!.effect)?.taste.activity ?? 0), 0);
					expect(activity, `${family}, seed ${seed}, bar ${cue.bar}`).toBeLessThanOrEqual(activityBudget(energy, cue.section) + 1e-9);
				}
			}
		}
	});

	it('changes section only on the phrase grid', () => {
		for (let i = 1; i < show.cues.length; i++) {
			const cue = show.cues[i];
			if (cue.section === show.cues[i - 1].section || cue.section === 'void') continue;
			expect(cue.bar % PHRASE_BARS).toBe(0);
		}
	});

	it('uses the full intensity range', () => {
		const levels = show.cues.map((c) => c.intensity ?? show.defaults.intensity);
		expect(Math.min(...levels)).toBeLessThan(0.35);
		expect(Math.max(...levels)).toBe(1);
	});

	it('spends the top of that range inside the peak section', () => {
		const peak = analysis.sections.find((s) => s.energyRank === 1)!;
		const brightest = show.cues.reduce((a, b) =>
			(b.intensity ?? 0) > (a.intensity ?? 0) ? b : a
		);
		expect(brightest.bar).toBeGreaterThanOrEqual(peak.startBar);
		expect(brightest.bar).toBeLessThan(peak.endBar);
	});

	it('spends the peak on the loudest group LAST statement, not its first', () => {
		// The house craft holds the first chorus back so every return adds; a first
		// statement that outranks by mean (EARFQUAKE's corrected first chorus) must not
		// take the peak treatment away from the final one.
		const early = fixture();
		const firstDrop = early.sections.find((x) => x.kind === 'drop')!;
		const lastDrop = [...early.sections].reverse().find((x) => x.kind === 'drop')!;
		firstDrop.energyRank = 1;
		lastDrop.energyRank = 2;
		const s = composeShow(early, { artHue: null, context: emptyContext() });
		const brightest = s.cues.reduce((a, b) => ((b.intensity ?? 0) > (a.intensity ?? 0) ? b : a));
		expect(brightest.bar).toBeGreaterThanOrEqual(lastDrop.startBar);
		expect(brightest.bar).toBeLessThan(lastDrop.endBar);
	});

	it('steps the closing cue down with a record that is leaving', () => {
		// The ring-out and the fade-out: a single outro cue holding one level reads as the
		// lights refusing to let go. Where the final bars decline decisively, the closing
		// look thins WITH them - same layers, lower level, slower clock.
		const fading = fixture();
		const outro = fading.sections[fading.sections.length - 1];
		for (let b = outro.startBar; b < outro.endBar; b++) {
			const k = (b - outro.startBar) / Math.max(1, outro.endBar - outro.startBar - 1);
			fading.bars[b].energy = Math.round(55 * (1 - k) + 8 * k);
		}
		const s = composeShow(fading, { artHue: null, context: emptyContext() });
		const tail = s.cues.filter((c) => c.bar >= outro.startBar);
		expect(tail.length).toBeGreaterThanOrEqual(2);
		for (let i = 1; i < tail.length; i++) {
			expect(tail[i].intensity ?? 1).toBeLessThan(tail[i - 1].intensity ?? 1);
			expect(tail[i].layers).toEqual(tail[0].layers);
		}
		// The gesture is sanctioned: the linter must not read the held stack as a repeat.
		const lint = lintShow(s, { analysis: fading, effects });
		expect(lint.warnings.filter((w) => w.rule === 'repeated-stack')).toEqual([]);
	});

	it('keeps the linter agreeing about where the peak is', () => {
		const early = fixture();
		const firstDrop = early.sections.find((x) => x.kind === 'drop')!;
		const lastDrop = [...early.sections].reverse().find((x) => x.kind === 'drop')!;
		firstDrop.energyRank = 1;
		lastDrop.energyRank = 2;
		const s = composeShow(early, { artHue: null, context: emptyContext() });
		const lint = lintShow(s, { analysis: early, effects });
		expect(lint.warnings.filter((w) => w.rule === 'peak-not-brightest')).toEqual([]);
	});

	it('snaps the cues that have to arrive on the downbeat', () => {
		for (const cue of show.cues) {
			if (cue.section === 'drop' || cue.section === 'void') expect(cue.fadeBeats).toBe(0);
		}
	});

	it('holds layers back in a build so the drop has something to add', () => {
		for (let i = 0; i < show.cues.length - 1; i++) {
			if (show.cues[i].section !== 'build') continue;
			const drop = show.cues.slice(i + 1).find((c) => c.section === 'drop');
			if (!drop) continue;
			const count = (c: (typeof show.cues)[number]) => LAYER_ROLES.filter((r) => c.layers[r]).length;
			expect(count(show.cues[i])).toBeLessThan(count(drop));
		}
	});

	it('climbs through a build rather than sitting at one level', () => {
		const builds = show.cues.filter((c) => c.section === 'build');
		for (let i = 1; i < builds.length; i++) {
			if (builds[i].bar - builds[i - 1].bar > 16) continue;
			expect(builds[i].intensity ?? 0).toBeGreaterThanOrEqual(builds[i - 1].intensity ?? 0);
		}
	});

	it('never plays the same stack twice running', () => {
		for (let i = 1; i < show.cues.length; i++) {
			expect(stackOf(show.cues[i])).not.toBe(stackOf(show.cues[i - 1]));
		}
	});

	it('changes the bed often enough that the room changes character', () => {
		const beds = new Set(show.cues.map((c) => c.layers.bed?.effect).filter(Boolean));
		expect(beds.size).toBeGreaterThan(2);
	});

	it('leaves the drum layer out of most cues', () => {
		// One light event per audio event reads as mechanical however well timed it is.
		const withTransient = show.cues.filter((c) => c.layers.transient).length;
		expect(withTransient / show.cues.length).toBeLessThan(0.8);
	});
});

describe('how long a look is held', () => {
	/** The fixture with its second and third sections cut as twelve bars each. */
	function withTwelve(bpm: number): TrackAnalysis {
		const a = fixture(bpm);
		const times = a.tempo.barTimes;
		const sections = a.sections.map((s) => {
			const startBar = s.startBar === 24 ? 20 : s.startBar;
			const endBar = s.endBar === 24 ? 20 : s.endBar;
			return { ...s, startBar, endBar, startTime: times[startBar], endTime: times[endBar] };
		});
		return { ...a, sections };
	}

	it('keeps a twelve-bar section as one look where it lasts under half a minute', () => {
		const show = composeShow(withTwelve(128));
		expect(show.cues.filter((c) => c.bar >= 8 && c.bar < 20).map((c) => c.bar)).toEqual([8]);
	});

	it('cuts a slow twelve-bar section into the statement and the lift, not three looks', () => {
		const show = composeShow(withTwelve(60));
		expect(show.cues.filter((c) => c.bar >= 8 && c.bar < 20).map((c) => c.bar)).toEqual([8, 16]);
	});

	for (const bpm of [58, 70, 96, 128, 175]) {
		it(`holds no look past the ceiling at ${bpm} bpm`, () => {
			const track = withTwelve(bpm);
			const show = composeShow(track);
			const times = track.tempo.barTimes;
			for (let i = 0; i + 1 < show.cues.length; i++) {
				const bars = show.cues[i + 1].bar - show.cues[i].bar;
				const seconds = times[show.cues[i + 1].bar] - times[show.cues[i].bar];
				expect(bars).toBeLessThanOrEqual(8 + PHRASE_BARS);
				// Over eight bars only where those bars fit in thirty seconds.
				if (bars > 8) expect(seconds).toBeLessThanOrEqual(30);
			}
		});
	}
});

describe('a record with no kit', () => {
	/** The fixture with every kick and snare removed, filed under rock by its metadata. */
	const silent: TrackAnalysis = {
		...fixture(),
		bars: fixture().bars.map((row) => ({ ...row, kicks: 0, snares: 0, hats: 0 }))
	};
	const show = composeShow(silent, { context: { ...emptyContext(), genreFamily: 'rock' } });

	it('gets the ballad restraint: nothing that flashes, and none of the effects a ballad avoids', () => {
		expect(show.hits.filter((h) => h.kind === 'strobe' || h.kind === 'blackout')).toEqual([]);
		for (const cue of show.cues) {
			for (const layer of Object.values(cue.layers)) {
				expect(['glitchScan', 'moshSlam', 'headbang', 'rollerChase', 'doubleKickGatling']).not.toContain(layer.effect);
			}
		}
	});
});

describe('colour', () => {
	it('keeps one identity: a handful of hues, base and accent genuinely apart', () => {
		const hues = new Set<number>([show.palette.base, show.palette.accent]);
		for (const cue of show.cues) {
			if (!cue.palette || cue.palette === 'swap' || cue.palette === 'inherit') continue;
			hues.add(cue.palette.base);
			hues.add(cue.palette.accent);
			if (cue.palette.third !== undefined) hues.add(cue.palette.third);
		}
		expect(hues.size).toBeLessThanOrEqual(6);

		const raw = Math.abs(show.palette.base - show.palette.accent);
		expect(Math.min(raw, 360 - raw)).toBeGreaterThanOrEqual(90);
	});

	it('makes every drop a colour event, and a later one a different event', () => {
		const drops = show.cues.filter((c) => c.section === 'drop' && c.palette !== undefined);
		expect(drops.length).toBeGreaterThan(0);
		for (const cue of drops) expect(cue.palette).not.toBe('inherit');
		// The first inverts; a later one promotes the third hue instead, so it tops the first
		// rather than repeating it.
		const opening = drops.filter((c, i) => i === 0 || drops[i - 1].bar + 16 < c.bar);
		if (opening.length > 1) expect(opening[0].palette).not.toEqual(opening[1].palette);
	});
});

describe('punctuation', () => {
	// A void is dark because its CUE is dark: intensity 0.05 and no house floor. A blackout hit
	// on top of that says nothing the room was not already saying, which is why the one flash a
	// show gets is not spent here unless nothing bigger wanted it.
	it('cuts the light in every void', () => {
		for (const span of analysis.sections) {
			if (span.kind !== 'void') continue;
			const cue = show.cues.find((c) => c.bar === span.startBar);
			expect(cue?.section).toBe('void');
			expect(cue?.intensity ?? 1).toBeLessThan(0.1);
		}
	});

	it('lets the outro keep the bed it inherited, thinned to nothing else', () => {
		// An ending is a release, not a scene change: the outro wears the previous cue's
		// bed and everything else leaves.
		const outro = analysis.sections[analysis.sections.length - 1];
		expect(outro.kind).toBe('outro');
		const cue = show.cues.find((c) => c.bar === outro.startBar)!;
		const before = [...show.cues].reverse().find((c) => c.bar < outro.startBar)!;
		expect(cue.layers.bed?.effect).toBe(before.layers.bed?.effect);
		expect(cue.layers.rhythm).toBeUndefined();
		expect(cue.layers.transient).toBeUndefined();
	});

	it('the button lints on a final section that is not a whole number of phrases', () => {
		// The American Idiot shape: a cold ending whose final bar sits on no phrase grid.
		// The finish line is an anchor - a lint rejection here deletes the whole show.
		const cold: TrackAnalysis = structuredClone(analysis);
		const outro = cold.sections.pop()!;
		const last = cold.sections[cold.sections.length - 1];
		// Trim two bars so the drop runs 96-126: thirty bars, not a phrase multiple, and
		// 126 is off the mod-4 fallback grid as well.
		const endBar = outro.endBar - 2;
		last.endBar = endBar;
		last.endTime = cold.bars[endBar - 1].t + 1;
		cold.bars = cold.bars.filter((row) => row.bar < endBar);
		for (const row of cold.bars) if (row.bar >= outro.startBar) row.section = last.kind;
		cold.bars[endBar - 1].kicks = 2;
		const ended = composeShow(cold);
		expect(ended.hits.some((h) => h.bar === endBar - 1)).toBe(true);
		const coldVerdict = lintShow(ended, { analysis: cold, effects });
		expect(coldVerdict.errors).toEqual([]);
	});

	it('marks a cold ending with the button, in rhythm and kit-honest', () => {
		// Surgery: delete the outro so the track ends inside its loudest material.
		const cold: TrackAnalysis = structuredClone(analysis);
		const outro = cold.sections.pop()!;
		const last = cold.sections[cold.sections.length - 1];
		last.endBar = outro.endBar;
		last.endTime = outro.endTime;
		for (const row of cold.bars) if (row.bar >= outro.startBar) row.section = last.kind;
		const finalBar = last.endBar - 1;
		cold.bars[finalBar].kicks = 2;
		const ended = composeShow(cold);
		const button = ended.hits.find((h) => h.bar === finalBar);
		expect(button?.kind).toBe('slam');
		// And the fixture's own outro ending plans no button: a release is not a hit.
		expect(show.hits.some((h) => h.bar >= outro.startBar - 1)).toBe(false);
	});

	it('spends one flash in the whole show, and spends it late', () => {
		const flashes = show.hits.filter((h) => h.kind === 'strobe' || h.kind === 'blackout');
		expect(flashes.length).toBeLessThanOrEqual(1);
		// Whatever it is, it belongs to the biggest moment rather than to the first one that
		// could have taken it.
		const peak = analysis.sections.find((s) => s.energyRank === 1)!;
		for (const flash of flashes) expect(flash.bar).toBeGreaterThanOrEqual(peak.startBar - 4);
	});

	it('slams every drop, which is the punctuation that is not rationed', () => {
		const drops = analysis.sections.filter((s) => s.kind === 'drop');
		for (const drop of drops) {
			expect(show.hits.some((h) => h.kind === 'slam' && h.bar === drop.startBar)).toBe(true);
		}
	});

	it('keeps blackouts where darkness reads as deliberate', () => {
		for (const hit of show.hits) {
			if (hit.kind !== 'blackout') continue;
			expect(['void', 'breakdown', 'outro', 'build']).toContain(analysis.bars[hit.bar].section);
		}
	});

	it('spends nothing big in the opening bars', () => {
		for (const hit of show.hits) expect(hit.bar).toBeGreaterThanOrEqual(16);
	});

	it('strobes out of every build, not just the one before the peak', () => {
		const strobes = show.hits.filter((h) => h.kind === 'strobe');
		const drops = analysis.sections.filter((s) => s.kind === 'drop' && s.startBar >= 16);
		expect(strobes.length).toBeGreaterThanOrEqual(drops.length - 1);
		for (const hit of strobes) expect(hit.params?.perBeat).toBeGreaterThan(0);
	});

	it('slams on every drop downbeat', () => {
		for (const span of analysis.sections) {
			if (span.kind !== 'drop') continue;
			expect(show.hits.some((h) => h.kind === 'slam' && h.bar === span.startBar)).toBe(true);
		}
	});

	it('reports hits in time order', () => {
		for (let i = 1; i < show.hits.length; i++) {
			expect(show.hits[i].bar).toBeGreaterThanOrEqual(show.hits[i - 1].bar);
		}
	});

	it('counts every hit in whole beats and touches a downbeat at one end', () => {
		const { beatsPerBar } = analysis.tempo;
		for (const hit of show.hits) {
			expect(Number.isInteger(hit.beats)).toBe(true);
			const beat = hit.beat ?? 0;
			const end = hit.bar + (beat + hit.beats) / beatsPerBar;
			expect(beat === 0 || Number.isInteger(end)).toBe(true);
		}
	});

	it('runs the held breath before a drop all the way to its downbeat', () => {
		const { beatsPerBar } = analysis.tempo;
		const drops = new Set(analysis.sections.filter((s) => s.kind === 'drop').map((s) => s.startBar));
		for (const hit of show.hits) {
			// Only the ones cut from a build and aimed at a drop. A blackout inside a void is
			// already surrounded by darkness, so where it stops decides nothing.
			if (hit.kind !== 'blackout' || analysis.bars[hit.bar]?.section === 'void') continue;
			if (![...drops].some((b) => b > hit.bar && b - hit.bar <= 2)) continue;
			expect(drops.has(hit.bar + ((hit.beat ?? 0) + hit.beats) / beatsPerBar)).toBe(true);
		}
	});

	it('keeps a blackout short enough to read as a breath rather than a fault', () => {
		for (const hit of show.hits) {
			if (hit.kind !== 'blackout') continue;
			const beat = barDurationAt(analysis.tempo, hit.bar) / analysis.tempo.beatsPerBar;
			expect(hit.beats * beat).toBeLessThanOrEqual(HIT_RULES.blackout.maxSeconds ?? Infinity);
		}
	});

	it('keeps a strobe short enough to still read as punctuation', () => {
		for (const hit of show.hits) {
			if (hit.kind !== 'strobe') continue;
			const bars = hit.beats / analysis.tempo.beatsPerBar;
			expect(bars * barDurationAt(analysis.tempo, hit.bar)).toBeLessThanOrEqual(
				HIT_RULES.strobe.maxSeconds ?? Infinity
			);
		}
	});
});

/** The engine's output must lint clean, or the app discards the show and the room goes dark. */
describe('the engine never writes a show its own linter refuses', () => {
	const effectMap = new Map(BUILT_IN_EFFECTS.map((e) => [e.id, e]));

	// Slow and drifting grids straddle duration caps, exposing hits sized at the wrong bar.
	for (const bpm of [58, 70, 80, 96, 110, 128, 175]) {
		for (const drift of [0, 0.03]) {
			it(`at ${bpm} bpm${drift ? ' on a drifting grid' : ''}`, () => {
				const track = fixture(bpm, drift);
				for (let seed = 0; seed < 12; seed++) {
					const verdict = lintShow(composeShow(track, { seed: 1 + seed * 7919 }), {
						analysis: track,
						effects: effectMap
					});
					expect(verdict.errors.map((e) => `${e.rule}: ${e.message}`)).toEqual([]);
				}
			});
		}
	}
});

describe('determinism', () => {
	it('gives the same show for the same track, every time', () => {
		expect(JSON.stringify(composeShow(analysis))).toBe(JSON.stringify(show));
	});

	it('gives a different show for a different track', () => {
		const other = composeShow({ ...analysis, hash: 'deadbeefcafe0002' });
		expect(JSON.stringify(other)).not.toBe(JSON.stringify(show));
	});

	it('pins the show to the grid it was written against', () => {
		expect(show.analysisHash).toBe(analysis.hash);
	});

	it('records which roll produced it, so a composition can be named after the fact', () => {
		expect(show.seed).toBeGreaterThan(0);
		expect(composeShow(analysis, { seed: 12345 }).seed).toBe(12345);
	});

	it('gives a different show for a different roll of the same track', () => {
		const other = composeShow(analysis, { seed: (show.seed ?? 1) + 7919 });
		expect(other.analysisHash).toBe(show.analysisHash);
		expect(JSON.stringify(other.cues)).not.toBe(JSON.stringify(show.cues));
	});
});

describe('prose', () => {
	it('writes a brief short enough to read', () => {
		expect(show.brief.length).toBeGreaterThan(80);
		expect(show.brief.length).toBeLessThan(1100);
	});

	it('says why every cue exists, briefly', () => {
		for (const cue of show.cues) {
			expect(cue.note.trim().length).toBeGreaterThan(0);
			expect(cue.note.length).toBeLessThanOrEqual(90);
		}
	});
});

describe('degenerate input', () => {
	it('survives a track with one section', () => {
		const flat: TrackAnalysis = {
			...analysis,
			sections: [{ ...analysis.sections[1], index: 0, startBar: 0, endBar: 128, lengthBars: 128, energyRank: 1 }],
			bars: analysis.bars.map((b) => ({ ...b, section: 'groove' as const }))
		};
		const plain = composeShow(flat);
		expect(plain.cues.length).toBeGreaterThan(0);
		expect(lintShow(plain, { analysis: flat, effects }).errors).toEqual([]);
	});

	it('survives a track with no sections at all', () => {
		const empty: TrackAnalysis = { ...analysis, sections: [], bars: [] };
		const plain = composeShow(empty);
		expect(plain.cues).toEqual([]);
		expect(plain.hits).toEqual([]);
	});
});

describe('planner-set params', () => {
	// Force the pick by leaving one candidate in the role, so the assertion is about the
	// params the planner writes rather than about which effect the seed happened to choose.
	const withRhythm = (id: string) =>
		BUILT_IN_EFFECTS.filter((e) => e.role !== 'rhythm' || e.id === id);
	const rhythmCues = (s: ReturnType<typeof composeShow>, id: string) =>
		s.cues.filter((c) => c.layers.rhythm?.effect === id);

	it('writes a PERIOD into sineRoll, never the hat rate', () => {
		// The fixture's hats run 2/beat, which is a dense track: one cycle per bar.
		const dense = composeShow(analysis, { effects: withRhythm('sineRoll') });
		const cues = rhythmCues(dense, 'sineRoll');
		expect(cues.length).toBeGreaterThan(0);
		for (const cue of cues) {
			expect(cue.layers.rhythm!.params).toMatchObject({ cycleBeats: 4 });
			expect(cue.layers.rhythm!.params!.perBeat).toBeUndefined();
		}

		// A sparse track slows the wave down, not up: this is the inversion that used to
		// run sineRoll at four times its designed speed on every sparse song.
		const quietTrack = fixture();
		for (const bar of quietTrack.bars) bar.hats = 1;
		const sparse = composeShow(quietTrack, { effects: withRhythm('sineRoll') });
		for (const cue of rhythmCues(sparse, 'sineRoll')) {
			expect(cue.layers.rhythm!.params).toMatchObject({ cycleBeats: 8 });
		}
	});

	it('stretches the roller lap to whole bars until it runs at least 2.2 s', () => {
		// 128 bpm: a bar is 1.875 s, so one lap per bar is a blur and the lap takes two.
		const fast = composeShow(analysis, { effects: withRhythm('rollerChase') });
		const fastCues = rhythmCues(fast, 'rollerChase');
		expect(fastCues.length).toBeGreaterThan(0);
		for (const cue of fastCues) {
			expect(cue.layers.rhythm!.params).toMatchObject({ lapBars: 2 });
		}

		// 100 bpm: a bar is 2.4 s on its own, and the dnb roller identity keeps its one-bar lap.
		const slow = composeShow(fixture(100), { effects: withRhythm('rollerChase') });
		for (const cue of rhythmCues(slow, 'rollerChase')) {
			expect(cue.layers.rhythm!.params).toMatchObject({ lapBars: 1 });
		}
	});

	it('still writes the hat RATE into the effects that count events per beat', () => {
		const stepped = composeShow(analysis, { effects: withRhythm('chase') });
		const cues = rhythmCues(stepped, 'chase');
		expect(cues.length).toBeGreaterThan(0);
		for (const cue of cues) {
			expect(cue.layers.rhythm!.params).toMatchObject({ perBeat: 2 });
		}
	});
});

describe('kit awareness', () => {
	it('releases a held techno rhythm when its kick leaves inside the section', () => {
		const track = fixture();
		for (const row of track.bars.slice(16, 24)) row.kicks = 0;
		const catalog = BUILT_IN_EFFECTS.filter((effect) => effect.role !== 'rhythm' || effect.id === 'blockChase');
		const composed = composeShow(track, { effects: catalog, context: { ...emptyContext(), genreFamily: 'techno' } });
		expect(composed.cues.find((cue) => cue.bar === 8)?.layers.rhythm?.effect).toBe('blockChase');
		expect(composed.cues.find((cue) => cue.bar === 16)?.layers.rhythm).toBeUndefined();
	});

	it('keeps kick effects out of the passages the kick sat out', () => {
		// The groove keeps its clap backbeat (snares stay), only the kick leaves - the exact
		// shape of the sung verse that used to get moshSlam pounding through it.
		const track = fixture();
		for (const bar of track.bars) if (bar.section === 'groove') bar.kicks = 0;
		for (let seed = 1; seed < 40; seed += 3) {
			const s = composeShow(track, { seed });
			for (const cue of s.cues) {
				if (track.bars[cue.bar]?.section !== 'groove') continue;
				for (const role of LAYER_ROLES) {
					const spec = cue.layers[role];
					if (!spec) continue;
					const def = effects.get(spec.effect)!;
					expect(def.taste.kit, `${spec.effect} at bar ${cue.bar} (seed ${seed})`).not.toBe(
						'kick'
					);
				}
			}
		}
	});

	it('demotes the arrival slam to a bump where the arrival bar has no kick', () => {
		const track = fixture();
		for (const bar of track.bars) if (bar.bar >= 40 && bar.bar < 72) bar.kicks = 0;
		const s = composeShow(track);
		const arrival = s.hits.find((h) => h.bar === 40);
		expect(arrival?.kind).toBe('bump');
		// The peak drop still kicks, so its slam stands.
		expect(s.hits.some((h) => h.bar === 96 && h.kind === 'slam')).toBe(true);
	});
});

describe('the peak earns its treatment', () => {
	const house = () => ({ ...emptyContext(), genreFamily: 'house' as const });

	it('a bloom family whose peak pounds gets slam treatment there', () => {
		// The fixture's drops run a kick per beat: four-on-the-floor. A soft bloom on top of
		// that is the rig missing the biggest moment of the night.
		const s = composeShow(analysis, { context: house() });
		expect(s.hits.some((h) => h.bar === 96 && h.kind === 'slam')).toBe(true);
		// The strobe comes into the peak with the override...
		expect(s.hits.some((h) => h.kind === 'strobe' && h.bar >= 94 && h.bar < 96)).toBe(true);
		// ...and the peak keeps hitting past its arrival.
		const inside = s.hits.filter((h) => h.kind === 'slam' && h.bar > 96 && h.bar < 120);
		expect(inside.length).toBe(2);
		for (const hit of inside) expect((hit.bar - 96) % 8).toBe(0);
	});

	it('a bloom family whose peak stays soft keeps the bloom', () => {
		const gentle = fixture();
		for (const bar of gentle.bars) bar.kicks = Math.min(bar.kicks, 1);
		const s = composeShow(gentle, { context: house() });
		expect(s.hits.some((h) => h.kind === 'strobe')).toBe(false);
		expect(s.hits.filter((h) => h.kind === 'slam' && h.bar > 96 && h.bar < 120)).toEqual([]);
	});
});

describe('the ring-out cue', () => {
	it('a one-bar outro inherits the bed it winds down from rather than going dark', () => {
		// The shape a ring-out carve leaves: the final drop runs to the second-to-last bar
		// and a one-bar outro holds the decay. Every bed wants two bars, so without the
		// inherit pass this cue lit nothing.
		const track = fixture();
		const drop = track.sections.find((s) => s.startBar === 96)!;
		const outro = track.sections.at(-1)!;
		drop.endBar = 127;
		drop.lengthBars = 31;
		outro.startBar = 127;
		outro.lengthBars = 1;
		for (const bar of track.bars) if (bar.bar >= 120 && bar.bar < 127) bar.section = 'drop';

		const s = composeShow(track);
		const last = s.cues.at(-1)!;
		expect(last.section).toBe('outro');
		expect(last.layers.bed).toBeDefined();
		expect(last.layers.bed!.effect).toBe(s.cues.at(-2)!.layers.bed!.effect);
	});
});

describe('the brief owns the doubt', () => {
	it('says explicitly when the grid is untrusted and the room runs lounge', () => {
		// Sections chopped to four bars across the whole track: the fragmentation that trips
		// the trust gate. The brief is the authoring system's own voice, so the verdict has
		// to be in it - a chip on a queue row is not the system saying so.
		const chopped = fixture();
		const bars = chopped.bars.length;
		chopped.sections = Array.from({ length: bars / 4 }, (_, i) => ({
			index: i,
			kind: 'groove' as const,
			startBar: i * 4,
			endBar: (i + 1) * 4,
			startTime: chopped.tempo.barTimes[i * 4],
			endTime: chopped.tempo.barTimes[(i + 1) * 4],
			lengthBars: 4,
			meanEnergy: 62,
			peakEnergy: 70,
			energyRank: i + 1,
			group: i,
			repeatOf: null
		}));
		for (const bar of chopped.bars) bar.section = 'groove';

		const doubted = composeShow(chopped);
		expect(doubted.brief).toContain('The analyser was not sure of this track');
		expect(doubted.brief).toContain('lounge scenes');

		// A trusted grid keeps its brief clean.
		expect(composeShow(analysis).brief).not.toContain('lounge scenes');
	});
});

describe('a track that is two songs', () => {
	/** The fixture with a second song starting at bar 72: the groove, build, drop and outro. */
	function twoSongs(): TrackAnalysis {
		const a = fixture();
		const seam = 72;
		return {
			...a,
			sections: a.sections.map((s) => ({ ...s, movement: s.startBar < seam ? 0 : 1 })),
			movements: [
				{ startBar: 0, endBar: seam, startTime: a.tempo.barTimes[0], endTime: a.tempo.barTimes[seam], bpm: 128, key: a.key, source: 'auto', note: '' },
				{ startBar: seam, endBar: 128, startTime: a.tempo.barTimes[seam], endTime: a.tempo.barTimes[128], bpm: 128, key: { tonic: 2, name: 'D major', mode: 'major', confidence: 0.8 }, source: 'auto', note: 'tempo 128 to 128, A minor to D major' }
			]
		};
	}
	const two = twoSongs();
	const stitched = composeShow(two);
	const verdictTwo = lintShow(stitched, { analysis: two, effects });
	const hueApart = (a: number, b: number) => Math.abs((((a - b) % 360) + 540) % 360 - 180);

	it('still lints clean', () => {
		expect(verdictTwo.errors.map((e) => `${e.rule}: ${e.message}`)).toEqual([]);
	});

	it('gives the second song a palette of its own, written into every one of its cues', () => {
		const second = stitched.cues.filter((c) => c.bar >= 72);
		expect(second.length).toBeGreaterThan(0);
		for (const cue of second) {
			expect(typeof cue.palette).toBe('object');
			const p = cue.palette as Exclude<typeof cue.palette, string | undefined>;
			// Its own base or its own accent: a swapped cue carries the song's accent as base.
			const base = Math.min(hueApart(p.base, stitched.palette.base), hueApart(p.accent, stitched.palette.base));
			expect(base).toBeGreaterThanOrEqual(60);
		}
	});

	it('arrives on the downbeat of the new song and marks it', () => {
		const arrival = stitched.cues.find((c) => c.bar === 72)!;
		expect(arrival).toBeDefined();
		expect(arrival.fadeBeats).toBe(0);
		expect(stitched.hits.some((h) => h.bar === 72 && (h.kind === 'slam' || h.kind === 'bump'))).toBe(true);
	});

	it('gives the first song a biggest moment of its own, under the peak the show reserves', () => {
		const firstDrop = stitched.cues.find((c) => c.bar === 40)!;
		expect(firstDrop.intensity).toBe(0.96);
		const peak = stitched.cues.find((c) => c.bar === 96)!;
		expect(peak.intensity).toBe(1);
	});

	it('is deterministic', () => {
		expect(JSON.stringify(composeShow(two))).toBe(JSON.stringify(stitched));
	});
});
