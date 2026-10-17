/**
 * Podzimní listí. One October day from a golden afternoon to the first frost, told by a single
 * leaf on the beam, which plays its branch: the last green after the storm at Go, scarlet in the
 * backdraft at midnight, and at the end it lets go and falls into the south-west corner above the
 * Bounce Lamp. At about 21:40 the night stops for a birthday, and at midnight it counts down on
 * the frame.
 *
 * Ring pixels run 0-561 from the north-west corner (north 0-169 west to east, east 170-280,
 * south 281-450 east to west, west 451-561 south to north); the beam runs 562-670 from south to
 * north. Landmarks derive from the run lengths. Every effect is a function of time, so the
 * preview and the fixture draw the same frames. Output gamma is 2.45: 0.45 is the dimmest colour
 * that reads cleanly, so light arrives and leaves as a front or pixel by pixel, never as a fade.
 * Full-room flashes stay single or under three a second; only small regions strobe faster. Every
 * moment arrives as a bloom opening out of where its story ends, never as a flash.
 *
 * The frame doubles as one 7-segment digit for a guest facing west and looking up: the east wall
 * is the top segment, the west wall the bottom, the north and south walls the sides split at the
 * beam's ends, and the beam the middle bar. `flip` turns it round for guests facing east.
 */
import {
	SLOT,
	addSample,
	block,
	clamp,
	effect,
	evening,
	fill,
	hash01,
	hold,
	lerp,
	look,
	narration,
	noise3,
	pause,
	setSample,
	smoothstep,
	song,
	type ShowPalette
} from 'lightningstrike';
import {
	BURCAK,
	DRAKIADA,
	LIST,
	NAROZENINY,
	ORIONIDY,
	PULNOC,
	SFOUKNUTO,
	SPACCI,
	VITR,
	ZARE,
	candles,
	countdown,
	dropTime,
	fireworks,
	hushBeats,
	kicks,
	lapEnds,
	rattles,
	spacciDrums,
	spelling,
	stormDrums,
	swingTimes,
	tugs,
	tune,
	warDrums
} from './podzimni-listi/timing.ts';

/** The leaf rides `base` in the canopy, `third` in the day's palettes and `accent` from the fog on. */
const canopy: ShowPalette = { name: 'canopy', base: 100, accent: 46, third: 72, sat: 0.88, shade: 0.12 };
const zlato: ShowPalette = { name: 'zlaté odpoledne', base: 40, accent: 205, third: 22, sat: 0.92, shade: 0.12 };
const drak: ShowPalette = { name: 'drak', base: 205, accent: 356, third: 62, sat: 0.94, shade: 0.12 };
const vinice: ShowPalette = { name: 'vinice', base: 285, accent: 46, third: 22, sat: 0.9, shade: 0.12 };
const burcakPalette: ShowPalette = { name: 'burčák', base: 335, accent: 48, third: 30, sat: 0.86, shade: 0.12 };
const dort: ShowPalette = { name: 'dort', base: 340, accent: 40, third: 28, sat: 0.85, shade: 0.12 };
const oslava: ShowPalette = { name: 'oslava', base: 45, accent: 320, third: 190, sat: 0.95, shade: 0.1 };
const lesk: ShowPalette = { name: 'lesk na rty', base: 335, accent: 275, third: 200, sat: 0.8, shade: 0.12 };
const zare: ShowPalette = { name: 'polární záře', base: 140, accent: 290, third: 350, sat: 0.92, shade: 0.1 };
const mlha: ShowPalette = { name: 'mlha', base: 212, accent: 34, third: 190, sat: 0.7, shade: 0.12, white: 0.1 };
/** The fire takes the fog with the leaf still gold; the leaf turns scarlet at midnight. */
const plamen: ShowPalette = { name: 'plamen', base: 18, accent: 44, third: 46, sat: 0.95, shade: 0.1 };
const ohen: ShowPalette = { name: 'oheň', base: 18, accent: 356, third: 46, sat: 0.96, shade: 0.1 };
const lampiony: ShowPalette = { name: 'lampiony', base: 26, accent: 350, third: 52, sat: 0.9, shade: 0.1 };
const hvezdy: ShowPalette = { name: 'hvězdy', base: 228, accent: 135, third: 30, sat: 0.9, shade: 0.1 };
const vinobrani: ShowPalette = { name: 'vinobraní', base: 322, accent: 88, third: 44, sat: 0.9, shade: 0.12 };
const jinovatka: ShowPalette = { name: 'jinovatka', base: 218, accent: 356, third: 40, sat: 0.85, shade: 0.12, white: 0.08 };

/** A palette fade is written in beats of the row's own grid. */
const beatsOf = (seconds: number, bpm: number) => Math.round((seconds * bpm) / 60);

/** Songs taken out of the night, which the fills would otherwise pick from the library. */
const removed = [
	'i34pFNr42mc', // Jamaican (Bam Bam)
	'SBqvDDh_Trw', // NARCOS
	'jrfpCYp3B1M', // Bomby
	'zEfM0w7n6XQ', // Givenchy
	'TNEkNkVByyA', // Deja Vu
	'aZ1hziFhj1o', // Love Story
	'p0BiGek2bKA', // Since U Been Gone
	'lFQdcPTTzSg', // Dai Dai
	'8GEObTEFEeo' // Baddadan
];

// ---- Vítr ---------------------------------------------------------------------------------------

/**
 * The doors and the opening, scored by podzimni-listi/vitr.m4a: a green canopy with the sun through it
 * and gossamer drifting; two gusts out of the west wall; a storm whose vortex of torn leaves laps
 * the room ever faster on the drums; the great gust that takes everything but one leaf; silence,
 * and the gold blooming out of that leaf over the whole frame.
 */
const vitr = effect({
	id: 'vitr',
	name: 'Vítr',
	role: 'bed',
	blurb: 'Canopy and gossamer; gusts, then a storm whose vortex of leaves strips it to one leaf, and gold.',
	// The soundtrack's timing table arrives as parameters; the formulas below mirror timing.ts.
	// `doors` holds the still canopy for as long as the doors are open.
	params: { ...VITR, doors: 0 },
	create(g) {
		let ring = 0;
		for (const s of g.strips) if (s.inPerimeter) ring += s.count;
		const [alongRun, acrossRun] = [g.strips[0].count, g.strips[1].count];
		const beamStart = ring;
		const beamCount = g.count - ring;
		const half = beamCount / 2;
		const leaf = Math.floor(beamCount / 2);
		const north = Math.round(alongRun / 2);
		const south = alongRun + acrossRun + Math.round(alongRun / 2);
		const west = 2 * alongRun + acrossRun + Math.round(acrossRun / 2);
		const wrap = (i: number) => ((i % ring) + ring) % ring;
		const apart = (a: number, b: number) => {
			const d = wrap(a - b);
			return d > ring / 2 ? ring - d : d;
		};
		const hit = (age: number, tau: number) => (age < 0 ? 0 : age < 0.02 ? age / 0.02 : Math.exp(-(age - 0.02) / tau));
		const fromWest = new Float32Array(ring);
		for (let i = 0; i < ring; i++) fromWest[i] = apart(i, west);
		const toBeam = apart(west, south);
		// The order the green goes in: clumps of leaves with ragged edges, not single pixels.
		const clump = new Float32Array(g.count);
		for (let i = 0; i < g.count; i++) clump[i] = 0.8 * clamp((noise3(i * 0.07, 3.3, 9.1) - 0.25) / 0.5) + 0.2 * hash01(i * 7 + 3);
		// The ring laid on a circle and the beam across it, so one noise field is the whole canopy.
		const skyX = new Float32Array(g.count);
		const skyY = new Float32Array(g.count);
		for (let i = 0; i < g.count; i++) {
			if (i < ring) {
				const a = (i / ring) * Math.PI * 2;
				skyX[i] = Math.cos(a) * 1.45;
				skyY[i] = Math.sin(a) * 1.45;
			} else {
				skyY[i] = ((i - beamStart) / beamCount - 0.5) * 2.9;
			}
		}
		// The two gusts and the great one.
		const gustAt = new Float32Array(3);
		const gustCross = new Float32Array(3);
		const gustStrip = new Float32Array(3);
		const gustSize = new Float32Array([0.6, 0.85, 1.4]);

		let drumAge = -1;
		let drumSize = 0;
		/** Mirrors stormDrums() in timing.ts: the latest drum at or before `t`. */
		const lastDrum = (t: number, storm: number, rush: number, peak: number, bpm: number) => {
			drumAge = -1;
			drumSize = 0;
			if (t < storm) return;
			const beat = 60 / bpm;
			for (let n = Math.floor((Math.min(t, peak - 1e-6) - storm) / (beat / 2)); n >= 0; n--) {
				const at = storm + (n * beat) / 2;
				const inBar = n % 8;
				let size = 0;
				if (at < rush - 1e-6) size = inBar === 0 ? 1 : inBar === 4 || inBar === 5 ? 0.6 : 0;
				else if (at < peak - 4 * beat - 1e-6) size = n % 2 === 0 ? (inBar === 0 ? 1 : 0.75) : 0;
				else size = n % 2 === 0 ? 0.9 : 0.6;
				if (size > 0) {
					drumAge = t - at;
					drumSize = size;
					return;
				}
			}
		};

		/**
		 * Gossamer drifting on the breeze, seen only while a thread catches the sun: the whole
		 * thread lights faintly and a glint runs along it. From `all` seconds every thread at once.
		 */
		const threads = (out: Float32Array, palette: Float32Array, t: number, all: number) => {
			for (let j = 0; j < 12; j++) {
				const period = 24 + 10 * hash01(j * 7 + 1);
				const shifted = t + hash01(j * 11 + 2) * period;
				const c = Math.floor(shifted / period);
				const tau = shifted - c * period;
				const length = 10 + Math.floor(20 * hash01(c * 19 + j * 3 + 5));
				const from = hash01(c * 31 + j * 17 + 3) * ring + (3 + 6 * hash01(c * 13 + j * 5 + 4)) * tau;
				let shine = 0;
				let head = -100;
				if (all >= 0) {
					shine = hit(all, 0.5);
					head = (all / 1.2) * (length + 8) - 4;
				} else {
					for (let k = 0; k < 2; k++) {
						const u = (tau - 2 - (period - 6) * hash01(c * 23 + j * 3 + k * 41 + 7)) / 1.6;
						if (u < 0 || u > 1) continue;
						shine = 0.55 * Math.sin(Math.PI * u);
						head = u * (length + 8) - 4;
					}
				}
				if (shine < 0.01) continue;
				for (let q = 0; q < length; q++) {
					const i = wrap(Math.round(from + q + 1.2 * Math.sin(t * 0.9 + q * 0.4 + j)));
					addSample(out, i, palette, SLOT.white, shine + 1.1 * Math.exp(-((q - head) * (q - head)) / 4));
				}
			}
		};

		return {
			render(out, { f, p, palette }) {
				const t = f.t;
				out.fill(0);
				const doors = p.doors > 0.5;
				const beat = 60 / p.bpm;

				if (!doors && t >= p.gold) {
					// The gold blooms out of the leaf: along the beam, out of both its ends and round
					// the ring both ways, with the sun's spokes turning over it and glitter thrown up.
					const age = t - p.gold;
					const along = 15 + age * 220;
					for (let b = 0; b < beamCount; b++) {
						const off = Math.abs(b - leaf);
						if (off > along) continue;
						setSample(out, beamStart + b, palette, SLOT.accent, 0.85 + 0.1 * noise3(b * 0.05, t * 0.3, 4.4));
						if (along - off < 5 && along < half) addSample(out, beamStart + b, palette, SLOT.white, 1.2);
					}
					const round = Math.max(0, (age - (half - 15) / 220) * 400);
					const turn = 0.1 * age + 0.6 * (1 - Math.exp(-age / 0.8));
					const rays = 1 - 0.4 * smoothstep(0, p.end - p.gold, age);
					for (let i = 0; i < ring; i++) {
						const behind = round - Math.min(apart(i, north), apart(i, south));
						if (behind < 0) continue;
						setSample(out, i, palette, SLOT.accent, 0.8 + 0.12 * noise3(skyX[i] * 1.2, skyY[i] * 1.2, t * 0.05 + 5));
						if (behind < 24 && round < ring / 4 + 30) addSample(out, i, palette, SLOT.white, 1.3 * (1 - behind / 24));
						const spoke = Math.pow(Math.max(0, Math.cos((i / ring - turn) * Math.PI * 16)), 8);
						if (spoke > 0.02) addSample(out, i, palette, SLOT.white, 0.8 * rays * spoke);
					}
					for (let slot = Math.floor(t * 30) - 3; slot <= Math.floor(t * 30); slot++) {
						if (slot / 30 < p.gold) continue;
						const since = t - slot / 30;
						const count = 1 + Math.round(9 * Math.exp(-(slot / 30 - p.gold) / 1.5));
						for (let j = 0; j < count; j++) {
							addSample(out, Math.floor(hash01(slot * 19 + j * 7 + 3) * g.count), palette, SLOT.white, 1.3 * Math.exp(-since / 0.06));
						}
					}
					for (let d = -3; d <= 3; d++) setSample(out, beamStart + leaf + d, palette, SLOT.base, 0.6 + 0.5 * (1 - Math.abs(d) / 4));
					addSample(out, beamStart + leaf, palette, SLOT.white, 0.5);
					return;
				}

				if (!doors && t >= p.hush) {
					// Silence: only the leaf, the branch glowing with its two beats, and the light drawn
					// in along the beam to it as the gold gathers.
					const pulse = Math.max(hit(t - p.hush - beat, 0.25), hit(t - p.hush - 2 * beat, 0.25));
					if (pulse > 0.5) {
						for (let b = 0; b < beamCount; b++) setSample(out, beamStart + b, palette, SLOT.base, 0.6 * pulse);
					}
					const drawn = smoothstep(p.hush + 2 * beat + 0.1, p.gold, t);
					if (drawn > 0) {
						const at = Math.round((leaf - 4) * drawn * drawn);
						for (let q = 0; q < 6; q++) {
							const level = q === 0 ? 1.2 : 0.9 * (1 - q / 6);
							if (at - q >= 0) setSample(out, beamStart + at - q, palette, q === 0 ? SLOT.white : SLOT.accent, level);
							if (at - q >= 0) setSample(out, beamStart + beamCount - 1 - at + q, palette, q === 0 ? SLOT.white : SLOT.accent, level);
						}
					}
					for (let d = -3; d <= 3; d++) {
						setSample(out, beamStart + leaf + d, palette, SLOT.base, (0.55 + 0.4 * (1 - Math.abs(d) / 4)) * (1 + 0.5 * pulse));
					}
					addSample(out, beamStart + leaf, palette, SLOT.white, 0.5 * drawn);
					return;
				}

				gustAt[0] = p.gust1;
				gustAt[1] = p.gust2;
				gustAt[2] = p.peak;
				gustCross[0] = p.cross1;
				gustCross[1] = p.cross2;
				gustCross[2] = p.crossPeak;
				gustStrip[0] = p.strip1;
				gustStrip[1] = p.strip2;
				gustStrip[2] = 1;
				const breeze = 0.05 * Math.sin(t * 0.5) + 0.03 * Math.sin(t * 0.23 + 1);
				const storming = doors ? 0 : smoothstep(p.storm, p.peak, t);
				// Mirrors stormStrip() in timing.ts.
				const stripped = p.strip2 + (0.8 - p.strip2) * Math.pow(clamp((t - p.storm) / (p.peak - p.storm)), 1.3);
				lastDrum(t, p.storm, p.rush, p.peak, p.bpm);
				const flare = doors || drumAge < 0 ? 0 : drumSize * hit(drumAge, 0.18);

				for (let i = 0; i < g.count; i++) {
					const onBeam = i >= ring;
					const b = i - beamStart;
					if (onBeam && Math.abs(b - leaf) <= 3) continue;
					let sway = breeze;
					// Seconds since this pixel's green was torn off; -1 while it holds.
					let torn = -1;
					let flying = 0;
					let wall = 0;
					if (!doors) {
						for (let k = 0; k < 3; k++) {
							// The storm takes its share between the second gust and the great one.
							if (k === 2 && torn < 0 && t >= p.storm && clump[i] >= p.strip2 && clump[i] < stripped) {
								torn = t - (p.storm + Math.pow((clump[i] - p.strip2) / (0.8 - p.strip2), 1 / 1.3) * (p.peak - p.storm));
							}
							const speed = ring / 2 / gustCross[k];
							const arrive = onBeam
								? gustAt[k] + toBeam / speed + (Math.min(b, beamCount - 1 - b) * (k === 2 ? 0.6 : 1.1)) / half
								: gustAt[k] + fromWest[i] / speed;
							const age = t - arrive;
							if (age < 0) continue;
							if (age < 4) sway += gustSize[k] * 0.35 * Math.exp(-age / 1.6) * Math.sin(6.9 * age);
							if (torn < 0 && clump[i] < gustStrip[k]) torn = age;
							// Leaves torn off ride the front: a pattern indexed from the front moves with it.
							const rel = age * speed;
							if (!onBeam && rel < 60 && hash01(Math.floor(rel) * 13 + k * 101) < 0.16 * gustSize[k]) {
								flying = Math.max(flying, 1 - rel / 60);
							}
							if (k === 2 && rel < 30) wall = 1 - rel / 30;
						}
					}
					if (torn < 0) {
						const n = noise3(skyX[i] * 1.6 + sway, skyY[i] * 1.6, t * 0.04);
						let level = 0.47 + 0.2 * n;
						// The branch straining: a wave running along the beam, faster as the storm grows.
						if (onBeam) level *= 1 + 0.25 * storming * Math.sin(b * 0.25 - t * (4 + 14 * storming));
						setSample(out, i, palette, lerp(SLOT.base, SLOT.glow, 0.5 * n), level + 0.3 * flare);
						// The sun through the leaves, in gold flecks that shift as the canopy moves.
						const fleck = noise3(skyX[i] * 5 + sway * 2.2, skyY[i] * 5, t * 0.12 + 3.1);
						if (fleck > 0.68) addSample(out, i, palette, SLOT.accent, (fleck - 0.68) * 3.2 * (1 - storming));
					} else if (torn < 0.11) addSample(out, i, palette, SLOT.white, 0.9 * Math.exp(-torn / 0.12));
					// Torn pixels are dark, so the specks stop where they could not hold a colour.
					if (flying > 0.35) addSample(out, i, palette, lerp(SLOT.base, SLOT.third, hash01(i * 3 + 1)), flying);
					if (wall > 0) addSample(out, i, palette, SLOT.white, 1.3 * wall);
				}

				if (!doors && t >= p.storm) {
					// The vortex: torn leaves lapping the ring, more of them as the canopy goes, faster
					// every lap, smearing into trails; after the peak they fly off one by one.
					const span = p.peak - p.storm;
					const u = clamp((t - p.storm) / span);
					const k0 = span / (p.lapTo - p.lapFrom);
					const turn = k0 * Math.log((p.lapFrom + (p.lapTo - p.lapFrom) * u) / p.lapFrom) + Math.max(0, t - p.peak) / p.lapTo;
					const lapNow = t < p.peak ? p.lapFrom + (p.lapTo - p.lapFrom) * u : p.lapTo;
					const trail = Math.round(2 + (26 * (p.lapFrom / lapNow - 1)) / (p.lapFrom / p.lapTo - 1));
					const density = t >= p.peak ? 1 : clamp(((stripped - p.strip2) / (0.8 - p.strip2)) * 1.4 + 0.08);
					for (let k = 0; k < 110; k++) {
						if (hash01(k * 7 + 1) > density) continue;
						if (t > p.peak + 0.3 + (p.hush - 0.5 - p.peak) * hash01(k * 13 + 5)) continue;
						const head = wrap(Math.round((k / 110 + turn * (0.85 + 0.3 * hash01(k * 11 + 2))) * ring + 8 * Math.sin(t * 1.7 + k)));
						const pick = hash01(k * 3 + 9);
						const tone = pick < 0.4 ? SLOT.base : pick < 0.75 ? SLOT.third : SLOT.accent;
						// The trail ends where it would drop into the dither codes over the torn canopy.
						for (let q = 0; q <= trail; q++) {
							const level = q < 2 ? 1.1 : 0.9 * Math.pow(1 - q / (trail + 1), 1.5);
							if (level < 0.34) break;
							addSample(out, wrap(head - q), palette, tone, level);
						}
						if (flare > 0.05) addSample(out, head, palette, SLOT.white, 0.8 * flare);
					}
					// The wind itself, made visible in the rush: thin streaks outrunning the leaves.
					const rush = t < p.peak ? smoothstep(p.rush, p.rush + 1, t) : 0;
					for (let j = 0; j < 6 && rush > 0; j++) {
						const head = wrap(Math.round((j / 6 + 1.4 * turn + hash01(j * 5 + 3)) * ring));
						for (let q = 0; q < 12; q++) addSample(out, wrap(head - q), palette, SLOT.white, 0.8 * rush * (1 - q / 18));
					}
					if (t >= p.peak && t < p.peak + 0.08) {
						for (let i = 0; i < g.count; i++) setSample(out, i, palette, SLOT.white, 1.2);
					}
				}

				// The leaf: part of the green until the storm leaves it alone on the branch, and shaking.
				const flutter = 0.3 * storming * Math.sin(2 * Math.PI * 8 * t);
				for (let d = -3; d <= 3; d++) {
					setSample(out, beamStart + leaf + d, palette, SLOT.base, (0.5 + 0.38 * (1 - Math.abs(d) / 4)) * (1 + flutter));
				}

				if (doors) threads(out, palette, t, -1);
				else if (t >= p.glint && t < p.glint + 2.5) threads(out, palette, t, t - p.glint);
			}
		};
	}
});

// ---- Drakiáda -----------------------------------------------------------------------------------

/**
 * Into the kite block, scored by podzimni-listi/drakiada.m4a: the kite climbs the beam pull by pull,
 * each pull firing colour round the room; a gale takes it at the top and the wind races round
 * the frame; the line snaps, and the kite spirals free round the room, faster every lap, painting
 * it in ribbons until it soars and they bloom round the room.
 */
const drakiada = effect({
	id: 'drakiada',
	name: 'Drakiáda',
	role: 'bed',
	blurb: 'A kite climbs in pulls, thrashes in a gale, snaps free, spirals the room and soars into ribbons.',
	params: DRAKIADA,
	create(g) {
		let ring = 0;
		for (const s of g.strips) if (s.inPerimeter) ring += s.count;
		const [alongRun, acrossRun] = [g.strips[0].count, g.strips[1].count];
		const beamStart = ring;
		const beamCount = g.count - ring;
		const half = beamCount / 2;
		const leaf = Math.floor(beamCount / 2);
		const north = Math.round(alongRun / 2);
		const south = alongRun + acrossRun + Math.round(alongRun / 2);
		const wrap = (i: number) => ((i % ring) + ring) % ring;
		const hit = (age: number, tau: number) => (age < 0 ? 0 : age < 0.02 ? age / 0.02 : Math.exp(-(age - 0.02) / tau));
		const skyX = new Float32Array(g.count);
		const skyY = new Float32Array(g.count);
		for (let i = 0; i < g.count; i++) {
			if (i < ring) {
				const a = (i / ring) * Math.PI * 2;
				skyX[i] = Math.cos(a) * 1.45;
				skyY[i] = Math.sin(a) * 1.45;
			} else {
				skyY[i] = ((i - beamStart) / beamCount - 0.5) * 2.9;
			}
		}
		return {
			render(out, { f, p, palette }) {
				const t = f.t;
				out.fill(0);
				const beat = 60 / p.bpm;
				const drop = p.snap + p.spiral;

				if (t >= drop) {
					// It soars: the ribbons it painted bloom out of the north end both ways round the
					// room into two trains running opposite ways, brightest where they cross, the beam
					// filling from its north end, and confetti over all of it.
					const age = t - drop;
					const run = 300 * 2.5 * (1 - Math.exp(-age / 2.5));
					const bloom = age * 420;
					for (let i = 0; i < ring; i++) {
						const along = wrap(i - north);
						const behind = bloom - Math.min(along, ring - along);
						const one = Math.floor((along + run) / 16) % 2 === 0;
						const two = Math.floor((along - run + 8) / 16) % 2 === 0;
						if (behind < 0) {
							// Still the spiral's last layer, until the bloom reaches it.
							setSample(out, i, palette, Math.floor((along + t * 60) / 14) % 2 === 0 ? SLOT.third : SLOT.accent, 0.9);
							continue;
						}
						setSample(out, i, palette, one ? SLOT.accent : SLOT.third, one === two ? 0.95 : 0.72);
						if (behind < 30 && bloom < ring / 2 + 30) addSample(out, i, palette, SLOT.white, 1.2 * (1 - behind / 30));
					}
					for (let b = 0; b < beamCount; b++) {
						const behind = bloom * 0.5 - (beamCount - 1 - b);
						if (behind < 0) continue;
						const band = Math.floor((Math.abs(b - leaf) - run * 0.5 + 400) / 10) % 2 === 0;
						setSample(out, beamStart + b, palette, band ? SLOT.accent : SLOT.third, 0.85);
						if (behind < 10 && bloom * 0.5 < beamCount + 10) addSample(out, beamStart + b, palette, SLOT.white, 1.1 * (1 - behind / 10));
					}
					for (let slot = Math.floor(t * 30) - 3; slot <= Math.floor(t * 30); slot++) {
						if (slot / 30 < drop) continue;
						const since = t - slot / 30;
						const count = 1 + Math.round(10 * Math.exp(-(slot / 30 - drop) / 1.6));
						for (let j = 0; j < count; j++) {
							const pick = hash01(slot * 13 + j * 5 + 1);
							const tone = pick < 0.33 ? SLOT.white : pick < 0.66 ? SLOT.accent : SLOT.third;
							addSample(out, Math.floor(hash01(slot * 29 + j * 11 + 7) * g.count), palette, tone, 1.3 * Math.exp(-since / 0.07));
						}
					}
					for (let d = -3; d <= 3; d++) setSample(out, beamStart + leaf + d, palette, SLOT.third, 0.6 + 0.5 * (1 - Math.abs(d) / 4));
					return;
				}

				// Mirrors kiteHeight() in timing.ts, and each pull's punch.
				let steps = 0;
				let pull = 0;
				let lastPull = -1;
				for (let k = 0; k < p.tugs; k++) {
					const at = p.launch + (k * 120) / p.bpm;
					steps += smoothstep(at, at + 0.25, t);
					if (t >= at) lastPull = k;
					pull = Math.max(pull, hit(t - at, 0.15));
				}
				const gale = smoothstep(p.top, p.snap, t);
				const thrash = 3.5 * gale * Math.sin(2 * Math.PI * (2 + 3 * gale) * (t - p.top));
				const height = Math.min(beamCount - 1, ((beamCount - 6) * steps) / p.tugs + thrash);
				// The drums: a pickup, then every beat, harder in the gale.
				const onBeat = t >= 2 * beat && t < p.snap ? hit(t - Math.floor(t / beat) * beat, 0.15) : 0;
				const pump = onBeat * (t < p.top ? 0.25 : 0.4 + 0.4 * gale);

				// The sky, its clouds racing as the wind gets up.
				const drift = 0.06 * t + 0.02 * t * t + 0.15 * Math.max(0, t - p.top) ** 2;
				for (let i = 0; i < g.count; i++) {
					const n = noise3(skyX[i] * 1.3 + drift, skyY[i] * 1.3, t * 0.05);
					const cloud = smoothstep(0.55, 0.8, n);
					setSample(out, i, palette, lerp(SLOT.base, SLOT.white, 0.75 * cloud), (i < ring ? 0.5 : 0.46) + 0.1 * n + 0.25 * cloud);
					if (i < ring && pump + 0.35 * pull > 0.02) addSample(out, i, palette, SLOT.glow, pump + 0.35 * pull);
				}
				// Each pull fires colour round the ring both ways from the beam's south end.
				if (lastPull >= 0 && t < p.snap) {
					const age = t - (p.launch + (lastPull * 120) / p.bpm);
					const tone = lastPull % 2 === 0 ? SLOT.accent : SLOT.third;
					if (age < 0.5) {
						const front = age * 600;
						for (let q = 0; q < 40; q++) {
							const level = 1.1 * (1 - q / 40) * (1 - age / 0.5);
							addSample(out, wrap(south + Math.round(front) - q), palette, tone, level);
							addSample(out, wrap(south - Math.round(front) + q), palette, tone, level);
						}
					}
				}
				// The gale made visible: streaks racing both ways round the frame, more and faster.
				const streaks = Math.floor(10 * gale);
				for (let j = 0; j < streaks && t < p.snap; j++) {
					const dir = j % 2 === 0 ? 1 : -1;
					const head = wrap(Math.round(hash01(j * 17 + 3) * ring + dir * (300 + 500 * gale) * (t - p.top)));
					for (let q = 0; q < 22; q++) addSample(out, wrap(head - dir * q), palette, SLOT.white, 0.85 * gale * (1 - q / 22));
				}

				if (t < p.snap) {
					// The line, glints running up it as it strains, faster in the gale.
					const rate = 1.6 + 6.4 * gale;
					const glint = (t * rate - Math.floor(t * rate)) * height;
					for (let b = 0; b < height - 2; b++) {
						setSample(out, beamStart + b, palette, lerp(SLOT.glow, SLOT.white, 0.6), 0.55 + 0.2 * gale);
						if (t >= p.launch) addSample(out, beamStart + b, palette, SLOT.white, 0.9 * Math.exp(-((b - glint) * (b - glint)) / 6));
					}
					// The tail below the kite, its bows whipping faster as the wind rises.
					for (let q = 0; q < 18; q++) {
						const b = Math.round(height) - 3 - q;
						if (b < 0) break;
						const bow = q % 4 === 0;
						const tone = Math.floor(q / 4) % 2 === 0 ? SLOT.accent : SLOT.third;
						setSample(out, beamStart + b, palette, tone, bow ? 0.95 : 0.5 + 0.2 * (0.5 + 0.5 * Math.sin(q * 0.9 - t * (14 + 20 * gale))));
					}
					for (let d = -2; d <= 2; d++) {
						const b = Math.round(height) + d;
						if (b < 0 || b >= beamCount) continue;
						const level = (Math.abs(d) === 2 ? 0.8 : Math.abs(d) === 1 ? 1.1 : 1.25) * (1 + 0.4 * pull);
						setSample(out, beamStart + b, palette, d === 0 ? SLOT.white : SLOT.accent, level);
					}
				} else {
					const since = t - p.snap;
					if (since < 0.08) {
						for (let i = 0; i < g.count; i++) setSample(out, i, palette, SLOT.white, 1.3);
						return;
					}
					// The line shatters into sparks along the beam.
					for (let b = 0; b < beamCount - 2 && since < 0.5; b++) {
						if (hash01(b * 7 + Math.floor(t * 30) * 13) < 0.3 * (1 - since / 0.5)) setSample(out, beamStart + b, palette, SLOT.white, 1.2);
					}
					// Mirrors spiralRun() in timing.ts: free, the kite laps the ring faster each time.
					const first = (p.spiral * (1 - p.lapShrink)) / (1 - Math.pow(p.lapShrink, p.laps));
					let run = ring * p.laps;
					let lapAt = p.snap;
					let lastLap = -10;
					for (let k = 0; k < p.laps; k++) {
						const lap = first * Math.pow(p.lapShrink, k);
						if (t < lapAt + lap) {
							run = ring * (k + (t - lapAt) / lap);
							break;
						}
						lapAt += lap;
						lastLap = lapAt;
					}
					// What it has painted: every lap lays another, brighter layer of ribbon.
					for (let i = 0; i < ring; i++) {
						const along = wrap(i - north);
						if (along > run) continue;
						const passes = Math.floor((run - along) / ring) + 1;
						const back = run - along - (passes - 1) * ring;
						if (back < 40 && passes === 1) continue;
						const band = Math.floor((along + t * 60) / 14) % 2 === 0;
						const tone = (passes + (band ? 1 : 0)) % 2 === 0 ? SLOT.accent : SLOT.third;
						setSample(out, i, palette, tone, Math.min(0.95, 0.5 + 0.12 * passes));
					}
					// The kite and its comet tail.
					const head = wrap(Math.round(north + run));
					for (let q = 0; q < 40; q++) {
						const tone = q < 2 ? SLOT.white : Math.floor(q / 5) % 2 === 0 ? SLOT.accent : SLOT.third;
						setSample(out, wrap(head - q), palette, tone, q < 2 ? 1.3 : 1.05 * (1 - q / 44));
					}
					// Each lap closes over the north end with a burst.
					const burst = hit(t - lastLap, 0.2);
					for (let d = -30; d <= 30 && burst > 0.02; d++) addSample(out, wrap(north + d), palette, SLOT.white, 1.2 * burst * (1 - Math.abs(d) / 31));
					// The beam fills from both ends with the ribbons, pulsing with the roll.
					const depth = half * (since / p.spiral);
					const roll = 0.15 * Math.sin(2 * Math.PI * (6 + 12 * (since / p.spiral)) * since);
					for (let b = 0; b < beamCount; b++) {
						if (Math.min(b, beamCount - 1 - b) > depth || Math.abs(b - leaf) <= 3) continue;
						setSample(out, beamStart + b, palette, Math.floor((b + t * 40) / 8) % 2 === 0 ? SLOT.accent : SLOT.third, 0.7 + roll);
					}
				}

				// The leaf, fluttering as the kite goes past and in the gale, but holding.
				const near = t < p.snap ? clamp(1 - Math.abs(height - leaf) / 10) : 0;
				const flutter = 1 + (0.35 * near + 0.25 * gale) * Math.sin(2 * Math.PI * 9 * t);
				for (let d = -3; d <= 3; d++) {
					if (t < p.snap && Math.abs(leaf + d - height) < 3) continue;
					setSample(out, beamStart + leaf + d, palette, SLOT.third, (0.5 + 0.4 * (1 - Math.abs(d) / 4)) * flutter);
				}
			}
		};
	}
});

// ---- Špačci -------------------------------------------------------------------------------------

/**
 * Into the vineyard block, scored by podzimni-listi/spacci.m4a: the sunset round the frame, gold over
 * the west wall going to violet in the east, and a murmuration of starlings black against it,
 * pouring in, swirling back and forth on the drums, tightening into a ball that races round the
 * room, hanging still in the silence, and lifting all at once as the sunset blazes up.
 */
const spacci = effect({
	id: 'spacci',
	name: 'Špačci',
	role: 'bed',
	blurb: 'Starlings black against the sunset, swirling on the drums, lifting all at once as it blazes up.',
	// The soundtrack's timing table arrives as parameters; the flock mirrors flockAt() in timing.ts.
	params: SPACCI,
	create(g) {
		let ring = 0;
		for (const s of g.strips) if (s.inPerimeter) ring += s.count;
		const [alongRun, acrossRun] = [g.strips[0].count, g.strips[1].count];
		const beamStart = ring;
		const beamCount = g.count - ring;
		const leaf = Math.floor(beamCount / 2);
		const west = 2 * alongRun + acrossRun + Math.round(acrossRun / 2);
		const wrap = (i: number) => ((i % ring) + ring) % ring;
		const apart = (a: number, b: number) => {
			const d = wrap(a - b);
			return d > ring / 2 ? ring - d : d;
		};
		const hit = (age: number, tau: number) => (age < 0 ? 0 : age < 0.02 ? age / 0.02 : Math.exp(-(age - 0.02) / tau));
		const fromWest = new Float32Array(ring);
		for (let i = 0; i < ring; i++) fromWest[i] = apart(i, west) / (ring / 2);
		const bird = new Uint8Array(ring);
		return {
			render(out, { f, p, palette }) {
				const t = f.t;
				out.fill(0);
				bird.fill(0);
				const beat = 60 / p.bpm;
				const bar = 4 * beat;
				const scatter = t >= p.lift ? t - p.lift : -1;
				// Mirrors spacciDrums() in timing.ts: the latest drum, for the sky's pulse.
				let pulse = 0;
				if (t >= p.swirl && t < p.hush) {
					const n = Math.floor((t - p.swirl) / (beat / 2));
					for (let m = n; m >= Math.max(0, n - 8); m--) {
						const at = p.swirl + (m * beat) / 2;
						const size = at < p.rush - 1e-6 ? (m % 8 === 0 ? 1 : m % 8 === 4 || m % 8 === 6 ? 0.6 : 0) : m % 2 === 0 ? 0.9 : 0.6;
						if (size > 0) {
							pulse = size * hit(t - at, 0.18);
							break;
						}
					}
				}

				// The sunset: gold low over the west wall, through orange, to violet in the east. As the
				// flock lifts it blazes up, a wave of gold running out of the west both ways.
				const blaze = scatter < 0 ? 0 : smoothstep(0, 0.9, scatter) * (1 - 0.3 * smoothstep(0, p.end - p.lift, scatter));
				const wave = scatter < 0 ? -1 : scatter * 380;
				for (let i = 0; i < ring; i++) {
					const w = fromWest[i];
					const n = noise3(i * 0.02, t * 0.08, 3.1);
					const level = (0.6 + 0.1 * n + 0.25 * blaze) * (1 - 0.15 * w) + 0.12 * pulse;
					setSample(out, i, palette, lerp(SLOT.accent, SLOT.third, clamp(w * 1.6)), level * (1 - 0.6 * smoothstep(0.55, 1, w)));
					if (w > 0.45) addSample(out, i, palette, SLOT.base, level * smoothstep(0.45, 1, w));
					const off = Math.abs((w * ring) / 2 - wave);
					if (wave >= 0 && off < 26 && wave < ring / 2 + 26) addSample(out, i, palette, off < 6 ? SLOT.white : SLOT.accent, 1.1 * (1 - off / 26));
				}
				for (let b = 0; b < beamCount; b++) {
					const n = noise3(b * 0.05, t * 0.1, 6.6);
					setSample(out, beamStart + b, palette, SLOT.base, 0.5 + 0.1 * n + 0.3 * blaze + 0.1 * pulse);
				}

				// The flock: mirrors flockAt(), flockSpread() and flockSize() in timing.ts. Each bird
				// is a pixel of sky taken out; the flock stops dead in the silence.
				if (t >= p.arrive && scatter < 2) {
					const still = Math.min(t, p.hush);
					let x = 60 * Math.max(0, Math.min(still, p.swirl) - p.arrive);
					for (let k = 0; k < 4; k++) {
						const from = p.swirl + k * bar;
						if (still <= from) break;
						const tau = Math.min(still, from + bar) - from;
						x += (k % 2 === 0 ? 1 : -1) * 150 * (1 + 0.3 * k) * (bar / Math.PI) * (1 - Math.cos((Math.PI * tau) / bar));
					}
					const rushed = Math.max(0, still - p.rush);
					const centre = west + x + 200 * rushed + 80 * rushed * rushed;
					const spread = still < p.swirl ? 42 : still < p.rush ? 34 + 16 * Math.sin((2 * Math.PI * (still - p.swirl)) / bar) : 34 - 24 * smoothstep(p.rush, p.hush, still);
					const size = Math.round(40 + 120 * smoothstep(p.arrive, p.rush, still));
					const turn = Math.floor((still - p.swirl) / bar);
					const lobes = still >= p.swirl && still < p.rush && turn % 2 === 1 ? spread * 0.9 * Math.sin(Math.PI * ((still - p.swirl) / bar - turn)) : 0;
					for (let k = 0; k < size; k++) {
						if ((t - p.arrive) * 120 < k) continue;
						let off = spread * 1.6 * (noise3(k * 0.71, still * 0.6, 2.2) * 2 - 1) + (k % 2 === 0 ? lobes : -lobes);
						if (scatter >= 0) {
							if (hash01(k * 13 + 7) < scatter / 1.2) continue;
							off *= 1 + 30 * scatter;
						}
						bird[wrap(Math.round(centre + off))] = 1;
					}
					for (let i = 0; i < ring; i++) if (bird[i]) setSample(out, i, palette, SLOT.base, 0);
				}

				// As they lift: glints of the sun on the grapes, thick at first and then settling.
				for (let slot = Math.floor(t * 30) - 3; slot <= Math.floor(t * 30) && scatter >= 0; slot++) {
					if (slot / 30 < p.lift) continue;
					const since = t - slot / 30;
					const count = 2 + Math.round(12 * Math.exp(-(slot / 30 - p.lift) / 2));
					for (let j = 0; j < count; j++) {
						const i = Math.floor(hash01(slot * 23 + j * 7 + 5) * g.count);
						if (i < ring && bird[i]) continue;
						addSample(out, i, palette, j % 3 === 0 ? SLOT.base : SLOT.white, 1.3 * Math.exp(-since / 0.07));
					}
				}
				for (let d = -3; d <= 3; d++) setSample(out, beamStart + leaf + d, palette, SLOT.third, 0.55 + 0.4 * (1 - Math.abs(d) / 4));
			}
		};
	}
});

// ---- Burčák -------------------------------------------------------------------------------------

/**
 * Into the burčák block, scored by podzimni-listi/burcak.m4a: a bottle working on the beam, bubbles
 * racing up it, its cap rattling ever faster while the room pumps on the kick; the cap blows off
 * round the room, the foam floods the ring both ways, two glasses close in along the beam and meet.
 */
const burcak = effect({
	id: 'burcak',
	name: 'Burčák',
	role: 'bed',
	blurb: 'A bottle under pressure, the room pumping; the cap blows, foam floods the ring, the glasses meet.',
	params: BURCAK,
	create(g) {
		let ring = 0;
		for (const s of g.strips) if (s.inPerimeter) ring += s.count;
		const alongRun = g.strips[0].count;
		const beamStart = ring;
		const beamCount = g.count - ring;
		const half = beamCount / 2;
		const leaf = Math.floor(beamCount / 2);
		const north = Math.round(alongRun / 2);
		const wrap = (i: number) => ((i % ring) + ring) % ring;
		const apart = (a: number, b: number) => {
			const d = wrap(a - b);
			return d > ring / 2 ? ring - d : d;
		};
		const hit = (age: number, tau: number) => (age < 0 ? 0 : age < 0.02 ? age / 0.02 : Math.exp(-(age - 0.02) / tau));
		return {
			render(out, { f, p, palette }) {
				const t = f.t;
				out.fill(0);
				const beat = 60 / p.bpm;
				const top = beamCount - 1;

				if (t >= p.clink) {
					// Na zdraví: the ring of the glasses runs out along the beam from where they met and
					// round the frame from its ends, and behind it the room blooms rosé and gold and
					// fizzing, with a storm of sparkle over it.
					const age = t - p.clink;
					const ripple = 6 + age * 260;
					const round = Math.max(0, ripple - half);
					for (let i = 0; i < ring; i++) {
						const behind = round - Math.min(apart(i, north), apart(i, north + ring / 2));
						if (behind < 0) {
							setSample(out, i, palette, SLOT.base, 0.48);
							continue;
						}
						const n = noise3(i * 0.3, t * 1.5, 7.7);
						setSample(out, i, palette, lerp(SLOT.base, SLOT.accent, 0.3 + 0.5 * n), 0.78 + 0.14 * n);
						if (behind < 20 && round < ring / 2) addSample(out, i, palette, SLOT.white, 1.2 * (1 - behind / 20));
					}
					for (let b = 0; b < beamCount; b++) {
						const behind = ripple - Math.abs(b - leaf);
						if (behind < 0) continue;
						setSample(out, beamStart + b, palette, lerp(SLOT.base, SLOT.white, 0.35), 0.8);
						if (hash01(Math.floor(b - t * 150) * 7 + 3) < 0.1) addSample(out, beamStart + b, palette, SLOT.white, 0.9);
						if (behind < 8 && ripple < half + 8) addSample(out, beamStart + b, palette, SLOT.white, 1.3 * (1 - behind / 8));
					}
					for (let slot = Math.floor(t * 30) - 3; slot <= Math.floor(t * 30); slot++) {
						if (slot / 30 < p.clink) continue;
						const since = t - slot / 30;
						const count = Math.round(16 * smoothstep(0, 0.5, slot / 30 - p.clink) * Math.exp(-(slot / 30 - p.clink) / 1.8)) + 2;
						for (let j = 0; j < count; j++) {
							addSample(out, Math.floor(hash01(slot * 23 + j * 7 + 2) * g.count), palette, j % 2 === 0 ? SLOT.accent : SLOT.white, 1.3 * Math.exp(-since / 0.07));
						}
					}
					return;
				}

				if (t >= p.pop) {
					const age = t - p.pop;
					if (age < 0.08) {
						for (let i = 0; i < g.count; i++) setSample(out, i, palette, SLOT.white, 1.4);
						return;
					}
					const raised = p.pop + p.round + 0.15;
					if (t < raised) {
						// The foam floods the ring both ways from the north end; the beam erupts.
						const front = clamp(age / p.round) * (ring / 2 + 20);
						for (let i = 0; i < ring; i++) {
							const behind = front - apart(i, north);
							if (behind < 0) continue;
							const froth = noise3(i * 0.3, t * 2, 7.7);
							setSample(out, i, palette, lerp(SLOT.base, SLOT.white, 0.35 + 0.4 * froth), 0.75 + 0.15 * froth);
							if (behind < 20 && front < ring / 2) addSample(out, i, palette, SLOT.white, 1.2 * (1 - behind / 20));
						}
						const jet = age * 600;
						for (let b = 0; b < beamCount; b++) {
							setSample(out, beamStart + b, palette, lerp(SLOT.base, SLOT.white, 0.5), 0.8);
							if (b < jet && jet - b < 80) addSample(out, beamStart + b, palette, SLOT.white, 1.2 * (1 - (jet - b) / 80));
						}
					} else {
						// Glasses raised: the room steadies, and two glasses close in along the beam.
						for (let i = 0; i < ring; i++) setSample(out, i, palette, SLOT.base, 0.48);
						const closing = smoothstep(raised, p.clink, t);
						const at = Math.round((leaf - 3) * closing * closing);
						for (let q = -2; q <= 2; q++) {
							const level = q === 0 ? 1.3 : 0.7;
							const tone = q === 0 ? SLOT.white : SLOT.accent;
							if (at + q >= 0) setSample(out, beamStart + at + q, palette, tone, level);
							if (at + q >= 0) setSample(out, beamStart + top - at - q, palette, tone, level);
						}
					}
					// The cap, gone round the room and slowing.
					if (age < 1.5) {
						const head = wrap(Math.round(north + 900 * (1 - Math.exp(-age / 0.5))));
						for (let q = 0; q < 30; q++) addSample(out, wrap(head - q), palette, q < 2 ? SLOT.white : SLOT.accent, (q < 2 ? 1.3 : 1 - q / 30) * (1 - age / 1.5));
					}
					return;
				}

				// Mirrors rattles() in timing.ts: the cap's latest rattle.
				let rattleAge = -1;
				for (let at = p.rattle; at <= t && at < p.pop - 1e-6; ) {
					rattleAge = t - at;
					at += at < p.surge - 1e-6 ? beat : at < p.hiss - 1e-6 ? beat / 2 : beat / 4;
				}
				const jolt = rattleAge < 0 ? 0 : hit(rattleAge, 0.05);
				// Mirrors kicks(): the room pumps on every one.
				const pump = t >= p.surge ? hit(t - p.surge - Math.floor((t - p.surge) / beat) * beat, 0.16) : 0;
				const working = clamp(t / p.pop);
				const pressure = smoothstep(p.hiss, p.pop, t);

				// The cellar round the ring, pumping, dropping out for the breath before the cap goes.
				if (t < p.pop - 0.15) {
					for (let i = 0; i < ring; i++) {
						const n = noise3(i * 0.025, t * 0.2, 3.3);
						setSample(out, i, palette, lerp(SLOT.third, SLOT.white, 0.25 * n), 0.46 + 0.12 * n + 0.12 * working + 0.35 * pump);
					}
					for (let slot = Math.floor(t * 14) - 2; slot <= Math.floor(t * 14); slot++) {
						const since = t - slot / 14;
						const count = 1 + Math.floor(12 * clamp(slot / 14 / p.pop));
						for (let j = 0; j < count; j++) {
							addSample(out, Math.floor(hash01(slot * 19 + j * 31 + 5) * ring), palette, SLOT.white, 1.1 * Math.exp(-since / 0.05));
						}
					}
				}
				// The bottle: cloudy rosé going white-hot under pressure, shivering before it goes.
				const shiver = 1 + 0.12 * pressure * Math.sin(2 * Math.PI * 8 * t);
				for (let b = 0; b < top - 2; b++) {
					const n = noise3(b * 0.08, t * 0.4, 1.9);
					const tone = lerp(SLOT.base, SLOT.white, 0.15 + 0.35 * working * working + 0.1 * n);
					setSample(out, beamStart + b, palette, tone, (0.6 + 0.3 * working + 0.12 * n + 0.15 * pump) * shiver);
				}
				// Bubbles off the bottom: mirrors bubbles() in timing.ts, collecting under the cap.
				for (let s = 0, e = 0.2; e < p.pop && e <= t; s++) {
					const u = e / p.pop;
					const speed = (p.riseFrom + (p.riseTo - p.riseFrom) * u * u) * (0.8 + 0.4 * hash01(s * 17 + 3));
					const y = (t - e) * speed;
					if (y < top - 3) {
						addSample(out, beamStart + Math.floor(y), palette, SLOT.white, 1);
						if (y >= 1) addSample(out, beamStart + Math.floor(y) - 1, palette, SLOT.accent, 0.45);
					}
					e += (0.6 + 0.8 * hash01(s * 29 + 7)) / (p.rateFrom * Math.pow(p.rateTo / p.rateFrom, u));
				}
				for (let q = 0; q < 3; q++) setSample(out, beamStart + top - q, palette, SLOT.accent, 0.9 + 0.8 * jolt);
				addSample(out, beamStart + top - 1, palette, SLOT.white, 0.8 * jolt);
			}
		};
	}
});

// ---- Hodně štěstí -------------------------------------------------------------------------------

/**
 * The birthday, scored by podzimni-listi/narozeniny.m4a: the warm room closes into the corner and goes
 * dark, eighteen candles light one by one round the ring and the beam glows as the cake; the
 * candles pulse with every note of the first verse while everyone sings, the room fills with warm
 * light between them for the second, bursts on every bar, and settles back to the candles burning.
 * `stage` 1 is the room waiting for the cake, `stage` 2 the candles burning for the wish.
 */
const narozeniny = effect({
	id: 'narozeniny',
	name: 'Hodně štěstí',
	role: 'bed',
	blurb: 'Eighteen candles light round the ring over the cake, and the room sings with them twice.',
	params: { ...NAROZENINY, stage: 0 },
	create(g) {
		let ring = 0;
		for (const s of g.strips) if (s.inPerimeter) ring += s.count;
		const [alongRun, acrossRun] = [g.strips[0].count, g.strips[1].count];
		const beamStart = ring;
		const beamCount = g.count - ring;
		const half = beamCount / 2;
		const leaf = Math.floor(beamCount / 2);
		const home = 2 * alongRun + acrossRun;
		const wrap = (i: number) => ((i % ring) + ring) % ring;
		const apart = (a: number, b: number) => {
			const d = wrap(a - b);
			return d > ring / 2 ? ring - d : d;
		};
		const hit = (age: number, tau: number) => (age < 0 ? 0 : age < 0.02 ? age / 0.02 : Math.exp(-(age - 0.02) / tau));
		// Mirrors MELODY in timing.ts: the beat of every note from the pickup.
		const notes = new Float32Array([0, 0.75, 1, 2, 3, 4, 6, 6.75, 7, 8, 9, 10, 12, 12.75, 13, 14, 15, 16, 17, 18, 18.75, 19, 20, 21, 22]);
		// Mirrors candles(): where each candle stands, and how far every ring pixel is from one.
		const where = new Float32Array(64);
		const nearest = new Float32Array(ring);
		let placed = -1;
		const place = (count: number) => {
			placed = count;
			for (let k = 0; k < count; k++) where[k] = (home + Math.round(((k + 0.5) * ring) / count)) % ring;
			for (let i = 0; i < ring; i++) {
				let d = ring;
				for (let k = 0; k < count; k++) d = Math.min(d, apart(i, where[k]));
				nearest[i] = d;
			}
		};
		const cake = (out: Float32Array, palette: Float32Array, reach: number, glow: number, t: number) => {
			for (let b = 0; b < beamCount; b++) {
				if (Math.abs(b - leaf) > reach) continue;
				setSample(out, beamStart + b, palette, SLOT.base, 0.52 + glow);
				if (hash01(b * 7 + Math.floor(t * 12) * 31) < 0.04) addSample(out, beamStart + b, palette, SLOT.white, 0.8);
			}
			for (let d = -3; d <= 3; d++) addSample(out, beamStart + leaf + d, palette, SLOT.third, 0.35 * (1 - Math.abs(d) / 4));
		};
		return {
			render(out, { f, p, palette }) {
				out.fill(0);
				const count = Math.min(64, Math.round(p.candles));
				if (placed !== count) place(count);
				if (p.stage === 1) {
					// Waiting for the cake: the room low and warm, slow waves going round, the cake glowing.
					const t = f.t;
					for (let i = 0; i < ring; i++) {
						const wave = 0.5 + 0.5 * Math.sin((i / ring) * Math.PI * 6 - t * 0.7);
						setSample(out, i, palette, lerp(SLOT.third, SLOT.accent, 0.4 * wave), 0.48 + 0.1 * wave);
					}
					cake(out, palette, half, 0.05 * Math.sin(t * 1.3), t);
					return;
				}
				const t = p.stage === 2 ? p.end + f.t : f.t;
				const beat = 60 / p.bpm;
				const finish = p.verse2 + (22 + p.hold) * beat;
				// The latest note of either verse, the second louder.
				let note = 0;
				for (let n = 0; n < notes.length; n++) {
					note = Math.max(note, 0.6 * hit(t - (p.verse1 + notes[n] * beat), 0.25), hit(t - (p.verse2 + notes[n] * beat), 0.25));
				}
				const building = smoothstep(p.verse2 - 6 * beat, p.verse2, t);
				const big = t < finish ? building : 1 - smoothstep(finish + 0.5, finish + 4, t);

				// The lights go down: the warm room closes into the corner.
				if (t < p.dark + 0.6) {
					const reach = (ring / 2 + 20) * (1 - smoothstep(p.dark, p.dark + 0.6, t));
					for (let i = 0; i < ring; i++) if (apart(i, home) < reach) setSample(out, i, palette, SLOT.third, 0.5);
				}
				// The warm light between the candles, filling out from them for the second verse.
				if (big > 0.01) {
					const reach = big * (ring / count / 2 + 2);
					for (let i = 0; i < ring; i++) {
						if (nearest[i] > reach) continue;
						const n = noise3(i * 0.05, t * 0.5, 2.7);
						setSample(out, i, palette, lerp(SLOT.third, SLOT.accent, 0.5), 0.6 + 0.2 * note + 0.12 * n);
					}
				}
				// The cake comes up out of the beam's centre once the first candle is lit.
				if (t >= p.light) cake(out, palette, half * smoothstep(p.light, p.light + 1.2, t), 0.25 * note + 0.25 * big, t);
				// Every bar of the second verse throws a burst out of a candle.
				for (let m = 0; m < 10; m++) {
					const at = p.verse2 + (1 + 3 * m) * beat;
					const age = t - at;
					if (age < 0 || age > 0.8 || at >= finish) continue;
					const from = where[(m * 5) % count];
					const front = age * 150;
					for (let d = -Math.ceil(front); d <= front; d++) {
						if (front - Math.abs(d) > 8) continue;
						addSample(out, wrap(from + d), palette, m % 2 === 0 ? SLOT.white : SLOT.accent, 1.1 * (1 - age / 0.8));
					}
				}
				// The candles.
				const tall = 2 + Math.round(2 * big);
				for (let k = 0; k < count; k++) {
					const at = p.light + k * p.spacing;
					if (t < at) continue;
					const flicker = noise3(k * 3.3, t * 6, 1.2);
					const lit = hit(t - at, 0.15);
					for (let d = -tall; d <= tall; d++) {
						const i = wrap(where[k] + d);
						const shape = 1 - Math.abs(d) / (tall + 1.5);
						setSample(out, i, palette, Math.abs(d) < 1 ? lerp(SLOT.accent, SLOT.white, 0.5) : SLOT.accent, Math.max(0.5, (0.75 + 0.3 * flicker) * shape) + 0.3 * note);
						if (Math.abs(d) <= 2) addSample(out, i, palette, SLOT.white, 1.3 * lit);
					}
				}
				// The cut-off blooms out of every candle at once, warm light running out to meet between them.
				const opened = t - finish;
				if (opened >= 0 && opened < 0.9) {
					const front = opened * 40;
					for (let i = 0; i < ring; i++) {
						const off = Math.abs(nearest[i] - front);
						if (off < 4) addSample(out, i, palette, SLOT.white, 1.1 * (1 - opened / 0.9) * (1 - off / 4));
					}
				}
				// The held last note swells into a shower of sparks, and the cut-off throws more.
				const swell = t < finish ? smoothstep(finish - p.hold * beat, finish, t) : Math.exp(-(t - finish) / 1.2);
				for (let slot = Math.floor(t * 30) - 3; slot <= Math.floor(t * 30) && swell > 0.05; slot++) {
					const since = t - slot / 30;
					const many = Math.round(14 * swell);
					for (let j = 0; j < many; j++) {
						addSample(out, Math.floor(hash01(slot * 29 + j * 11 + 3) * g.count), palette, j % 2 === 0 ? SLOT.white : SLOT.accent, 1.2 * Math.exp(-since / 0.07));
					}
				}
			}
		};
	}
});

// ---- Sfouknuto ----------------------------------------------------------------------------------

/**
 * When he blows, scored by podzimni-listi/sfouknuto.m4a: the candles go out round the ring, a beat of
 * dark, then fireworks over the whole frame while it spells HAPPY, then bdAY, then his age, one
 * 7-segment letter at a time with the fireworks burning inside each letter, and the digits of his
 * age trading places on every beat under the barrage at the end.
 */
const sfouknuto = effect({
	id: 'sfouknuto',
	name: 'Sfouknuto',
	role: 'bed',
	blurb: 'The candles out, a beat of dark, then fireworks while the frame spells HAPPY bdAY and his age.',
	// The soundtrack's timing table arrives as parameters; letters and fireworks mirror timing.ts.
	params: { ...SFOUKNUTO, candles: NAROZENINY.candles, flip: 0 },
	create(g) {
		let ring = 0;
		for (const s of g.strips) if (s.inPerimeter) ring += s.count;
		const [alongRun, acrossRun] = [g.strips[0].count, g.strips[1].count];
		const beamStart = ring;
		const beamCount = g.count - ring;
		const half = beamCount / 2;
		const leaf = Math.floor(beamCount / 2);
		const home = 2 * alongRun + acrossRun;
		const north = Math.round(alongRun / 2);
		const south = alongRun + acrossRun + Math.round(alongRun / 2);
		const wrap = (i: number) => ((i % ring) + ring) % ring;
		const apart = (a: number, b: number) => {
			const d = wrap(a - b);
			return d > ring / 2 ? ring - d : d;
		};
		const hit = (age: number, tau: number) => (age < 0 ? 0 : age < 0.02 ? age / 0.02 : Math.exp(-(age - 0.02) / tau));
		// Each pixel's segment, top 0 clockwise to upper left 5 and the beam 6, for a guest facing
		// west; the last three pixels at each end of a segment stay dark so the letters read.
		const segment = new Int8Array(g.count).fill(-1);
		const runs = [
			[alongRun, alongRun + acrossRun],
			[north, alongRun],
			[0, north],
			[home, ring],
			[south, home],
			[alongRun + acrossRun, south],
			[ring, g.count]
		];
		runs.forEach(([from, to], s) => {
			for (let i = from + 3; i < to - 3; i++) segment[i] = s;
		});
		const turned = new Int8Array([3, 4, 5, 0, 1, 2, 6]);
		// Mirrors SEGMENTS in timing.ts: digits, then H A P Y b d.
		const digits = new Int32Array([63, 6, 91, 79, 102, 109, 125, 7, 127, 111]);
		const word = new Int32Array([118, 119, 115, 115, 110, 0, 124, 94, 119, 110, 0]);
		const shown = new Uint8Array(g.count);

		/** The pattern for slot `k` of the spelling, -1 past the end. */
		const pattern = (k: number, age: number) => {
			if (k < word.length) return word[k];
			const tens = Math.floor(age / 10);
			const ones = Math.round(age) % 10;
			if (tens === 0) return k === word.length ? digits[ones] : -1;
			if (k === word.length) return digits[tens];
			return k === word.length + 1 ? digits[ones] : -1;
		};

		const firework = (out: Float32Array, palette: Float32Array, at: number, age: number, tone: number, size: number) => {
			if (age < 0 || age > 1.2) return;
			const front = age * 180 * size;
			const fade = 1 - age / 1.2;
			const colour = tone === 0 ? SLOT.accent : tone === 1 ? SLOT.third : SLOT.glow;
			for (let d = -Math.ceil(front); d <= front; d++) {
				const behind = front - Math.abs(d);
				const i = wrap(at + d);
				const level = 1.2 * fade * (1 - behind / 14);
				if (behind < 10 && level >= 0.45) addSample(out, i, palette, colour, level);
				else if (hash01(i * 17 + Math.floor(age * 30) * 7) < 0.25 * fade) addSample(out, i, palette, SLOT.white, 0.9);
			}
			if (age < 0.15) for (let d = -6; d <= 6; d++) addSample(out, wrap(at + d), palette, SLOT.white, 1.4 * (1 - age / 0.15));
		};

		return {
			render(out, { f, p, palette }) {
				const t = f.t;
				out.fill(0);
				const beat = 60 / p.bpm;
				const slot = p.letter * beat;
				const count = Math.max(1, Math.round(p.candles));

				if (t < p.boom) {
					// The candles go out one after another round the ring, each with a wisp; the cake
					// goes dark with them, and then there is a beat of nothing.
					for (let k = 0; k < count; k++) {
						const at = (home + Math.round(((k + 0.5) * ring) / count)) % ring;
						const gone = t - (p.out + k * 0.05);
						const flicker = noise3(k * 3.3, t * 6, 1.2);
						for (let d = -2; d <= 2; d++) {
							if (gone < 0) setSample(out, wrap(at + d), palette, SLOT.accent, Math.max(0.5, (0.75 + 0.3 * flicker) * (1 - Math.abs(d) / 3.5)));
							else if (gone < 0.12) addSample(out, wrap(at + d), palette, SLOT.white, 0.8 * (1 - gone / 0.12));
						}
					}
					if (t < p.out + count * 0.05) {
						for (let b = 0; b < beamCount; b++) setSample(out, beamStart + b, palette, SLOT.base, 0.52);
					}
					return;
				}

				// Mirrors fireworks() in timing.ts: four on the beats after the boom, three in each
				// blank, and the barrage from the finale.
				let k = 0;
				for (let n = 0; n < 4; n++, k++) firework(out, palette, Math.floor(hash01(k * 37 + 11) * ring), t - (p.boom + n * beat), k % 3, 1);
				for (const blank of [5, 10]) {
					for (let n = 0; n < 3; n++, k++) firework(out, palette, Math.floor(hash01(k * 37 + 11) * ring), t - (p.happy + blank * slot + (n * slot) / 3), k % 3, 0.8);
				}
				for (let at = p.finale; at < p.end - 2; at += beat / 2, k++) {
					firework(out, palette, Math.floor(hash01(k * 37 + 11) * ring), t - at, k % 3, 0.7 + 0.3 * hash01(Math.round(at * 100)));
				}
				// Everything goes up out of the cake: a front along the beam from its centre and on round
				// the ring from both its ends.
				const up = t - p.boom;
				if (up < 1.2) {
					const front = up * 320;
					for (let b = 0; b < beamCount; b++) {
						const behind = front - Math.abs(b - leaf);
						if (behind >= 0 && behind < 10) addSample(out, beamStart + b, palette, behind < 4 ? SLOT.white : SLOT.glow, 1.25 - 0.07 * behind);
					}
					for (let i = 0; i < ring; i++) {
						const behind = front - half - Math.min(apart(i, north), apart(i, south));
						if (behind >= 0 && behind < 16) addSample(out, i, palette, behind < 5 ? SLOT.white : SLOT.glow, 1.2 - 0.045 * behind);
					}
				}
				// The beam lights with every burst near either of its ends.
				const ends = Math.max(hit(t - p.boom, 0.5), 0);
				for (let b = 0; b < beamCount && ends > 0.1; b++) {
					if (Math.abs(b - leaf) < half * ends) addSample(out, beamStart + b, palette, SLOT.glow, 0.8 * ends);
				}

				// The letter showing, if any: mirrors spelling(); the finale trades his age's digits.
				let mask = -1;
				let since = 0;
				if (t >= p.happy && t < p.finale) {
					const n = Math.floor((t - p.happy) / slot);
					since = t - (p.happy + n * slot);
					if (since < 0.85 * slot) mask = pattern(n, p.age);
				} else if (t >= p.finale) {
					const n = Math.floor((t - p.finale) / beat);
					since = t - (p.finale + n * beat);
					const two = p.age >= 10;
					if (since < 0.8 * beat) mask = two ? pattern(word.length + (n % 2), p.age) : pattern(word.length, p.age);
				}
				if (mask > 0) {
					// Only the letter carries light: the fireworks burn inside it, the rest goes dark.
					shown.fill(0);
					for (let i = 0; i < g.count; i++) {
						const s = segment[i];
						if (s < 0) continue;
						if ((mask >> (p.flip > 0.5 ? turned[s] : s)) & 1) shown[i] = 1;
					}
					const strike = hit(since, 0.2);
					for (let i = 0; i < g.count; i++) {
						if (!shown[i]) {
							out[i * 3] = 0;
							out[i * 3 + 1] = 0;
							out[i * 3 + 2] = 0;
							continue;
						}
						addSample(out, i, palette, lerp(SLOT.white, SLOT.base, 0.2), 1.05 + 0.4 * strike);
					}
				}
			}
		};
	}
});

// ---- Polární záře -------------------------------------------------------------------------------

/**
 * Into the late evening, scored by podzimni-listi/zare.m4a: a starry night, a green glow low over the
 * north wall, curtains rising and rippling round the sky with violet at their folds, the substorm
 * on the drums with red crowning the brightest of it and the aurora climbing the beam from its
 * north end, a breath, and the corona breaking overhead from the beam's centre.
 */
const polarniZare = effect({
	id: 'polarniZare',
	name: 'Polární záře',
	role: 'bed',
	blurb: 'An aurora rising from the north wall, rippling round the sky, and breaking overhead as a corona.',
	// The soundtrack's timing table arrives as parameters; the reach mirrors auroraReach() in timing.ts.
	params: ZARE,
	create(g) {
		let ring = 0;
		for (const s of g.strips) if (s.inPerimeter) ring += s.count;
		const alongRun = g.strips[0].count;
		const beamStart = ring;
		const beamCount = g.count - ring;
		const half = beamCount / 2;
		const leaf = Math.floor(beamCount / 2);
		const north = Math.round(alongRun / 2);
		const wrap = (i: number) => ((i % ring) + ring) % ring;
		const south = wrap(north + ring / 2);
		const apart = (a: number, b: number) => {
			const d = wrap(a - b);
			return d > ring / 2 ? ring - d : d;
		};
		const hit = (age: number, tau: number) => (age < 0 ? 0 : age < 0.02 ? age / 0.02 : Math.exp(-(age - 0.02) / tau));
		const curtain = (out: Float32Array, palette: Float32Array, i: number, along: number, edge: number, energy: number, phase: number, surge: number) => {
			const fold = 0.5 + 0.5 * Math.sin(along * 0.09 - phase * 2.1) * Math.sin(along * 0.031 + phase * 0.7);
			const n = noise3(along * 0.05, phase * 0.5, 9.9);
			const a = edge * energy * (0.25 + 0.75 * fold * fold) * (0.6 + 0.4 * n);
			if (a < 0.16) return;
			setSample(out, i, palette, lerp(SLOT.base, SLOT.glow, 0.3 * fold), 0.46 + 0.6 * a);
			if (fold > 0.82) addSample(out, i, palette, SLOT.accent, (fold - 0.82) * 4 * a * (0.4 + 0.6 * surge));
			if (a > 0.6) addSample(out, i, palette, SLOT.third, (a - 0.6) * 1.2 * surge);
			if (hash01(Math.floor(along / 3) * 7 + Math.floor(phase * 4)) > 0.92) addSample(out, i, palette, SLOT.white, 0.3 * a);
		};
		return {
			render(out, { f, p, palette }) {
				const t = f.t;
				out.fill(0);
				const bar = 240 / p.bpm;
				const surge = smoothstep(p.surge, p.corona, t);
				// The ripple's phase: steady, quickening through the substorm, racing after the corona.
				const into = clamp(t - p.surge, 0, p.corona - p.surge);
				const phase = 0.6 * t + (1.2 * into * into) / (p.corona - p.surge) + 2.4 * Math.max(0, t - p.corona);

				// The stars, and Orion's belt not yet risen.
				for (let i = 0; i < g.count; i++) {
					if (hash01(i * 17 + 4) < 0.035) setSample(out, i, palette, SLOT.white, 0.4 + 0.3 * noise3(i, t * 0.7, 3.3));
				}
				if (t >= p.corona - 0.4 && t < p.corona) return;
				const corona = t - p.corona;
				// After the breath the sky comes back out of the corona, overhead first.
				const opened = corona >= 0 ? 8 + corona * 380 : Infinity;

				// Mirrors auroraReach() in timing.ts.
				const reach =
					t < p.glow ? 0 : t < p.curtain ? 30 + 30 * smoothstep(p.glow, p.curtain, t) : corona >= 0 ? ring / 2 + 30 : 60 + (ring / 2 - 60) * smoothstep(p.curtain, p.corona, t);
				const energy =
					corona >= 0 ? 1 : t < p.curtain ? 0.4 + 0.3 * smoothstep(p.glow, p.curtain, t) : 0.7 + 0.3 * surge;
				// The substorm's drums brighten it on the bar.
				let drum = 0;
				for (let at = p.surge, k = 0; at <= t && at < p.corona - 0.5; at += bar / 2, k++) drum = hit(t - at, 0.3) * (k % 2 === 0 ? 1 : 0.5);
				for (let i = 0; i < ring; i++) {
					const d = apart(i, north);
					const overhead = half + Math.min(d, apart(i, south));
					if (d > reach || overhead > opened) continue;
					curtain(out, palette, i, i, clamp((reach - d) / 25), Math.min(1.2, energy + 0.2 * drum), phase, corona >= 0 ? 1 : surge);
					if (opened - overhead < 22 && opened < half + ring / 2) addSample(out, i, palette, SLOT.white, 1.1 - 0.03 * (opened - overhead));
				}
				// It climbs the beam from the north end through the substorm, and has it at the corona.
				const climb = corona >= 0 ? beamCount : beamCount * surge;
				for (let b = 0; b < beamCount; b++) {
					const up = beamCount - 1 - b;
					if (up > climb || (corona < 0 && Math.abs(b - leaf) <= 3) || Math.abs(b - leaf) > opened) continue;
					curtain(out, palette, beamStart + b, 300 + b * 2, clamp((climb - up) / 15), Math.min(1.2, energy + 0.2 * drum), phase, surge);
				}
				if (corona >= 0) {
					// The corona: rays bursting out of the beam's centre to both ends, then pulsing.
					const front = corona * 300;
					for (let b = 0; b < beamCount; b++) {
						const off = Math.abs(b - leaf);
						if (off > front) continue;
						const ray = 0.5 + 0.5 * Math.sin(off * 0.6 - corona * 9);
						addSample(out, beamStart + b, palette, lerp(SLOT.glow, SLOT.white, 0.5), 0.5 * ray + (front - off < 6 && front < half ? 0.9 : 0));
					}
				}
				for (let d = -3; d <= 3; d++) addSample(out, beamStart + leaf + d, palette, SLOT.third, 0.5 + 0.35 * (1 - Math.abs(d) / 4));
			}
		};
	}
});

// ---- Půlnoc -------------------------------------------------------------------------------------

/**
 * The minute before midnight, scored by podzimni-listi/pulnoc.m4a: fog under three streetlamps going
 * out one by one while a clock ticks; a match in the corner, the leaf fire running round the frame
 * to war drums while the leaf turns gold; the fire drawn back into the corner; ten to one drawn in
 * flame as 7-segment digits on the whole frame, one a second; and on the stroke of midnight the
 * backdraft blows the fire round the room and the leaf goes scarlet. With `fog` it is the fog
 * alone, with a car's lights passing now and then, which the pause before it holds.
 */
const pulnoc = effect({
	id: 'pulnoc',
	name: 'Půlnoc',
	role: 'bed',
	blurb: 'Fog and lamps, the leaf fire to war drums, ten to one in flame on the frame, the midnight backdraft.',
	// The soundtrack's timing table arrives as parameters; the formulas below mirror timing.ts.
	params: { ...PULNOC, fog: 0, flip: 0 },
	create(g) {
		let ring = 0;
		for (const s of g.strips) if (s.inPerimeter) ring += s.count;
		const [alongRun, acrossRun] = [g.strips[0].count, g.strips[1].count];
		const beamStart = ring;
		const beamCount = g.count - ring;
		const half = beamCount / 2;
		const leaf = Math.floor(beamCount / 2);
		const home = 2 * alongRun + acrossRun;
		const north = Math.round(alongRun / 2);
		const south = alongRun + acrossRun + Math.round(alongRun / 2);
		const wrap = (i: number) => ((i % ring) + ring) % ring;
		const apart = (a: number, b: number) => {
			const d = wrap(a - b);
			return d > ring / 2 ? ring - d : d;
		};
		const hit = (age: number, tau: number) => (age < 0 ? 0 : age < 0.02 ? age / 0.02 : Math.exp(-(age - 0.02) / tau));
		// Mirrors LAMPS in timing.ts.
		const lamps = new Float32Array([Math.round(0.053 * ring), Math.round(0.365 * ring), Math.round(0.566 * ring)]);
		const toSouth = apart(home, south);
		const toNorth = apart(home, north);
		const fromHome = new Float32Array(g.count);
		const skyX = new Float32Array(g.count);
		const skyY = new Float32Array(g.count);
		for (let i = 0; i < g.count; i++) {
			if (i < ring) {
				fromHome[i] = apart(i, home);
				const a = (i / ring) * Math.PI * 2;
				skyX[i] = Math.cos(a) * 1.45;
				skyY[i] = Math.sin(a) * 1.45;
			} else {
				const b = i - beamStart;
				fromHome[i] = Math.min(toSouth + b, toNorth + beamCount - 1 - b);
				skyY[i] = (b / beamCount - 0.5) * 2.9;
			}
		}
		// The frame as one digit, as in Sfouknuto: each pixel's segment, ends left dark.
		const segment = new Int8Array(g.count).fill(-1);
		const runs = [
			[alongRun, alongRun + acrossRun],
			[north, alongRun],
			[0, north],
			[home, ring],
			[south, home],
			[alongRun + acrossRun, south],
			[ring, g.count]
		];
		runs.forEach(([from, to], s) => {
			for (let i = from + 3; i < to - 3; i++) segment[i] = s;
		});
		const turned = new Int8Array([3, 4, 5, 0, 1, 2, 6]);
		const digits = new Int32Array([63, 6, 91, 79, 102, 109, 125, 7, 127, 111]);

		const flame = (out: Float32Array, palette: Float32Array, i: number, behind: number, t: number, swell: number, edge: boolean) => {
			const body = noise3(i * 0.13, t * 2.4, 1.7);
			const tongue = noise3(i * 0.45, t * 6.5, 4.2);
			const front = clamp(behind / 6);
			setSample(out, i, palette, SLOT.base, (0.6 + 0.3 * body) * front * swell);
			if (tongue > 0.5) addSample(out, i, palette, SLOT.third, (tongue - 0.5) * 2.4 * front * swell);
			if (tongue > 0.85) addSample(out, i, palette, SLOT.white, (tongue - 0.85) * 4 * front);
			if (edge && behind < 8) addSample(out, i, palette, SLOT.white, 1.1 * (1 - behind / 8));
		};

		return {
			render(out, { f, p, palette }) {
				const t = f.t;
				out.fill(0);
				const fog = p.fog > 0.5;
				const span = p.inhale - p.catch;
				// Mirrors fireReach(): full at the breath, drawn back into the corner, then the blast.
				const grown = (ring / 2) * Math.pow(clamp((Math.min(t, p.inhale) - p.catch) / span), p.spread);
				const drawnIn = smoothstep(p.inhale, p.count, t);
				const met = fog ? -1 : t - p.midnight;
				const blast = met < 0 ? -1 : Math.min(ring / 2 + 40, met * p.blast);
				const reach = fog || t < p.catch ? -1 : t < p.inhale ? grown : t < p.count ? grown * (1 - drawnIn) ** 2 : met >= 0 ? blast : -1;
				// Mirrors warDrums(): the latest drum.
				let drum = 0;
				if (!fog && t >= p.catch && t < p.inhale) {
					let at = p.catch;
					let last = -1;
					let size = 0;
					while (at <= t && at < p.inhale - 1e-6) {
						last = at;
						size = Math.abs(at - Math.round(at)) < 1e-6 ? 1 : 0.6;
						at += at < p.double - 1e-6 ? 1 : at < p.again - 1e-6 ? 0.5 : 0.25;
					}
					if (last >= 0) drum = size * hit(t - last, 0.2);
				}
				const roar = met >= 0 ? 1 + 0.3 * Math.sin(2 * Math.PI * 5 * t) * Math.exp(-met / 1) : 1;
				const swell = (1 + 0.35 * drum) * roar;

				// Fog drifting along the frame, thinning pixel by pixel once the lamps are out except
				// where the fire lights it, and gone when the fire draws its breath.
				const drift = t * 0.045;
				const thin = fog ? 1 : t >= p.inhale ? 0 : 1 - 0.55 * smoothstep(p.lamp3 + 0.5, p.match, t);
				for (let i = 0; i < g.count && thin > 0; i++) {
					const near = fog || t < p.match ? 0 : Math.exp(-Math.max(0, fromHome[i] - Math.max(reach, 6)) / 30);
					if (hash01(i * 5 + 1) > thin && near < 0.3) continue;
					const n = noise3(skyX[i] * 1.1 + drift, skyY[i] * 1.1, t * 0.03 + 2);
					const n2 = noise3(skyX[i] * 3 - drift * 1.7, skyY[i] * 3, t * 0.05 + 4);
					setSample(out, i, palette, lerp(SLOT.glow, SLOT.white, 0.35 + 0.4 * n), 0.46 + 0.14 * n + 0.06 * n2);
					if (near > 0.01) addSample(out, i, palette, SLOT.base, 0.45 * near);
				}
				if (fog) {
					// Now and then a car's lights pass along one wall, a soft band through the fog.
					const j = Math.floor(t / 47);
					const age = t - (j * 47 + 10 + 25 * hash01(j * 7 + 3));
					if (age >= 0 && age < 4) {
						const along = g.strips[Math.floor(hash01(j * 13 + 5) * 4)];
						const at = along.offset + (hash01(j * 3 + 1) < 0.5 ? age / 4 : 1 - age / 4) * along.count;
						const level = 0.6 * Math.sin((Math.PI * age) / 4);
						for (let d = -20; d <= 20; d++) {
							const i = Math.round(at) + d;
							if (i < along.offset || i >= along.offset + along.count) continue;
							addSample(out, i, palette, SLOT.white, level * (1 - Math.abs(d) / 21));
						}
					}
				}

				// The streetlamps, each going out on its tick.
				for (let k = 0; k < 3; k++) {
					const age = fog ? -1 : t - ((k === 0 ? p.lamp1 : k === 1 ? p.lamp2 : p.lamp3) + 0.1);
					if (age > 0.25) continue;
					const radius = age < 0 ? 14 : 14 * (1 - age / 0.25) + 0.5;
					const glow = age < 0 ? 1 : 1 - age / 0.25;
					for (let d = -40; d <= 40; d++) {
						const halo = Math.exp(-(d * d) / (2 * radius * radius));
						if (halo < 0.05) continue;
						const i = wrap(lamps[k] + d);
						addSample(out, i, palette, SLOT.accent, 0.8 * halo * glow);
						if (d > -2 && d < 2) addSample(out, i, palette, SLOT.white, 0.8 * glow);
					}
				}

				if (!fog && t >= p.match && t < p.catch + 0.5) {
					const m = t - p.match;
					if (m < 0.12) {
						for (let j = 0; j < 3; j++) addSample(out, wrap(home + Math.floor(hash01(Math.floor(t * 60) * 7 + j) * 7) - 3), palette, SLOT.white, 1.2);
					}
					const flare = hit(m - 0.1, 0.16);
					const smoulder = 3 + 9 * smoothstep(p.match + 1, p.catch, t);
					for (let d = -Math.ceil(smoulder); d <= smoulder; d++) {
						const i = wrap(home + d);
						const flicker = noise3(d * 0.5, t * 7, 1.1);
						if (Math.abs(d) <= 3) {
							setSample(out, i, palette, lerp(SLOT.base, SLOT.third, 0.5 + 0.5 * flicker), 0.55 + 0.4 * flicker * (1 - Math.abs(d) / 5));
						} else addSample(out, i, palette, SLOT.base, 0.5 * (0.7 + 0.3 * flicker));
						if (Math.abs(d) <= 4) addSample(out, i, palette, SLOT.white, 1.3 * flare * (1 - Math.abs(d) / 5));
					}
				}

				if (!fog && t >= p.catch && (t < p.count || met >= 0)) {
					const whoosh = hit(t - p.catch, 0.3);
					for (let d = -40; d <= 40 && whoosh > 0.02; d++) addSample(out, wrap(home + d), palette, SLOT.third, 1.2 * whoosh * (1 - Math.abs(d) / 41));
					const growing = t < p.inhale || met >= 0;
					for (let i = 0; i < ring; i++) {
						const behind = reach - fromHome[i];
						if (behind >= 0) flame(out, palette, i, behind, t, swell, growing);
						if (met >= 0 && behind >= 0 && behind < 40 && blast < ring / 2) addSample(out, i, palette, SLOT.white, 1.4 * (1 - behind / 40));
					}
					// The beam burns in from each end once the fire reaches it, embers flying ahead.
					let fromSouth: number;
					let fromNorth: number;
					if (met >= 0) {
						fromSouth = blast - toSouth;
						fromNorth = blast - toNorth;
					} else {
						const southAt = p.catch + span * Math.pow(toSouth / (ring / 2), 1 / p.spread);
						const northAt = p.catch + span * Math.pow(toNorth / (ring / 2), 1 / p.spread);
						const held = Math.min(t, p.inhale);
						const shrink = (1 - drawnIn) ** 2;
						fromSouth = held < southAt ? -1 : (half - 3) * clamp((held - southAt) / (p.inhale - southAt)) * shrink;
						fromNorth = held < northAt ? -1 : (half - 3) * clamp((held - northAt) / (p.inhale - northAt)) * shrink;
					}
					for (let b = 0; b < beamCount; b++) {
						if (Math.abs(b - leaf) <= 3) continue;
						const behind = Math.max(fromSouth - b, fromNorth - (beamCount - 1 - b));
						if (behind >= 0) flame(out, palette, beamStart + b, behind, t, swell, growing);
						const upS = fromSouth >= 0 && b > fromSouth && b < fromSouth + 18 && hash01(Math.floor(b - t * 45) * 7 + 3) < 0.15 + 0.2 * drum;
						const upN = fromNorth >= 0 && beamCount - 1 - b > fromNorth && beamCount - 1 - b < fromNorth + 18 && hash01(Math.floor(b + t * 45) * 11 + 5) < 0.15 + 0.2 * drum;
						if (upS || upN) addSample(out, beamStart + b, palette, SLOT.third, 0.95);
					}
					// Mirrors pops() in timing.ts.
					for (let s = Math.max(Math.ceil((p.catch + 0.4) / 0.11), Math.floor((t - 0.3) / 0.11)); s <= Math.floor(t / 0.11); s++) {
						if (s * 0.11 >= p.end - 1) break;
						const at = s * 0.11 + 0.06 * hash01(s * 13 + 1);
						const age = t - at;
						if (age < 0 || age > 0.3 || (at > p.inhale - 0.1 && at < p.midnight + 0.3)) continue;
						if (hash01(s * 7 + 5) > 0.12 + 0.3 * Math.min(1, (at - p.catch) / span)) continue;
						const popReach = at >= p.midnight ? ring / 2 : (ring / 2) * Math.pow(clamp((Math.min(at, p.inhale) - p.catch) / span), p.spread);
						const d = Math.floor(hash01(s * 31 + 2) * popReach);
						const i = wrap(hash01(s * 3 + 9) < 0.5 ? home + d : home - d);
						const v = 1.25 * Math.exp(-age / 0.06);
						addSample(out, i, palette, SLOT.white, v);
						addSample(out, wrap(i - 1), palette, SLOT.third, 0.6 * v);
						addSample(out, wrap(i + 1), palette, SLOT.third, 0.6 * v);
					}
					if (t >= p.inhale && t < p.count) {
						for (let d = -12; d <= 12; d++) addSample(out, wrap(home + d), palette, SLOT.third, 1.2 * drawnIn * (1 - Math.abs(d) / 13));
					}
				}

				if (!fog && t >= p.count && t < p.midnight) {
					// Ten to one in flame: mirrors countdown() in timing.ts, ten as a one then a nought.
					const second = t - p.count;
					const n = Math.floor(second);
					const value = n === 0 ? (second < 0.5 ? 1 : 0) : 10 - n;
					const since = n === 0 ? second % 0.5 : second - n;
					const mask = digits[value];
					const strike = hit(since, 0.15);
					const on = since < (n === 0 ? 0.42 : 0.9);
					for (let i = 0; i < g.count && on; i++) {
						const s = segment[i];
						if (s < 0 || !((mask >> (p.flip > 0.5 ? turned[s] : s)) & 1)) continue;
						flame(out, palette, i, 20, t, 1.2 + 0.4 * strike, false);
						if (strike > 0.05) addSample(out, i, palette, SLOT.white, 0.9 * strike);
					}
				}

				// The leaf, in the palette's accent: the fog's amber, the fire's gold, then scarlet.
				const glow = fog ? 0.82 : (1 + 0.2 * drum) * (met >= 0 ? 1.25 : t >= p.inhale ? 1.15 : 1);
				for (let d = -3; d <= 3; d++) {
					setSample(out, beamStart + leaf + d, palette, SLOT.accent, (0.5 + 0.4 * (1 - Math.abs(d) / 4)) * glow);
				}
			}
		};
	}
});

// ---- Lampionový průvod ----------------------------------------------------------------------------

/**
 * The second pause: a procession of paper lanterns round the dark frame, the children's ones
 * running ahead now and then, under a half moon on the beam.
 */
const lampionovyPruvod = effect({
	id: 'lampionovyPruvod',
	name: 'Lampionový průvod',
	role: 'bed',
	blurb: 'Paper lanterns in procession round a dark frame, children running ahead, a half moon on the beam.',
	create(g) {
		let ring = 0;
		for (const s of g.strips) if (s.inPerimeter) ring += s.count;
		const beamStart = ring;
		const beamCount = g.count - ring;
		const moon = Math.floor(beamCount / 2);
		const wrap = (i: number) => ((i % ring) + ring) % ring;
		const tones = new Float32Array([SLOT.base, SLOT.accent, SLOT.third]);
		const lantern = (out: Float32Array, palette: Float32Array, at: number, tone: number, candle: number, turn: number) => {
			for (let d = -4; d <= 4; d++) {
				const shape = Math.cos((Math.PI * d) / 10) ** 2;
				const i = wrap(Math.round(at) + d);
				setSample(out, i, palette, tone, Math.max(0.52, (0.78 + 0.22 * candle) * shape) * turn);
				if (d === 0) addSample(out, i, palette, SLOT.white, 0.3 + 0.25 * candle);
			}
		};
		return {
			render(out, { f, palette }) {
				const t = f.t;
				out.fill(0);
				// Walking pace, a lap a minute; each lantern bobs with its bearer's stride.
				for (let j = 0; j < 12; j++) {
					const at = (j * ring) / 12 + 14 * (hash01(j * 7 + 1) - 0.5) + 9.4 * t + 1.2 * Math.sin(t * 2.1 + j * 1.7);
					lantern(out, palette, at, tones[j % 3], noise3(j * 3.1, t * 5, 0.7), 1 + 0.1 * Math.sin(t * 1.3 * 2 * Math.PI + j));
				}
				// Every so often two children run on ahead, round the frame and back into the line.
				const k = Math.floor(t / 37);
				const run = t - (k * 37 + 12 * hash01(k * 5 + 2));
				if (run >= 0 && run < 9) {
					const from = hash01(k * 11 + 4) * ring + 9.4 * t;
					for (let c = 0; c < 2; c++) {
						const at = from + 22 * (run - 4.5 * (1 - Math.cos((Math.PI * run) / 9))) - c * 14;
						lantern(out, palette, at, tones[(k + c) % 3], noise3(k * 2.3 + c, t * 7, 1.9), 1 + 0.2 * Math.sin(t * 9 + c));
					}
				}
				// The half moon: lit on one side, dark on the other.
				for (let d = -4; d <= 0; d++) setSample(out, beamStart + moon + d, palette, SLOT.white, 0.6 + (0.08 * (d + 4)) / 4);
			}
		};
	}
});

// ---- Orionidy -----------------------------------------------------------------------------------

/**
 * After the lanterns, scored by podzimni-listi/orionidy.m4a: the real Orionids of that night. Stars,
 * Orion's belt rising in the north-east corner, meteors out of it ever thicker on the drums, a
 * fireball crossing the east and south walls to home and bursting, a breath of dark, and the whole
 * sky coming down in a shower of light.
 */
const orionidy = effect({
	id: 'orionidy',
	name: 'Orionidy',
	role: 'bed',
	blurb: 'Meteors out of the north-east thickening on the drums, a fireball, a breath, and the sky falling.',
	// The soundtrack's timing table arrives as parameters; the meteors mirror meteors() in timing.ts.
	params: ORIONIDY,
	create(g) {
		let ring = 0;
		for (const s of g.strips) if (s.inPerimeter) ring += s.count;
		const [alongRun, acrossRun] = [g.strips[0].count, g.strips[1].count];
		const beamStart = ring;
		const beamCount = g.count - ring;
		const half = beamCount / 2;
		const leaf = Math.floor(beamCount / 2);
		const home = 2 * alongRun + acrossRun;
		const far = alongRun;
		const wrap = (i: number) => ((i % ring) + ring) % ring;
		const apart = (a: number, b: number) => {
			const d = wrap(a - b);
			return d > ring / 2 ? ring - d : d;
		};
		const hit = (age: number, tau: number) => (age < 0 ? 0 : age < 0.02 ? age / 0.02 : Math.exp(-(age - 0.02) / tau));
		return {
			render(out, { f, p, palette }) {
				const t = f.t;
				out.fill(0);
				const beat = 60 / p.bpm;
				const fallen = t >= p.fall ? t - p.fall : -1;
				// The drums brighten the sky.
				let drum = 0;
				for (let at = p.shower, k = 0; at <= t && at < p.burst; at += beat / 2, k++) {
					const strong = at < p.storm ? k % 8 === 0 || k % 8 === 5 : k % 2 === 0;
					if (strong) drum = hit(t - at, 0.25);
				}
				// As the sky falls it glows, blooming round from home behind a crest of light.
				if (fallen >= 0) {
					const front = 10 + fallen * 340;
					for (let i = 0; i < ring; i++) {
						const behind = front - apart(i, home);
						if (behind < 0) continue;
						const n = noise3(i * 0.03, t * 0.2, 4.4);
						setSample(out, i, palette, SLOT.base, 0.5 + 0.15 * n);
						if (behind < 26 && front < ring / 2 + 26) addSample(out, i, palette, SLOT.white, 1.15 * (1 - behind / 26));
					}
					const reach = Math.min(half, fallen * 120);
					for (let b = 0; b < beamCount; b++) {
						const off = Math.abs(b - leaf);
						if (off > reach) continue;
						const ray = 0.5 + 0.5 * Math.sin(off * 0.5 - fallen * 8);
						addSample(out, beamStart + b, palette, SLOT.accent, 0.55 + 0.35 * ray);
						addSample(out, beamStart + b, palette, SLOT.white, 0.25 * ray);
					}
				}
				// The stars, brighter on the drums and as the sky falls; Orion's belt in the north-east.
				for (let i = 0; i < g.count; i++) {
					if (hash01(i * 13 + 7) < 0.05) addSample(out, i, palette, SLOT.white, 0.4 + 0.25 * noise3(i, t * 0.9, 1.1) + 0.3 * drum + (fallen >= 0 ? 0.3 : 0));
				}
				for (let k = 0; k < 3; k++) setSample(out, wrap(far - 30 + 4 * k), palette, SLOT.white, 0.85);

				// Mirrors meteors() in timing.ts: each runs away from the radiant, head first.
				for (let s = Math.max(Math.ceil(p.first / 0.05), Math.floor((t - 1) / 0.05)); s <= Math.floor(t / 0.05); s++) {
					const at = s * 0.05;
					if (at >= p.end - 1 || (at >= p.burst && at < p.fall)) continue;
					const rate = at >= p.fall ? p.rateTo * 1.4 : p.rateFrom * Math.pow(p.rateTo / p.rateFrom, Math.min(1, (at - p.first) / (p.burst - p.first)));
					if (hash01(s * 7 + 3) > rate * 0.05) continue;
					const life = 0.35 + 0.45 * hash01(s * 23 + 6);
					const age = t - at;
					if (age < 0 || age > life) continue;
					const from = far + Math.round((hash01(s * 11 + 5) - 0.5) * 120);
					const dir = hash01(s * 13 + 1) < 0.5 ? 1 : -1;
					const speed = 250 + 400 * hash01(s * 17 + 2);
					const length = 14 + Math.floor(26 * hash01(s * 19 + 4));
					const bright = 1.25 * Math.sqrt(1 - age / life);
					const head = Math.round(from + dir * speed * age);
					const tone = hash01(s * 29 + 8) < 0.5 ? SLOT.accent : SLOT.third;
					for (let q = 0; q < length; q++) {
						const level = q < 2 ? bright : bright * Math.pow(1 - q / length, 1.5);
						if (level < 0.34) break;
						addSample(out, wrap(head - dir * q), palette, q < 2 ? SLOT.white : lerp(SLOT.white, tone, Math.min(1, q / 6)), level);
					}
				}

				// The fireball: mirrors bolideAt(), green-white, shedding sparks, lighting the sky.
				if (t >= p.bolide && t < p.burst) {
					const u = clamp((t - p.bolide) / (p.burst - p.bolide));
					const head = Math.round(far + (home - far) * u * u * (3 - 2 * u));
					const grow = 1 + 0.6 * u;
					for (let q = -3; q < 90; q++) {
						const level = q < 4 ? 1.4 * grow : 1.2 * grow * Math.pow(1 - q / 90, 1.3);
						if (level < 0.34) break;
						addSample(out, wrap(head - q), palette, q < 4 ? SLOT.white : q < 30 ? SLOT.accent : SLOT.third, level);
					}
					for (let j = 0; j < 6; j++) {
						const q = Math.floor(hash01(Math.floor(t * 30) * 7 + j) * 80) + 10;
						addSample(out, wrap(head - q), palette, SLOT.white, 1);
					}
					if (u > 0.8) {
						for (let i = 0; i < ring; i++) addSample(out, i, palette, SLOT.accent, 0.48 * smoothstep(0.8, 1, u));
					}
				}
				// It bursts over home: a flare there, the pieces falling away from it, then nothing but stars.
				const burst = t - p.burst;
				if (burst >= 0 && burst < 1.2 && fallen < 0) {
					if (burst < 0.12) {
						for (let d = -40; d <= 40; d++) addSample(out, wrap(home + d), palette, SLOT.white, 1.4 * (1 - Math.abs(d) / 41));
					}
					const front = burst * 160;
					for (let d = -Math.ceil(front); d <= front; d++) {
						if (front - Math.abs(d) > 6) continue;
						addSample(out, wrap(home + d), palette, d % 3 === 0 ? SLOT.white : SLOT.accent, 1.2 * (1 - burst / 1.2));
					}
				}
				for (let d = -3; d <= 3; d++) addSample(out, beamStart + leaf + d, palette, SLOT.third, 0.5 + 0.35 * (1 - Math.abs(d) / 4));
			}
		};
	}
});

// ---- Poslední list ------------------------------------------------------------------------------

/**
 * The end, scored by podzimni-listi/posledni-list.m4a: a clear night, hoarfrost growing feather by
 * feather and brightening with the music until the frame is silver; the leaf shivering, and at
 * the silence it lets go and falls through the dark, lighting the frost it passes; its landing
 * throws a last wave of gold round the room, which ebbs back into the corner and leaves the leaf
 * glowing there among a few glints. The Goodnight hold plays it from its end.
 */
const posledniList = effect({
	id: 'posledniList',
	name: 'Poslední list',
	role: 'bed',
	blurb: 'Frost silvers the frame, the last leaf falls through the dark and its landing sends a wave of gold round.',
	// The soundtrack's timing table arrives as parameters; `from` skips ahead to the resting leaf.
	params: { ...LIST, from: 0 },
	create(g) {
		let ring = 0;
		for (const s of g.strips) if (s.inPerimeter) ring += s.count;
		const [alongRun, acrossRun] = [g.strips[0].count, g.strips[1].count];
		const beamStart = ring;
		const beamCount = g.count - ring;
		const half = beamCount / 2;
		const leaf = Math.floor(beamCount / 2);
		const home = 2 * alongRun + acrossRun;
		const north = Math.round(alongRun / 2);
		const south = alongRun + acrossRun + Math.round(alongRun / 2);
		const path = leaf + (home - south);
		const wrap = (i: number) => ((i % ring) + ring) % ring;
		const apart = (a: number, b: number) => {
			const d = wrap(a - b);
			return d > ring / 2 ? ring - d : d;
		};
		const hit = (age: number, tau: number) => (age < 0 ? 0 : age < 0.02 ? age / 0.02 : Math.exp(-(age - 0.02) / tau));
		const toSouth = apart(home, south);
		const toNorth = apart(home, north);
		const frost = new Float32Array(g.count);
		const flash = new Float32Array(g.count);
		// Where each pixel lies on the leaf's way down, so the falling leaf can light what it passes.
		const onPath = new Float32Array(g.count);
		for (let i = 0; i < g.count; i++) {
			if (i >= ring) onPath[i] = leaf - (i - beamStart);
			else {
				const along = wrap(i - south);
				onPath[i] = along <= home - south ? leaf + along : -1000;
			}
		}

		/** A leaf at a fractional position on its path, its colour turning as it flips. */
		const drawLeaf = (out: Float32Array, palette: Float32Array, along: number, flip: number, level: number) => {
			for (let d = -3; d <= 3; d++) {
				const q = Math.round(along) + d;
				const shape = 1 - Math.abs(q - along) / 4;
				if (shape <= 0 || q < -leaf || q > path) continue;
				const i = q <= leaf ? beamStart + leaf - q : wrap(south + q - leaf);
				setSample(out, i, palette, lerp(SLOT.accent, SLOT.third, flip), Math.max(0.5, (0.5 + 0.55 * shape) * level));
			}
		};

		return {
			render(out, { f, p, palette }) {
				const t = f.t + p.from;
				out.fill(0);
				frost.fill(0);
				flash.fill(0);
				const after = smoothstep(p.land + 1.5, p.rest, t);
				const swelling = smoothstep(p.frost + 4, p.shiver, t);
				const roll = t >= p.rimed - 4 && t < p.letGo ? smoothstep(p.rimed - 4, p.letGo, t) : 0;

				// Feathers of hoarfrost: mirrors tufts() in timing.ts. Each grows out from its spine.
				for (let s = 0; p.frost + s * 0.12 < p.rimed; s++) {
					const at = p.frost + s * 0.12 + 0.08 * hash01(s * 23 + 4);
					if (at > t) break;
					if (hash01(s * 11 + 6) > 0.25 + 0.7 * ((at - p.frost) / (p.rimed - p.frost))) continue;
					const centre = Math.floor(hash01(s * 37 + 12) * ring);
					const width = 3 + Math.floor(hash01(s * 41 + 8) * 4);
					const grown = width * clamp((t - at) / 1.2);
					for (let d = -width; d <= width; d++) {
						if (Math.abs(d) > grown) continue;
						const barb = Math.abs(d) % 2 === 0 ? 1 : 0.62;
						const i = wrap(centre + d);
						frost[i] = Math.max(frost[i], (0.58 + 0.18 * (1 - Math.abs(d) / (width + 1))) * barb);
					}
					flash[centre] = Math.max(flash[centre], 1.1 * hit(t - at, 0.1));
				}
				// The beam frosts in from both ends and reaches the leaf as it starts to shiver.
				const inward = (half - 4) * Math.pow(clamp((t - p.frost) / (p.shiver - p.frost)), 1.2);
				for (let b = 0; b < beamCount; b++) {
					if (Math.min(b, beamCount - 1 - b) < inward && hash01(b * 13 + 5) < 0.85) frost[beamStart + b] = b % 2 === 0 ? 0.68 : 0.5;
				}

				if (t < p.letGo) {
					// The clear night under the frost, the frost brightening and shimmering as the music
					// swells and the roll comes up under it.
					for (let i = 0; i < g.count; i++) {
						if (frost[i] > 0) {
							const shimmer = 1 + 0.08 * roll * Math.sin(2 * Math.PI * 16 * t + i * 1.7);
							setSample(out, i, palette, lerp(SLOT.glow, SLOT.white, 0.75), frost[i] * (1 + 0.35 * swelling) * shimmer);
						} else {
							setSample(out, i, palette, SLOT.base, 0.46 + 0.1 * noise3(i * 0.03, t * 0.06, 6.1));
							if (i < ring && hash01(i * 17 + 4) < 0.03) addSample(out, i, palette, SLOT.white, 0.35 + 0.3 * noise3(i, t * 0.8, 2.2));
						}
						if (flash[i] > 0.02) addSample(out, i, palette, SLOT.white, flash[i]);
					}
					for (let slot = Math.floor(t * 10) - 3; slot <= Math.floor(t * 10); slot++) {
						const since = t - slot / 10;
						for (let j = 0; j < 3 + Math.round(5 * swelling); j++) {
							const i = Math.floor(hash01(slot * 29 + j * 13 + 3) * g.count);
							if (frost[i] > 0) addSample(out, i, palette, SLOT.white, 0.9 * Math.exp(-since / 0.08));
						}
					}
					// The leaf on the branch, shivering as the frost closes in.
					const shiver = smoothstep(p.shiver, p.shiver + 1, t);
					const jitter = shiver > 0.5 ? Math.round(2 * hash01(Math.floor(t * 20)) - 1) : 0;
					drawLeaf(out, palette, jitter, 0.2, 1 + 0.3 * shiver * Math.sin(2 * Math.PI * 9 * t));
					return;
				}

				if (t < p.land) {
					// The fall, in the dark: the leaf lights the frost it passes, and pulses with the
					// heart under each swing. Mirrors leafAlong() in timing.ts.
					const u = clamp((t - p.letGo) / (p.land - p.letGo));
					const mean = path * u * u * (3 - 2 * u);
					const swing = 9 * Math.sqrt(Math.sin(Math.PI * u)) * Math.sin(2 * Math.PI * p.swings * u);
					const along = Math.max(0, Math.min(path, mean + swing));
					const flip = 0.5 + 0.5 * Math.cos(2 * Math.PI * p.swings * u);
					let beat = 0;
					for (let k = 0; k < p.swings; k++) beat = Math.max(beat, hit(t - (p.letGo + ((k + 0.25) / p.swings) * (p.land - p.letGo)) - 0.6, 0.3));
					const pool = 40 + 14 * beat;
					for (let i = 0; i < g.count; i++) {
						const off = Math.abs(onPath[i] - along);
						if (off > pool) continue;
						if (frost[i] > 0) setSample(out, i, palette, lerp(SLOT.third, SLOT.white, 0.6), Math.max(0.46, frost[i] * (1 - off / pool) * 1.2));
						else setSample(out, i, palette, SLOT.base, 0.46);
					}
					drawLeaf(out, palette, along, 0.15 + 0.6 * flip, 1.1 + 0.6 * hit(t - p.letGo, 0.08) + 0.4 * beat);
					return;
				}

				// The last light: gold out of the corner both ways round the frost, the beam taking it
				// from both ends; then it ebbs back into the corner and leaves the leaf there.
				const landed = t - p.land;
				const reach = t < p.ebb ? Math.min(ring / 2 + 30, 6 + landed * p.wave) : ring / 2 + 30 - (ring / 2 + 30 - 56) * smoothstep(p.ebb, p.rest, t);
				for (let i = 0; i < g.count; i++) {
					const d = i < ring ? apart(i, home) : Math.min(toSouth + (i - beamStart), toNorth + beamCount - 1 - (i - beamStart));
					if (d < reach) {
						setSample(out, i, palette, SLOT.third, 0.82 + 0.1 * noise3(i * 0.03, t * 0.2, 1.3));
						if (frost[i] > 0) addSample(out, i, palette, SLOT.white, 0.35 * frost[i] * (0.5 + 0.5 * noise3(i * 0.5, t * 3, 8.8)));
						if (t < p.ebb && reach - d < 24 && reach < ring / 2) addSample(out, i, palette, SLOT.white, 1.3 * (1 - (reach - d) / 24));
					} else if (t < p.ebb) {
						continue;
					} else if (frost[i] > 0 && hash01(i * 7 + 2) < 1 - 0.88 * after) {
						setSample(out, i, palette, lerp(SLOT.glow, SLOT.white, 0.75), frost[i]);
					} else if (frost[i] === 0 && hash01(i * 3 + 11) >= after) {
						setSample(out, i, palette, SLOT.base, 0.46 + 0.1 * noise3(i * 0.03, t * 0.06, 6.1));
					}
				}
				// Glints in what frost is left.
				for (let slot = Math.floor(t * 10) - 3; slot <= Math.floor(t * 10); slot++) {
					const since = t - slot / 10;
					for (let j = 0; j < 3; j++) {
						if (hash01(slot * 17 + j * 5 + 1) > 0.15) continue;
						const i = Math.floor(hash01(slot * 29 + j * 13 + 3) * g.count);
						const d = i < ring ? apart(i, home) : 0;
						if (frost[i] > 0 && d >= reach && hash01(i * 7 + 2) < 1 - 0.88 * after) addSample(out, i, palette, SLOT.white, 0.9 * Math.exp(-since / 0.08));
					}
				}
				// At rest in the corner: it opens out of a point into the glow the night ends on.
				const bloom = hit(landed, 0.5);
				const open = Math.round(56 * smoothstep(p.land, p.land + 0.6, t));
				const breath = 0.93 + 0.07 * noise3(0.4, t * 0.06, 9.7);
				for (let d = -open; d <= open; d++) {
					const core = Math.exp(-(d * d) / 300);
					const i = wrap(home + d);
					setSample(out, i, palette, lerp(SLOT.accent, SLOT.third, 0.5 - 0.35 * core), breath * (0.46 + 0.42 * core) + 1.1 * bloom * Math.exp(-(d * d) / 900));
					if (d > -3 && d < 3) addSample(out, i, palette, SLOT.white, 0.25 + 0.6 * bloom);
				}
			}
		};
	}
});

// ---- The night --------------------------------------------------------------------------------

const birthdayEnd = NAROZENINY.verse2 + ((22 + NAROZENINY.hold) * 60) / NAROZENINY.bpm;
const letters = spelling(SFOUKNUTO).filter((l) => l.char !== ' ');
const zareBar = 240 / ZARE.bpm;
const zareDrums = Array.from({ length: Math.ceil((ZARE.corona - 0.5 - ZARE.surge) / (zareBar / 2)) }, (_, k) => ({
	at: ZARE.surge + (k * zareBar) / 2,
	kick: k % 2 === 0 ? 0.6 : 0.35
}));
const skyBeat = 60 / ORIONIDY.bpm;
const skyDrums = Array.from({ length: Math.ceil((ORIONIDY.burst - ORIONIDY.shower) / (skyBeat / 2)) }, (_, k) => ({ at: ORIONIDY.shower + (k * skyBeat) / 2, k })).filter(
	({ at, k }) => (at < ORIONIDY.storm ? k % 8 === 0 || k % 8 === 5 : k % 2 === 0)
);
// Whole, like the moment it hands to, so the fog does not step up when the minute starts.
const fog = look({ bed: { effect: pulnoc, params: { fog: 1 } }, palette: mlha, intensity: 1, floor: 0 });

export default evening('Podzimní listí', {
	palette: zlato,
	segments: [
		hold('Pavučinky', {
			look: look({ bed: { effect: vitr, params: { doors: 1 } }, palette: canopy, floor: 0 }),
			expectEnd: '19:45',
			note: 'Stop Spotify, then press Go.'
		}),

		narration('Vítr', {
			audio: './podzimni-listi/vitr.m4a',
			palette: canopy,
			bpm: VITR.bpm,
			enter: { light: 'cut' },
			// The gold rings out and is handed to the first song at its own level.
			end: 'hold',
			timeline: [
				{ at: 0, section: 'breakdown', look: look({ bed: vitr, floor: 0 }) },
				{ at: VITR.glint, kick: 0.6 },
				{ at: VITR.gust1, kick: 0.6 },
				{ at: VITR.gust2, kick: 0.75 },
				{ at: VITR.storm, section: 'build' },
				...stormDrums(VITR).map((d) => ({ at: d.t, kick: 0.35 + (0.5 * d.size * (d.t - VITR.storm)) / (VITR.peak - VITR.storm) })),
				{ at: VITR.peak, kick: true },
				{ at: VITR.hush, section: 'void' },
				...hushBeats(VITR).map((at) => ({ at, kick: 0.8 })),
				{ at: VITR.gold, section: 'drop', kick: 0.6 }
			]
		}),

		block('Zlaté odpoledne', {
			palette: zlato,
			enter: { light: 3 },
			between: { crossfade: 4 },
			songs: [
				song('Better', { by: 'Khalid', id: 'zweuMUhYpX0' }),
				song('Better', { by: 'nimino', id: '9Zo8jqTqju0' }),
				song('6am', { by: 'Channel Tres', id: 'Z40azBQ4hzo' }),
				song('Inner Light', { by: 'Elderbrook', id: 'xZiSW0rI_9Y' }),
				song('Edge Of Desire', { by: 'Jonas Blue', id: '91ArCmT8cF0' }),
				song("Movin' To The Sun", { by: 'HUGEL', id: 'n7QlUH0zrPg' }),
				song('Just The Way You Are', { by: 'Milky', id: '1iDrQta26zo' }),
				song('Waterfalls', { by: 'James Hype', id: 'G-VVVGALi1A' }),
				song('Desire', { by: 'Ian Asher', id: 'UARSiWU8eoo' })
			]
		}),

		narration('Drakiáda', {
			id: 'drakiada-launch',
			audio: './podzimni-listi/drakiada.m4a',
			palette: drak,
			bpm: DRAKIADA.bpm,
			enter: { light: 'cut' },
			end: 'hold',
			timeline: [
				{ at: 0, section: 'build', look: look({ bed: drakiada, floor: 0 }) },
				...tugs(DRAKIADA).map((at, k) => ({ at, kick: 0.6 + 0.05 * k })),
				{ at: DRAKIADA.snap, kick: true },
				...lapEnds(DRAKIADA)
					.filter((at) => at < dropTime(DRAKIADA) - 0.05)
					.map((at) => ({ at, kick: 0.8 })),
				{ at: dropTime(DRAKIADA), section: 'drop', kick: 0.6 }
			]
		}),

		block('Drakiáda', {
			palette: drak,
			enter: { light: 'cut', hit: 'bump' },
			between: { crossfade: 3 },
			songs: [
				song('Beauty And A Beat', { by: 'Justin Bieber', id: 'aWkPBCF8rFU' }),
				song('Timber', { by: 'Pitbull', id: 'GcYF1xnmZTI' }),
				song('Party Rock Anthem', { by: 'LMFAO', id: 'kmioyMNkgx4' }),
				song('Where Have You Been', { by: 'Rihanna', id: 'DxC-PpNdwxo' }),
				song('Into You', { by: 'Ariana Grande', id: 'Faq-ODnfIPw' }),
				song('Dynamite', { by: 'Taio Cruz', id: '3MrY_BwLChk' }),
				song('Starships', { by: 'Nicki Minaj', id: '_cUM4SlY2_o' })
			]
		}),

		narration('Špačci', {
			id: 'spacci-flock',
			audio: './podzimni-listi/spacci.m4a',
			palette: vinice,
			bpm: SPACCI.bpm,
			enter: { light: 'cut' },
			end: 'hold',
			timeline: [
				{ at: 0, section: 'build', look: look({ bed: spacci, floor: 0 }) },
				{ at: SPACCI.arrive, kick: 0.5 },
				...spacciDrums(SPACCI).map((d) => ({ at: d.t, kick: 0.35 + 0.45 * d.size })),
				{ at: SPACCI.hush, section: 'void' },
				{ at: SPACCI.lift, section: 'drop', kick: 0.6 }
			]
		}),

		block('Vinice', {
			palette: vinice,
			enter: { light: 'cut', hit: 'bump' },
			between: { crossfade: 3 },
			songs: [
				song('Hannah Montana', { by: 'Calin', id: 'rtRf-iukdvc' }),
				song('Praha/Vídeň', { by: 'Calin', id: 'NZtZzsI8JTA' }),
				song('Habibi', { by: 'STEIN27', id: 'tWEaUKCQ8Fg' }),
				song('Vandr', { by: 'Skippy McDippy', id: 'cOpRvLUSMiQ' }),
				song('SuperStar', { by: 'Calin', id: 'cBICopUZveg' }),
				song('Sunset', { by: 'Separ', id: 'bEgS_KJCxTU' }),
				song('Ona chce tančit', { by: 'Calin', id: 'vWmy5S1C_yo' }),
				// The whole EP as its video plays it, ending on Rolls.
				song('Melanž', { by: 'Yzomandias', id: 'jojRxf2qvqs' })
			]
		}),

		narration('Burčák', {
			id: 'burcak-pop',
			audio: './podzimni-listi/burcak.m4a',
			palette: burcakPalette,
			bpm: BURCAK.bpm,
			enter: { light: 'cut' },
			end: 'hold',
			timeline: [
				{ at: 0, section: 'build', look: look({ bed: burcak, floor: 0 }) },
				...rattles(BURCAK)
					.filter((at) => at < BURCAK.surge)
					.map((at) => ({ at, kick: 0.45 })),
				...kicks(BURCAK).map((at) => ({ at, kick: 0.75 })),
				{ at: BURCAK.pop, kick: true },
				{ at: BURCAK.clink, section: 'drop', kick: 0.6 }
			]
		}),

		block('Burčák', {
			palette: burcakPalette,
			enter: { light: 'cut', hit: 'bump' },
			between: { crossfade: 3 },
			songs: [
				song('Boston', { by: 'Ian Asher', id: '4HKiZY0wp5Y' }),
				song('Somebody (2024)', { by: 'FISHER', id: '6tzzrNS56x8' }),
				song("Baby Don't Hurt Me", { by: 'David Guetta', id: '0zFzJg2srvQ' }),
				song('Forever Young', { by: 'David Guetta', id: 'FFfwiFvwfm8' }),
				song("I'm Good (Blue)", { by: 'David Guetta', id: 'pIb7QoXdP_k' }),
				// The slack before the cake: guests' requests first, and it stretches or shrinks to meet 21:40.
				fill({
					length: '10m',
					from: 'requests-then-library',
					order: 'steady',
					where: {
						families: ['house', 'edm', 'disco', 'pop', 'trance', 'latin'],
						heat: [3, 4.6],
						minutes: [2, 4.5],
						exclude: removed
					}
				}),
				song('Think About The Way', { by: 'Ice MC', id: 'MN-OitmV28Q' })
			]
		}),

		// The birthday.
		hold('Dort', {
			at: '21:40',
			expect: '3m',
			look: look({ bed: { effect: narozeniny, params: { stage: 1 } }, palette: dort, intensity: 1, floor: 0 }),
			enter: { light: 3 },
			note: 'Bring the cake in with its candles lit. Press Go when it is in the room.'
		}),

		narration('Hodně štěstí', {
			audio: './podzimni-listi/narozeniny.m4a',
			palette: dort,
			bpm: NAROZENINY.bpm,
			beatsPerBar: 3,
			enter: { light: 'cut' },
			// The candles burn on into the wish.
			end: 'hold',
			timeline: [
				{ at: 0, section: 'breakdown', look: look({ bed: narozeniny, floor: 0 }) },
				...candles(NAROZENINY).map((c) => ({ at: c.t, kick: 0.35 })),
				...tune(NAROZENINY).map((n) => ({ at: n.t, kick: n.verse === 1 ? 0.3 : 0.55 })),
				{ at: NAROZENINY.verse2, section: 'drop' },
				{ at: birthdayEnd, kick: 0.6 }
			]
		}),

		hold('Přání', {
			expect: '30s',
			look: look({ bed: { effect: narozeniny, params: { stage: 2 } }, palette: dort, intensity: 1, floor: 0 }),
			note: 'He makes a wish. Press Go the moment he blows the candles out.'
		}),

		narration('Sfouknuto', {
			audio: './podzimni-listi/sfouknuto.m4a',
			palette: dort,
			bpm: SFOUKNUTO.bpm,
			enter: { light: 'cut' },
			end: 'hold',
			timeline: [
				{ at: 0, section: 'void', look: look({ bed: sfouknuto, floor: 0 }) },
				{ at: SFOUKNUTO.boom, section: 'drop', palette: oslava, fade: 0, kick: 0.7 },
				...letters.map((l) => ({ at: l.t, kick: 0.85 })),
				...fireworks(SFOUKNUTO)
					.filter((f) => letters.every((l) => Math.abs(l.t - f.t) > 0.01))
					.map((f) => ({ at: f.t, kick: 0.5 }))
			]
		}),

		block('Oslava', {
			palette: oslava,
			enter: { light: 'cut', hit: 'strobe' },
			between: { crossfade: 3 },
			songs: [
				song('Až na měsíc', { by: 'Viktor Sheen', id: 'I-HWMiOM8uE' }),
				song('Safír', { by: 'Calin', id: 'nTzU8TjvxyE' }),
				song('Dopamin', { by: 'Viktor Sheen', id: 'OUpSvSECgVc' }),
				song('Plán B', { by: 'Calin', id: 'QKONZV8yEt4' }),
				song('Dívej', { by: 'Calin', id: 'npF44EQhhso' }),
				song('Cikády', { by: 'Calin', id: 'jqY_Oi95hUk' }),
				song('Jedna Dva', { by: 'Yzomandias', id: 'IyqcKddpDKA' }),
				song('Ibalgin', { by: 'Viktor Sheen', id: 'jhb7g0hM3xE' }),
				song('Syndrom', { by: 'Viktor Sheen', id: '3rkMo0N-Irc' }),
				song('dřív bylo líp', { by: 'Yzomandias', id: 'w4M13JKPE2Y' }),
				song('Cígo a káva', { by: 'Viktor Sheen', id: 'rgN9j5WQVdc' }),
				song('Stíny', { by: 'Viktor Sheen', id: '_VyTeP-35cs' }),
				song('Rozdělený světy', { by: 'Viktor Sheen', id: 'NcypOs8yC50' }),
				// Out of the birthday into the songs they grew up on.
				song('Nostalgie', { by: 'Viktor Sheen', id: 'KCJzMN1vPog' })
			]
		}),

		block('White girl music', {
			palette: lesk,
			enter: { light: 'cut', hit: 'bump' },
			between: { crossfade: 3 },
			songs: [
				song('Mr. Brightside', { by: 'The Killers', id: 'm2zUrruKjDQ' }),
				song('Party In The U.S.A.', { by: 'Miley Cyrus', id: '7ARXrfGbQaI' }),
				song('Toxic', { by: 'Britney Spears', id: 'tVdr_JWmnsA' }),
				song('Poker Face', { by: 'Lady Gaga', id: 'oG-4Uvhm4lI' }),
				song('Teenage Dream', { by: 'Katy Perry', id: 'X1yb80PWsN4' }),
				song('Girlfriend', { by: 'Avril Lavigne', id: 'g0TiuFwX0r8' }),
				song('TiK ToK', { by: 'Kesha', id: 'RxUZLmN5RsY' }),
				song('Call Me Maybe', { by: 'Carly Rae Jepsen', id: 'k6jscLH3p2g' }),
				song('Shake It Off', { by: 'Taylor Swift', id: 'sWMk8dwljFU' })
			]
		}),

		narration('Polární záře', {
			id: 'polarni-zare',
			audio: './podzimni-listi/zare.m4a',
			palette: zare,
			bpm: ZARE.bpm,
			enter: { light: 'cut' },
			end: 'hold',
			timeline: [
				{ at: 0, section: 'breakdown', look: look({ bed: polarniZare, floor: 0 }) },
				{ at: ZARE.curtain, section: 'build' },
				...zareDrums,
				{ at: ZARE.corona - 0.4, section: 'void' },
				{ at: ZARE.corona, section: 'drop', kick: 0.6 }
			]
		}),

		block('Záře', {
			palette: zare,
			enter: { light: 'cut', hit: 'bump' },
			between: { crossfade: 3 },
			songs: [
				song('Nicole Kidman', { by: 'ADÉLA', id: 'h-zuG75Ds-w' }),
				song('APT.', { by: 'ROSÉ', id: 'DiTd771WumE' }),
				song('Golden', { by: 'HUNTR/X', id: '9_bTl2vvYQg' }),
				song('Party', { by: 'Troye Sivan', id: 'mFCU_oVnUcI' }),
				song('Sad Girls', { by: 'Bebe Rexha', id: 'L72P0Os56G4' }),
				song("Don't Wanna Go Home", { by: 'MEDUZA', id: 'jY33qno7Csg' })
			]
		}),

		block('Noc', {
			palette: 'ultraviolet',
			enter: { light: 'cut', hit: 'strobe' },
			between: { crossfade: 3 },
			songs: [
				song('FE!N', { by: 'Travis Scott', id: '2nR1zrNzgcY' }),
				song('Rumble', { by: 'Skrillex', id: 'fFU3VEimqe0' }),
				song('NOKIA', { by: 'Drake', id: 'yi4WypSJr2U' }),
				song('Prada', { by: 'cassö', id: 'KYcSPar5uTk' }),
				song('Not Like Us', { by: 'Kendrick Lamar', id: 'phLb_SoPBlA' }),
				song('SICKO MODE', { by: 'Travis Scott', id: 'NQbkGDoD7B0' }),
				// The slack before midnight, which the birthday's holds spend; it stretches or shrinks to meet 23:56.
				fill({
					length: '10m',
					from: 'library',
					order: 'rising',
					where: {
						// Measured heat puts rap under 3.3; a higher floor leaves only bass, all of it named.
						families: ['hiphop', 'bass', 'edm', 'techno'],
						heat: [2.7, 5],
						minutes: [2, 4.5],
						exclude: removed
					}
				}),
				// Into the fog that the countdown rises out of.
				song('Mlha', { by: 'Viktor Sheen', id: '_0NvwW9TcN8' })
			]
		}),

		pause('Mlha', {
			look: fog,
			enter: { light: 4 },
			length: '1m'
		}),

		// Music ending early waits here in the fog for 23:56; late music shortens it. It ends on 23:59 sharp.
		pause('Mlha', {
			id: 'mlha-pulnoc',
			at: '23:56',
			look: fog,
			until: '23:59'
		}),

		// Its sixtieth second is midnight.
		narration('Půlnoc', {
			at: '23:59',
			audio: './podzimni-listi/pulnoc.m4a',
			palette: mlha,
			bpm: 60,
			enter: { light: 'cut' },
			end: 'hold',
			timeline: [
				{ at: 0, section: 'breakdown', look: look({ bed: pulnoc, floor: 0 }) },
				...[PULNOC.lamp1, PULNOC.lamp2, PULNOC.lamp3].map((at) => ({ at: at + 0.1, kick: 0.45 })),
				{ at: PULNOC.match, kick: 0.7 },
				// A cue's fade runs back from its own start: the fog warms as the match burns.
				{ at: PULNOC.catch, section: 'build', palette: plamen, fade: beatsOf(PULNOC.catch - PULNOC.match, 60), kick: 1 },
				...warDrums(PULNOC)
					.filter((d) => d.t > PULNOC.catch + 0.01)
					.map((d) => ({ at: d.t, kick: 0.35 + 0.45 * d.size })),
				{ at: PULNOC.inhale, section: 'void' },
				...countdown(PULNOC).map((c) => ({ at: c.t, kick: 1 })),
				// The leaf goes scarlet with the blast.
				{ at: PULNOC.midnight, section: 'drop', palette: ohen, fade: 0, kick: 0.8 }
			]
		}),

		block('Oheň', {
			palette: ohen,
			enter: { light: 'cut', hit: 'slam' },
			between: { crossfade: 3 },
			songs: [
				song('Kernkraft 400', { by: 'Zombie Nation', id: '48apI4bpnSo' }),
				song('Pumpin Blood', { by: 'TWINSICK', id: 'rY_VIdu_mR4' }),
				song('Sandstorm', { by: 'Darude', id: 'XjvkxXblpz8' }),
				song('Summertime Sadness (Hardstyle)', { id: 'AHaIdOXzzuE' }),
				song('Turn The Tide', { by: 'Dimitri Vegas', id: 'bopWEN0v9Y8' }),
				song('Vois sur ton chemin (Techno Mix)', { by: 'BENNETT', id: 'i9Jr50r8L7o' }),
				song('Freaks', { by: 'Timmy Trumpet', id: 'Y9i2rPVSEok' }),
				song('Animals', { by: 'Martin Garrix', id: 'DYf28lOb8KU' }),
				song('We Like To Party (Da Tweekaz Remix)', { by: 'Vengaboys', id: 'P5Djcm-Ufmk' }),
				song('Tremor', { by: 'Dimitri Vegas & Like Mike', id: '9vMh9f41pqE' }),
				song('Bangarang', { by: 'Skrillex', id: 'V7hbIzqxhaE' }),
				song('Thunder', { by: 'Gabry Ponte', id: 'b_bEigUA1kk' })
			]
		}),

		pause('Lampionový průvod', {
			look: look({ bed: lampionovyPruvod, palette: lampiony, intensity: 1, floor: 0 }),
			enter: { light: 4 },
			length: '5m'
		}),

		// The guests' block comes before the stars, so the night ends on songs chosen for it.
		block('Vinobraní', {
			palette: vinobrani,
			enter: { light: 3 },
			between: { crossfade: 3 },
			songs: [
				song('Benzínka', { by: 'Stepan Drabek', id: 'j4YQy6uOIGE' }),
				song('Párno Nýdrle', { by: 'VOJIR', id: 'NDvtXeAVjOM' }),
				song('ASSETTO CLUB', { by: 'ASSETTO DRIFTER', id: 'DhM_tQAKqB0' }),
				song('ČIMICE RIDER', { by: 'VOJIR', id: 'j7fLRm-w2cU' }),
				// Shortened by the friends' songs, so the stars still come at about one.
				fill({
					length: '8m',
					from: 'requests-then-library',
					order: 'steady',
					where: {
						families: ['house', 'edm', 'disco', 'pop', 'hiphop', 'latin', 'trance'],
						heat: [3, 4.4],
						minutes: [1.5, 5.5],
						exclude: removed
					}
				})
			]
		}),

		narration('Orionidy', {
			audio: './podzimni-listi/orionidy.m4a',
			palette: hvezdy,
			bpm: ORIONIDY.bpm,
			enter: { light: 'cut' },
			end: 'hold',
			timeline: [
				{ at: 0, section: 'breakdown', look: look({ bed: orionidy, floor: 0 }) },
				{ at: ORIONIDY.shower, section: 'build' },
				...skyDrums.map(({ at }) => ({ at, kick: 0.5 })),
				{ at: ORIONIDY.burst, kick: 1 },
				{ at: ORIONIDY.burst + 0.5, section: 'void' },
				{ at: ORIONIDY.fall, section: 'drop', kick: 0.6 }
			]
		}),

		block('Hvězdy', {
			palette: hvezdy,
			enter: { light: 'cut', hit: 'bump' },
			between: { crossfade: 3 },
			songs: [
				song('Levels', { by: 'Avicii', id: 'xAgv1mAyxr8' }),
				song("Don't You Worry Child", { by: 'Swedish House Mafia', id: 'vRqbSgp8w38' }),
				song('Žijeme len raz', { by: 'Ego', id: '9r5oDM1LGac' }),
				song('Wake Me Up', { by: 'Avicii', id: '2NiyrtYegso' }),
				song('Mráz', { by: 'Viktor Sheen', id: 'ruPeHR2AQEs' }),
				song('All The Stars', { by: 'Kendrick Lamar', id: 'ju4KQT0wL0I' }),
				song('Underground', { by: 'Re-Logic', id: 'p9kZJwdZoXM' }),
				song('Aria Math', { by: 'C418', id: 'maWHojZTnTg' })
			]
		}),

		narration('Poslední list', {
			audio: './podzimni-listi/posledni-list.m4a',
			palette: jinovatka,
			bpm: 60,
			enter: { light: 3 },
			// The leaf glowing in the corner carries straight on into Dobrou noc.
			end: 'hold',
			timeline: [
				{ at: 0, section: 'outro', look: look({ bed: posledniList, floor: 0 }) },
				{ at: LIST.letGo, kick: 0.6 },
				...swingTimes(LIST).map((at) => ({ at, kick: 0.5 })),
				{ at: LIST.land, kick: 0.5 }
			]
		}),

		hold('Dobrou noc', {
			look: look({ bed: { effect: posledniList, params: { from: LIST.end } }, palette: jinovatka, intensity: 1, floor: 0 }),
			enter: { light: 3 },
			note: 'The leaf is home in the corner. End the evening when the room is empty.'
		})
	]
});
