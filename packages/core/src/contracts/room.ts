/** Metres. The origin is the middle of the floor, with +x east, +y north and +z up. */
export type Vec3 = readonly [number, number, number];

export type Wall = 'north' | 'east' | 'south' | 'west';

/** Where a light is fixed. A ceiling light faces down; a wall's faces into the room. */
export type Mount = 'ceiling' | 'floor' | Wall;

/**
 * What a light is to the show. Effects walk the ring as the room's four walls, draw the spine as
 * a line through its middle, and light a field like any other pixels. `auto` lets the room decide.
 */
export type LightRole = 'auto' | 'ring' | 'spine' | 'field';

/** The controller that drives a light, and the controller pixel its first LED is. */
export interface Wiring {
	controller: string;
	start: number;
	/** The data enters at the light's far end. */
	reversed?: boolean;
}

interface LightBase {
	id: string;
	name: string;
	/** An unwired light still plays in the preview. */
	wiring?: Wiring;
	/** Scales this light's delivered light, 0..1. */
	level?: number;
}

/** LEDs on straight runs between points; a closed path runs from its last point back to the first. */
export interface PathLight extends LightBase {
	kind: 'path';
	points: readonly Vec3[];
	/** LEDs on each run in point order, one count per run. */
	counts: readonly number[];
	closed: boolean;
	/** LEDs per metre as sold. A run is often cut short of its drawing, so counts stay separate. */
	density: number;
	mount: Mount;
	role: LightRole;
}

export interface RingLight extends LightBase {
	kind: 'ring';
	centre: Vec3;
	radius: number;
	count: number;
	/** Where the first LED sits, degrees clockwise from north on the plan, or from up on a wall. */
	startAngle: number;
	/** LEDs follow the clock as seen on the floor plan, or from inside the room on a wall. */
	clockwise: boolean;
	mount: Mount;
	role: LightRole;
}

export type Corner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

/**
 * A grid of LEDs. On the floor plan a ceiling or floor panel has its top edge north; a wall
 * panel is seen from inside the room.
 */
export interface MatrixLight extends LightBase {
	kind: 'matrix';
	centre: Vec3;
	/** Metres between the outer LED centres, across and down. */
	width: number;
	height: number;
	columns: number;
	rows: number;
	mount: Mount;
	/** The LED the data enters at. */
	first: Corner;
	/** The data runs along rows rather than down columns. */
	horizontal: boolean;
	/** Every other line runs back the way the previous one came. */
	serpentine: boolean;
	role: LightRole;
}

/**
 * One diffused source. A summary lamp glows with the whole room reduced to one colour, as the
 * Bounce Lamp does; a pixel lamp is a point the show paints like any other LED.
 */
export interface LampLight extends LightBase {
	kind: 'lamp';
	/** The base of the lamp. */
	at: Vec3;
	/** Metres from the base to the top of the glow; 0 for a bulb. */
	height: number;
	diameter: number;
	mode: 'summary' | 'pixel';
}

export type Light = PathLight | RingLight | MatrixLight | LampLight;

export interface RoomLayout {
	/** Floor plan and headroom, metres, centred on the origin. */
	width: number;
	depth: number;
	height: number;
	/** The wall the room faces. An effect that points somewhere points at it. */
	front: Wall;
	lights: readonly Light[];
}

/** A contiguous run of the effect buffer. */
export interface LedSpan {
	firstLed: number;
	ledCount: number;
}

/** Named output region. A region crossing the perimeter seam needs two buffer spans. */
export interface RoomRegion {
	id: string;
	name: string;
	spans: readonly LedSpan[];
	/** Total LEDs across every span. */
	count: number;
}

export interface StripSpec {
	/** Its index in `Geometry.strips`. */
	id: number;
	name: string;
	/** First LED index in the effect buffer. */
	offset: number;
	count: number;
	/** In the show frame, where the room's front is south. */
	start: Vec3;
	end: Vec3;
	/** Inward-facing. */
	normal: Vec3;
	inPerimeter: boolean;
}

/**
 * Precomputed LED attributes in the show frame: room coordinates turned so the front wall is
 * south. The ring's four walls come first, then any spine, then everything else. Positions
 * describe the lights as drawn, `pitch` the strip as sold; the two are different scales, so never
 * divide one into the other. nx/ny/nz share the lit area's single largest extent, since per-axis
 * scaling distorts circles and room scaling wastes a sweep's range outside the lights.
 */
export interface Geometry {
	count: number;
	strips: readonly StripSpec[];

	x: Float32Array;
	y: Float32Array;
	z: Float32Array;

	nx: Float32Array;
	ny: Float32Array;
	nz: Float32Array;

	/** Distance from the vertical centre axis, 0..1 by the half-diagonal. */
	r: Float32Array;
	/** Angle around the vertical axis, 0..1 from +x, counter-clockwise. */
	theta: Float32Array;
	/** 3D distance from the room centre, 0..1. */
	dist: Float32Array;

	strip: Uint8Array;
	/** Position along its own strip, 0..1. */
	local: Float32Array;
	/** Arc length around the ring, 0..1. -1 when off the ring. */
	perim: Float32Array;

	/** 3 floats per LED. */
	normal: Float32Array;

	/** Metres between adjacent LEDs, from `density`. Converts m/s into pixels/frame. */
	pitch: number;
	/** The lit area's largest side, metres: the one divisor behind nx/ny/nz. */
	extent: number;
	/** Drawn arc length of the ring, metres, which `perim` normalizes. `ringsFor` measures the lit run. */
	perimeterLength: number;
	/** Whether a line runs through the middle of the room, which some effects are drawn around. */
	spine: boolean;
}

/** What a light turned out to be to the show, once `auto` is decided. */
export type LightPart = Exclude<LightRole, 'auto'>;

/** One light's LEDs in the order its data runs, with where each lands in the effect buffer. */
export interface LightPixels {
	light: Light;
	part: LightPart;
	/** Effect buffer index per LED. */
	index: Int32Array;
	/** Room coordinates per LED, 3 floats each. */
	position: Float32Array;
}

/** Everything the show and the outputs derive from a layout. */
export interface RoomModel {
	layout: RoomLayout;
	geometry: Geometry;
	/** Lights the show paints. */
	pixels: readonly LightPixels[];
	/** Lamps that glow with the room reduced to one colour. */
	lamps: readonly LampLight[];
	/**
	 * The room has no LEDs of its own, so the show runs unseen on the Frame's geometry and its
	 * summary lamps still have a room to reduce.
	 */
	borrowed: boolean;
}
