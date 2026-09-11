import type { Geometry, LedSpan, RoomRegion, RoomSpec, StripSpec, Vec3 } from './contracts/room.ts';

/** A 5x4 m room with a 3x2 m frame hanging at 2.4 m. 720 px at 60 LED/m. */
export const DEFAULT_ROOM: RoomSpec = {
	name: 'Room 5x4',
	width: 5,
	depth: 4,
	height: 2.6,
	fixture: {
		width: 3,
		depth: 2,
		height: 2.4,
		density: 60,
		crossAxis: 'y',
		crossOffset: 0,
		section: 0.04
	},
	bounce: { at: [-2.2, -1.7], height: 1, diameter: 0.175 }
};

function segLength(s: { start: Vec3; end: Vec3 }): number {
	return Math.hypot(s.end[0] - s.start[0], s.end[1] - s.start[1], s.end[2] - s.start[2]);
}

/** All runs face down. Use stripAxis, not normal, to distinguish their axes. */
const DOWN: Vec3 = [0, 0, -1];

function stripSpecs(spec: RoomSpec): StripSpec[] {
	const f = spec.fixture;
	const hw = f.width / 2;
	const hd = f.depth / 2;
	const z = f.height;
	const d = f.density;
	const along = Math.round(f.width * d);
	const across = Math.round(f.depth * d);

	// Walked as one counter-clockwise ring so concatenating the sides yields a closed
	// perimeter with no seam.
	const raw: Omit<StripSpec, 'offset'>[] = [
		{
			id: 0,
			name: 'Frame N',
			count: along,
			start: [-hw, hd, z],
			end: [hw, hd, z],
			normal: DOWN,
			inPerimeter: true
		},
		{
			id: 1,
			name: 'Frame E',
			count: across,
			start: [hw, hd, z],
			end: [hw, -hd, z],
			normal: DOWN,
			inPerimeter: true
		},
		{
			id: 2,
			name: 'Frame S',
			count: along,
			start: [hw, -hd, z],
			end: [-hw, -hd, z],
			normal: DOWN,
			inPerimeter: true
		},
		{
			id: 3,
			name: 'Frame W',
			count: across,
			start: [-hw, -hd, z],
			end: [-hw, hd, z],
			normal: DOWN,
			inPerimeter: true
		}
	];

	// Keep non-perimeter LEDs at the buffer tail so wrapped corners cannot reach the beam.
	const o = f.crossOffset;
	raw.push(
		f.crossAxis === 'y'
			? {
					id: 4,
					name: 'Beam',
					count: across,
					start: [o, -hd, z],
					end: [o, hd, z],
					normal: DOWN,
					inPerimeter: false
				}
			: {
					id: 4,
					name: 'Beam',
					count: along,
					start: [-hw, o, z],
					end: [hw, o, z],
					normal: DOWN,
					inPerimeter: false
				}
	);

	let offset = 0;
	return raw.map((s) => {
		const withOffset: StripSpec = { ...s, offset };
		offset += s.count;
		return withOffset;
	});
}

export function buildGeometry(spec: RoomSpec = DEFAULT_ROOM): Geometry {
	const strips = stripSpecs(spec);
	const count = strips.reduce((n, s) => n + s.count, 0);

	const x = new Float32Array(count);
	const y = new Float32Array(count);
	const z = new Float32Array(count);
	const nx = new Float32Array(count);
	const ny = new Float32Array(count);
	const nz = new Float32Array(count);
	const r = new Float32Array(count);
	const theta = new Float32Array(count);
	const dist = new Float32Array(count);
	const strip = new Uint8Array(count);
	const local = new Float32Array(count);
	const perim = new Float32Array(count).fill(-1);
	const normal = new Float32Array(count * 3);

	const f = spec.fixture;
	const extent = Math.max(f.width, f.depth);
	const halfDiag = Math.hypot(f.width / 2, f.depth / 2);
	// Use head height so dist differs from radial distance on the coplanar frame.
	const centreZ = f.height / 2;
	const maxDist3 = Math.hypot(halfDiag, centreZ);

	const perimeterLength = strips
		.filter((s) => s.inPerimeter)
		.reduce((sum, s) => sum + segLength(s), 0);

	let perimWalked = 0;

	for (const s of strips) {
		const len = segLength(s);
		const [sx, sy, sz] = s.start;
		const [ex, ey, ez] = s.end;

		for (let k = 0; k < s.count; k++) {
			const i = s.offset + k;
			// Sample at LED centres so the corner LED where two runs meet is not
			// duplicated into a visible double-bright dot.
			const u = (k + 0.5) / s.count;

			const px = sx + (ex - sx) * u;
			const py = sy + (ey - sy) * u;
			const pz = sz + (ez - sz) * u;

			x[i] = px;
			y[i] = py;
			z[i] = pz;

			nx[i] = (px + f.width / 2) / extent;
			ny[i] = (py + f.depth / 2) / extent;
			nz[i] = pz / extent;

			const rad = Math.hypot(px, py);
			r[i] = Math.min(rad / halfDiag, 1);

			let th = Math.atan2(py, px) / (Math.PI * 2);
			if (th < 0) th += 1;
			theta[i] = th;

			dist[i] = Math.min(Math.hypot(rad, pz - centreZ) / maxDist3, 1);

			strip[i] = s.id;
			local[i] = u;
			if (s.inPerimeter) perim[i] = (perimWalked + u * len) / perimeterLength;

			normal[i * 3 + 0] = s.normal[0];
			normal[i * 3 + 1] = s.normal[1];
			normal[i * 3 + 2] = s.normal[2];
		}

		if (s.inPerimeter) perimWalked += len;
	}

	return {
		count,
		strips,
		x,
		y,
		z,
		nx,
		ny,
		nz,
		r,
		theta,
		dist,
		strip,
		local,
		perim,
		normal,
		pitch: 1 / f.density,
		extent,
		perimeterLength
	};
}

/** Metres on each side of a corner; 120 pixels at 60 LED/m gives a useful percentile sample. */
const CORNER_REACH_M = 1;

/** Return two spans across the ring seam; wrapping must exclude the beam at the buffer tail. */
function ringSpans(ringStart: number, ringLen: number, centre: number, count: number): LedSpan[] {
	const len = Math.min(count, ringLen);
	const from = (((centre - Math.floor(len / 2)) % ringLen) + ringLen) % ringLen;
	if (from + len <= ringLen) return [{ firstLed: ringStart + from, ledCount: len }];
	const head = ringLen - from;
	return [
		{ firstLed: ringStart + from, ledCount: head },
		{ firstLed: ringStart, ledCount: len - head }
	];
}

/** Compass names put latitude first; custom run names keep walk order. */
function cornerLabel(a: StripSpec, b: StripSpec): string {
	const [p, q] = [runLabel(a), runLabel(b)];
	return q === 'N' || q === 'S' ? `${q}${p}` : `${p}${q}`;
}

/** What tells a run from its neighbours, which for the frame is its compass letter. */
function runLabel(s: StripSpec): string {
	return s.name.split(' ').pop() ?? s.name;
}

function region(id: string, name: string, spans: LedSpan[]): RoomRegion {
	return { id, name, spans, count: spans.reduce((n, s) => n + s.ledCount, 0) };
}

/** Device regions preserve spatial gestures when a fixture reduces its input to one value. */
export function roomRegions(g: Geometry): RoomRegion[] {
	const out: RoomRegion[] = [region('all', 'Whole room', [{ firstLed: 0, ledCount: g.count }])];
	const ring = g.strips.filter((s) => s.inPerimeter);

	// A 5 m reel covers one long and one short run. Return both spans without assuming
	// buffer contiguity; the beam has its own region.
	for (let i = 0; i + 1 < ring.length; i += 2) {
		const [a, b] = [ring[i], ring[i + 1]];
		out.push(
			region(`line-${a.id}-${b.id}`, `${a.name} + ${runLabel(b)}`, [
				{ firstLed: a.offset, ledCount: a.count },
				{ firstLed: b.offset, ledCount: b.count }
			])
		);
	}

	for (const s of g.strips) {
		out.push(region(`strip-${s.id}`, s.name, [{ firstLed: s.offset, ledCount: s.count }]));
	}

	if (ring.length < 2) return out;

	const ringStart = ring[0].offset;
	const ringLen = ring.reduce((n, s) => n + s.count, 0);
	const reach = Math.max(1, Math.round(CORNER_REACH_M / g.pitch));

	for (let i = 0; i < ring.length; i++) {
		const a = ring[i];
		const b = ring[(i + 1) % ring.length];
		// The junction is the first LED of the next run, which for the pair that closes the
		// ring is the first LED of the whole perimeter.
		const centre = b.offset - ringStart;
		out.push(
			region(
				`corner-${a.id}-${b.id}`,
				`${cornerLabel(a, b)} corner`,
				ringSpans(ringStart, ringLen, centre, reach * 2)
			)
		);
	}

	return out;
}
