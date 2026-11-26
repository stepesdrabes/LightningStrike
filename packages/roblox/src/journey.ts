import type { Geometry, Show, ShowFrame, TrackAnalysis } from '@mv/core';
import { EffectRegistry, RoomDirector, sectionBase } from '@mv/core';

export interface Song {
	analysis: TrackAnalysis;
	show: Show;
}

type Step =
	| { kind: 'load'; song: 0 | 1 }
	| { kind: 'seek' }
	| { kind: 'clear' }
	| { kind: 'frame'; t: number; playing: boolean };

const DT = 1 / 60;

/**
 * Windows of the first song through the director, then the handover into the second as the web
 * app makes it: its opening, a seek to its first drop, a seek to its ending, the show cleared for
 * a paused decode, and the next show played from its start.
 */
function journey(first: TrackAnalysis): Step[] {
	const steps: Step[] = [{ kind: 'load', song: 0 }];
	const play = (from: number, seconds: number, playing = true) => {
		for (let i = 0; i < Math.round(seconds / DT); i++) {
			steps.push({ kind: 'frame', t: playing ? from + i * DT : from, playing });
		}
	};
	const drop = first.sections.find((s) => sectionBase(s.kind) === 'drop');
	play(0, 12);
	steps.push({ kind: 'seek' });
	play(drop?.startTime ?? first.duration / 3, 10);
	steps.push({ kind: 'seek' });
	play(Math.max(0, first.duration - 8), 8.5);
	steps.push({ kind: 'clear' });
	play(first.duration + 0.5, 1.5, false);
	steps.push({ kind: 'load', song: 1 });
	play(0, 8);
	return steps;
}

/**
 * Run two directors through the same journey, one on `a`'s songs and one on `b`'s, and find the
 * first frame where their bytes, lamps, light or show frames differ.
 */
export function compareJourney(
	a: readonly [Song, Song],
	b: readonly [Song, Song],
	geometry: Geometry,
	lamps = 1
): { frames: number; difference: string | null } {
	const sides = [a, b].map((songs) => ({
		songs,
		director: new RoomDirector(geometry, new EffectRegistry(), lamps)
	}));
	let hasShow = false;
	let frames = 0;
	for (const step of journey(a[0].analysis)) {
		if (step.kind === 'frame') {
			const state = { playing: step.playing, hasShow, lounge: false, rest: true };
			const [x, y] = sides.map(({ director }) => ({ director, f: director.update(step.t, DT, state) }));
			const difference =
				sameFrame(x.f, y.f) ??
				same(x.director.frame, y.director.frame, 'light') ??
				same(x.director.bytes, y.director.bytes, 'bytes') ??
				same(x.director.lamps, y.director.lamps, 'lamps');
			if (difference) {
				return { frames, difference: `frame ${frames}, t ${step.t.toFixed(3)}: ${difference}` };
			}
			frames++;
		} else {
			for (const { songs, director } of sides) {
				if (step.kind === 'load') director.load(songs[step.song].analysis, songs[step.song].show);
				else if (step.kind === 'seek') director.seek();
				else director.clearShow();
			}
			if (step.kind !== 'seek') hasShow = step.kind === 'load';
		}
	}
	return { frames, difference: null };
}

function sameFrame(a: ShowFrame, b: ShowFrame): string | null {
	for (const key of Object.keys(a) as (keyof ShowFrame)[]) {
		const x = a[key];
		const y = b[key];
		if (x instanceof Float32Array) {
			const d = same(x, y as Float32Array, key);
			if (d) return d;
		} else if (!Object.is(x, y)) {
			return `${key} ${x} vs ${y}`;
		}
	}
	return null;
}

function same(a: ArrayLike<number>, b: ArrayLike<number>, what: string): string | null {
	if (a.length !== b.length) return `${what} length ${a.length} vs ${b.length}`;
	for (let i = 0; i < a.length; i++) {
		if (!Object.is(a[i], b[i])) return `${what}[${i}] ${a[i]} vs ${b[i]}`;
	}
	return null;
}
