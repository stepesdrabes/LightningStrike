import type { Geometry, RoomLayout, RoomModel } from './contracts/room.ts';
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
