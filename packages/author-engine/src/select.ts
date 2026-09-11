import type { EffectDef, LayerRole, SectionKind } from '@mv/core';
import { Rng, sectionBase } from '@mv/core';

interface PickRequest {
	role: LayerRole;
	section: SectionKind;
	lengthBars: number;
	/** 0..1. Decides which energy band of the catalog is in range. */
	energy: number;
	/** Draw one energy band harder when measured kick activity outstrips normalized loudness. */
	pounding?: boolean;
	/** Allow an effect its author reserved for one moment per show. */
	allowPeakReserved?: boolean;
	/** This layer has to hold the room by itself, so anything that cannot is ineligible. */
	mustCarry?: boolean;
	/** The layer must show the music with little else running. */
	bare?: boolean;
	/** A continuous spectral voice that can react while the kit and beat events rest. */
	noteVoice?: boolean;
	/** Prefer individual kick accents over grid motion or ducking when the kit is sparse. */
	kickAccent?: boolean;
	/** SectionSpan.group identity: reuse the opening effect when the material returns. */
	group?: number;
	/**
	 * Preferred effects, weighted within the eligible pool without overriding a large energy
	 * mismatch.
	 */
	prefer?: readonly string[];
	/** Ignore the section filter: the once-per-track wildcard look reaches the whole catalog. */
	anySection?: boolean;
	/** Refuse flash/impact effects for this pick even when the show has a flash budget. */
	noCharacter?: boolean;
	/** Disfavored effects, weighted like prefer but retained as fallbacks. */
	avoid?: readonly string[];
	/** Exclude these effects; a bed may fall back only if nothing else can carry the room. */
	exclude?: readonly string[];
	/** Hits/beat per stream; absent skips the silent-kit veto. */
	drums?: { kick: number; snare: number; hat: number };
	/** Peak picks use the requested band or one below, with half the repeat penalty. */
	peak?: boolean;
	/** Existing summed taste.activity; absent skips the cue activity budget. */
	busy?: number;
}

/**
 * Hits/beat silence threshold, below 0.25 so one kick per bar still counts as a playing
 * stream.
 */
export const KIT_FLOOR = 0.2;

export function kitSilent(e: EffectDef, drums: PickRequest['drums']): boolean {
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
 * Weight quiet responsiveness by rank, since measured magnitudes drift.
 * Cap each rank step at 1.1 so adjacent choices remain within the 1.4 seed jitter.
 */
const QUIET_WEIGHT = 4;

/** Summed activity leaves room for one lead gesture over a carrying bed. */
const ACTIVITY_FLOOR = 0.8;
const ACTIVITY_LOUD_TOP = 1.4;
const ACTIVITY_GROOVE_TOP = 0.9;
/**
 * Breakdowns have a flat low activity budget: loudness must not turn their slow motion into
 * strikes.
 */
const ACTIVITY_BREAKDOWN = 0.5;

export function activityBudget(energy: number, section: SectionKind): number {
	if (section === 'breakdown') return ACTIVITY_BREAKDOWN;
	const base = sectionBase(section);
	const top = base === 'drop' || base === 'build' ? ACTIVITY_LOUD_TOP : ACTIVITY_GROOVE_TOP;
	const u = Math.max(0, Math.min(1, (energy - 0.3) / 0.45));
	return ACTIVITY_FLOOR + (top - ACTIVITY_FLOOR) * u;
}

interface PickerOptions {
	/** Hard-veto flash/impact effects when the family's flash allowance is zero. */
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

		const fits = (e: EffectDef, exclusive = true): boolean => {
			if (e.role !== req.role) return false;
			if (exclusive && req.exclude?.includes(e.id)) return false;
			if ((this.vetoCharacter || req.noCharacter) && e.taste.character) return false;
			if (req.mustCarry && e.taste.carries === false) return false;
			if (req.noteVoice && !e.taste.noteReactive) return false;
			if (kitSilent(e, req.drums)) return false;
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
		let eligible = this.effects.filter((e) => fits(e));
		// Only the carrying bed may relax exclusions to avoid an unlit room.
		if (eligible.length === 0 && req.role === 'bed') {
			eligible = this.effects.filter((e) => fits(e, false));
		}
		if (eligible.length === 0) return null;

		// The activity budget: what the cue already holds decides how hard this layer may hit.
		// Ahead of the peak's band floor on purpose: the top-band accents are all strikers,
		// and a peak already striking twice under its master gets a calm one.
		if (room < Infinity) {
			const calm = eligible.filter(withinBudget);
			if (calm.length > 0) eligible = calm;
			else if (req.role === 'bed') {
				const least = Math.min(...eligible.map((e) => e.taste.activity ?? 0));
				eligible = eligible.filter((e) => (e.taste.activity ?? 0) === least);
			} else return null;
		}

		// Novelty cannot drain the main rhythm of a pounding chorus later in a long show.
		// Fall back only within the already safe instrument, character and activity pool.
		const drivingRhythm = req.pounding && req.role === 'rhythm' && sectionBase(req.section) === 'drop';
		if (req.peak || drivingRhythm) {
			const strong = eligible.filter((e) => e.taste.energy >= target - 1);
			if (strong.length > 0) eligible = strong;
		}
		if (drivingRhythm) {
			const kit = eligible.filter((e) => e.taste.kit === 'kick' || e.taste.kit === 'any');
			if (kit.length > 0) eligible = kit;
		}
		const groupKey = req.group !== undefined && req.group >= 0 ? `${req.role}:${req.group}` : null;
		if (groupKey) {
			const held = this.byGroup.get(groupKey);
			const def = held ? eligible.find((e) => e.id === held) : undefined;
			if (def && withinBudget(def)) {
				this.used.set(def.id, (this.used.get(def.id) ?? 0) + 1);
				this.lastInRole.set(req.role, def.id);
				return def;
			}
		}

		// Rank preserves quiet-response ordering despite stale magnitudes; capped steps keep
		// neighboring choices viable.
		const quietRank = new Map<string, number>();
		let quietStep = 0;
		if (req.bare) {
			const values = [...new Set(eligible.map((e) => e.taste.quiet ?? 0))].sort((a, b) => a - b);
			// Equal measurements, including an unmeasured pool, must not acquire a catalog-order bonus.
			for (const e of eligible) quietRank.set(e.id, values.indexOf(e.taste.quiet ?? 0));
			quietStep = Math.min(1.1, QUIET_WEIGHT / Math.max(1, values.length - 1));
		}

		// In loud passages, underpowered effects cost more than repeats of the right energy band.
		const loud = sectionBase(req.section) === 'drop';
		const scored = eligible.map((e) => {
			// Two bands out is a different kind of moment, not a slightly wrong one.
			const above = Math.max(0, e.taste.energy - target);
			const below = Math.max(0, target - e.taste.energy);
			const seen = this.used.get(e.id) ?? 0;
			// Long shows may repeat fitting chorus vocabulary before crossing genre boundaries.
			const novelty = drivingRhythm ? Math.min(1, seen) : seen;
			const score =
				-1.6 * above -
				(loud ? 2.6 : 1.6) * below -
				// The peak may reach for its best look again: a repeat there costs half.
				(req.peak ? 1.1 : 2.2) * novelty -
				(e.id === previous ? 6 : 0) +
				// A tie-breaker, deliberately under one energy band and half a use of novelty.
				// At 3 it was a mandate: within a family, every show reached for the same
				// signatures and two-thirds of any two shows' vocabularies were identical.
				(req.prefer?.includes(e.id) ? 1.1 : 0) -
				// The foreign-gesture penalty exceeds a loud-band mismatch plus jitter, while retaining a
				// fallback.
				(req.avoid?.includes(e.id) ? 4.4 : 0) +
				(req.kickAccent && e.taste.kickAccent ? 3.2 : 0) +
				// Only where it is the whole show. In a groove or a drop there is a kit, a
				// transient layer and a master doing the reacting, and a bed that fights them is
				// noise rather than information.
				(req.bare ? quietStep * (quietRank.get(e.id) ?? 0) : 0) +
				// Jitter varies near-equal choices but stays below one energy-band penalty.
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

	/** Choose the strongest eligible effect, breaking top-band ties with the track seed. */
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

		// No signature bonus for peak masters: seed jitter alone prevents one genre favorite owning
		// every climax.
		const scored = eligible.map((e) => ({
			def: e,
			score: e.taste.energy + this.rng.float() * 0.9
		}));
		scored.sort((a, b) => b.score - a.score || a.def.id.localeCompare(b.def.id));
		return scored[0].def;
	}
}
