import type { LayerRole, Params } from '../contracts/effect.ts';

interface SceneLayer {
	effect: string;
	/** Two-layer scenes can spend more than the four-layer show's bed opacity budget. */
	opacity?: number;
	params?: Params;
}

export interface AmbientScene {
	id: string;
	/** Shown in the interface, so it has to say what the room will look like. */
	name: string;
	layers: Partial<Record<LayerRole, SceneLayer>>;
	/** Requires measured audio; excluded from rest, whose grid has no spectrum. */
	needsMusic?: boolean;
}

/**
 * Bed-plus-texture scenes. Beds keep their gain because fewer layers support them here.
 * Neighbours have different beds because the picker walks this order.
 */
export const AMBIENT_SCENES: readonly AmbientScene[] = [
	{
		id: 'resting',
		name: 'Resting',
		layers: {
			bed: { effect: 'ambientDrift', params: { intensity: 0.78, period: 0.55, listen: 0.4 } },
			accent: { effect: 'breathe', params: { intensity: 0.62, bars: 0.75, tilt: 0.35 } }
		}
	},
	{
		id: 'hearth',
		name: 'Hearth',
		layers: {
			bed: { effect: 'hearth', params: { intensity: 0.8, flicker: 0.55, settle: 0.6 } },
			accent: { effect: 'embers', opacity: 0.42, params: { intensity: 0.62, pool: 0.3 } }
		}
	},
	{
		id: 'poolside',
		name: 'Poolside',
		layers: {
			bed: { effect: 'caustics', params: { intensity: 0.76, flow: 0.4, listen: 0.45 } },
			accent: { effect: 'ripple', params: { intensity: 0.7, every: 11, reach: 0.65 } }
		}
	},
	{
		id: 'lamplight',
		name: 'Lamplight',
		layers: {
			bed: { effect: 'wash', params: { intensity: 0.6, breath: 0.25, drift: 0.04 } },
			accent: {
				effect: 'lanterns',
				opacity: 0.7,
				params: { intensity: 0.82, drift: 0.45, width: 0.5, listen: 0.5 }
			}
		}
	},
	{
		id: 'dusk',
		name: 'Dusk',
		layers: {
			bed: { effect: 'dusk', params: { intensity: 0.74, turn: 0.42, depth: 0.55 } },
			accent: {
				effect: 'sparkle',
				opacity: 0.3,
				params: { intensity: 0.5, rate: 25, decay: 0.5, white: 0.35 }
			}
		}
	},
	{
		id: 'nightfield',
		name: 'Night field',
		layers: {
			// Raise shade-heavy beds to match the pool's delivered brightness.
			bed: { effect: 'nebula', opacity: 0.85, params: { intensity: 0.85, scale: 0.3, surge: 0.3 } },
			accent: { effect: 'discoBall', opacity: 0.34, params: { intensity: 0.58, density: 0.35 } }
		}
	},
	{
		id: 'curtains',
		name: 'Curtains',
		layers: {
			bed: { effect: 'auroraBorealis', opacity: 0.85, params: { intensity: 0.85, drift: 0.26 } },
			accent: { effect: 'mirrorBall', opacity: 0.32, params: { intensity: 0.55, density: 0.5 } }
		}
	},
	{
		id: 'oilslick',
		name: 'Oil slick',
		layers: {
			bed: { effect: 'iridescence', params: { intensity: 0.74, scale: 0.3 } },
			accent: {
				effect: 'lanterns',
				opacity: 0.5,
				params: { intensity: 0.62, drift: 0.3, width: 0.6, listen: 0.6 }
			}
		}
	},

	// From here down the room has to be listening to something.
	{
		id: 'spectrum',
		name: 'Spectrum',
		needsMusic: true,
		layers: {
			bed: { effect: 'spectrumBed', params: { intensity: 0.76, spread: 0.7, depth: 0.45 } },
			accent: { effect: 'harmonicRibbon', params: { intensity: 0.64, travel: 0.5, width: 0.65 } }
		}
	},
	{
		id: 'bloom',
		name: 'Bloom',
		needsMusic: true,
		layers: {
			// Reduce this chorus-opening bed so its peak stays within lounge's level.
			bed: { effect: 'chorusBloom', params: { intensity: 0.56 } },
			accent: { effect: 'vocalGlow', opacity: 0.46, params: { intensity: 0.62, width: 0.55 } }
		}
	},
	{
		id: 'haze',
		name: 'Haze',
		needsMusic: true,
		layers: {
			bed: { effect: 'harmonicHaze', params: { intensity: 0.76, grain: 0.6, drift: 0.3 } },
			accent: {
				effect: 'bandBloom',
				opacity: 0.44,
				params: { intensity: 0.62, spread: 0.65, turn: 0.25 }
			}
		}
	},
	{
		id: 'undertow',
		name: 'Undertow',
		needsMusic: true,
		layers: {
			bed: { effect: 'bassRing', params: { intensity: 0.76 } },
			rhythm: { effect: 'laidbackWave', opacity: 0.38, params: { intensity: 0.62, barsPerWave: 3 } }
		}
	},
	{
		id: 'lagoon',
		name: 'Lagoon',
		needsMusic: true,
		layers: {
			bed: { effect: 'lavaBlobs', params: { intensity: 0.72, size: 0.65 } },
			rhythm: { effect: 'sineRoll', opacity: 0.34, params: { intensity: 0.58, cycleBeats: 12, waves: 2 } }
		}
	}
];
