import type { RoomModel } from '../contracts/room.ts';

export type LightTestKind = 'identify' | 'walk' | 'colours';

/** Encoded bytes, which are linear light: a whole strip at half keeps a small supply calm. */
const FILL = 110;
const DOT = 255;
const PULSE_HZ = 1.2;
/** A dot crosses a light at this many LEDs a second, but never faster than two seconds a lap. */
const WALK_LEDS_PER_S = 60;
const WALK_MIN_S = 2;
const TAIL = 6;
const COLOUR_S = 0.8;
const COLOURS: readonly [number, number, number][] = [
	[FILL, 0, 0],
	[0, FILL, 0],
	[0, 0, FILL],
	[FILL, FILL, FILL]
];
/** Ends a test someone forgot, so the room never stays on a pattern. */
const LIMIT_S = 60;

/**
 * A setup aid drawn over the show. `identify` pulses the lights under test so they can be told
 * apart, `walk` runs a dot from the first LED to the last with the first held green and the last
 * red, and `colours` steps red, green, blue and white, which shows a wrong colour order at once.
 * Every other light goes dark while a test runs.
 */
export class LightTest {
	private kind: LightTestKind | null = null;
	private lights = new Set<string>();
	private t = 0;

	constructor(private readonly model: RoomModel) {}

	get active(): boolean {
		return this.kind !== null;
	}

	start(kind: LightTestKind, lightIds: readonly string[]): void {
		this.kind = kind;
		this.lights = new Set(lightIds);
		this.t = 0;
	}

	stop(): void {
		this.kind = null;
		this.lights.clear();
	}

	apply(bytes: Uint8Array, lamps: Uint8Array, dt: number): void {
		const kind = this.kind;
		if (!kind) return;
		this.t += dt;
		if (this.t > LIMIT_S) {
			this.stop();
			return;
		}
		bytes.fill(0);
		lamps.fill(0);
		const pulse = 0.35 + 0.65 * (0.5 + 0.5 * Math.cos(this.t * Math.PI * 2 * PULSE_HZ));
		const colour = COLOURS[Math.floor(this.t / COLOUR_S) % COLOURS.length];

		for (const p of this.model.pixels) {
			if (!this.lights.has(p.light.id)) continue;
			const n = p.index.length;
			if (kind === 'identify') {
				const v = Math.round(FILL * pulse);
				for (let k = 0; k < n; k++) set(bytes, p.index[k], v, v, v);
			} else if (kind === 'colours') {
				for (let k = 0; k < n; k++) set(bytes, p.index[k], ...colour);
			} else {
				const lap = Math.max(WALK_MIN_S, n / WALK_LEDS_PER_S);
				const head = ((this.t % lap) / lap) * n;
				for (let k = 0; k < n; k++) {
					const behind = head - k;
					const v = behind >= 0 && behind < TAIL ? Math.round(DOT * (1 - behind / TAIL)) : 0;
					set(bytes, p.index[k], v, v, v);
				}
				set(bytes, p.index[0], 0, DOT, 0);
				if (n > 1) set(bytes, p.index[n - 1], DOT, 0, 0);
			}
		}

		this.model.lamps.forEach((lamp, i) => {
			if (!this.lights.has(lamp.id)) return;
			const [r, g, b] = kind === 'identify' ? [FILL * pulse, FILL * pulse, FILL * pulse] : colour;
			lamps[i * 3] = Math.round(r);
			lamps[i * 3 + 1] = Math.round(g);
			lamps[i * 3 + 2] = Math.round(b);
		});
	}
}

function set(bytes: Uint8Array, i: number, r: number, g: number, b: number): void {
	bytes[i * 3] = r;
	bytes[i * 3 + 1] = g;
	bytes[i * 3 + 2] = b;
}
