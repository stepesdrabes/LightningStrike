import type { EffectDef, LayerRole } from '../contracts/effect.ts';

import { ambientDrift } from './ambientDrift.ts';
import { anthemWash } from './anthemWash.ts';
import { aurora } from './aurora.ts';
import { auroraBorealis } from './auroraBorealis.ts';
import { bandBloom } from './bandBloom.ts';
import { barFill } from './barFill.ts';
import { backbeatBloom } from './backbeatBloom.ts';
import { bassRing } from './bassRing.ts';
import { beamFlick } from './beamFlick.ts';
import { blackout } from './blackout.ts';
import { blinderWall } from './blinderWall.ts';
import { blockChase } from './blockChase.ts';
import { breathe } from './breathe.ts';
import { buildStrobe } from './buildStrobe.ts';
import { cascade } from './cascade.ts';
import { caustics } from './caustics.ts';
import { chase } from './chase.ts';
import { chorusBloom } from './chorusBloom.ts';
import { chromaBurst } from './chromaBurst.ts';
import { clapAlong } from './clapAlong.ts';
import { colorBump } from './colorBump.ts';
import { comet } from './comet.ts';
import { confetti } from './confetti.ts';
import { counterweight } from './counterweight.ts';
import { crossbeam } from './crossbeam.ts';
import { crownSpill } from './crownSpill.ts';
import { discoBall } from './discoBall.ts';
import { doubleKickGatling } from './doubleKickGatling.ts';
import { dusk } from './dusk.ts';
import { emberBump } from './emberBump.ts';
import { embers } from './embers.ts';
import { emberStorm } from './emberStorm.ts';
import { feedbackSwell } from './feedbackSwell.ts';
import { flexStrobe } from './flexStrobe.ts';
import { glitchScan } from './glitchScan.ts';
import { halftimeBounce } from './halftimeBounce.ts';
import { harmonicHaze } from './harmonicHaze.ts';
import { harmonicRibbon } from './harmonicRibbon.ts';
import { headbang } from './headbang.ts';
import { hearth } from './hearth.ts';
import { hueCarousel } from './hueCarousel.ts';
import { impulseSpin } from './impulseSpin.ts';
import { iridescence } from './iridescence.ts';
import { kickCannon } from './kickCannon.ts';
import { kickTunnel } from './kickTunnel.ts';
import { kitStage } from './kitStage.ts';
import { laidbackWave } from './laidbackWave.ts';
import { lanterns } from './lanterns.ts';
import { lavaBlobs } from './lavaBlobs.ts';
import { lean } from './lean.ts';
import { meterBuild } from './meterBuild.ts';
import { mirrorBall } from './mirrorBall.ts';
import { moshSlam } from './moshSlam.ts';
import { nebula } from './nebula.ts';
import { phraseArc } from './phraseArc.ts';
import { pitchRibbon } from './pitchRibbon.ts';
import { pixelRain } from './pixelRain.ts';
import { pump } from './pump.ts';
import { pyroBursts } from './pyroBursts.ts';
import { ricochet } from './ricochet.ts';
import { ripple } from './ripple.ts';
import { rippleTank } from './rippleTank.ts';
import { riser } from './riser.ts';
import { rollerChase } from './rollerChase.ts';
import { shockwave } from './shockwave.ts';
import { shutterCut } from './shutterCut.ts';
import { silhouette } from './silhouette.ts';
import { sineRoll } from './sineRoll.ts';
import { slam } from './slam.ts';
import { snareBlade } from './snareBlade.ts';
import { snapSplit } from './snapSplit.ts';
import { snareWhip } from './snareWhip.ts';
import { sparkle } from './sparkle.ts';
import { spectrumBed } from './spectrumBed.ts';
import { spectrumRings } from './spectrumRings.ts';
import { splash } from './splash.ts';
import { stageBlinders } from './stageBlinders.ts';
import { stopTime } from './stopTime.ts';
import { strobe } from './strobe.ts';
import { subBreath } from './subBreath.ts';
import { subSwell } from './subSwell.ts';
import { subThrob } from './subThrob.ts';
import { sweep } from './sweep.ts';
import { tideBloom } from './tideBloom.ts';
import { tremor } from './tremor.ts';
import { twoTone } from './twoTone.ts';
import { undertow } from './undertow.ts';
import { vocalGlow } from './vocalGlow.ts';
import { vortex } from './vortex.ts';
import { vuTowers } from './vuTowers.ts';
import { wash } from './wash.ts';

export const BUILT_IN_EFFECTS: readonly EffectDef[] = [
	// bed
	wash,
	blackout,
	aurora,
	nebula,
	embers,
	ambientDrift,
	barFill,
	bassRing,
	lavaBlobs,
	iridescence,
	auroraBorealis,
	chorusBloom,
	anthemWash,
	undertow,
	twoTone,
	subBreath,
	subThrob,
	spectrumBed,
	harmonicHaze,
	phraseArc,
	hearth,
	caustics,
	dusk,
	// rhythm
	impulseSpin,
	stopTime,
	sweep,
	chase,
	comet,
	pump,
	riser,
	rollerChase,
	halftimeBounce,
	pixelRain,
	sineRoll,
	vuTowers,
	meterBuild,
	glitchScan,
	emberBump,
	lean,
	cascade,
	hueCarousel,
	vortex,
	blockChase,
	snapSplit,
	headbang,
	feedbackSwell,
	moshSlam,
	laidbackWave,
	spectrumRings,
	// transient
	ricochet,
	snareBlade,
	counterweight,
	crossbeam,
	rippleTank,
	kitStage,
	shockwave,
	splash,
	beamFlick,
	subSwell,
	kickTunnel,
	snareWhip,
	doubleKickGatling,
	pyroBursts,
	clapAlong,
	// accent
	pitchRibbon,
	sparkle,
	tremor,
	stageBlinders,
	vocalGlow,
	confetti,
	flexStrobe,
	buildStrobe,
	discoBall,
	lanterns,
	ripple,
	emberStorm,
	harmonicRibbon,
	bandBloom,
	breathe,
	mirrorBall,
	kickCannon,
	crownSpill,
	backbeatBloom,
	// master
	blinderWall,
	slam,
	strobe,
	chromaBurst,
	silhouette,
	colorBump,
	shutterCut,
	tideBloom
];

/** Mutable so a show's generated effects can join the vocabulary at load time. */
export class EffectRegistry {
	private readonly byId = new Map<string, EffectDef>();

	constructor(defs: readonly EffectDef[] = BUILT_IN_EFFECTS) {
		for (const d of defs) this.byId.set(d.id, d);
	}

	get(id: string): EffectDef | null {
		return this.byId.get(id) ?? null;
	}

	has(id: string): boolean {
		return this.byId.has(id);
	}

	add(def: EffectDef): void {
		this.byId.set(def.id, def);
	}

	/** Drop everything not built in. Called on track change. */
	clearGenerated(): void {
		const builtIn = new Set(BUILT_IN_EFFECTS.map((d) => d.id));
		for (const id of [...this.byId.keys()]) if (!builtIn.has(id)) this.byId.delete(id);
	}

	all(): EffectDef[] {
		return [...this.byId.values()];
	}

	forRole(role: LayerRole): EffectDef[] {
		return this.all().filter((d) => d.role === role);
	}
}
