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
	HIT_RULES,
	PHRASE_BARS,
	SHOW_VERSION,
	Rng,
	gridTrust,
	hitSeconds,
	lerpHue,
	sectionBase,
	strobePerBeat,
	swapped,
	bpmAt
} from '@mv/core';
import { allowedFlashes, profileFor, type GenreProfile } from './genre.ts';
import { choosePalette } from './palette.ts';
import { EffectPicker } from './select.ts';

export interface EngineOptions {
	/** Built-ins by default; pass a superset to let generated effects be chosen too. */
	effects?: readonly EffectDef[];
	/** Overrides the seed taken from the analysis hash. */
	seed?: number;
	/** Dominant hue of the cover art, degrees. The room takes the record's own colour. */
	artHue?: number | null;
	/** What the track is. Decides the genre profile; absent falls back to the default row. */
	context?: TrackContext | null;
}

/**
 * No cue holds the room longer than this before something has to change.
 *
 * Two phrases, not four. At sixteen a long groove held one look for a minute at 120 bpm, which
 * is most of the reason a show that reaches for half the catalog still feels like it reaches
 * for none of it: the variety was there and the room never got to it.
 */
const MAX_CUE_BARS = 8;
/**
 * The stub tolerance below lets a section run to twelve bars as one cue, which is 22 s at
 * 128 bpm and 48 s at 60, where the owner heard Melanz's first chorus as one look held too
 * long. Past this many seconds the twelve split into the eight and the stub - the statement,
 * then the lift. The eight-bar ceiling itself does not move: bringing it down at slow tempos
 * turned five looks into nine on the same track, which is the over-effecting he warned of.
 */
const MAX_CUE_S = 30;
/** A stub is a cue of its own only when it lasts long enough to read as one: a two-bar tag. */
const MIN_STUB_S = 6;
/** Matches the linter: punctuation inside this many bars spends the biggest card too early. */
const SETTLE_BARS = 16;
/**
 * Kicks per beat at which a passage counts as measurably pounding - four-on-the-floor
 * territory. One constant for every consequence it has (the peak's slam treatment, a slot's
 * slam treatment, and the energy band its looks are drawn from), because two thresholds
 * meaning one thing is how they come to disagree.
 */
const POUNDING_KICK = 0.8;

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
	/** Which drop this is, counting from zero; -1 when the slot is not a drop. */
	dropIndex: number;
	/** True when this section is the LAST appearance of its material: the final chorus. */
	finalOfGroup: boolean;
	/** Which song of a stitched track this slot lights; 0 on a track that is one song. */
	movement: number;
	/** True for the slot that opens a second or later song: the beat switch itself. */
	arrival: boolean;
	/**
	 * True for the one slot that opens the loudest passage of a song that does not hold the
	 * track's peak: each song of a medley gets a biggest moment of its own, short of the one
	 * the whole show reserves.
	 */
	movementPeak: boolean;
}

/**
 * A show from the analysis alone: no model, no network, and the same bytes every time for
 * the same track.
 *
 * The taste metadata on the effects and the rules in the linter already encode most of what a
 * lighting designer would decide, so this does not need judgement so much as bookkeeping:
 * cover every bar, hold back in the build, spend the biggest look inside the peak, and do not
 * play the same trick twice running. What it cannot do is interpret - it has no idea what the
 * song is about - which is exactly the part left for `author-ai` to revise.
 */
export function composeShow(analysis: TrackAnalysis, opts: EngineOptions = {}): Show {
	const effects = opts.effects ?? BUILT_IN_EFFECTS;
	const seed = opts.seed ?? seedFrom(analysis.hash);
	const rng = new Rng(seed);
	const profile = profileFor(opts.context);
	// The allowance governs the effects as well as the hits: a family that has earned no
	// flashes does not get blinder slams by the accent door instead.
	const flashes = allowedFlashes(analysis, opts.context);
	// vocalGlow answers "the voice", which post-revert means the mid band: on a track with
	// no singing that is a glow named after something absent. The vocal column is nonzero
	// only where synced lyrics put words - but LRCLIB has no sync coverage for much of the
	// owner's corpus (Czech rap most of all), so an empty column means "unknown", not
	// "instrumental". Only an explicit instrumental flag forbids the glow; unknown allows
	// it, because most of what a music player plays is sung and the mid band is an honest
	// approximation of a voice that is really there.
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
	// A track that is several songs gets a palette per song, each drawn from that song's own
	// tempo and key and kept a clear step from the one before: the switch is the biggest
	// thing on such a record, and a room that keeps its colour through it has not noticed.
	// Blobs written before spans existed carry bar numbers here; they are read as no movements
	// at all, since the version bump re-analyses them before the app composes anything.
	const movements: readonly MovementSpan[] = (analysis.movements ?? []).filter(
		(m): m is MovementSpan => typeof m === 'object' && m !== null && typeof m.startBar === 'number'
	);
	const palettes: ShowPalette[] = [palette];
	for (let k = 1; k < movements.length; k++) {
		const m = movements[k];
		palettes.push(choosePalette(analysis, rng, null, profile, { bpm: m.bpm, key: m.key, awayFrom: palettes[k - 1].base }));
	}
	// A signature is the family's vocabulary, not every sentence. Listed plainly, the
	// preference put impulseSpin in 30 of 34 house shows and the owner's word for it was
	// OVERUSED - and merit alone kept it at 80% with the preference gone, because a
	// mid-energy kick-driven rhythm is near-eligible in every pool. So each show draws a
	// seed-stable half of the list, and the UNDRAWN half is avoided at full weight for
	// the night: a signature look is either this show's vocabulary or it rests, which is
	// what makes the fiftieth listen contain shows that never reach for it at all. The
	// family's own avoid list is not sampled - a foreign gesture is foreign every night.
	const signatures = profile.signatures.filter(() => rng.float() < 0.5);
	// The kick-burst family reads as ONE gesture however many files it spans - the owner
	// named four of its members in one complaint ("they all look very similar and the
	// effect is so common"). Each show draws at most one member; the rest are foreign for
	// the night, and one show in seven goes burst-free entirely. Same mechanism as the
	// signature draw, because it is the same disease: presence arithmetic, not taste.
	const BURSTS = ['shockwave', 'kickTunnel', 'kickCannon', 'ricochet', 'pyroBursts', 'splash'];
	const drawnBurst = BURSTS[Math.floor(rng.float() * (BURSTS.length + 1))];
	// Excluded, not merely avoided: in the loud slots the family saturates, an avoided
	// burst at energy distance zero still outscored honest alternatives two bands away,
	// and the measured result was two members in most shows - which is the exact defect.
	const exclude = BURSTS.filter((e) => e !== drawnBurst);
	const avoid = [
		...profile.avoid,
		...profile.signatures.filter((s) => !signatures.includes(s))
	];

	const peakSpan = peakSection(analysis.sections);

	// What the peak arrival is marked with. The genre's answer by default - but a bloom
	// family's peak that measurably pounds has earned the slam anyway: 0.8 kicks a beat is
	// four-on-the-floor territory, and a soft bloom on top of it reads as the rig missing
	// the biggest moment of the night. Light the record that is playing, not the genre card.
	// Swell families are never overridden: their peak is a rise by definition.
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

	// A master effect is a moment, not a look: they are written to hold the room for a bar or
	// two and the linter says so. The peak therefore gets a short cue carrying the burst and a
	// second one right behind it for the rest of the section, which is how a desk would run it.
	// A swell peak carries no burst at all: rnb and ballads bloom into their biggest passage.
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

	for (const slot of slots) {
		const layers: Partial<Record<LayerRole, LayerSpec>> = {};
		const add = (role: LayerRole, def: EffectDef | null) => {
			if (!def) return;
			const params = paramsFor(def, slot, analysis);
			layers[role] = params ? { effect: def.id, params } : { effect: def.id };
		};

		const length = slot.endBar - slot.bar;
		// What the kit is doing here, so the picker can refuse a kick effect in the passage
		// the producer pulled the kick out of. Per slot, not per section: the suspension is
		// often only part of one.
		const drums = drumDensity(analysis, slot.bar, slot.endBar);
		// Aggression comes from the record, not the genre card - the law the slam override
		// already follows, applied one layer up. A drop-class passage measuring 0.8 kicks a
		// beat draws its LOOKS a band harder too, because the band otherwise comes from mean
		// loudness and a heavily limited record has none to give: SOPHIE's Ponyboy pounds at
		// 1.2 kicks a beat from its first bar and sat at band 3 of 5 in four of six sections,
		// which the room heard as the show being too polite for the track. Swell families are
		// exempt on the same grounds their punctuation is: a rise is not a blow.
		const pounding =
			profile.peak !== 'swell' &&
			sectionBase(slot.section) === 'drop' &&
			drums.kick >= POUNDING_KICK;
		// The bed a repeat shares is the one its FIRST cue opened with; interior cues pick freely,
		// or a long section would hold one look for its whole length again by another route.
		const bedEnergy = Math.min(slot.energy, 0.75);
		// A quiet section is a bed and one texture, so the bed genuinely is the room.
		// The quiet three. Every layer in one of these has to be able to hold a room on its own,
		// because there are only two of them and nothing else is running: a breakdown was drawing
		// from the same accent pool as a drop, which is how a passage with the drums taken out
		// ended up lit by stage blinders.
		const bare =
			slot.section === 'intro' || slot.section === 'outro' || slot.section === 'breakdown';
		// Every drop-class floor has to hold the room, not only the peak's: the other
		// layers there are the spikiest things in the catalog - slams and kick rings with
		// darkness between events - and a texture bed under them measured whole dark bars
		// the first time the seed reshuffled that way. The peak-only version of this rule
		// was the same lesson learned half-way.
		const carrier = bare || slot.span === peakSpan || sectionBase(slot.section) === 'drop';
		// An ending is a release, not a scene change: no documented practice makes the
		// ENTRY into an outro an event, and the judged word for the fresh-look version was
		// "cut in way too aggresively". The outro keeps the bed the room was already
		// wearing and everything else leaves - the change IS the thinning. Fresh draws
		// only when there is nothing to inherit, or the inherited bed cannot hold a room
		// alone (beds are written to sit under something).
		const inheritedBed =
			slot.section === 'outro' && cues.length > 0 ? cues[cues.length - 1].layers.bed : undefined;
		if (inheritedBed) {
			layers.bed = { ...inheritedBed };
		} else {
			add('bed', picker.pick({ drums, role: 'bed', section: slot.section, lengthBars: length, energy: bedEnergy, pounding, mustCarry: carrier, bare, group: slot.index === 0 ? slot.span.group : undefined, prefer: signatures, avoid, exclude }));
		}
		switch (sectionBase(slot.section)) {
			case 'void':
				break;

			case 'intro':
			case 'outro':
				// One texture over the bed, as a breakdown gets, and it has to be one that carries.
				// A bed is written to sit UNDER something, so a cue whose other layer contributes
				// nothing asks the dimmest thing in the system to hold the room alone.
				//
				// This used to be unfiltered, because requiring it once left most of these cues
				// with no accent at all: only a single accent in the catalog qualified. There are
				// now enough that the rule can be what it should always have been.
				//
				// An outro wearing an inherited bed that can hold the room takes nothing new at
				// all: the thinning is the gesture, and a fresh texture would be the look-change
				// the inheritance exists to prevent.
				if (
					inheritedBed &&
					effects.find((e) => e.id === inheritedBed.effect)?.taste.carries !== false
				) {
					break;
				}
				add('accent', picker.pick({ drums, role: 'accent', section: slot.section, lengthBars: length, energy: slot.energy, pounding, mustCarry: true, bare, prefer: signatures, avoid, exclude }));
				break;

			case 'breakdown':
				// A texture on top of the bed, always. This used to be a coin toss, on the grounds
				// that a breakdown which keeps everything running is not a breakdown - but what it
				// actually produced was a passage lit by one slow bed and nothing else, half the
				// time. Taking the drums out is what makes a breakdown; taking the light out makes
				// it look broken.
				add('accent', picker.pick({ drums, role: 'accent', section: slot.section, lengthBars: length, energy: slot.energy, pounding, mustCarry: true, bare, prefer: signatures, avoid, exclude }));
				// The kit, where the passage still has one. A breakdown with a beat under it is
				// common in this repertoire and the room should be answering it; a genuinely
				// stripped one has no onsets to answer and gets nothing, which is the difference
				// the coin toss was reaching for and could not see.
				if (profile.transientEvery > 0 && kickDensity(analysis, slot) > 0.25) {
					add('transient', picker.pick({ drums, role: 'transient', section: slot.section, lengthBars: length, energy: slot.energy, pounding, prefer: signatures, avoid, exclude }));
				}
				break;

			case 'build':
				add('rhythm', picker.pick({ drums, role: 'rhythm', section: slot.section, lengthBars: length, energy: slot.energy, pounding, prefer: signatures, avoid, exclude }));
				// A build is the one place an accent belongs before the drop rather than in it, and
				// without one the two effects written for exactly this moment were unreachable.
				add('accent', picker.pick({ drums, role: 'accent', section: slot.section, lengthBars: length, energy: slot.energy, pounding, prefer: signatures, avoid, exclude }));
				break;

			case 'groove':
				add('rhythm', picker.pick({ drums, role: 'rhythm', section: slot.section, lengthBars: length, energy: slot.energy, pounding, prefer: signatures, avoid, exclude }));
				// The drum layer runs at the genre's cadence, never in every cue. Firing a light
				// at every hit is the documented failure of audio-to-light mapping: it reads as
				// mechanical however well timed it is, and leaving it out is what makes it land
				// on return. A ballad leaves it out entirely; punk and funk barely rest it.
				if (profile.transientEvery > 0 && grooveIndex % profile.transientEvery === profile.transientEvery - 1) {
					add('transient', picker.pick({ drums, role: 'transient', section: slot.section, lengthBars: length, energy: slot.energy, pounding, prefer: signatures, avoid, exclude }));
				}
				grooveIndex++;
				break;

			case 'drop':
				// The rhythm layer shares the group's identity the way the bed does: a second
				// chorus whose VISIBLE layers look nothing like the first says the room is not
				// listening, and without the group the novelty penalty actively pushes the
				// repeat away from what the first one used.
				add('rhythm', picker.pick({ drums, role: 'rhythm', section: slot.section, lengthBars: length, energy: slot.energy, pounding, group: slot.index === 0 ? slot.span.group : undefined, prefer: signatures, avoid, exclude }));
				if (profile.transientEvery > 0) {
					add('transient', picker.pick({ drums, role: 'transient', section: slot.section, lengthBars: length, energy: slot.energy, pounding, prefer: signatures, avoid, exclude }));
				}
				// The first appearance of material that returns holds its accent back, so the
				// return ADDS something: escalation by vocabulary rather than by brightness,
				// which prompt.ts warns is the cliche. The peak section and material that never
				// returns get the full stack from the start.
				if (!(slot.dropIndex === 0 && !slot.finalOfGroup && slot.span !== peakSpan)) {
					add('accent', picker.pick({ drums, role: 'accent', section: slot.section, lengthBars: length, energy: slot.energy, pounding, prefer: signatures, avoid, exclude }));
				}
				break;
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
	stripBuilds(cues);
	shapeApproaches(cues, profile);
	plantWildcard(cues, slots, picker, analysis);
	inheritWhereEmpty(cues);
	trackTheLeaving(cues, analysis);

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
 * One cue where each section starts, plus interior cues so nothing holds the room for more
 * than four phrases. The interior ones land on the phrase grid because the linter rejects a
 * section change anywhere else, and a cue that arrives off-phrase reads as wrong even when
 * nobody can say why.
 */
/**
 * The record leaving is a gesture the room must follow. A ring-out or fade whose single
 * closing cue holds one level reads as the lights refusing to let go - every documented
 * ending practice tracks the decay (the round-2 endings research). Where the final bars
 * decline decisively, the closing look is stepped down WITH them: the same layers
 * throughout, which is the outro inheritance rule, only the level and the clock move.
 * A cold ending has no decline and is the button's business, not this pass's.
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
 * The peak is the LAST statement of the loudest group, not the loudest single section.
 * The house craft holds the first statement back so every return adds, and every peak
 * complaint on file names a first statement: EARFQUAKE's corrected first chorus
 * outranked by mean, sat before SETTLE_BARS, and silently skipped the reserved master.
 * Kind is held alongside group because a degenerate grouping (everything group 0) must
 * not let the peak leak into an outro that merely shares the id.
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
			// The peak's opening cue is only as long as the burst it carries, so a master effect
			// written to hold the room for a bar is never asked to hold it for eight.
			// Interior changes land on the phrase grid counted FROM THE SECTION'S OWN START:
			// that is the grid the audience counts on, and on a track whose phase shifts
			// mid-song it is the only phrase grid that exists at all.
			const burst = isPeak && index === 0 && peakMasterBars > 0;
			let take = burst ? Math.min(peakMasterBars, remaining) : cueBars(remaining, barSeconds);
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
 * How many of a section's `remaining` bars the next cue takes: the ceiling while more than
 * that and a phrase are left, else all of it. Leaving a stub shorter than a phrase behind is
 * worse than one long cue, so the last cue may run a phrase over the ceiling - unless at
 * this tempo it would hold past `MAX_CUE_S` and the stub is long enough to be a cue of its own.
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
 * `spread` widens the gap between the quiet sections and the loud ones, for a master with none
 * of its own left. It only ever pushes the quiet end down: the loud end is already at the top
 * of the range and the peak owns 1.0.
 *
 * Deliberately NOT corrected for how thin the stack is, though it was tried. Compensating a
 * one-layer cue back up to what a four-layer cue delivers takes the drop-to-quiet ratio from
 * 8.5x to 2.8x, which is the same contrast collapse the auto-exposure fix existed to undo. The
 * intro was black because two beds emitted a twentieth of what their peers did and the cue had
 * nothing else in it, and both of those are fixed where they were: in the effects, and in the
 * plan.
 */
function intensityFor(slot: Slot, spread = 0, profile?: GenreProfile): number {
	const base: Record<SectionKind, number> = {
		intro: 0.46,
		groove: 0.68,
		verse: 0.64,
		// Not 0.42, for the reason the outro is not 0.32: gamma 2.2 leaves very little room
		// under byte 10 to say anything in, and movement is delivered in bytes, so a passage
		// held down there cannot react however reactive its layers are. A breakdown also sits
		// mid-track with the room already warm, so it has less to prove than the intro does.
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
	let floor = base[slot.section] * (1 - spread * 0.35);
	// The families that sit in near-black between their loud passages get the darkness the
	// genre expects; everyone else keeps a lit room playing quietly.
	if (profile?.darkBreakdowns && slot.section === 'breakdown') floor = Math.min(floor, 0.42);
	// A build that sits at one level is not a build. Climbing across its cues is what makes the
	// drop feel arrived at rather than merely loud.
	const climb = slot.section === 'build' && slot.of > 1 ? (slot.index / (slot.of - 1)) * 0.16 : 0;
	// The final chorus outranks its siblings: everything the room has, short of the peak's 1.0.
	const finale = slot.section === 'chorus' && slot.finalOfGroup ? 0.05 : 0;
	// A song's own biggest moment on a stitched track: above anything else in that song,
	// still under the one peak the whole show reserves, which the linter holds brightest.
	if (slot.movementPeak) return 0.96;
	return Math.min(0.92, floor + slot.energy * 0.08 + climb + finale);
}

/**
 * How fast a cue's effects are allowed to move, which every effect multiplies its own speeds by.
 *
 * The quiet three are far below where they were. A passage with nothing happening in it should
 * look like the room holding its position, drifting over tens of seconds; at 0.6 an intro was
 * still moving fast enough to read as restless, and the light was answering noise in the
 * spectrum rather than anything in the music. The loud sections are untouched.
 */
function motionFor(slot: Slot, profile?: GenreProfile): number {
	const base: Record<SectionKind, number> = {
		intro: 0.28,
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
	// An outro that is still the whole band playing is not a fade, and an intro that opens on the
	// full arrangement is not a hush. These two carry the lowest motion in the table because they
	// usually deserve it; where the passage is as loud as the track gets, that assumption throttles
	// every speed its layers declare and lights a live room at a quarter speed. Energy is
	// normalised within the track, so a genuinely quiet one is untouched.
	const bookend = slot.section === 'intro' || slot.section === 'outro';
	const lively = bookend ? (0.85 - base[slot.section]) * slot.energy : 0;
	// The genre's clock. Scaled before rounding, and the quiet floor stands: a ballad's 0.5
	// on an already-slow outro is a room that has stopped, which is what a ballad's end is.
	const scale = profile?.motionScale ?? 1;
	return Math.round(Math.max(0.15, base[slot.section] + climb + lively) * scale * 100) / 100;
}

/**
 * A drop and a void arrive on the downbeat; everything else can afford to be eased into. How
 * long depends on what came before: a breakdown after a drop is a collapse and wants two
 * beats, the same breakdown after a groove is a settling and wants eight.
 */
function fadeFor(slot: Slot, profile?: GenreProfile): number {
	// A swell family's biggest arrival is a rise, not a step - the planner reserves no master
	// and plans no hits for it, so this ramp IS the arrival. Two bars of fade complete on the
	// cue's own downbeat: the room lifts through the end of the verse and peaks exactly where
	// the chorus lands, which is what a designer's swell is.
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
	// A quiet section dissolving into anything short of a drop reads abrupt at two bars:
	// both sides are near-still, the eye has nothing else to watch, and the change IS the
	// event. Three bars makes it weather. Two listening notes, both at exactly this seam.
	if (slot.from === 'intro' || slot.from === 'breakdown' || slot.from === 'outro') return 12;
	return 8;
}

/**
 * One colour identity, read six ways.
 *
 * The hues never change: base and accent are the track's, and every section varies only how
 * saturated and how deep they sit. That restraint is the point - a declared colour that drifts
 * from section to section stops being an identity, and the base/accent swap at a drop only
 * reads as an event because nothing else about the colour has moved all night.
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
	// The Hunt effect: perceived colorfulness falls with luminance, so a dim cue rendered at
	// reduced saturation reads grey rather than hushed. The quiet sections therefore get MORE
	// chroma as the intensity drops, never less - stage practice's saturated "night", not a
	// pale one - and the hush stays where it belongs, in shade, white and the intensity itself.
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
			// A chorus owns the song's signature colour: the base stays put all song and the
			// room simply blooms in it - saturation up, whites up, no inversion. The FINAL
			// chorus is the one allowed the drop's inversion, which is how it outranks every
			// earlier one without being a byte brighter - and when the track lifts a key into
			// it, the swapped identity rotates a step upward with the song.
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
 * Parameters an effect cannot pick for itself, because they depend on what the track is doing
 * rather than on what the effect is.
 *
 * Only where the analysis genuinely knows better than the default. An effect's defaults are
 * its author's opinion, and overriding them from here on anything else would be guessing with
 * extra steps.
 */
function paramsFor(
	def: EffectDef,
	slot: Slot,
	analysis: TrackAnalysis
): Record<string, number> | undefined {
	const params: Record<string, number> = {};
	const clampTo = (key: string, wanted: number) => {
		const spec = def.params.find((x) => x.key === key);
		if (spec) params[key] = Math.max(spec.min, Math.min(spec.max, wanted));
		return !!spec;
	};

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
		// The two keys are opposite units and MUST stay separate mappings: `perBeat` counts
		// events per beat, `cycleBeats` counts beats per cycle. Writing the rate number into
		// the period param is how sineRoll ran at four times its designed speed on every
		// sparse track.
		if (hasRate) clampTo('perBeat', hatsPerBeat >= 3 ? 4 : hatsPerBeat >= 1.5 ? 2 : 1);
		if (hasPeriod) clampTo('cycleBeats', hatsPerBeat >= 1.5 ? 4 : 8);
	}

	// The felt orbit: whole bars per lap until a lap runs at least ~2.2 s. From the track
	// MEDIAN, decided once at compose - a bar hovering at the threshold must not flip the
	// lap length mid-song.
	const barSeconds = (60 / Math.max(1, analysis.tempo.bpm)) * analysis.tempo.beatsPerBar;
	clampTo('lapBars', barSeconds >= 2.2 ? 1 : 2);

	return Object.keys(params).length > 0 ? params : undefined;
}

function noteFor(slot: Slot): string {
	if (slot.peak) return 'the peak: full stack, palette swapped, biggest look of the night';
	switch (slot.section) {
		case 'intro':
			return 'the room waking up, bed and one texture';
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
 * The peak's burst rides on the peak's look rather than replacing it with a one-bar one.
 *
 * That opening cue is only as long as the master effect holds the room, which is a bar. Almost
 * nothing in the catalog is legal in a bar - no rhythm effect at all - so picking layers for it
 * drew from a pool of one or none, and the biggest moment of the show came out as a bed that
 * emits nothing, no kit, and whatever single accent happened to be short enough. Deterministic,
 * so it happened in every show.
 *
 * A burst is a moment on top of a look, not a look. Taking the one the section goes on to hold
 * means the room does not drop out underneath the hit, and the master is still the only thing
 * that changes when it lands.
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
 * A cue that lit nothing inherits the bed of the one before it.
 *
 * The one-bar outro a ring-out carve leaves is real: every bed in the catalog wants two
 * bars, so its pick comes back empty and the last bar of the night goes black - which reads
 * as a fault, not an ending. The look it winds down FROM is the honest fill; the outro's own
 * intensity, motion and fade already say the rest. Voids are exempt: their darkness is the
 * instruction.
 */
function inheritWhereEmpty(cues: Cue[]): void {
	for (let i = 1; i < cues.length; i++) {
		if (cues[i].section === 'void') continue;
		if (countLayers(cues[i]) > 0) continue;
		const bed = cues[i - 1].layers.bed;
		if (bed) cues[i].layers = { bed: { ...bed } };
	}
}

/**
 * A build must run fewer layers than the drop it leads into. Lighting strips in parallel with
 * the music: a build reintroduces at the drop, it does not add before it.
 */
function stripBuilds(cues: Cue[]): void {
	for (let i = 0; i < cues.length - 1; i++) {
		if (cues[i].section !== 'build') continue;
		const drop = cues.slice(i + 1).find((c) => sectionBase(c.section) === 'drop');
		if (!drop) continue;
		const dropLayers = countLayers(drop);
		while (countLayers(cues[i]) >= dropLayers) {
			// Strip from the top down: the drum layer is what the drop wants back most.
			const order: LayerRole[] = ['transient', 'accent', 'rhythm', 'master'];
			const victim = order.find((r) => cues[i].layers[r]);
			if (!victim) break;
			delete cues[i].layers[victim];
		}
	}
}

function countLayers(cue: Cue): number {
	return Object.values(cue.layers).filter(Boolean).length;
}

/**
 * The bar before a drop-class arrival dips instead of peaking.
 *
 * "Darkest immediately before brightest" is the most reliable contrast gesture a designer
 * has, and until now it existed only as the held-breath blackout: budget-gated, build-only,
 * so a verse running straight into a chorus never got any approach shaping at all. This is
 * the free version - a one-bar cue inside the preceding section, same bed so the layer run
 * survives, everything above it removed, the level pulled down - and the drop's own snap
 * cut (fadeBeats 0) then fires out of a hollow instead of out of the loudest bar so far.
 *
 * Builds keep their climb: the held breath is theirs when the budget allows, and dipping a
 * ramp that exists to rise reads as a stumble. Swell families are shaped the other way, by
 * the two-bar fade in `fadeFor`.
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
		// The breath dims the rig; it does not strike the set. The first version stripped
		// the look to its bed, and the owner located two "starts 2-4 beats early" marks
		// exactly on the dip bar: a re-staged room reads as the next section arriving,
		// however dim. The full look stays; only the level exhales - down by mid-bar
		// (fadeBeats 2), then HELD hollow, so the slam fires out of a breath instead of
		// out of a scene change.
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

/**
 * One look per track that belongs to no section, planted midway through the longest steady
 * passage.
 *
 * Judged against human designers, the axis rule-built shows lose worst on is surprise - the
 * fiftieth listen knows every move before it lands. A single stranger, once, is the smallest
 * honest answer: the seed keeps it the same stranger every time, the accent slot keeps it
 * opacity-bounded, and planting it mid-passage keeps it away from every structural moment
 * the show is already spending real cards on.
 */
function plantWildcard(cues: Cue[], slots: Slot[], picker: EffectPicker, analysis: TrackAnalysis): void {
	const steady = slots.filter(
		(s) => sectionBase(s.section) === 'groove' && s.of >= 3 && !s.peak && s.index > 0
	);
	if (steady.length === 0) return;

	let host = steady[0];
	for (const s of steady) {
		if (s.span.lengthBars > host.span.lengthBars) host = s;
		else if (s.span.lengthBars === host.span.lengthBars && s.index === Math.floor(s.of / 2)) host = s;
	}

	// The wildcard's freedom is from the SECTION vocabulary and nothing else. It still may
	// not be a flash or a blow - a strobe as the one surprise in a rap verse reads as a
	// fault, not a stranger - and it still may not answer a kit stream the passage does not
	// have, which is the same honesty every ordinary pick obeys.
	const def = picker.pick({
		role: 'accent',
		section: host.section,
		lengthBars: host.endBar - host.bar,
		energy: host.energy,
		anySection: true,
		noCharacter: true,
		drums: drumDensity(analysis, host.bar, host.endBar)
	});
	if (!def) return;
	const cue = cues.find((c) => c.bar === host.bar);
	if (!cue) return;
	cue.layers.accent = { effect: def.id };
	cue.note = `${cue.note}; one stranger, once`;
}

/**
 * Punctuation. The part that puts hands on the show.
 *
 * Every drop slams on its downbeat, and the phrases inside the loud passages are answered with
 * colour. What happens at most once is the flash: one strobe or one blackout in the whole show,
 * never both and never twice.
 *
 * That is a correction rather than a preference. This used to strobe out of every build, cut to
 * black before every drop and strobe again on alternate phrases inside them, on the grounds that
 * the move is the vocabulary rather than the surprise. On a four-minute rock track it produced
 * five strobes and two blackouts, and past the second one the room has said the only thing a
 * flash says. Spent once, on the biggest moment that can hold it, it is the loudest thing in the
 * show again.
 */
function planHits(
	analysis: TrackAnalysis,
	slots: Slot[],
	profile: GenreProfile,
	allowance: number,
	peakTreatment: GenreProfile['peak'] = profile.peak
): Hit[] {
	/**
	 * The aggression override, per slot: a bloom-family drop that measurably pounds takes
	 * slam treatment for its punctuation, exactly as the peak already did. The peak's
	 * version fixed Galantis; a listening note then missed the strobe on the FIRST drop of
	 * a house track whose every drop is four-on-the-floor - same evidence, same answer,
	 * light the record that is playing. Swell families stay swells everywhere.
	 */
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
	// safe while its fast movement runs the same gesture at 9.2, past the 8 Hz ceiling.
	const perBeatAt = (bar: number) => strobePerBeat({ bpm: bpmAt(tempo, bar) });

	// Every gesture below is counted in whole bars, so each one starts on a downbeat and ends on
	// one. Anything shorter came back mid-bar, and a room that comes back mid-bar has answered
	// nothing: the phrase it was pointing at has not arrived yet.
	const bars = (n: number) => n * beatsPerBar;
	// Two bars of clearance either side, so gestures read as separate events rather than one
	// smear, and so nothing is planned where a bigger card will mask it.
	const clear = (from: number, to: number) =>
		!hits.some((h) => from - 2 < h.bar + h.beats / beatsPerBar && h.bar < to + 2);
	// A strobe is lit for exactly as long as it is held, so its length is capped in seconds as
	// well as in bars. Whole bars only, and none at all where one bar already runs too long:
	// a tempo that cannot fit a bar of strobe inside the cap should not be strobing.
	// Measured over the span the hit will OCCUPY, using the same function the linter checks it
	// with. Sizing it against one bar and placing it at another is how a show came back failing
	// its own linter on a track whose tempo drifts by a per cent, and a rejected show is a dark
	// room rather than a slightly long strobe.
	const strobeBars = (endBar: number, want: number) => {
		const cap = HIT_RULES.strobe.maxSeconds ?? Infinity;
		let bars = Math.min(want, HIT_RULES.strobe.maxBars);
		while (bars > 0 && hitSeconds(tempo, endBar - bars, 0, bars * beatsPerBar) > cap) bars--;
		return bars;
	};
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
	/**
	 * Strobes and blackouts share one allowance for the whole show, scaled by genre and by
	 * how hard the track actually goes: a techno night earns several, a ballad none.
	 *
	 * Counted together because they are the same gesture from the audience's side: the room
	 * stops being a room and becomes an event. Whatever the budget, each one still needs a
	 * moment big enough to hold it - the allowance is a ceiling, never a quota.
	 */
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

	// The button: a track that ends cold inside loud material gets its last downbeat
	// marked - hold the look, hit the final bar, and the show is OVER rather than merely
	// out of bars. Theatre practice, and the judged word for its absence was "no outro".
	// Only for cold endings: a carved outro or a quiet tail is a release already, and a
	// button on top of a decay is a hit after the band has left. Placed BEFORE the
	// flashes and the phrase punctuation, because everything later yields through its own
	// clear() - placed last, a routine phrase bump two bars out suppressed the one hit
	// the ending exists for. Kit honesty as everywhere, and anthem honesty too: a chorus
	// that arrives by lift ends by lift, so only slam treatments slam the button.
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

	// The peak first, then by how loud the passage is, so the flashes land on the biggest
	// moments that can hold them rather than on whichever drop happens to come first.
	// Ordering by bar instead put it on the opening drop of a track whose third one was
	// the point.
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

		// Strobe first, because it is the bigger of the two - except where the genre marks its
		// peaks with light rather than with flash, where a strobe into a chorus is a rig
		// malfunction however well placed. Those families keep the held-breath blackout only -
		// unless the peak itself pounds hard enough to have earned the slam treatment, which
		// brings the strobe into IT with it.
		const room = before.endBar - before.bar - 1;
		const runFor = strobeBars(slot.bar, Math.min(slot.peak ? 2 : 1, room));
		// The bar it actually starts on, which on a track that changes tempo is the only bar
		// whose beat length says what this will look like in the room.
		const perBeat = perBeatAt(slot.bar - runFor);
		if (perBeat > 0 && runFor > 0 && treatFor(slot) === 'slam') {
			spendFlash({
				bar: slot.bar - runFor,
				kind: 'strobe',
				beats: bars(runFor),
				params: { perBeat },
				note: slot.peak ? 'strobing into the one that matters' : 'strobing out of the build'
			});
			continue;
		}

		// The held breath: black ending exactly ON the drop downbeat, and only as many beats of
		// it as read as a breath rather than as a fault. The fallback rather than the partner -
		// at a tempo too slow to strobe inside the cap, silence is the gesture still available -
		// and it wants a build behind it, because holding a breath needs something to hold it
		// out of.
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

	// The peak section keeps hitting. One slam on the arrival and thirty seconds of steady
	// wash is how the biggest passage of the night ends up reading SMALLER than an ordinary
	// drop; every other phrase inside it lands another, where the floor is actually kicking.
	// Slams are free of the flash budget, capped so the peak punctuates without turning into
	// a drum machine, and placed before the colour floods so the spacing rule yields to them.
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

	// Inside the loud passages, on the phrase. A drop that slams once on its downbeat and then
	// runs eight bars of steady wash is the definition of a show going flat: the genre
	// punctuates all the way through, and the genre also says how often - a techno floor is
	// answered every phrase, a ballad never.
	//
	// Colour only. This used to alternate a flood with a strobe, which is where most of a show's
	// strobes came from: three or four of them inside the drops, none of which was the one the
	// build had been pointing at. A flood is the same size of gesture reached without spending
	// the card the whole show is saving.
	let phraseIndex = 0;
	for (const slot of slots) {
		if (profile.bumpEvery === 0) break;
		const kind = sectionBase(slot.section);
		if (kind !== 'drop' && kind !== 'groove') continue;
		if (slot.bar < SETTLE_BARS) continue;
		if (slot.energy < 0.55) continue;
		// Energy is normalised within the track, so a ballad's loudest passage reads as high as
		// a techno drop's. Kick density is not: four to the floor is about one a beat and a
		// ballad is a quarter of that, which is the difference between a room that should be
		// strobing and one that should not.
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

	// A cymbal crash is a hit the arrangement already contains, and the analyser has been
	// tagging them all along with nothing reading the tag. Outside a drop downbeat, which has a
	// slam of its own, one is worth a bump: it is the one moment the room can answer something
	// the track did rather than something the grid predicted.
	//
	// Budgeted, because crashes are tagged on ~6% of all bars and answering every clear one
	// put eight bumps on a four-minute rap track: the one moment the room answers the track
	// became the thing the room always does. The loudest few, spaced at least two phrases
	// apart, scaled by how densely the genre already punctuates.
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
	const trust = gridTrust(analysis);
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
