import type { RoomSpec } from '@mv/core';

export type CameraView = 'orbit' | 'top' | 'front';

/**
 * Visible gap between the chrome panels, in canvas pixels; framing to the full canvas hides
 * the room.
 */
export interface Viewport {
	x: number;
	y: number;
	width: number;
	height: number;
}

export interface RoomRendererOptions {
	spec: RoomSpec;
}
