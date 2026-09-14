import { describe, expect, it } from 'vitest';
import type { NarrationPlan, SilentPlan, SongPlan } from '../contracts/evening.ts';
import { encodeBase64 } from '../base64.ts';
import { fixtureAnalysis, fixtureShow } from '../ambient/fixture.ts';
import { RoomDirector } from '../director.ts';
import { EffectRegistry } from '../effects/index.ts';
import { compileGenerated } from '../effects/sandbox.ts';
import { buildGeometry, DEFAULT_ROOM } from '../geometry.ts';
import { ShowPlayer } from '../player.ts';
import { Mixer } from '../mixer.ts';
import { block, effect, evening, fill, hold, look, moment, pause, song, sting } from './api.ts';
import { compileEvening, serializeCreate, slug } from './compile.ts';
import { barAt, silentAnalysis, silentShow, songShow } from './synth.ts';
import { hsv2rgb } from '../color/hsv.ts';
import { clockOnNight, nightMinutes, parseClock, parseLength } from './time.ts';

/** A create function whose source is exactly this text, as Node's type stripping leaves it. */
function source<T>(text: string): T {
	return new Function(`return (${text});`)() as T;
}

const glow = (id = 'glow') =>
	effect({
		id,
		role: 'bed',
		params: { level: 0.6 },
		create: source(
			'function create(g) { return { render(out, ctx) { const v = clamp(ctx.p.level * (0.5 + ctx.f.energy)); for (let i = 0; i < g.count; i++) setSample(out, i, ctx.palette, SLOT.glow, v); } }; }'
		)
	});

describe('lengths and clock times', () => {
	it('reads every length form as seconds', () => {
		expect(parseLength(90)).toBe(90);
		expect(parseLength('45s')).toBe(45);
		expect(parseLength('8m')).toBe(480);
		expect(parseLength('1h30m')).toBe(5400);
		expect(parseLength('3:30')).toBe(210);
		expect(parseLength('1:02:03')).toBe(3723);
		expect(parseLength('0:12')).toBe(12);
	});

	it('rejects malformed and negative lengths', () => {
		for (const bad of [-1, '', 'soon', '5x', Number.NaN, '1:75', null]) expect(parseLength(bad)).toBeNull();
	});

	it('orders a night that crosses midnight', () => {
		expect(parseClock('20:00')).toBe(1200);
		expect(parseClock('24:00')).toBeNull();
		expect(nightMinutes(parseClock('00:30')!)).toBeGreaterThan(nightMinutes(parseClock('23:30')!));
	});

	it('places clock times on the night, before and after midnight', () => {
		// 2026-09-19 21:00 in UTC+2 (offset -120), and 00:30 the next morning in the same zone.
		const evening = Date.UTC(2026, 8, 19, 19, 0);
		const lateNight = Date.UTC(2026, 8, 19, 22, 30);
		expect(clockOnNight(parseClock('23:00')!, evening, -120)).toBe(Date.UTC(2026, 8, 19, 21, 0));
		expect(clockOnNight(parseClock('00:30')!, evening, -120)).toBe(Date.UTC(2026, 8, 19, 22, 30));
		expect(clockOnNight(parseClock('20:00')!, lateNight, -120)).toBe(Date.UTC(2026, 8, 19, 18, 0));
	});
});

describe('serialising effects', () => {
	it('accepts function, arrow and method forms as sandbox source', () => {
		const forms = [
			'function create(g) { return { render(out) { out.fill(0.5); } }; }',
			'(g) => ({ render(out) { out.fill(0.5); } })',
			'({ create(g) { return { render(out) { out.fill(0.5); } }; } }).create'
		];
		const g = buildGeometry(DEFAULT_ROOM);
		for (const form of forms) {
			const text = serializeCreate(source(form));
			expect(text).not.toBeNull();
			const compiled = compileGenerated(
				{ id: 'x', name: 'x', role: 'bed', blurb: '', params: [], source: text! },
				g
			);
			expect(compiled.failures).toEqual([]);
		}
	});

	it('refuses async functions', () => {
		expect(serializeCreate(source('async function create(g) { return {}; }'))).toBeNull();
	});
});

describe('compiling an evening', () => {
	it('normalises segments, looks, stings and effects into plain data', () => {
		const flash = sting('Flash', { length: 2, timeline: [{ at: 0, section: 'void', look: 'resting' }] });
		const { script, findings } = compileEvening(
			evening('Saturday', {
				palette: 'ember',
				segments: [
					hold('Doors', { look: 'dusk', expectEnd: '20:00' }),
					moment('Ignition', {
						length: '16s',
						bpm: 128,
						pulse: 'four-on-the-floor',
						timeline: [
							{ at: 0, section: 'void', look: look({ bed: glow() }) },
							{ at: { bar: 4 }, section: 'drop', hit: 'slam' }
						]
					}),
					block('Detonation', {
						enter: { sting: flash, hit: 'slam' },
						songs: [song('poster boy', { id: 'jOLT6ukrQSg' }), fill({ count: 3, where: { heat: [4, 5] } })]
					}),
					pause('Breather', { music: [song('Snooze', { by: 'SZA' })] })
				]
			})
		);
		expect(findings.filter((f) => f.severity === 'error')).toEqual([]);
		expect(script).not.toBeNull();
		expect(JSON.parse(JSON.stringify(script))).toEqual(script);
		expect(script!.segments.map((s) => s.id)).toEqual(['doors', 'ignition', 'detonation', 'breather']);
		expect(script!.palette?.name).toBe('ember');
		expect(script!.effects.map((e) => e.id)).toEqual(['glow']);
		expect(script!.stings.map((s) => s.id)).toEqual(['flash']);

		const ignition = script!.segments[1];
		expect(ignition.kind === 'moment' && ignition.timeline[1].at).toBeCloseTo((60 / 128) * 4 * 4);
		const doors = script!.segments[0];
		expect(doors.kind === 'hold' && doors.expectAt).toBe('20:00');
		expect(doors.kind === 'hold' && doors.look.layers.bed?.effect).toBe('dusk');
	});

	it('reports what is wrong, where', () => {
		const bad = evening('Broken', {
			segments: [
				block('One', { songs: [] }),
				block('One', { songs: [fill({ count: 2, length: '10m' })] }),
				pause('Nothing', {}),
				moment('Spark', { length: 'soon' as never, timeline: [] }),
				block('Late', { at: '21:00', songs: [song('x')] }),
				block('Early', { at: '20:00', songs: [song('y')] })
			]
		});
		const messages = compileEvening(bad).findings.map((f) => `${f.segment}: ${f.message}`);
		expect(messages).toContain('one: A block needs at least one song or fill.');
		expect(messages).toContain('one: Two segments share the id "one"; give one an explicit id.');
		expect(messages).toContain('one: A fill takes a count or a length, not both.');
		expect(messages).toContain('nothing: A pause needs a length, an until time or music.');
		expect(messages.some((m) => m.startsWith('spark: length must be a length'))).toBe(true);
		expect(messages.some((m) => m.startsWith('early: 20:00 comes before'))).toBe(true);
	});

	it('runs custom effects through the gate and explains sandbox scope', () => {
		const leaky = effect({
			id: 'leaky',
			role: 'bed',
			create: source('function create(g) { return { render(out) { out.fill(OUTSIDE); } }; }')
		});
		const clash = effect({ id: 'wash', role: 'bed', create: source('function create(g) { return { render(out) { out.fill(0.4); } }; }') });
		const { findings } = compileEvening(
			evening('Effects', {
				segments: [
					hold('A', { look: look({ bed: leaky }) }),
					hold('B', { look: look({ bed: clash }) })
				]
			})
		);
		const errors = findings.filter((f) => f.severity === 'error').map((f) => f.message);
		expect(errors.some((m) => m.includes('"leaky" failed the effect gate') && m.includes('move constants into create'))).toBe(true);
		expect(errors).toContain('Effect id "wash" is already a built-in effect; choose another.');
	});

	it('lights a master that waits for a hit when a look names it', () => {
		const { script } = compileEvening(
			evening('Hits', { segments: [hold('Flash', { look: look({ master: 'strobe' }) })] })
		);
		const hold0 = script!.segments[0];
		expect(hold0.kind === 'hold' && hold0.look.layers.master?.params?.trigger).toBe(1);
	});

	it('lets only the fill that ends an open block go without a count', () => {
		const errors = (open: boolean) =>
			compileEvening(
				evening('Late', {
					segments: [block('Afterglow', { open, songs: [fill({ count: 2 }), fill({ where: { families: ['house'] } })] })]
				})
			).findings.filter((f) => f.severity === 'error');
		expect(errors(true)).toEqual([]);
		expect(errors(false).map((f) => f.message)).toEqual(['A fill needs a count or a length.']);
	});

	it('derives stable ids from names', () => {
		expect(slug('Párno Nýdrle: Afterglow!')).toBe('parno-nydrle-afterglow');
	});
});

const calmPlan = (overrides: Partial<SilentPlan> = {}): SilentPlan => ({
	kind: 'silent',
	title: 'Doors',
	length: 60,
	clock: { bpm: 120, beatsPerBar: 4, pulse: 'none' },
	timeline: [{ at: 0, look: { layers: { bed: { effect: 'dusk', opacity: 1 } } } }],
	palette: { base: 24, accent: 200 },
	calm: true,
	effects: [],
	...overrides
});

describe('silent rows', () => {
	it('builds a grid on the row clock with sections and hits from the timeline', () => {
		const plan = calmPlan({
			calm: false,
			length: 16,
			clock: { bpm: 120, beatsPerBar: 4, pulse: 'backbeat' },
			timeline: [
				{ at: 0, section: 'build', look: { layers: { rhythm: { effect: 'riser', opacity: 0.8 } } } },
				{ at: 8, section: 'void', hit: 'blackout', beats: 2 },
				{ at: 10, section: 'drop', look: { layers: { master: { effect: 'blinderWall', opacity: 1 } } }, hit: 'slam' }
			]
		});
		const analysis = silentAnalysis('row', plan);
		const show = silentShow(analysis, plan);
		expect(analysis.tempo.barTimes[1]).toBeCloseTo(2);
		expect(analysis.sections.map((s) => [s.kind, s.startTime])).toEqual([
			['build', 0],
			['void', 8],
			['drop', 10]
		]);
		expect(show.cues.map((c) => [c.bar, c.section])).toEqual([
			[0, 'build'],
			[4, 'void'],
			[5, 'drop']
		]);
		expect(show.hits.map((h) => [h.bar, h.kind])).toEqual([
			[4, 'blackout'],
			[5, 'slam']
		]);
		// The kit stays silent through the void.
		expect(analysis.onsets.kick.times.some((t) => t >= 8 && t < 10)).toBe(false);
		expect(analysis.onsets.snare.times.length).toBeGreaterThan(0);
	});

	it('lands kicks placed off the grid, even in the void', () => {
		const { script, findings } = compileEvening(
			evening('Heart', {
				segments: [
					moment('Heartbeat', {
						length: 4,
						pulse: 'kick',
						timeline: [
							{ at: 0, section: 'void', look: look({ bed: 'dusk' }) },
							{ at: 1.1, kick: true },
							{ at: 1.37, kick: 0.5 },
							{ at: 2, kick: 2 }
						]
					})
				]
			})
		);
		expect(findings.map((f) => f.message)).toContain('timeline[3].kick must be true or a strength above 0, up to 1.');
		const heart = script!.segments[0];
		if (heart.kind !== 'moment') throw new Error('expected a moment');
		const plan: SilentPlan = { kind: 'silent', title: 'Heartbeat', length: 4, clock: heart.clock, timeline: heart.timeline, palette: { base: 20, accent: 200 }, calm: false, effects: [] };
		const analysis = silentAnalysis('heart', plan);
		expect(analysis.onsets.kick.times).toEqual([1.1, 1.37]);
		expect(analysis.onsets.kick.levels).toEqual([1, 0.5]);

		const player = new ShowPlayer(new Mixer(buildGeometry(DEFAULT_ROOM)), new EffectRegistry());
		player.load(analysis, silentShow(analysis, plan));
		const envelope: number[] = [];
		for (let t = 0; t < 1.6; t += 1 / 60) envelope.push(player.update(t, 1 / 60).kickEnv);
		expect(Math.max(...envelope.slice(0, 55))).toBe(0);
		expect(Math.max(...envelope.slice(55, 80))).toBeGreaterThan(0.8);
	});

	it('is a pure function of the plan, so the preview and the hardware agree', () => {
		const plan = calmPlan();
		expect(silentShow(silentAnalysis('k', plan), plan)).toEqual(silentShow(silentAnalysis('k', plan), plan));
		expect(silentAnalysis('k', plan).hash).not.toBe(silentAnalysis('other', plan).hash);
	});

	it('keeps the house floor unless a look sets its own', () => {
		const g = buildGeometry(DEFAULT_ROOM);
		const floorOf = (plan: SilentPlan) => {
			const mixer = new Mixer(g);
			const player = new ShowPlayer(mixer, new EffectRegistry());
			const analysis = silentAnalysis('floor', plan);
			player.load(analysis, silentShow(analysis, plan));
			player.update(5, 1 / 60);
			return mixer.floor;
		};
		expect(floorOf(calmPlan())).toBeGreaterThan(0.3);
		expect(floorOf(calmPlan({ timeline: [{ at: 0, look: { layers: { bed: { effect: 'dusk', opacity: 1 } }, floor: 0 } }] }))).toBe(0);
		expect(floorOf(calmPlan({ timeline: [{ at: 0, look: { layers: { bed: { effect: 'dusk', opacity: 1 } }, floor: 0.1 } }] }))).toBeCloseTo(0.1);
	});

	it('eases a narration out where its audio ends, as a song does, unless it holds', () => {
		const fps = 100;
		const bytes = new Uint8Array(10 * fps).map((_, i) => (i < 9.5 * fps ? 180 : 0));
		const fadeAt = (end: NarrationPlan['end'], t: number) => {
			const plan: NarrationPlan = {
				kind: 'narration',
				title: 'Voice',
				length: 10,
				clock: { bpm: 120, beatsPerBar: 4, pulse: 'none' },
				timeline: [{ at: 0, look: { layers: { bed: { effect: 'dusk', opacity: 1 } } } }],
				palette: { base: 200, accent: 30 },
				volume: 1,
				end,
				effects: []
			};
			const analysis = silentAnalysis('voice', { ...plan, calm: false }, { duration: 10, level: { fps, data: encodeBase64(bytes) } });
			const mixer = new Mixer(buildGeometry(DEFAULT_ROOM));
			const player = new ShowPlayer(mixer, new EffectRegistry());
			player.load(analysis, silentShow(analysis, plan));
			player.update(t, 1 / 60);
			return mixer.fade;
		};
		expect(fadeAt('ease', 8.5)).toBe(1);
		expect(fadeAt('ease', 9.5)).toBeLessThan(0.5);
		expect(fadeAt('hold', 9.5)).toBe(1);
		expect(fadeAt('hold', 10)).toBe(1);
	});

	it('keeps a build rising through steps that only kick or change the look', () => {
		const plan = calmPlan({
			calm: false,
			length: 24,
			timeline: [
				{ at: 0, section: 'build', look: { layers: { bed: { effect: 'dusk', opacity: 1 } } } },
				...Array.from({ length: 19 }, (_, k) => ({ at: k + 1, kick: 1 })),
				{ at: 12, look: { layers: { bed: { effect: 'wash', opacity: 1 } } } },
				{ at: 20, section: 'drop' }
			]
		});
		const analysis = silentAnalysis('build', plan);
		const beat = (t: number) => analysis.envelopes.energy[Math.floor(t / analysis.tempo.beatPeriod)];
		expect(beat(19.5)).toBeGreaterThan(beat(10.5));
		expect(beat(10.5)).toBeGreaterThan(beat(1.5));
		expect(analysis.sections.map((s) => s.kind)).toEqual(['build', 'drop']);
	});

	it('gives a hold an open grid without the end-of-audio fade', () => {
		const analysis = silentAnalysis('hold', calmPlan({ length: null }));
		expect(analysis.duration).toBeGreaterThan(5 * 3600);
	});

	it('delivers a calm scene within a fifth of the resting room that scene lights', () => {
		const g = buildGeometry(DEFAULT_ROOM);
		const meanBytes = (d: RoomDirector) => d.bytes.reduce((a, b) => a + b, 0) / d.bytes.length;
		const { script } = compileEvening(evening('Calm', { segments: [hold('Doors', { look: 'dusk' })] }));
		const doors = script!.segments[0];
		if (doors.kind !== 'hold') throw new Error('expected a hold');

		const plan = calmPlan({ length: 120, timeline: [{ at: 0, look: doors.look }] });
		const analysis = silentAnalysis('calm', plan);
		const shown = new RoomDirector(g, new EffectRegistry());
		shown.load(analysis, silentShow(analysis, plan));
		const resting = new RoomDirector(g, new EffectRegistry());
		resting.ambientSettings = { source: 'fixed', hue: 24, sat: 0.94, drift: 0, dwell: 600 };

		let a = 0;
		let b = 0;
		for (let i = 0; i < 90 * 60; i++) {
			if (i === 1) resting.follow({ ambience: 1, stopped: 10, scene: 'dusk', sceneCounter: 1, sceneHeld: 0, idleT: 0 });
			shown.update(i / 60, 1 / 60, { playing: true, hasShow: true, lounge: false, rest: true });
			resting.update(0, 1 / 60, { playing: false, hasShow: false, lounge: false, rest: true });
			if (i >= 30 * 60) {
				a += meanBytes(shown);
				b += meanBytes(resting);
			}
		}
		expect(Math.abs(a / b - 1)).toBeLessThan(0.2);
	});
});

describe('song lighting', () => {
	const analysis = fixtureAnalysis(120);
	const show = fixtureShow(analysis);
	const overlayLook = { layers: { master: { effect: 'glow', opacity: 1 } } };
	const plan = (overrides: Partial<SongPlan>): SongPlan => ({
		kind: 'song',
		trackId: 'fixture',
		calm: false,
		overlays: [],
		effects: [],
		...overrides
	});

	it('finds named places in the song', () => {
		expect(barAt(analysis, 'first-drop')).toBe(40);
		expect(barAt(analysis, { section: 'build' })).toBe(32);
		expect(barAt(analysis, { bar: 12.4 })).toBe(12);
		expect(barAt(analysis, { section: 'chorus' })).toBeNull();
	});

	it('replaces the show over an overlay range and resumes the engine after it', () => {
		const lit = songShow(analysis, show, plan({ overlays: [{ from: 'start', to: 'first-drop', look: overlayLook }] }));
		expect(lit.cues[0]).toMatchObject({ bar: 0, layers: overlayLook.layers });
		expect(lit.cues.filter((c) => c.bar > 0 && c.bar < 40)).toEqual([]);
		const resumed = lit.cues.find((c) => c.bar === 40);
		expect(resumed?.layers).toEqual(show.cues.find((c) => c.bar === 40)?.layers);
		expect(lit.cues.slice(-1)[0].layers).toEqual(show.cues.slice(-1)[0].layers);
	});

	it('adds the entry hit and the evening effects once', () => {
		const gen = { id: 'glow', name: 'Glow', role: 'master' as const, blurb: '', params: [], source: 'function create(g) { return { render(out) { out.fill(0.2); } }; }' };
		const lit = songShow(analysis, { ...show, generatedEffects: [gen] }, plan({ hit: 'slam', effects: [gen] }));
		expect(lit.hits).toContainEqual({ bar: 0, kind: 'slam', beats: 1 });
		expect(lit.generatedEffects.map((g) => g.id)).toEqual(['glow']);
	});

	it('keeps calm music free of the engine show punctuation', () => {
		const punctuated = { ...show, hits: [{ bar: 8, kind: 'slam' as const, beats: 1 }] };
		expect(songShow(analysis, punctuated, plan({ calm: true, look: overlayLook })).hits).toEqual([]);
		expect(songShow(analysis, punctuated, plan({ look: overlayLook })).hits).toEqual(punctuated.hits);
	});

	it('gives an overlay its bars without engine hits, and its end hit the downbeat after', () => {
		const punctuated = {
			...show,
			hits: [
				{ bar: 4, kind: 'slam' as const, beats: 1 },
				{ bar: 39, beat: 3, kind: 'blackout' as const, beats: 1 },
				{ bar: 40, kind: 'strobe' as const, beats: 2 },
				{ bar: 48, kind: 'slam' as const, beats: 1 }
			]
		};
		const overlay = { from: 'start' as const, to: 'first-drop' as const, look: overlayLook };
		expect(songShow(analysis, punctuated, plan({ overlays: [overlay] })).hits.map((h) => [h.bar, h.kind])).toEqual([
			[40, 'strobe'],
			[48, 'slam']
		]);
		expect(songShow(analysis, punctuated, plan({ overlays: [{ ...overlay, end: 'slam' }] })).hits.map((h) => [h.bar, h.kind])).toEqual([
			[48, 'slam'],
			[40, 'slam']
		]);
	});

	it('tints a song toward its chapter without changing the light its colours deliver', () => {
		const delivered = (hue: number) => {
			const [r, g, b] = hsv2rgb(hue / 360, 0.96, 1);
			return 0.2126 * r ** 2.45 + 0.7152 * g ** 2.45 + 0.0722 * b ** 2.45;
		};
		const apart = (a: number, b: number) => Math.abs(((((a - b) % 360) + 540) % 360) - 180);
		const own = { base: 78, accent: 254, third: 172, sat: 0.96, shade: 0.12 };
		const chapter = { name: 'ultraviolet', base: 268, accent: 88, third: 320, sat: 0.94, shade: 0.16 };
		const lit = songShow(analysis, { ...show, palette: own }, plan({ palette: chapter }));
		expect(lit.palette).toMatchObject({ sat: 0.96, shade: 0.12 });
		for (const slot of ['base', 'accent', 'third'] as const) {
			const before = delivered(own[slot]);
			expect(Math.abs(delivered(lit.palette[slot]!) - before)).toBeLessThanOrEqual(0.15 * before + 1e-9);
		}
		// Each colour moves toward the chapter colour nearest to it, never away.
		expect(apart(lit.palette.base, 88)).toBeLessThan(apart(own.base, 88));
		expect(apart(lit.palette.accent, 268)).toBeLessThan(apart(own.accent, 268));

		// What the room shows stays the song's light.
		const g = buildGeometry(DEFAULT_ROOM);
		const lightOf = (s: typeof show) => {
			const director = new RoomDirector(g, new EffectRegistry());
			director.load(analysis, s);
			let sum = 0;
			for (let i = 0; i < 30 * 30; i++) {
				director.update(i / 30, 1 / 30, { playing: true, hasShow: true, lounge: false, rest: true });
				for (let k = 0; k < director.bytes.length; k += 3) sum += 0.2126 * director.bytes[k] + 0.7152 * director.bytes[k + 1] + 0.0722 * director.bytes[k + 2];
			}
			return sum;
		};
		const swapped = { ...show, palette: own, cues: show.cues.map((c, i) => (i % 2 === 1 ? { ...c, palette: 'swap' as const } : c)) };
		expect(Math.abs(lightOf(songShow(analysis, swapped, plan({ palette: chapter }))) / lightOf(swapped) - 1)).toBeLessThan(0.04);
	});

	it('plays a look over pause music at the song section levels, calmed', () => {
		const levels = { ...show, cues: show.cues.map((c, i) => ({ ...c, intensity: i % 2 === 0 ? 0.5 : 0.92 })) };
		const calm = songShow(analysis, levels, plan({ calm: true, look: overlayLook }));
		const quiet = calm.cues.filter((_, i) => i % 2 === 0).map((c) => c.intensity!);
		const loud = calm.cues.filter((_, i) => i % 2 === 1).map((c) => c.intensity!);
		expect(Math.max(...quiet)).toBeLessThan(Math.min(...loud));
		expect(Math.max(...loud)).toBeLessThanOrEqual(1.05);
		expect(songShow(analysis, levels, plan({ look: { ...overlayLook, intensity: 0.4 } })).cues.every((c) => c.intensity === 0.4)).toBe(true);
	});

	it('leaves the engine show unchanged when the song asks for nothing', () => {
		expect(songShow(analysis, show, plan({}))).toEqual({ ...show, cues: [...show.cues].sort((a, b) => a.bar - b.bar) });
	});

	it('plays overlay effects in the player', () => {
		const g = buildGeometry(DEFAULT_ROOM);
		const registry = new EffectRegistry();
		const gen = {
			id: 'glow',
			name: 'Glow',
			role: 'master' as const,
			blurb: '',
			params: [],
			source: 'function create(g) { return { render(out) { out.fill(0.3); } }; }'
		};
		registry.add(compileGenerated(gen, g).def!);
		const mixer = new Mixer(g);
		const player = new ShowPlayer(mixer, registry);
		player.load(analysis, songShow(analysis, show, plan({ overlays: [{ from: 'start', to: 'first-drop', look: overlayLook }], effects: [gen] })));
		player.update(1, 1 / 60);
		expect(mixer.layers.master.def?.id).toBe('glow');
		player.update(barAtTime(analysis, 41), 1 / 60);
		expect(mixer.layers.master.def?.id).not.toBe('glow');
	});
});

function barAtTime(a: ReturnType<typeof fixtureAnalysis>, bar: number): number {
	return a.tempo.barTimes[bar];
}
