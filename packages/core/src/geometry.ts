import type { Geometry, LedSpan, RoomLayout, RoomModel, RoomRegion, StripSpec } from './contracts/room.ts';
import { buildRoomModel } from './room/model.ts';

/**
 * The room the effects were tuned in: a 5x4 m room with a 3x2 m frame hanging at 2.4 m, 673 px
 * at 60 LED/m, and the Bounce Lamp on the floor. The runs are the counts fitted on the built
 * frame, a little under its drawing. Data enters the ring at its north-west corner.
 */
export const DEFAULT_ROOM: RoomLayout = {
	width: 5,
	depth: 4,
	height: 2.6,
	front: 'south',
	lights: [
		{
			id: 'frame',
			name: 'Frame',
			kind: 'path',
			points: [
				[-1.5, 1, 2.4],
				[1.5, 1, 2.4],
				[1.5, -1, 2.4],
				[-1.5, -1, 2.4]
			],
			counts: [170, 112, 170, 112],
			closed: true,
			density: 60,
			mount: 'ceiling',
			role: 'ring',
			wiring: { controller: 'frame', start: 0 }
		},
		{
			id: 'beam',
			name: 'Beam',
			kind: 'path',
			points: [
				[0, -1, 2.4],
				[0, 1, 2.4]
			],
			counts: [109],
			closed: false,
			density: 60,
			mount: 'ceiling',
			role: 'spine',
			wiring: { controller: 'frame', start: 564 }
		},
		{
			id: 'bounce',
			name: 'Bounce Lamp',
			kind: 'lamp',
			at: [-2.2, -1.7, 0],
			height: 1,
			diameter: 0.175,
			mode: 'summary',
			wiring: { controller: 'bounce', start: 0 }
		}
	]
};

export function roomModel(layout: RoomLayout = DEFAULT_ROOM): RoomModel {
	return buildRoomModel(layout, DEFAULT_ROOM);
}

export function buildGeometry(layout: RoomLayout = DEFAULT_ROOM): Geometry {
	return roomModel(layout).geometry;
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
