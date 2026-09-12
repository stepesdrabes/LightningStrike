import type {
	Cue,
	CuePalette,
	EffectDef,
	Hit,
	LayerRole,
	LayerSpec,
	MovementSpan,
	SectionKind,
	SectionSpan,
	Show,
	ShowPalette,
	TrackAnalysis,
	TrackContext
} from '@mv/core';
import {
	BUILT_IN_EFFECTS,
	DEFAULT_OPACITY,
	HIT_RULES,
	LAYER_ROLES,
	PHRASE_BARS,
	SHOW_VERSION,
	Rng,
	gridTrust,
	hash01,
	hitSeconds,
	lerpHue,
	sectionBase,
	strobePerBeat,
	swapped,
	bpmAt
} from '@mv/core';
import { KICK_BURSTS, allowedFlashes, profileFor, type GenreProfile } from './genre.ts';
import { choosePalette } from './palette.ts';
import { EffectPicker, KIT_FLOOR, activityBudget, kitSilent } from './select.ts';

interface EngineOptions {
	/** Built-ins by default; pass a superset to let generated effects be chosen too. */
	effects?: readonly EffectDef[];
	/** Overrides the seed taken from the analysis hash. */
	seed?: number;
	/** Dominant hue of the cover art, degrees. The room takes the record's own colour. */
	artHue?: number | null;
	/** What the track is. Decides the genre profile; absent falls back to the default row. */
	context?: TrackContext | null;
}

/** Eight bars keeps a look from occupying an entire long groove. */
const MAX_CUE_BARS = 8;
/**
 * Split an overlong cue plus stub past 30 seconds, retaining the eight-bar ceiling at slow
 * tempos.
 */
const MAX_CUE_S = 30;
/** A stub is a cue of its own only when it lasts long enough to read as one: a two-bar tag. */
const MIN_STUB_S = 6;
/** An opening this short is a count-in or a pickup, and what follows it arrives. */
const SHORT_INTRO_BARS = 4;
/** Energy step, 0..1, above which the passage after a short opening lands rather than fades. */
const ARRIVAL_STEP = 0.3;
/** Matches the linter: punctuation inside this many bars spends the biggest card too early. */
const SETTLE_BARS = 16;
/** Kicks/beat threshold shared by slam treatment and the effect energy-band override. */
const POUNDING_KICK = 0.8;
/** Kicks/beat threshold above which the kit layer gets first claim on the activity budget. */
const KIT_LEADS = 0.6;
/** Strobe duration in beats, capped in seconds. The linter allows a wider authoring range. */
const STROBE_BEATS = 2;
const PEAK_STROBE_BEATS = 4;
const STROBE_MAX_S = 1.5;

interface Slot {
	bar: number;
	endBar: number;
	section: SectionKind;
	span: SectionSpan;
	/** 0..1 within the track. */
	energy: number;
	/** Which cue this is inside its section; 0 is the one that opens it. */
	index: number;
	/** How many cues the section is split into. */
	of: number;
	/** True for the one slot that opens the peak section. */
	peak: boolean;
	/** What was playing before, which decides how fast this one is allowed to arrive. */
	from: SectionKind | null;
	/** Length and level of the cue before, for arrivals out of a short opening. */
	fromBars: number;
	fromEnergy: number;
	/** Which drop this is, counting from zero; -1 when the slot is not a drop. */
	dropIndex: number;
	/** True when this section is the LAST appearance of its material: the final chorus. */
	finalOfGroup: boolean;
	/** Which song of a stitched track this slot lights; 0 on a track that is one song. */
	movement: number;
	/** True for the slot that opens a second or later song: the beat switch itself. */
	arrival: boolean;
	/** Opens a medley song's loudest passage when that song does not own the whole-track peak. */
	movementPeak: boolean;
}

/**
 * Compose deterministically from analysis and taste metadata; author-ai revises the
 * interpretation.
 */
export function composeShow(analysis: TrackAnalysis, opts: EngineOptions = {}): Show {
	const effects = opts.effects ?? BUILT_IN_EFFECTS;
	const byId = new Map(effects.map((e) => [e.id, e]));
	const activityOf = (spec: LayerSpec | undefined) =>
		spec ? (byId.get(spec.effect)?.taste.activity ?? 0) : 0;
	const seed = opts.seed ?? seedFrom(analysis.hash);
	const rng = new Rng(seed);
	// A seed-stable draw per cue for the params that vary a look, kept off the picker's own
	// stream so a variety choice never reshuffles which effect wins the cue after it.
	const draw = (bar: number, k: number) => hash01((seed ^ Math.imul(bar * 8 + k + 1, 0x9e3779b1)) >>> 0);
	const profile = profileFor(opts.context, analysis);
	// The allowance governs the effects as well as the hits: a family that has earned no
	// flashes does not get blinder slams by the accent door instead.
	const flashes = allowedFlashes(analysis, opts.context);
	// Missing synced lyrics means unknown, not instrumental. Only positive instrumental evidence
	// vetoes vocalGlow.
	const lyricsKnown = (opts.context?.lyrics?.length ?? 0) > 0;
	const sung = lyricsKnown
		? analysis.bars.some((b) => (b.vocal ?? 0) > 0.05)
		: !opts.context?.instrumental;
	const picker = new EffectPicker(
		sung ? effects : effects.filter((e) => e.id !== 'vocalGlow'),
		rng,
		{ vetoCharacter: flashes === 0 }
	);
	const palette = choosePalette(analysis, rng, opts.artHue, profile);
	// Each medley song gets its own palette. Ignore legacy numeric movement entries until
	// reanalysis.
	const movements: readonly MovementSpan[] = (analysis.movements ?? []).filter(
		(m): m is MovementSpan => typeof m === 'object' && m !== null && typeof m.startBar === 'number'
	);
	const palettes: ShowPalette[] = [palette];
	for (let k = 1; k < movements.length; k++) {
		const m = movements[k];
		palettes.push(choosePalette(analysis, rng, null, profile, { bpm: m.bpm, key: m.key, awayFrom: palettes[k - 1].base }));
	}
	// Draw half the signatures per show and avoid the rest, so rerolls can omit a familiar look
	// entirely.
	const signatures = profile.signatures.filter(() => rng.float() < 0.5);
	// Choose at most one similar kick-burst effect per show, with one extra draw for no burst at
	// all.
	const drawnBurst = KICK_BURSTS[Math.floor(rng.float() * (KICK_BURSTS.length + 1))];
	// Excluded, not merely avoided: in the loud slots the family saturates, an avoided
	// burst at energy distance zero still outscored honest alternatives two bands away,
	// and the measured result was two members in most shows - which is the exact defect.
	const exclude = [...KICK_BURSTS.filter((e) => e !== drawnBurst), ...profile.exclude];
	const avoid = [
		...profile.avoid,
		...profile.signatures.filter((s) => !signatures.includes(s))
	];

	const peakSpan = peakSection(analysis.sections);

	// Pounding peaks may upgrade bloom to slam; swell families always keep their rise.
	const peakKick = peakSpan
		? drumDensity(analysis, peakSpan.startBar, peakSpan.endBar).kick
		: 0;
	const peakTreatment: GenreProfile['peak'] =
		profile.peak === 'bloom' && peakKick >= POUNDING_KICK ? 'slam' : profile.peak;

	// Reserved before anything else is chosen, so it cannot be spent on an ordinary drop
	// earlier in the track. The biggest thing in the catalog is worth more as the one moment
	// nobody saw coming. A swell genre spends nothing here: its peak is a rise, not a hit.
	const peakMaster =
		peakTreatment !== 'swell' && peakSpan && peakSpan.startBar >= SETTLE_BARS
			? picker.strongest('master', peakSpan.kind, 1, peakTreatment)
			: null;
	if (peakMaster) picker.reserve(peakMaster.id);

	// Give a peak master a short burst cue; the following cue carries the sustained look. Swells
	// have no burst.
	const slots = buildSlots(
		analysis,
		profile.peak === 'swell' ? 0 : (peakMaster?.taste.maxBars ?? 0),
		peakSpan?.index ?? -1,
		movements
	);

	// A squashed master has almost no per-bar level left to read, so the arrangement has to
	// supply the dynamics the waveform no longer does. Under about 8 LU of peak-to-loudness the
	// track is limited hard enough that its own energy curve is nearly flat.
	const spread = analysis.peakToLoudness > 0 ? clamp01((10 - analysis.peakToLoudness) / 6) : 0;

	const cues: Cue[] = [];
	let grooveIndex = 0;
	let peakCue = -1;
	/** Whether the last breakdown cue kept the accent of the one before it. */
	let breakdownHeld = false;

	for (const slot of slots) {
		const layers: Partial<Record<LayerRole, LayerSpec>> = {};
		const drums = drumDensity(analysis, slot.bar, slot.endBar);
		let busy = 0;
		const canKeep = (spec: LayerSpec | undefined) => {
			const def = spec ? byId.get(spec.effect) : undefined;
			return !!def && !kitSilent(def, drums) &&
				busy + (def.taste.activity ?? 0) <= activityBudget(slot.energy, slot.section) + 1e-9;
		};
		// A family that holds its looks re-stages nothing inside a section: the interior cues
		// keep the bed and the rhythm layer the section opened with and move the transient or
		// the accent every second cue, so a techno drop is one look that changes one thing.
		const previous = cues.length > 0 ? cues[cues.length - 1] : undefined;
		const heldLook =
			profile.holdLooks && slot.index > 0 && previous?.section === slot.section ? previous.layers : null;
		const holds = (role: LayerRole) =>
			canKeep(heldLook?.[role]) && (role === 'bed' || role === 'rhythm' || slot.index % 2 === 1);
		// The picker is asked only for the layers this cue may change, so a held layer is
		// never counted as spent twice.
		const choose = (role: LayerRole, req: Parameters<EffectPicker['pick']>[0]) =>
			holds(role) ? null : picker.pick(req);
		// What the cue already holds, in `taste.activity`, so each layer picked after another
		// may only add what the budget leaves: one hard hitter a cue.
		const add = (role: LayerRole, def: EffectDef | null) => {
			if (!def && holds(role)) {
				layers[role] = { ...heldLook![role]! };
				busy += activityOf(layers[role]);
				return;
			}
			if (!def) return;
			const params = paramsFor(def, slot, analysis, (k) => draw(slot.bar, k));
			layers[role] = params ? { effect: def.id, params } : { effect: def.id };
			busy += def.taste.activity ?? 0;
		};

		const length = slot.endBar - slot.bar;
		const kitRests = Math.max(drums.kick, drums.snare) < KIT_FLOOR;
		// Kick density can raise the effect energy band when heavy limiting hides intensity
		// differences.
		const pounding =
			profile.peak !== 'swell' &&
			sectionBase(slot.section) === 'drop' &&
			drums.kick >= POUNDING_KICK;
		// Every cue of the peak section, not only its opener: the burst cue borrows the
		// second cue's look, and the whole passage is the one the picker must not soften.
		const inPeak = slot.span === peakSpan;
		// Charge master activity only when it spans the section; short bursts borrow the following
		// cue's layers.
		if (peakMaster && slot.peak && slot.of === 1) busy += peakMaster.taste.activity ?? 0;
		// The bed a repeat shares is the one its FIRST cue opened with; interior cues pick freely,
		// or a long section would hold one look for its whole length again by another route.
		const bedEnergy = Math.min(slot.energy, 0.75);
		// Quiet sections need a carrying bed beneath their moving voice.
		const bare =
			slot.section === 'intro' || slot.section === 'outro' || slot.section === 'breakdown';
		// Drop beds must carry the room through the darkness between transient hits.
		const carrier = bare || slot.span === peakSpan || sectionBase(slot.section) === 'drop';
		// Outros inherit a carrying bed so the ending thins instead of changing looks.
		// Adjacent breakdowns also retain their bed and vary the accent every second cue.
		const last = cues.length > 0 ? cues[cues.length - 1] : undefined;
		const continued = slot.section === 'breakdown' && last?.section === 'breakdown';
		const inheritedBed =
			(slot.section === 'outro' || continued) && last ? last.layers.bed : undefined;
		if (inheritedBed) {
			layers.bed = { ...inheritedBed };
			busy += activityOf(inheritedBed);
		} else {
			add('bed', choose('bed', { drums, busy, role: 'bed', section: slot.section, lengthBars: length, energy: bedEnergy, pounding, peak: inPeak, mustCarry: carrier, bare, group: slot.index === 0 ? slot.span.group : undefined, prefer: signatures, avoid, exclude }));
		}
		const addNoteVoice = () => {
			const bed = layers.bed ? byId.get(layers.bed.effect) : undefined;
			if (!kitRests || !bed || bed.taste.carries === false || bed.taste.noteReactive) return false;
			for (const role of ['rhythm', 'accent'] as const) {
				const voice = picker.pick({ drums, busy, role, section: slot.section, lengthBars: length, energy: Math.min(slot.energy, 0.45), noCharacter: true, noteVoice: true, bare, prefer: signatures, avoid, exclude });
				if (!voice) continue;
				add(role, voice);
				return true;
			}
			return false;
		};
		switch (sectionBase(slot.section)) {
			case 'void':
				break;

			case 'intro':
				if (addNoteVoice()) break;
				add('rhythm', choose('rhythm', { drums, busy, role: 'rhythm', section: slot.section, lengthBars: length, energy: Math.min(slot.energy, 0.45), noCharacter: true, prefer: signatures, avoid, exclude }));
				if (!layers.rhythm) {
					add('accent', choose('accent', { drums, busy, role: 'accent', section: slot.section, lengthBars: length, energy: slot.energy, noCharacter: true, mustCarry: true, bare, prefer: signatures, avoid, exclude }));
				}
				break;

			case 'outro':
				// Quiet textures must carry; an outro with a carrying inherited bed introduces no new
				// texture.
				if (
					inheritedBed &&
					effects.find((e) => e.id === inheritedBed.effect)?.taste.carries !== false
				) {
					break;
				}
				add('accent', choose('accent', { drums, busy, role: 'accent', section: slot.section, lengthBars: length, energy: slot.energy, pounding, peak: inPeak, mustCarry: true, bare, prefer: signatures, avoid, exclude }));
				break;

			case 'breakdown':
				if (addNoteVoice()) break;
				// Breakdowns retain slow motion under their smaller activity budget, including while the
				// kit is absent.
				if (continued && last?.layers.rhythm && canKeep(last.layers.rhythm)) {
					layers.rhythm = { ...last.layers.rhythm };
					busy += activityOf(layers.rhythm);
				} else {
					add('rhythm', choose('rhythm', { drums, busy, role: 'rhythm', section: slot.section, lengthBars: length, energy: slot.energy, pounding, peak: inPeak, prefer: signatures, avoid, exclude }));
				}
				// Keep a texture above the bed and change it only every second continued breakdown cue.
				if (continued && last?.layers.accent && canKeep(last.layers.accent) && !breakdownHeld) {
					layers.accent = { ...last.layers.accent };
					busy += activityOf(layers.accent);
					breakdownHeld = true;
					break;
				}
				breakdownHeld = false;
				add('accent', choose('accent', { drums, busy, role: 'accent', section: slot.section, lengthBars: length, energy: slot.energy, pounding, peak: inPeak, mustCarry: true, bare, prefer: signatures, avoid, exclude }));
				// Answer a breakdown's kit only when measured onsets remain.
				if (profile.transientEvery > 0 && kickDensity(analysis, slot) > 0.25) {
					add('transient', choose('transient', { drums, busy, role: 'transient', section: slot.section, lengthBars: length, energy: slot.energy, pounding, peak: inPeak, prefer: signatures, avoid, exclude }));
				}
				break;

			case 'build':
				if (addNoteVoice()) break;
				add('rhythm', choose('rhythm', { drums, busy, role: 'rhythm', section: slot.section, lengthBars: length, energy: slot.energy, pounding, peak: inPeak, prefer: signatures, avoid, exclude }));
				// A build is the one place an accent belongs before the drop rather than in it, and
				// without one the two effects written for exactly this moment were unreachable.
				add('accent', choose('accent', { drums, busy, role: 'accent', section: slot.section, lengthBars: length, energy: slot.energy, pounding, peak: inPeak, prefer: signatures, avoid, exclude }));
				break;

			case 'groove':
				add('rhythm', choose('rhythm', { drums, busy, role: 'rhythm', section: slot.section, lengthBars: length, energy: slot.energy, pounding, peak: inPeak, prefer: signatures, avoid, exclude }));
				// Rest the drum layer at the genre's cadence so its return remains an event.
				if (profile.transientEvery > 0 && grooveIndex % profile.transientEvery === profile.transientEvery - 1) {
					add('transient', choose('transient', { drums, busy, role: 'transient', section: slot.section, lengthBars: length, energy: slot.energy, pounding, peak: inPeak, prefer: signatures, avoid, exclude }));
				}
				grooveIndex++;
				break;

			case 'drop':
				// Use group identity so a returning chorus retains its visible rhythm.
				const sparseKickLead = profile.peak !== 'swell' && slot.energy >= 0.8
					&& drums.kick >= KIT_FLOOR && drums.kick < POUNDING_KICK;
				add('rhythm', choose('rhythm', { drums, busy, role: 'rhythm', section: slot.section, lengthBars: length, energy: slot.energy, pounding, kickAccent: sparseKickLead, peak: inPeak, group: slot.index === 0 ? slot.span.group : undefined, prefer: signatures, avoid, exclude }));
				// Hold back the first nonfinal, nonpeak chorus accent so returns add vocabulary.
				// Pick the kit first in kick-led passages; otherwise give the phrase gesture the activity
				// budget.
				const accentDue = !(slot.dropIndex === 0 && !slot.finalOfGroup && slot.span !== peakSpan);
				const addAccent = () => {
					if (!accentDue) return;
					add('accent', choose('accent', { drums, busy, role: 'accent', section: slot.section, lengthBars: length, energy: slot.energy, pounding, peak: inPeak, prefer: signatures, avoid, exclude }));
				};
				const addTransient = () => {
					if (profile.transientEvery <= 0) return;
					add('transient', choose('transient', { drums, busy, role: 'transient', section: slot.section, lengthBars: length, energy: slot.energy, pounding, peak: inPeak, prefer: signatures, avoid, exclude }));
				};
				if (drums.kick >= KIT_LEADS) {
					addTransient();
					addAccent();
				} else {
					addAccent();
					addTransient();
				}
				break;
		}

		if (layers.bed) {
			delete layers.bed.opacity;
			const lead = byId.get(layers.rhythm?.effect ?? '')?.taste.kit;
			if (pounding && (lead === 'kick' || lead === 'any') && layers.transient && layers.accent) {
				// Four additive voices need room for the kit above the sustained bed.
				layers.bed.opacity = DEFAULT_OPACITY.bed * 0.8;
			}
		}

		if (slot.peak && peakMaster) {
			layers.master = { effect: peakMaster.id };
			peakCue = cues.length;
		}

		const intensity = intensityFor(slot, spread, profile);
		// The one palette move sanctioned beyond the swap: the analyser heard the last chorus
		// lift a key, and the whole identity rotates a step with it - same three hues, all
		// moved together, so it reads as the song going up rather than the show changing.
		const lifted =
			analysis.bars[slot.span.startBar]?.events.includes('key_change') ?? false;
		// Past the first song every cue names its palette outright: a cue with none resolves
		// against the SHOW palette, never the cue before, so a 'swap' or an absent palette in
		// the second song would reach back to the first song's colour.
		const own = palettes[slot.movement] ?? palette;
		const cuePalette = paletteFor(slot, own, intensity, lifted);
		const concrete: CuePalette | undefined =
			slot.movement === 0 ? cuePalette : cuePalette === 'swap' ? swapped(own) : (cuePalette ?? own);
		cues.push({
			bar: slot.bar,
			section: slot.section,
			layers,
			palette: concrete,
			intensity,
			motion: motionFor(slot, profile),
			// A new song arrives on its downbeat, whatever its first section is.
			fadeBeats: slot.arrival ? 0 : fadeFor(slot, profile),
			note: slot.arrival ? `a new song: ${noteFor(slot)}` : noteFor(slot)
		});
	}

	carryThePeak(cues, peakCue);
	stripBuilds(cues, byId);
	shapeApproaches(cues, profile);
	plantWildcard(cues, slots, picker, analysis, byId, exclude);
	inheritWhereEmpty(cues);
	trackTheLeaving(cues, analysis);
	answerIntroKit(cues, analysis, effects, seed, profile, signatures, avoid, exclude);

	return {
		version: SHOW_VERSION,
		trackId: analysis.trackId,
		title: analysis.title,
		analysisHash: analysis.hash,
		brief: writeBrief(analysis, palette.name ?? 'unnamed', opts.context, movements),
		authoredBy: 'engine',
		seed,
		palette,
		defaults: { intensity: 0.7, motion: 1, fadeBeats: 2 },
		generatedEffects: [],
		cues,
		hits: planHits(analysis, slots, profile, flashes, peakTreatment)
	};
}


/**
 * An opening's hits deserve an answer even where the picker would not spend a transient:
 * a count-in ticks, a riff's snares stroke. Only intro cues without a kit voice change, with
 * a picker of their own so every later draw stays where it was.
 */
function answerIntroKit(
	cues: Cue[], analysis: TrackAnalysis, effects: readonly EffectDef[], seed: number,
	profile: GenreProfile, prefer: readonly string[], avoid: readonly string[],
	exclude: readonly string[]
): void {
	if (profile.transientEvery === 0) return;
	const byId = new Map(effects.map((effect) => [effect.id, effect]));
	const picker = new EffectPicker(
		effects.filter((effect) => effect.role === 'transient' && effect.taste.kit !== undefined),
		new Rng(seed ^ 0x736e6172)
	);
	for (let index = 0; index < cues.length; index++) {
		const cue = cues[index];
		if (cue.section !== 'intro' || cue.layers.transient || cue.layers.master) continue;
		const layers = Object.values(cue.layers).map((spec) => byId.get(spec!.effect));
		if (layers.some((effect) => effect?.taste.kit)) continue;
		const endBar = cues[index + 1]?.bar ?? analysis.bars.length;
		const drums = drumDensity(analysis, cue.bar, endBar);
		if (Math.max(drums.kick, drums.snare, drums.hat) < KIT_FLOOR) continue;
		const span = analysis.sections.find((s) => cue.bar >= s.startBar && cue.bar < s.endBar);
		const energy = (span?.meanEnergy ?? 0) / 100;
		const busy = layers.reduce((sum, effect) => sum + (effect?.taste.activity ?? 0), 0);
		const voice = picker.pick({
			role: 'transient', section: 'intro', lengthBars: endBar - cue.bar,
			energy: Math.min(energy, 0.45), drums, busy, noCharacter: true, prefer, avoid, exclude
		});
		if (voice) cue.layers.transient = { effect: voice.id };
	}
}


/**
 * Follow a decisive ending decay with the same layers and falling level/motion. Cold endings
 * use the button.
 */
function trackTheLeaving(cues: Show['cues'], analysis: TrackAnalysis): void {
	if (cues.length === 0) return;
	const last = cues[cues.length - 1];
	const endBar = analysis.bars.length;
	if (endBar - last.bar < 6) return;
	const energy = (b: number) => analysis.bars[Math.min(endBar - 1, Math.max(0, b))].energy;
	const head = (energy(last.bar) + energy(last.bar + 1)) / 2;
	const tail = (energy(endBar - 2) + energy(endBar - 1)) / 2;
	if (head < 15 || tail > 0.65 * head) return;
	const base = last.intensity ?? 0.5;
	const baseMotion = last.motion ?? 1;
	let prev = base;
	for (let bar = last.bar + 4; bar < endBar - 1; bar += 4) {
		const local = (energy(bar) + energy(bar + 1)) / 2;
		// Follows the record down, never back up, and never to black: "letting the room go
		// dark" is not the same instruction as "off".
		const level = Math.max(0.12, Math.min(prev - 0.02, base * (local / head)));
		if (level >= prev) continue;
		prev = level;
		cues.push({
			bar,
			section: last.section,
			layers: last.layers,
			palette: last.palette,
			intensity: Math.round(level * 100) / 100,
			motion: Math.max(0.15, Math.round(baseMotion * Math.max(0.5, local / head) * 100) / 100),
			fadeBeats: 8,
			note: 'the record is leaving and the room goes with it'
		});
	}
}

/**
 * Reserve the last statement of the loudest group. Match kind too, since group 0 can span
 * unrelated sections.
 */
export function peakSection(sections: readonly SectionSpan[]): SectionSpan | null {
	const top = sections.find((s) => s.energyRank === 1) ?? null;
	if (!top || top.group < 0) return top;
	let last = top;
	for (const s of sections) {
		if (s.group === top.group && s.kind === top.kind && s.index > last.index) last = s;
	}
	return last;
}

function buildSlots(
	analysis: TrackAnalysis,
	peakMasterBars: number,
	peakIndex: number,
	movements: readonly MovementSpan[] = []
): Slot[] {
	const slots: Slot[] = [];

	let dropCount = 0;
	let lastMovement = 0;

	// The final appearance of each material, so the last chorus can outrank its siblings.
	const lastOfGroup = new Map<number, number>();
	for (const s of analysis.sections) {
		if (s.group >= 0) lastOfGroup.set(s.group, s.index);
	}
	// Each song's own biggest passage: the last statement of its loudest drop-class group,
	// the rule the track's peak already follows, asked per song. The song holding the
	// track's peak needs none of its own.
	const movementPeaks = new Set<number>();
	for (let k = 0; k < movements.length; k++) {
		const own = analysis.sections.filter((s) => s.movement === k && sectionBase(s.kind) === 'drop');
		if (own.length === 0 || own.some((s) => s.index === peakIndex)) continue;
		const top = own.reduce((a, b) => (b.meanEnergy > a.meanEnergy ? b : a));
		const last = own.filter((s) => s.group === top.group && s.kind === top.kind).pop() ?? top;
		movementPeaks.add(last.index);
	}

	for (const span of analysis.sections) {
		const energy = span.meanEnergy / 100;
		const isPeak = span.index === peakIndex;
		const movement = span.movement ?? 0;
		// The drop count restarts with each song, so the second song's first drop inverts the
		// palette the way any first drop does.
		if (movement !== lastMovement) {
			dropCount = 0;
			lastMovement = movement;
		}
		const dropIndex = sectionBase(span.kind) === 'drop' ? dropCount++ : -1;
		const first = slots.length;
		let bar = span.startBar;
		let index = 0;
		// An outro is the leaving pass's to step down, and a void is dark: neither is a look
		// held too long, so the ceiling in seconds does not apply.
		const barSeconds = span.kind === 'outro' || span.kind === 'void' ? 0 : barSecondsOf(analysis, span);

		while (bar < span.endBar) {
			const remaining = span.endBar - bar;
			// Size the peak opener to its master burst; place later cues on the section-relative phrase
			// grid.
			const burst = isPeak && index === 0 && peakMasterBars > 0;
			// Absorb a remainder shorter than two bars so the peak retains viable bed and rhythm
			// layers.
			let take = burst
				? remaining - peakMasterBars < 2
					? remaining
					: peakMasterBars
				: cueBars(remaining, barSeconds);
			// The burst cue is deliberately shorter than a phrase and must not be re-rounded;
			// everything after it re-lands on the section's own grid.
			if (take < remaining && !burst) {
				const into = bar + take - span.startBar;
				let landed = span.startBar + Math.round(into / PHRASE_BARS) * PHRASE_BARS;
				// Rounding up past the ceiling in seconds - two and a half phrases after a
				// two-bar burst, at 58 bpm - lands the phrase before instead.
				const down = span.startBar + Math.floor(into / PHRASE_BARS) * PHRASE_BARS;
				if (landed > down && (landed - bar) * barSeconds > MAX_CUE_S && down > bar) landed = down;
				if (landed > bar && landed < span.endBar) take = landed - bar;
			}

			slots.push({
				bar,
				endBar: bar + take,
				section: span.kind,
				span,
				energy,
				index,
				of: 0,
				peak: isPeak && index === 0,
				from: slots[slots.length - 1]?.section ?? null,
				fromBars: slots.length > 0 ? slots[slots.length - 1].endBar - slots[slots.length - 1].bar : 0,
				fromEnergy: slots[slots.length - 1]?.energy ?? 0,
				dropIndex,
				finalOfGroup: span.group >= 0 && lastOfGroup.get(span.group) === span.index,
				movement,
				arrival: movement > 0 && index === 0 && bar === movements[movement]?.startBar,
				movementPeak: movementPeaks.has(span.index) && index === 0
			});
			bar += take;
			index++;
		}

		for (let i = first; i < slots.length; i++) slots[i].of = index;
	}

	return slots;
}

/** Seconds a bar of this section lasts, from its own bar lines. */
function barSecondsOf(analysis: TrackAnalysis, span: SectionSpan): number {
	const times = analysis.tempo.barTimes;
	const at = (b: number) => times[Math.max(0, Math.min(b, times.length - 1))];
	const seconds = (at(span.endBar) - at(span.startBar)) / Math.max(1, span.endBar - span.startBar);
	return seconds > 0 ? seconds : 0;
}

/**
 * Avoid short trailing stubs unless the extended cue exceeds MAX_CUE_S and the stub lasts
 * MIN_STUB_S.
 */
function cueBars(remaining: number, barSeconds: number): number {
	if (remaining > MAX_CUE_BARS + PHRASE_BARS) return MAX_CUE_BARS;
	const stub = remaining - MAX_CUE_BARS;
	if (stub > 0 && remaining * barSeconds > MAX_CUE_S && stub * barSeconds >= MIN_STUB_S) return MAX_CUE_BARS;
	return remaining;
}

function clamp01(v: number): number {
	return v < 0 ? 0 : v > 1 ? 1 : v;
}


/**
 * Spread lowers quiet cues only. Compensating for thin stacks would erase drop-to-quiet
 * contrast.
 */
function intensityFor(slot: Slot, spread = 0, profile?: GenreProfile): number {
	const base: Record<SectionKind, number> = {
		intro: 0.52,
		// A step above where they sat: with the catalog's levels brought onto one ladder a
		// groove measured a median of 46 bytes against an intro's 28 and a drop's 84, and a
		// groove should read as the room playing, clearly above the room waking up.
		groove: 0.72,
		verse: 0.68,
		// Keep enough post-gamma level for visible motion in a breakdown.
		breakdown: 0.54,
		build: 0.62,
		void: 0.05,
		drop: 0.9,
		// A chorus is as loud as a drop and arrives by lift; the last one gets the extra step.
		chorus: 0.86,
		// Not 0.32. "Letting the room go dark" is not the same instruction as "off", and gamma
		// 2.2 leaves very little room below byte 10 to say the difference in.
		outro: 0.5
	};
	// The peak is the only cue allowed the top of the range, because the linter checks that the
	// brightest thing in the show happens in the biggest moment of the track.
	if (slot.peak) return 1;
	let floor = base[slot.section] * (1 - spread * (slot.section === 'intro' ? 0.12 : 0.35));
	// The families that sit in near-black between their loud passages get the darkness the
	// genre expects; everyone else keeps a lit room playing quietly.
	if (profile?.darkBreakdowns && slot.section === 'breakdown') floor = Math.min(floor, 0.42);
	// A build that sits at one level is not a build. Climbing across its cues is what makes the
	// drop feel arrived at rather than merely loud - or, in the family that lights its risers by
	// taking the room away, dimming across them so the return lands out of near-black.
	const climb =
		slot.section === 'build' && slot.of > 1
			? (slot.index / (slot.of - 1)) * (profile?.buildDims ? -0.2 : 0.16)
			: 0;
	// The final chorus outranks its siblings: everything the room has, short of the peak's 1.0.
	const finale = slot.section === 'chorus' && slot.finalOfGroup ? 0.05 : 0;
	// A song's own biggest moment on a stitched track: above anything else in that song,
	// still under the one peak the whole show reserves, which the linter holds brightest.
	if (slot.movementPeak) return 0.96;
	return Math.min(0.92, floor + slot.energy * 0.08 + climb + finale);
}

function motionFor(slot: Slot, profile?: GenreProfile): number {
	const base: Record<SectionKind, number> = {
		intro: 0.58,
		groove: 1,
		verse: 0.9,
		// Not 0.34. Motion scales every speed an effect declares, so a third of it turned the one
		// layer a breakdown had into a still picture. A breakdown is quieter than a groove, not
		// slower than one: what comes out is the arrangement, not the clock.
		breakdown: 0.7,
		build: 1.15,
		void: 0.4,
		drop: 1.25,
		// A chorus moves like an anthem, not like an impact: full, not frantic.
		chorus: 1.1,
		outro: 0.24
	};
	const climb = slot.section === 'build' && slot.of > 1 ? (slot.index / (slot.of - 1)) * 0.2 : 0;
	// Loud intros/outros retain motion; their labels alone must not throttle a full arrangement.
	const bookend = slot.section === 'intro' || slot.section === 'outro';
	const lively = bookend ? (0.85 - base[slot.section]) * slot.energy : 0;
	// The genre's clock. Scaled before rounding, and the quiet floor stands: a ballad's 0.5
	// on an already-slow outro is a room that has stopped, which is what a ballad's end is.
	const scale = profile?.motionScale ?? 1;
	const floor = slot.section === 'intro' ? 0.35 : 0.15;
	return Math.round(Math.max(floor, (base[slot.section] + climb + lively) * scale) * 100) / 100;
}

/** Arrivals snap; eased sections depend on the preceding section's contrast. */
function fadeFor(slot: Slot, profile?: GenreProfile): number {
	// A swell-family arrival uses a two-bar fade ending on the chorus downbeat.
	if (profile?.peak === 'swell' && sectionBase(slot.section) === 'drop' && slot.index === 0) {
		return 8;
	}
	if (slot.section === 'drop' || slot.section === 'void') return 0;
	// A chorus arrives ON its downbeat and still blooms rather than detonating: one beat of
	// fade is the difference between a lift and a cut, and it is over before anyone sees it
	// as a fade.
	if (slot.section === 'chorus') return slot.index > 0 ? 4 : 1;
	// Inside a section nothing has changed but the look, so the change should be barely felt.
	if (slot.index > 0) return 4;
	if (slot.section === 'intro' || slot.section === 'outro') return 8;
	if (slot.from === 'drop' || slot.from === 'chorus') return 2;
	// A count-in ends in an arrival, not a dissolve: the band stepping in hard lands on one
	// beat, a softer entry over half the opening, so the intro look is seen before it goes.
	if (slot.from === 'intro' && slot.fromBars <= SHORT_INTRO_BARS) {
		return slot.energy - slot.fromEnergy >= ARRIVAL_STEP ? 1 : slot.fromBars * 2;
	}
	// A quiet section dissolving into anything short of a drop reads abrupt at two bars:
	// both sides are near-still, the eye has nothing else to watch, and the change IS the
	// event. Three bars makes it weather. Two listening notes, both at exactly this seam.
	if (slot.from === 'intro' || slot.from === 'breakdown' || slot.from === 'outro') return 12;
	return 8;
}

/**
 * Vary saturation and depth while preserving hue identity, making the reserved inversion
 * meaningful.
 */
function paletteFor(
	slot: Slot,
	show: ShowPalette,
	intensity = 0.7,
	lifted = false
): CuePalette | undefined {
	const sat = show.sat ?? 0.94;
	const shade = show.shade ?? 0.14;
	const { base, accent } = show;
	const third = show.third ?? accent;
	/** A key change moves every hue the same step, so the identity rises without breaking. */
	const lift = (h: number) => (h + 18) % 360;
	// Counter the Hunt effect by adding chroma as intensity falls.
	const hunt = Math.min(1, sat * (1 + 0.35 * (1 - intensity)));

	switch (slot.section) {
		case 'drop':
			// The first drop inverts, which is the loudest thing colour can do without leaving
			// the identity. A later one promotes the third hue instead, so it tops the first
			// rather than repeating it.
			return slot.dropIndex % 2 === 0
				? 'swap'
				: { base: third, accent: base, third: accent, sat: Math.min(1, sat * 1.05), shade };

		case 'chorus':
			// Only the final chorus inverts the palette; a key lift rotates that identity with the
			// song.
			return slot.finalOfGroup
				? lifted
					? {
							base: lift(accent),
							accent: lift(base),
							third: lift(third),
							sat: Math.min(1, sat * 1.08),
							shade: shade * 0.8,
							white: 0.16
						}
					: 'swap'
				: { base, accent, third, sat: Math.min(1, sat * 1.06), shade: shade * 0.85, white: 0.14 };

		case 'intro':
		case 'outro':
			return { base, accent, third, sat: hunt, shade: shade * 0.7, white: 0.3 };

		case 'breakdown':
			// A breakdown is somewhere else. Turning the room to the third hue is the cheapest
			// way to say so, and it costs no hue the show has not already declared.
			return { base: third, accent: base, third: accent, sat: hunt, shade: shade * 1.5, white: 0.25 };

		case 'build':
			// The base walks toward the accent across the build, so the drop's inversion is
			// arriving at somewhere the room has already started moving.
			return {
				base: lerpHue(base, accent, slot.of > 1 ? 0.2 + (slot.index / (slot.of - 1)) * 0.2 : 0.3),
				accent,
				third,
				sat: Math.min(1, sat * 1.02),
				shade: shade * 0.8,
				white: 0.08
			};

		default:
			return undefined;
	}
}

/**
 * Parameter choices preserve the effect's identity. Repeated entries weight the draw;
 * omissions keep defaults.
 */
const VARIETY: Record<string, Record<string, readonly number[]>> = {
	vortex: { barsPerRev: [1, 2, 2, 4], arms: [1, 2, 2, 3], dir: [1, 1, -1], twist: [0.15, 0.4, 0.7, 0.95] },
	chase: { segments: [6, 8, 8, 12], tail: [0.35, 0.5, 0.7] },
	impulseSpin: { lobes: [2, 3, 3, 4], drag: [0.3, 0.45, 0.6] },
	sweep: { bars: [1, 2, 2, 4], turn: [1, 1, 0] },
	hueCarousel: { barsPerRev: [4, 8, 8] },
	pixelRain: { fallBeats: [3, 4, 6] },
	pump: { sweep: [0.3, 0.5, 0.8] },
	blockChase: { order: [0, 1, 2], half: [0, 0, 1] },
	snapSplit: { hold: [0.6, 0.75, 0.9] }
};

/** Override defaults only where track measurements determine the parameter. */
function paramsFor(
	def: EffectDef,
	slot: Slot,
	analysis: TrackAnalysis,
	draw: (k: number) => number
): Record<string, number> | undefined {
	const params: Record<string, number> = {};
	const clampTo = (key: string, wanted: number) => {
		const spec = def.params.find((x) => x.key === key);
		if (spec) params[key] = Math.max(spec.min, Math.min(spec.max, wanted));
		return !!spec;
	};

	// The look's own variety, drawn per cue so the fourth vortex of a night is not the first
	// one again. A key an effect does not declare is skipped, so the table can name a param
	// before the effect grows it.
	const variety = VARIETY[def.id];
	if (variety) {
		let k = 0;
		for (const [key, options] of Object.entries(variety)) {
			clampTo(key, options[Math.min(options.length - 1, Math.floor(draw(k++) * options.length))]);
		}
	}

	// Hats carry the subdivision a track is actually played at, so a flicker locked to them
	// lands where the producer put it rather than on a guess about the genre.
	const hasRate = def.params.some((x) => x.key === 'perBeat');
	const hasPeriod = def.params.some((x) => x.key === 'cycleBeats');
	if (hasRate || hasPeriod) {
		let hats = 0;
		let bars = 0;
		for (let b = slot.bar; b < Math.min(slot.endBar, analysis.bars.length); b++) {
			hats += analysis.bars[b].hats;
			bars++;
		}
		const hatsPerBeat = bars > 0 ? hats / bars / Math.max(1, analysis.tempo.beatsPerBar) : 0;
		// perBeat is events/beat; cycleBeats is beats/cycle. Their rate mappings are inverses.
		if (hasRate) clampTo('perBeat', hatsPerBeat >= 3 ? 4 : hatsPerBeat >= 1.5 ? 2 : 1);
		if (hasPeriod) clampTo('cycleBeats', hatsPerBeat >= 1.5 ? 4 : 8);
	}

	// The felt orbit: whole bars per lap until a lap runs at least ~2.2 s. From the track
	// MEDIAN, decided once at compose - a bar hovering at the threshold must not flip the
	// lap length mid-song.
	const barSeconds = (60 / Math.max(1, analysis.tempo.bpm)) * analysis.tempo.beatsPerBar;
	clampTo('lapBars', barSeconds >= 2.2 ? 1 : 2);
	// The felt strike rate, the same way: a wall struck on every beat is a chase at 120 bpm
	// and a 3 Hz flicker at 174, so past 150 bpm the blocks strike on the half bar.
	if (barSeconds / Math.max(1, analysis.tempo.beatsPerBar) < 0.4) clampTo('half', 1);

	return Object.keys(params).length > 0 ? params : undefined;
}

function noteFor(slot: Slot): string {
	if (slot.peak) return 'the peak: full stack, palette swapped, biggest look of the night';
	switch (slot.section) {
		case 'intro':
			return 'the room waking up, a moving gesture over the bed';
		case 'groove':
			return 'the groove: bed and pulse, drums held back';
		case 'verse':
			return 'the verse sits back so the chorus has somewhere to go';
		case 'breakdown':
			return 'stripped back so the next lift has somewhere to come from';
		case 'build':
			return 'holding layers back so the drop has something to add';
		case 'void':
			return 'the light cuts with the bass; this is what makes the drop a release';
		case 'drop':
			return 'full stack on the downbeat';
		case 'chorus':
			return slot.finalOfGroup
				? 'the last chorus: colours invert, everything the song has been saving'
				: 'the chorus blooms in the signature colour';
		case 'outro':
			return 'letting the room go dark';
	}
}

/**
 * A short peak burst borrows the following cue's look, keeping viable layers beneath its
 * master.
 */
function carryThePeak(cues: Cue[], at: number): void {
	if (at < 0) return;
	const burst = cues[at];
	const next = cues[at + 1];
	// Only from the same section. If the peak is one cue long there is nothing to inherit and
	// its own picks, degenerate or not, are all there is.
	if (!burst || !next || next.section !== burst.section) return;
	const master = burst.layers.master;
	burst.layers = { ...next.layers };
	if (master) burst.layers.master = master;
}

/**
 * Short nonvoid cues inherit a bed when no effect meets minBars; the cue still controls its
 * own decay.
 */
function inheritWhereEmpty(cues: Cue[]): void {
	for (let i = 1; i < cues.length; i++) {
		if (cues[i].section === 'void') continue;
		if (countLayers(cues[i]) > 0) continue;
		const bed = cues[i - 1].layers.bed;
		if (bed) cues[i].layers = { bed: { ...bed } };
	}
}

/** Builds leave layers out so the drop can reintroduce them. */
function stripBuilds(cues: Cue[], effects: ReadonlyMap<string, EffectDef>): void {
	for (let i = 0; i < cues.length - 1; i++) {
		if (cues[i].section !== 'build') continue;
		const drop = cues.slice(i + 1).find((c) => sectionBase(c.section) === 'drop');
		if (!drop) continue;
		const dropLayers = countLayers(drop);
		while (countLayers(cues[i]) >= dropLayers) {
			// Strip from the top down: the drum layer is what the drop wants back most.
			const order: LayerRole[] = ['transient', 'accent', 'rhythm', 'master'];
			const sounding = (r: LayerRole) => effects.get(cues[i].layers[r]?.effect ?? '')?.taste.noteReactive;
			const victim = order.find((r) => cues[i].layers[r] && !sounding(r))
				?? order.find((r) => cues[i].layers[r]);
			if (!victim) break;
			delete cues[i].layers[victim];
		}
	}
}

function countLayers(cue: Cue): number {
	return Object.values(cue.layers).filter(Boolean).length;
}

/**
 * Dim the existing look before drop-class arrivals. Builds keep climbing; swells use fadeFor
 * instead.
 */
function shapeApproaches(cues: Cue[], profile: GenreProfile): void {
	if (profile.peak === 'swell') return;
	for (let i = cues.length - 1; i >= 1; i--) {
		const opener = cues[i];
		const prev = cues[i - 1];
		if (sectionBase(opener.section) !== 'drop') continue;
		if (prev.section === opener.section) continue;
		if (prev.section === 'build' || prev.section === 'void') continue;
		if (opener.bar < SETTLE_BARS) continue;
		// A short predecessor has no room to give a bar away.
		if (opener.bar - prev.bar < 3) continue;
		if (!prev.layers.bed) continue;
		// Keep the full look through the breath; changing its stack would read as an early section
		// arrival.
		cues.splice(i, 0, {
			bar: opener.bar - 1,
			section: prev.section,
			layers: { ...prev.layers },
			palette: prev.palette,
			intensity: (prev.intensity ?? 0.7) * 0.6,
			motion: prev.motion,
			fadeBeats: 2,
			note: 'the breath before it lands'
		});
	}
}

/** A single seeded wildcard adds surprise mid-passage, away from structural arrivals. */
function plantWildcard(
	cues: Cue[],
	slots: Slot[],
	picker: EffectPicker,
	analysis: TrackAnalysis,
	byId: Map<string, EffectDef>,
	exclude: readonly string[] = []
): void {
	const steady = slots.filter(
		(s) => sectionBase(s.section) === 'groove' && s.of >= 3 && !s.peak && s.index > 0
	);
	if (steady.length === 0) return;

	let host = steady[0];
	for (const s of steady) {
		if (s.span.lengthBars > host.span.lengthBars) host = s;
		else if (s.span.lengthBars === host.span.lengthBars && s.index === Math.floor(s.of / 2)) host = s;
	}

	const cue = cues.find((c) => c.bar === host.bar);
	if (!cue) return;
	// The stranger joins a stack that is already moving and pays into the same budget.
	let busy = 0;
	for (const role of LAYER_ROLES) {
		const spec = cue.layers[role];
		if (role !== 'accent' && spec) busy += byId.get(spec.effect)?.taste.activity ?? 0;
	}

	// Wildcards bypass section eligibility only; flash/impact and silent-kit exclusions still
	// apply.
	const def = picker.pick({
		role: 'accent',
		section: host.section,
		lengthBars: host.endBar - host.bar,
		energy: host.energy,
		busy,
		anySection: true,
		noCharacter: true,
		// Foreign every night, so a stranger too: the family's hard exclusions hold here.
		exclude,
		drums: drumDensity(analysis, host.bar, host.endBar)
	});
	if (!def) return;
	cue.layers.accent = { effect: def.id };
	cue.note = `${cue.note}; one stranger, once`;
}

/**
 * Plan punctuation against the shared genre allowance, reserving flashes for the strongest
 * arrivals.
 */
function planHits(
	analysis: TrackAnalysis,
	slots: Slot[],
	profile: GenreProfile,
	allowance: number,
	peakTreatment: GenreProfile['peak'] = profile.peak
): Hit[] {
	/** Apply the peak's kick-density slam override to ordinary drops too; swells remain swells. */
	const treatFor = (slot: Slot) => {
		if (slot.peak) return peakTreatment;
		if (
			profile.peak === 'bloom' &&
			sectionBase(slot.section) === 'drop' &&
			kickDensity(analysis, slot) >= POUNDING_KICK
		) {
			return 'slam';
		}
		return profile.peak;
	};
	const hits: Hit[] = [];
	const { tempo } = analysis;
	const beatsPerBar = tempo.beatsPerBar;
	// Sized at the bar it will FIRE on, not off the track median. On a track that changes
	// tempo the median describes nothing anybody plays: SICKO MODE's median says 5.2 Hz is
	// safe while its fast movement runs the same gesture at 9.2, past the ceiling.
	const perBeatAt = (bar: number) => strobePerBeat({ bpm: bpmAt(tempo, bar) });

	// Every gesture below is counted in whole bars, so each one starts on a downbeat and ends on
	// one. Anything shorter came back mid-bar, and a room that comes back mid-bar has answered
	// nothing: the phrase it was pointing at has not arrived yet.
	const bars = (n: number) => n * beatsPerBar;
	// Two bars of clearance either side, so gestures read as separate events rather than one
	// smear, and so nothing is planned where a bigger card will mask it.
	const clear = (from: number, to: number) =>
		!hits.some((h) => from - 2 < h.bar + h.beats / beatsPerBar && h.bar < to + 2);
	// Black is counted in beats rather than bars, because a bar of it is four beats and at the
	// tempos this repertoire sits at that is three seconds of nothing. Whole beats still, so it
	// lands on the grid, and never more than the rule allows in either unit.
	const blackBeats = (atBar: number, wantBars: number) => {
		const cap = HIT_RULES.blackout.maxSeconds ?? Infinity;
		let beats = Math.min(HIT_RULES.blackout.maxBars, wantBars) * beatsPerBar;
		while (beats > 1 && hitSeconds(tempo, atBar, 0, beats) > cap) beats--;
		return Math.max(1, beats);
	};
	/** Placed so it finishes exactly on `endBar`'s downbeat, however few beats long it is. */
	const endingAt = (endBar: number, beats: number): { bar: number; beat?: number } => {
		const barsBack = Math.ceil(beats / beatsPerBar);
		const bar = endBar - barsBack;
		const beat = barsBack * beatsPerBar - beats;
		return beat > 0 ? { bar, beat } : { bar };
	};
	// Cap strobe seconds across the actual occupied bars, since neighboring bars may differ on a
	// drifting grid.
	const strobeBeats = (endBar: number, want: number) => {
		let beats = Math.min(want, HIT_RULES.strobe.maxBars * beatsPerBar);
		while (beats > 0) {
			const { bar, beat } = endingAt(endBar, beats);
			if (hitSeconds(tempo, bar, beat ?? 0, beats) <= STROBE_MAX_S) break;
			beats--;
		}
		return beats;
	};
	/** Strobes and blackouts share one allowance. It is a ceiling, not a quota. */
	let flashes = 0;
	const spendFlash = (hit: Hit): boolean => {
		if (flashes >= allowance) return false;
		flashes++;
		hits.push(hit);
		return true;
	};

	// A beat switch is the biggest thing on a record that has one, and it is marked whatever
	// section it opens: a slam where the new song kicks, a colour flood where it does not.
	for (const slot of slots) {
		if (!slot.arrival || slot.bar < SETTLE_BARS) continue;
		const lands = (analysis.bars[slot.bar]?.kicks ?? 0) > 0;
		hits.push({
			bar: slot.bar,
			kind: lands && treatFor(slot) !== 'swell' ? 'slam' : 'bump',
			beats: bars(1),
			note: 'a new song begins'
		});
	}

	// Every drop-class arrival gets its downbeat marked - with what depends on the genre.
	// A slam is an impact; a bump is the bloom genres mark a chorus with; a swell genre
	// lets the cue's own rise carry it and plans nothing at all.
	const dropOpeners = slots.filter((s) => sectionBase(s.section) === 'drop' && s.index === 0);
	for (const slot of dropOpeners) {
		const treat = treatFor(slot);
		const anthem = slot.section === 'chorus' && treat !== 'slam';
		if (treat === 'swell') continue;
		// The switch already marked this bar.
		if (hits.some((h) => h.bar === slot.bar)) continue;
		// A slam is a kick gesture, spent only where the arrival actually kicks. The sung hook
		// that lands with the drums out is still an arrival - it gets the colour flood, and
		// the slam stays saved for a downbeat that hits back.
		const lands = (analysis.bars[slot.bar]?.kicks ?? 0) > 0;
		hits.push({
			bar: slot.bar,
			kind: anthem || !lands ? 'bump' : 'slam',
			beats: bars(1),
			note: slot.peak
				? 'the moment this whole track has been about'
				: anthem
					? 'the chorus arrives'
					: lands
						? 'the drop lands'
						: 'the arrival, in colour - the kit sat this one out'
		});
	}

	// A cold loud ending gets a final downbeat button. Place it before routine punctuation so it
	// takes priority;
	// quiet tails already release, and bloom endings keep bloom treatment.
	const last = analysis.sections[analysis.sections.length - 1];
	if (last && peakTreatment !== 'swell') {
		const lastBars = Math.max(1, last.endBar - last.startBar);
		const pounding =
			analysis.bars
				.slice(last.startBar, last.endBar)
				.reduce((a, row) => a + row.kicks, 0) /
				(lastBars * beatsPerBar) >=
			0.8;
		const cold = sectionBase(last.kind) === 'drop' || (sectionBase(last.kind) === 'groove' && pounding);
		const finalBar = last.endBar - 1;
		if (cold && clear(finalBar, finalBar + 1)) {
			const lands = (analysis.bars[finalBar]?.kicks ?? 0) > 0;
			const anthem = last.kind === 'chorus' && peakTreatment !== 'slam';
			hits.push({
				bar: finalBar,
				kind: lands && !anthem ? 'slam' : 'bump',
				beats: bars(1),
				note: 'the button - the record ends and the room says so'
			});
		}
	}

	// Spend flashes on the peak first, then on the strongest remaining arrivals.
	const byImportance = [...dropOpeners].sort(
		(a, b) => Number(b.peak) - Number(a.peak) || a.span.energyRank - b.span.energyRank || a.bar - b.bar
	);
	for (const slot of byImportance) {
		if (flashes >= allowance) break;
		if (slot.bar < SETTLE_BARS) continue;
		const before = slots.find((s) => s.endBar === slot.bar);
		// A drop arriving out of a void is already the silence-then-slam figure and does not need
		// a card spent on saying so again.
		if (!before || before.section === 'void') continue;

		// Prefer strobes only for slam treatments, leaving a clear bar beforehand so the flash
		// remains punctuation.
		const room = (before.endBar - before.bar - 1) * beatsPerBar;
		const runFor = strobeBeats(slot.bar, Math.min(slot.peak ? PEAK_STROBE_BEATS : STROBE_BEATS, room));
		const start = endingAt(slot.bar, runFor);
		// The bar it actually starts on, which on a track that changes tempo is the only bar
		// whose beat length says what this will look like in the room.
		const perBeat = perBeatAt(start.bar);
		if (perBeat > 0 && runFor > 0 && treatFor(slot) === 'slam') {
			spendFlash({
				...start,
				kind: 'strobe',
				beats: runFor,
				params: { perBeat },
				note: slot.peak ? 'strobing into the one that matters' : 'strobing out of the build'
			});
			continue;
		}

		// A held-breath blackout is the build-only fallback when a strobe cannot fit; it ends on the
		// drop.
		if (before.section !== 'build' || before.endBar - before.bar < 2) continue;
		const heldBeats = blackBeats(slot.bar - 1, 1);
		if (heldBeats > 0) {
			spendFlash({ ...endingAt(slot.bar, heldBeats), kind: 'blackout', beats: heldBeats, note: 'the held breath' });
		}
	}

	// A void that never got the allowance still goes dark: the void CUE carries intensity 0.05
	// and a house floor of zero, so the room is already black there without a hit saying so.
	// This is only worth spending on where nothing bigger wanted it.
	if (flashes < allowance && allowance > 0) {
		const hush = analysis.sections.find((s) => s.kind === 'void');
		if (hush) {
			spendFlash({
				bar: hush.startBar,
				kind: 'blackout',
				beats: blackBeats(hush.startBar, hush.lengthBars),
				note: 'cut with the bass'
			});
		}
	}

	// Peak phrase slams require kicks, have their own cap, and take spacing priority over color
	// floods.
	const peakSlot = slots.find((s) => s.peak);
	if (peakSlot && peakTreatment === 'slam') {
		const span = peakSlot.span;
		let placed = 0;
		for (
			let bar = span.startBar + 2 * PHRASE_BARS;
			bar < span.endBar && placed < 2;
			bar += 2 * PHRASE_BARS
		) {
			if ((analysis.bars[bar]?.kicks ?? 0) === 0) continue;
			if (!clear(bar, bar + 1)) continue;
			hits.push({ bar, kind: 'slam', beats: bars(1), note: 'the peak keeps hitting' });
			placed++;
		}
	}

	// Phrase punctuation uses color floods so sustained loud passages do not spend extra flashes.
	let phraseIndex = 0;
	for (const slot of slots) {
		if (profile.bumpEvery === 0) break;
		const kind = sectionBase(slot.section);
		if (kind !== 'drop' && kind !== 'groove') continue;
		if (slot.bar < SETTLE_BARS) continue;
		if (slot.energy < 0.55) continue;
		// Kick density compares absolute activity across tracks; normalized energy does not.
		if (kickDensity(analysis, slot) < 0.6) continue;

		// Denser in the loud sections, on the phrase grid counted from the section's own
		// start - the grid the audience is counting on.
		const every = PHRASE_BARS * profile.bumpEvery * (kind === 'drop' ? 1 : 2);
		const origin = slot.span.startBar;
		for (
			let bar = origin + Math.ceil(Math.max(1, slot.bar + every - 1 - origin) / every) * every;
			bar < slot.endBar;
			bar += every
		) {
			// Every other phrase, so the passage is punctuated without the answer becoming the
			// thing that is expected. The skipped one is what makes the next one land.
			if (phraseIndex++ % 2 === 0) continue;
			if (clear(bar, bar + 1)) {
				hits.push({ bar, kind: 'bump', beats: bars(1), note: 'colour flood on the phrase' });
			}
		}
	}

	// Answer the loudest crashes outside drop starts, capped by genre and spaced two phrases
	// apart.
	const dropStarts = new Set(
		analysis.sections.filter((s) => sectionBase(s.kind) === 'drop').map((s) => s.startBar)
	);
	if (profile.peak !== 'swell' && profile.bumpEvery > 0) {
		const crashCap = Math.max(1, 5 - profile.bumpEvery);
		const candidates = analysis.bars
			.filter(
				(row) =>
					row.events.includes('crash') && !dropStarts.has(row.bar) && row.bar >= SETTLE_BARS
			)
			.sort((a, b) => b.air - a.air || a.bar - b.bar);
		let placed = 0;
		const taken: number[] = [];
		for (const row of candidates) {
			if (placed >= crashCap) break;
			// Last in, so the bigger cards are already placed: a crash landing under a slam or
			// a blackout is answered by those, and planning a hit that can never fire is a lie
			// about what the show does.
			if (!clear(row.bar, row.bar + 1)) continue;
			if (taken.some((b) => Math.abs(b - row.bar) < 2 * PHRASE_BARS)) continue;
			hits.push({ bar: row.bar, kind: 'bump', beats: bars(1), note: 'answering the crash' });
			taken.push(row.bar);
			placed++;
		}
	}

	return hits.sort((a, b) => a.bar - b.bar || a.kind.localeCompare(b.kind));
}

/** Hits per beat over a span, per stream: how hard the track is actually going, absolutely. */
function drumDensity(
	analysis: TrackAnalysis,
	from: number,
	to: number
): { kick: number; snare: number; hat: number } {
	let kicks = 0;
	let snares = 0;
	let hats = 0;
	let bars = 0;
	for (let b = from; b < Math.min(to, analysis.bars.length); b++) {
		const row = analysis.bars[b];
		kicks += row.kicks;
		snares += row.snares;
		hats += row.hats;
		bars++;
	}
	const per = bars > 0 ? 1 / bars / Math.max(1, analysis.tempo.beatsPerBar) : 0;
	return { kick: kicks * per, snare: snares * per, hat: hats * per };
}

/** Kicks per beat over a slot, the stream every "is this pounding" question reads. */
function kickDensity(analysis: TrackAnalysis, slot: Slot): number {
	return drumDensity(analysis, slot.bar, slot.endBar).kick;
}

function writeBrief(
	analysis: TrackAnalysis,
	paletteName: string,
	context?: TrackContext | null,
	movements: readonly MovementSpan[] = []
): string {
	const t = analysis.tempo;
	const quiet = analysis.sections.some((s) => s.kind === 'verse') ? 'verses' : 'grooves';
	const peak = analysis.sections.find((s) => s.energyRank === 1);
	const shape = analysis.sections.map((s) => s.kind).join(' > ');
	const songs =
		movements.length > 1
			? ` ${movements.length} songs in one: ${movements
					.map((m) => `${Math.round(m.bpm)} bpm in ${m.key.name} from bar ${m.startBar}`)
					.join(', ')}; each gets its own palette and its own biggest moment.`
			: '';
	const who =
		context?.artist && context.title ? `${context.artist} - ${context.title}. ` : '';
	const family = context?.genreFamily ? ` Lit as ${context.genreFamily}.` : '';
	// The show's own voice says so, not just a chip on the queue: everything below is built
	// on a grid the analyser itself does not believe, and anyone reading the brief - the
	// owner or the agent revising it - should know the room runs lounge over this track.
	const trust = gridTrust(analysis, context?.publishedBpm);
	const doubt = trust.trusted
		? ''
		: `The analyser was not sure of this track (${trust.reasons.join('; ')}), so the room runs the calm lounge scenes over it and this show is only the fallback behind the override. `;

	return [
		`${doubt}${who}${t.bpm} bpm in ${t.beatsPerBar}/4, ${analysis.key.name}, ${analysis.bars.length} bars.${family}${songs}`,
		`Arrangement: ${shape}.`,
		`Palette "${paletteName}": one base hue with a complementary answer, no third colour to mud`,
		`the walls. Intensity follows the arrangement rather than the waveform, so the room sits`,
		`back through the ${quiet} and has somewhere to go.`,
		peak
			? `Everything is held for bars ${peak.startBar}-${peak.endBar}, the loudest passage in the track: full stack, palette swapped, and the one look nothing else in the show is allowed to use.`
			: 'No single passage dominates, so the show keeps an even hand throughout.',
		'Generated without a model, so it is a starting point rather than an interpretation.'
	].join(' ');
}

function seedFrom(hash: string): number {
	let h = 0x811c9dc5;
	for (let i = 0; i < hash.length; i++) {
		h ^= hash.charCodeAt(i);
		h = Math.imul(h, 0x01000193) >>> 0;
	}
	return h >>> 0 || 1;
}
