/** Metres for positions, unit vectors for normals. */
export type Vec3 = readonly [number, number, number];

export interface StripSpec {
	id: number;
	name: string;
	/** First LED index in the global buffer. Also the DDP byte offset / 3. */
	offset: number;
	count: number;
	/** Origin at room centre, floor level, +z up. */
	start: Vec3;
	end: Vec3;
	/** Inward-facing. */
	normal: Vec3;
	inPerimeter: boolean;
}

/** A contiguous run of the global frame. */
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

/** Drawn room structure, independent of the smaller hanging LED fixture. */
export interface RoomSpec {
	name: string;
	/** Footprint, metres. */
	width: number;
	depth: number;
	/** Headroom, metres. Nothing is drawn at it; it is what the camera has to hold. */
	height: number;
	fixture: FrameSpec;
	bounce: BounceSpec;
}

/** Downward-facing rectangle and crossbar. The perimeter is a closed ring; the beam is off-ring. */
interface FrameSpec {
	width: number;
	depth: number;
	/** The LED plane, metres above the deck. */
	height: number;
	/** Strip pitch, LEDs per metre. Sets `Geometry.pitch`; it does not set the run lengths. */
	density: number;
	/** Fitted LEDs per run, measured off the built frame rather than derived from its drawing. */
	counts: FrameCounts;
	/** 'y' means the crossbar spans `depth`. */
	crossAxis: 'x' | 'y';
	/** Metres from the frame's centre, along the axis the crossbar does not span. */
	crossOffset: number;
	/** Aluminium section, metres. Drawn, never lit. */
	section: number;
}

/** The frame was built a little under its drawn size, so a run is shorter than width x density. */
interface FrameCounts {
	/** Frame N and Frame S, the runs along `width`. */
	along: number;
	/** Frame E and Frame W, the runs across `depth`. */
	across: number;
	beam: number;
}

/** One diffused fixture reduced from the show, outside the geometry effects paint. */
interface BounceSpec {
	/** Floor position, metres, origin at the room centre. */
	at: readonly [number, number];
	height: number;
	diameter: number;
}

/**
 * Precomputed LED attributes. Positions describe the frame as drawn, `pitch` the strip as
 * built and a little shorter; the two are different scales, so never divide one into the other.
 * Normalize nx/ny/nz by the fixture's single largest extent.
 * Per-axis scaling distorts circles; room scaling wastes a sweep's range outside the fixture.
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
	/** Arc length around the perimeter ring, 0..1. -1 when off-perimeter. */
	perim: Float32Array;

	/** 3 floats per LED. */
	normal: Float32Array;

	/** Metres between adjacent LEDs, from `density`. Converts m/s into pixels/frame. */
	pitch: number;
	/** The drawn fixture's largest side, metres: the one divisor behind nx/ny/nz. */
	extent: number;
	/** Drawn arc length of the ring, metres, which `perim` normalizes. `ringsFor` measures the lit run. */
	perimeterLength: number;
}
