import type { ParamSpec } from '../contracts/effect.ts';
import type { ShowFrame } from '../contracts/frame.ts';
import type { Geometry, StripSpec } from '../contracts/room.ts';

export function param(
	key: string,
	label: string,
	def: number,
	min = 0,
	max = 1,
	step = 0.01
): ParamSpec {
	return { key, label, min, max, step, default: def };
}

export const INTENSITY = param('intensity', 'Intensity', 0.7);

/** Release time expressed in beats, so an effect retimes itself with the tempo. */
export function beatRelease(beatPeriod: number, beats = 0.6): number {
	return Math.max(beatPeriod * beats, 0.02);
}

/** Rising-edge detector for the player-driven `trigger` param. */
export class Edge {
	private prev = false;

	update(v: boolean): boolean {
		const fired = v && !this.prev;
		this.prev = v;
		return fired;
	}

	reset(): void {
		this.prev = false;
	}
}

/** One droplet sliding from a wall's end toward that wall's centre. */
export interface WallDrop {
	alive: boolean;
	wall: number;
	fromEnd: number;
	t0: number;
	/** Deterministic spawn number for seek-stable colour. */
	seq: number;
	/** Caller-defined colour value. */
	tint: number;
}

/** Fixed droplet pool, spawned round-robin on the grid; callers own colour. */
export class WallDrops {
	readonly walls: readonly StripSpec[];
	private readonly drops: WallDrop[] = [];
	private next = 0;
	private spawned = 0;
	private lastStep = -1;

	constructor(g: Geometry, max = 24) {
		this.walls = g.strips.filter((s) => s.inPerimeter);
		for (let i = 0; i < max; i++) {
			this.drops.push({ alive: false, wall: 0, fromEnd: 0, t0: 0, seq: 0, tint: 0 });
		}
	}

	/** At most one droplet per grid step. Returns it so the caller can colour it. */
	spawn(f: ShowFrame, perBeat: number): WallDrop | null {
		if (this.walls.length === 0) return null;
		const step = Math.floor((f.beatIndex + f.beatPhase) * Math.max(0.5, perBeat));
		if (step === this.lastStep) return null;
		this.lastStep = step;
		this.spawned++;

		const d = this.drops[this.next];
		this.next = (this.next + 1) % this.drops.length;
		d.alive = true;
		d.wall = this.spawned % this.walls.length;
		d.fromEnd = (this.spawned >> 2) % 2;
		d.t0 = f.t;
		d.seq = this.spawned;
		return d;
	}

	/** onFall receives progress and sub-pixel position; onLand fires once at the wall centre. */
	fall(
		f: ShowFrame,
		fallBeats: number,
		onFall: (drop: WallDrop, u: number, pos: number, wall: StripSpec) => void,
		onLand: (drop: WallDrop) => void
	): void {
		const fallTime = Math.max(0.3, fallBeats * f.beatPeriod);
		for (const d of this.drops) {
			if (!d.alive) continue;
			const u = (f.t - d.t0) / fallTime;
			if (u >= 1) {
				d.alive = false;
				onLand(d);
				continue;
			}
			const wall = this.walls[d.wall];
			// u^1.8 reads as gravity with drag; a linear slide reads as an animation.
			const dist = Math.pow(u, 1.8) * (wall.count / 2);
			onFall(d, u, d.fromEnd === 0 ? dist : wall.count - 1 - dist, wall);
		}
	}

	reset(): void {
		for (const d of this.drops) d.alive = false;
		this.next = 0;
		this.spawned = 0;
		this.lastStep = -1;
	}
}
