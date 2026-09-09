import type { EffectDef, LayerRole, SectionKind } from '@mv/core';
import { Rng, sectionBase } from '@mv/core';

export interface PickRequest {
	role: LayerRole;
	section: SectionKind;
	lengthBars: number;
	/** 0..1. Decides which energy band of the catalog is in range. */
	energy: number;
	/**
	 * This passage measurably pounds, so it draws one band harder than its loudness alone
	 * would ask for.
	 *
	 * The band otherwise comes from mean energy, and a heavily limited master has almost no
	 * energy range to give: a record that is four-on-the-floor from its first bar reads as
	 * mid-energy throughout and gets mid-energy looks, which the room hears as the rig being
	 * too polite for the track. The caller decides what pounding means; it is the same
	 * measurement that upgrades the punctuation to slams.
	 */
	pounding?: boolean;
	/** Allow an effect its author reserved for one moment per show. */
	allowPeakReserved?: boolean;
	/** This layer has to hold the room by itself, so anything that cannot is ineligible. */
	mustCarry?: boolean;
	/**
	 * True where there is nothing else happening, so what the layer shows of the music is most of
	 * what the room shows at all.
	 */
	bare?: boolean;
	/**
	 * Repeat identity of the passage being lit, from `SectionSpan.group`.
	 *
	 * A second chorus that looks nothing like the first says the room is not listening. Given
	 * one, the same effect that opened the group is returned, which is what makes a show read
	 * as having a structure rather than a sequence.
	 */
	group?: number;
	/**
	 * The genre's signature effects, favoured wherever they are legal. A weight comparable
	 * to the quiet preference, so a signature wins the coin tosses without ever emptying a
	 * pool or overriding an energy mismatch of more than a band.
	 */
	prefer?: readonly string[];
	/** Ignore the section filter: the once-per-track wildcard look reaches the whole catalog. */
	anySection?: boolean;
	/**
	 * Refuse flash/impact-character effects for this pick alone, whatever the show's budget.
	 *
	 * The wildcard's freedom is FROM the section vocabulary, not from the gesture rules: a
	 * strobe planted as the one surprise in a rap verse is how "surprise" reads as fault.
	 */
	noCharacter?: boolean;
	/**
	 * Effects that are not this family's vocabulary, dispreferred by a weight in the same
	 * band as `prefer`. Never a filter: a pool of avoided effects still lights the room,
	 * and the mismatch costs less than a dead layer would.
	 */
	avoid?: readonly string[];
	/**
	 * Refused outright for this pick, yielding only when nothing else fits at all. The
	 * hard form of `avoid`, for the one case a weight cannot carry: the undrawn members
	 * of a look-alike family, where the owner's verdict is that a second member in one
	 * show IS the defect and an energy-fit alternative two bands away is still better.
	 */
	exclude?: readonly string[];
	/**
	 * Hits per beat over the slot, per stream. With it, effects declaring `taste.kit` are
	 * refused where their stream is silent: a kick effect in a kickless verse is either a
	 * dead layer or a grid pulse lying about the arrangement. Absent skips the veto.
	 */
	drums?: { kick: number; snare: number; hat: number };
	/**
	 * This cue is inside the peak section.
	 *
	 * The peak draws only from the band it asks for and the one under it, and pays half the
	 * usual price for a repeat. Measured over the corpus, 24 of 65 peaks were lit by a
	 * pixel-scale transient and a third by a rhythm two bands soft, because by the last
	 * statement of the loudest material every top look had been spent once and the novelty
	 * penalty handed the biggest passage of the night to whatever was left.
	 */
	peak?: boolean;
	/**
	 * Frame-scale activity the cue already holds: the sum of `taste.activity` over the layers
	 * picked before this one, and the master where one sits over them. With it, this pick
	 * may only add what `activityBudget` leaves; absent skips the budget.
	 */
	busy?: number;
}

/**
 * Below this many hits per beat the stream is not playing, whatever else the bar holds.
 *
 * A shade under the 0.25 the breakdown transient gate uses, because that one asks "is there
 * enough kit to answer" and this one asks "is the stream absent" - a sparse half-time kick
 * at one hit per bar (0.25/beat) is still a kick pattern and must keep its effects.
 */
const KIT_FLOOR = 0.2;

function kitSilent(e: EffectDef, drums: PickRequest['drums']): boolean {
	const kit = e.taste.kit;
	if (!kit || !drums) return false;
	const density =
		kit === 'kick'
			? drums.kick
			: kit === 'snare'
				? drums.snare
				: kit === 'hat'
					? drums.hat
					: Math.max(drums.kick, drums.snare);
	return density < KIT_FLOOR;
}

/**
 * Chooses effects so the show does not repeat itself.
 *
 * The taste metadata on each effect is a hard filter, not a preference: it already says which
 * sections an effect belongs in and how long it can hold the room, and the linter rejects a
 * show that ignores it. What is left to decide is which of the survivors, and that is where a
 * show gets its character - so the score is mostly about what has not been used yet.
 */
/**
 * How hard a quiet cue leans toward the layers that actually show the music.
 *
 * A preference, never a filter. The carrying pool for a quiet section is seven beds and three
 * accents, and a threshold on top of that empties it - which is the mistake this project already
 * made once by requiring `carries` of an accent. Weighting instead keeps every option reachable
 * and simply makes the spectrum-led ones win the coin tosses.
 *
 * Spent as a rank inside the eligible pool rather than against an absolute scale: only the
 * ORDER of `taste.quiet` is trusted, because the stored magnitudes go stale every time the
 * quiet pool or the house floor changes and the ordering mostly survives that. This is the
 * span of the whole ladder; the per-step gap is capped at 1.1 in `pick` so neighbouring
 * candidates stay a coin toss (jitter 1.4) while the ends stay decisive. Swept as the
 * absolute weight: at 2 nothing changed hands, at 4 intro drift went 1.76 to 4.37
 * corpus-wide, at 6 it reached 4.75 and started spending variety for it.
 */
const QUIET_WEIGHT = 4;

/**
 * How much frame-scale activity one cue may hold, summed over its layers' `taste.activity`.
 *
 * One hard hitter, and only where the music has arrived. A whole-room striker rates 1, so at
 * 1.4 a drop-class cue (or a build, which climbs into one) holds one of those and a moving
 * rhythm, or two partial strikers (a wall per beat, a wave per kick), and the accent then
 * holds or blooms. A groove or a verse tops out at 0.9: no whole-room striker at all, one
 * partial one over a moving look, which is what a designer runs under a verse so that the
 * chorus has somewhere to go. Scaled by the cue's energy from the floor at 0.3 to the top
 * at 0.75, where the band ladder reaches the loud looks anyway. A breakdown has its own
 * flat budget below.
 *
 * The owner's fallback if one hitter reads too polite: ACTIVITY_LOUD_TOP 2.4 lets two
 * whole-room strikers share a loud cue, never three; ACTIVITY_GROOVE_TOP 1.4 lets a groove
 * take one. A filter with a fallback rather than a price, because a price loses to novelty
 * by the third loud cue the way the peak band's did; where the budget would empty a pool the
 * calmest candidates stay, never the whole pool.
 */
const ACTIVITY_FLOOR = 0.8;
const ACTIVITY_LOUD_TOP = 1.4;
const ACTIVITY_GROOVE_TOP = 0.9;
/**
 * A breakdown holds half of what a groove may: a slow look over the bed and a soft kit
 * answer where the kit still plays, never a striker. Flat rather than scaled by energy,
 * because how hard the room may move in a breakdown is a decision about what a breakdown
 * is, not about how loud this one happens to be.
 */
const ACTIVITY_BREAKDOWN = 0.5;

export function activityBudget(energy: number, section: SectionKind): number {
	if (section === 'breakdown') return ACTIVITY_BREAKDOWN;
	const base = sectionBase(section);
	const top = base === 'drop' || base === 'build' ? ACTIVITY_LOUD_TOP : ACTIVITY_GROOVE_TOP;
	const u = Math.max(0, Math.min(1, (energy - 0.3) / 0.45));
	return ACTIVITY_FLOOR + (top - ACTIVITY_FLOOR) * u;
}

export interface PickerOptions {
	/**
	 * Refuse every effect that declares a `character`, however it scores.
	 *
	 * Set where the track's flash allowance is zero: the families that forbid the strobe as a
	 * hit forbid it as an effect too, or an rnb night is "no flashes" in the punctuation and
	 * blinder slams in every accent. A filter rather than a weight, unlike everything else in
	 * here, because the gesture is forbidden rather than dispreferred - and it can only empty
	 * a pool down to the effects that are not flashes, which is a pool worth having.
	 */
	vetoCharacter?: boolean;
}

export class EffectPicker {
	private readonly effects: readonly EffectDef[];
	private readonly used = new Map<string, number>();
	private readonly lastInRole = new Map<LayerRole, string>();
	private readonly byGroup = new Map<string, string>();
	private readonly rng: Rng;
	private readonly vetoCharacter: boolean;

	constructor(effects: readonly EffectDef[], rng: Rng, opts: PickerOptions = {}) {
		this.effects = effects;
		this.rng = rng;
		this.vetoCharacter = opts.vetoCharacter ?? false;
	}

	/** Marks an effect as spent without picking it, for one chosen ahead of time. */
	reserve(id: string): void {
		this.used.set(id, (this.used.get(id) ?? 0) + 1);
	}

	pick(req: PickRequest): EffectDef | null {
		const band = 1 + Math.round(Math.max(0, Math.min(1, req.energy)) * 4);
		const target = Math.min(5, band + (req.pounding ? 1 : 0));
		const previous = this.lastInRole.get(req.role);
		const room = req.busy === undefined ? Infinity : activityBudget(req.energy, req.section) - req.busy;
		const withinBudget = (e: EffectDef) => (e.taste.activity ?? 0) <= room + 1e-9;

		const groupKey = req.group !== undefined && req.group >= 0 ? `${req.role}:${req.group}` : null;
		if (groupKey) {
			const held = this.byGroup.get(groupKey);
			const def = held ? this.effects.find((e) => e.id === held) : undefined;
			// Only when it still fits: a reprise that runs half as long as the original cannot
			// hold an effect that wanted the full length - and a reprise whose kit has left
			// cannot hold the kit effect the full version opened with.
			if (
				def &&
				req.lengthBars >= def.taste.minBars &&
				req.lengthBars <= def.taste.maxBars &&
				!kitSilent(def, req.drums) &&
				withinBudget(def)
			) {
				this.used.set(def.id, (this.used.get(def.id) ?? 0) + 1);
				this.lastInRole.set(req.role, def.id);
				return def;
			}
		}

		const fits = (e: EffectDef, kitAware: boolean, exclusive = true): boolean => {
			if (e.role !== req.role) return false;
			if (exclusive && req.exclude?.includes(e.id)) return false;
			if ((this.vetoCharacter || req.noCharacter) && e.taste.character) return false;
			if (req.mustCarry && e.taste.carries === false) return false;
			if (kitAware && kitSilent(e, req.drums)) return false;
			// Either vocabulary: an effect written for choruses says 'chorus'; the rest of the
			// catalog speaks the club kinds and serves a chorus as the drop-class passage it is.
			if (
				!req.anySection &&
				!e.taste.sections.includes(req.section) &&
				!e.taste.sections.includes(sectionBase(req.section))
			) {
				return false;
			}
			if (req.lengthBars < e.taste.minBars || req.lengthBars > e.taste.maxBars) return false;
			if (e.taste.peakReserved) {
				if (!req.allowPeakReserved) return false;
				if ((this.used.get(e.id) ?? 0) > 0) return false;
			}
			return true;
		};
		// The kit veto yields before it empties a pool: a role whose every candidate answers
		// the kit is better served by the least-wrong of them than by nothing, the same lesson
		// `carries` taught as a hard requirement.
		let eligible = this.effects.filter((e) => fits(e, true));
		if (eligible.length === 0) eligible = this.effects.filter((e) => fits(e, false));
		// The exclusion yields last: a cue with literally nothing else is lit by the
		// excluded thing rather than by darkness.
		if (eligible.length === 0) eligible = this.effects.filter((e) => fits(e, false, false));
		if (eligible.length === 0) return null;

		// The activity budget: what the cue already holds decides how hard this layer may hit.
		// Ahead of the peak's band floor on purpose: the top-band accents are all strikers,
		// and a peak already striking twice under its master gets a calm one.
		if (room < Infinity) {
			const calm = eligible.filter(withinBudget);
			if (calm.length > 0) eligible = calm;
			else {
				const least = Math.min(...eligible.map((e) => e.taste.activity ?? 0));
				eligible = eligible.filter((e) => (e.taste.activity ?? 0) === least);
			}
		}

		// The peak keeps to the top of the catalog. A filter with a fallback rather than a
		// price: the price was 2.6 a band and it still lost to novelty by the third loud cue.
		if (req.peak) {
			const strong = eligible.filter((e) => e.taste.energy >= target - 1);
			if (strong.length > 0) eligible = strong;
		}

		// The quiet preference as a rank within THIS pool, not a position on an absolute
		// scale. The absolute map had two failure modes the shows actually exhibited: a
		// probe outlier saturated the whole bonus and won its section in 98% of seeds, and
		// any two candidates more than the jitter apart stopped being a choice at all. Rank
		// keeps the ordering - which survives a stale probe far better than the magnitudes
		// do - and the step is capped so adjacent candidates stay inside the seed's reach.
		const quietRank = new Map<string, number>();
		let quietStep = 0;
		if (req.bare) {
			const ranked = [...eligible].sort((a, b) => (a.taste.quiet ?? 0) - (b.taste.quiet ?? 0));
			ranked.forEach((e, i) => quietRank.set(e.id, i));
			quietStep = Math.min(1.1, QUIET_WEIGHT / Math.max(1, eligible.length - 1));
		}

		// In a drop-class passage an effect a band too quiet costs more than a repeat of the
		// right one. At one price for both directions, the third loud cue of a track has spent
		// every top-band look once and the novelty penalty hands the final chorus to a chest
		// pulse and a confetti pop: Panama's last chorus, "these effects carry NO energy". A
		// look that is too big for a quiet passage stays at the old price - that mismatch reads
		// as over-lighting, and the room has never asked for more of it.
		const loud = sectionBase(req.section) === 'drop';
		const scored = eligible.map((e) => {
			// Two bands out is a different kind of moment, not a slightly wrong one.
			const above = Math.max(0, e.taste.energy - target);
			const below = Math.max(0, target - e.taste.energy);
			const seen = this.used.get(e.id) ?? 0;
			const score =
				-1.6 * above -
				(loud ? 2.6 : 1.6) * below -
				// The peak may reach for its best look again: a repeat there costs half.
				(req.peak ? 1.1 : 2.2) * seen -
				(e.id === previous ? 6 : 0) +
				// A tie-breaker, deliberately under one energy band and half a use of novelty.
				// At 3 it was a mandate: within a family, every show reached for the same
				// signatures and two-thirds of any two shows' vocabularies were identical.
				(req.prefer?.includes(e.id) ? 1.1 : 0) -
				// A foreign gesture costs two uses of novelty. It has to clear the loud-passage
				// band price above plus the jitter, or the steeper price hands the last chorus of
				// a rap track to moshSlam the moment the native top band has been used once - at
				// 2.4 it did exactly that. Still no filter: an avoided effect stays reachable when
				// the natives are spent twice over or three bands wrong.
				(req.avoid?.includes(e.id) ? 4.4 : 0) +
				// Only where it is the whole show. In a groove or a drop there is a kit, a
				// transient layer and a master doing the reacting, and a bed that fights them is
				// noise rather than information.
				(req.bare ? quietStep * (quietRank.get(e.id) ?? 0) : 0) +
				// Jitter wide enough that the seed genuinely chooses among near-equals - at 0.9
				// the first choice for a role at a given energy was close to deterministic, so
				// same-family shows opened on the same bed night after night - and still under
				// one energy band, so the fit keeps the last word.
				this.rng.float() * 1.4;
			return { def: e, score };
		});

		scored.sort((a, b) => b.score - a.score || a.def.id.localeCompare(b.def.id));
		const chosen = scored[0].def;
		this.used.set(chosen.id, (this.used.get(chosen.id) ?? 0) + 1);
		this.lastInRole.set(req.role, chosen.id);
		if (groupKey) this.byGroup.set(groupKey, chosen.id);
		return chosen;
	}

	/**
	 * The strongest thing in the catalog that a given section can legally hold.
	 *
	 * The top of the catalog is a tie by construction: several effects are written to be the
	 * biggest thing in the room, which is the point of them. Breaking that tie alphabetically
	 * meant `chromaBurst` opened the peak of 68% of shows, so a corpus of nineteen tracks had
	 * four distinct biggest moments between them. The seed is the track's own hash, so the
	 * choice is still the same every time for the same track.
	 */
	strongest(
		role: LayerRole,
		section: SectionKind,
		lengthBars: number,
		peak: 'slam' | 'bloom' = 'slam'
	): EffectDef | null {
		const eligible = this.effects.filter(
			(e) =>
				e.role === role &&
				// A hit performer renders black until the player arms it, so reserved here it is
				// either a duplicate of the drop-opener hit or a no-op on the biggest moment.
				!e.taste.hitOnly &&
				// A bloom family's peak arrives as light, not as interruption: a shutter or a
				// strobe winning it is the rig malfunction the profile exists to prevent.
				!(peak === 'bloom' && e.taste.character === 'flash') &&
				// And a master that declares a peak style serves only that treatment: the draw
				// is a seed-broken tie, and without this a bloom look lands on a rap climax
				// the moment any new master reshuffles the ties.
				!(e.taste.peakStyle && e.taste.peakStyle !== peak) &&
				!(this.vetoCharacter && e.taste.character) &&
				(e.taste.sections.includes(section) ||
					e.taste.sections.includes(sectionBase(section))) &&
				lengthBars >= e.taste.minBars &&
				lengthBars <= e.taste.maxBars &&
				(this.used.get(e.id) ?? 0) === 0
		);
		if (eligible.length === 0) return null;

		// No signature bonus here, and that is a lesson rather than an omission: at +0.7
		// against 0.9 of seed jitter, one master won the peak of nearly every show in its
		// family - blinderWall opened eight of eleven rock tracks - and the peak is exactly
		// the moment that must never become the expected thing. The seed alone decides
		// among the several effects written to be the biggest thing in the room.
		const scored = eligible.map((e) => ({
			def: e,
			score: e.taste.energy + this.rng.float() * 0.9
		}));
		scored.sort((a, b) => b.score - a.score || a.def.id.localeCompare(b.def.id));
		return scored[0].def;
	}
}
