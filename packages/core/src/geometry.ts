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

/**
 * The web club's rig: the Frame scaled 1.5 times in a 7x6 m room, 0.2 m under its 2.7 m ceiling,
 * at two thirds the density so every run keeps its count, and the Bounce Lamp a 1 m column in
 * the north-west corner. Nothing is wired: the club draws it in the browser.
 */
export const CLUB_ROOM: RoomLayout = {
	width: 7,
	depth: 6,
	height: 2.7,
	front: 'south',
	lights: [
		{
			id: 'frame',
			name: 'Frame',
			kind: 'path',
			points: [
				[-2.25, 1.5, 2.5],
				[2.25, 1.5, 2.5],
				[2.25, -1.5, 2.5],
				[-2.25, -1.5, 2.5]
			],
			counts: [170, 112, 170, 112],
			closed: true,
			density: 40,
			mount: 'ceiling',
			role: 'ring'
		},
		{
			id: 'beam',
			name: 'Beam',
			kind: 'path',
			points: [
				[0, -1.5, 2.5],
				[0, 1.5, 2.5]
			],
			counts: [109],
			closed: false,
			density: 40,
			mount: 'ceiling',
			role: 'spine'
		},
		{
			id: 'bounce',
			name: 'Bounce Lamp',
			kind: 'lamp',
			at: [-3.12, 1.75, 0],
			height: 1,
			diameter: 0.2,
			mode: 'summary'
		}
	]
};

export function roomModel(layout: RoomLayout = DEFAULT_ROOM): RoomModel {
	return buildRoomModel(layout, DEFAULT_ROOM);
}

export function buildGeometry(layout: RoomLayout = DEFAULT_ROOM): Geometry {
	return roomModel(layout).geometry;
}
