/** Keep surface spill independent of emitter HDR gain so wall colors do not clip before bloom. */
export const LIGHTING = {
	/** HDR gain gives LEDs white cores and colored fringes; excess clips saturated colors. */
	emitterGain: 2.0,

	/** A metre of strip's throw onto the room's surfaces, as the Frame's was tuned. */
	frameSpill: 0.22,

	/** A faint wash of the painted LEDs' average color connects the room's surfaces. */
	frameAmbient: 0.5,

	/** The Bounce Lamp's tube, on the emitter scale. */
	lampGain: 2.5,

	/** Lamp spill per metre of tube, independently tunable from the frame. */
	lampSpill: 0.26,

	/** A bulb's spill, half the Bounce Lamp's; its size only softens the falloff near it. */
	bulbSpill: 0.13
} as const;
