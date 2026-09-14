/** Built-in effect ids by layer role, so a look autocompletes only what fits each layer. */
export type BedEffect =
	| 'ambientDrift'
	| 'anthemWash'
	| 'aurora'
	| 'auroraBorealis'
	| 'bassRing'
	| 'blackout'
	| 'caustics'
	| 'chorusBloom'
	| 'dusk'
	| 'embers'
	| 'harmonicHaze'
	| 'hearth'
	| 'iridescence'
	| 'lavaBlobs'
	| 'nebula'
	| 'phraseArc'
	| 'spectrumBed'
	| 'subBreath'
	| 'subThrob'
	| 'twoTone'
	| 'undertow'
	| 'wash';

export type RhythmEffect =
	| 'barFill'
	| 'blockChase'
	| 'cascade'
	| 'chase'
	| 'comet'
	| 'emberBump'
	| 'feedbackSwell'
	| 'glitchScan'
	| 'halftimeBounce'
	| 'headbang'
	| 'hueCarousel'
	| 'impulseSpin'
	| 'laidbackWave'
	| 'lean'
	| 'meterBuild'
	| 'moshSlam'
	| 'pixelRain'
	| 'pump'
	| 'riser'
	| 'rollerChase'
	| 'sineRoll'
	| 'snapSplit'
	| 'spectrumRings'
	| 'stopTime'
	| 'sweep'
	| 'vortex'
	| 'vuTowers';

export type TransientEffect =
	| 'beamFlick'
	| 'clapAlong'
	| 'counterweight'
	| 'crossbeam'
	| 'doubleKickGatling'
	| 'kickTunnel'
	| 'kitStage'
	| 'kitTicks'
	| 'pyroBursts'
	| 'ricochet'
	| 'rippleTank'
	| 'shockwave'
	| 'snareBlade'
	| 'snareWhip'
	| 'splash'
	| 'subSwell';

export type AccentEffect =
	| 'backbeatBloom'
	| 'bandBloom'
	| 'breathe'
	| 'buildStrobe'
	| 'confetti'
	| 'crownSpill'
	| 'discoBall'
	| 'emberStorm'
	| 'flexStrobe'
	| 'harmonicRibbon'
	| 'kickCannon'
	| 'lanterns'
	| 'mirrorBall'
	| 'pitchRibbon'
	| 'ripple'
	| 'sparkle'
	| 'stageBlinders'
	| 'tremor'
	| 'vocalGlow';

export type MasterEffect =
	| 'blinderWall'
	| 'chromaBurst'
	| 'colorBump'
	| 'shutterCut'
	| 'silhouette'
	| 'slam'
	| 'strobe'
	| 'tideBloom';

export interface EffectsByRole {
	bed: BedEffect;
	rhythm: RhythmEffect;
	transient: TransientEffect;
	accent: AccentEffect;
	master: MasterEffect;
}

export type BuiltInEffect = EffectsByRole[keyof EffectsByRole];

/** The calm scenes rest and lounge use. The last five need music to move. */
export type Scene =
	| 'resting'
	| 'hearth'
	| 'poolside'
	| 'lamplight'
	| 'dusk'
	| 'nightfield'
	| 'curtains'
	| 'oilslick'
	| 'spectrum'
	| 'bloom'
	| 'haze'
	| 'undertow'
	| 'lagoon';

export type PaletteName =
	| 'glacier'
	| 'ice'
	| 'deep sea'
	| 'moss'
	| 'indigo'
	| 'menthol'
	| 'ultraviolet'
	| 'jade'
	| 'sodium night'
	| 'orchid'
	| 'gold room'
	| 'rosewood'
	| 'magenta bloom'
	| 'copper'
	| 'lime rig'
	| 'hot pink'
	| 'acid'
	| 'ember'
	| 'siren'
	| 'blood orange';
