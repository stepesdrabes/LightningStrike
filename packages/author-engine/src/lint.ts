import type { EffectDef, Hit, LayerRole, Show, TrackAnalysis, TrackContext } from '@mv/core';
import { allowedFlashes } from './genre.ts';
import { peakSection as enginePeakSection } from './plan.ts';
import { activityBudget } from './select.ts';
import {
	HIT_RULES,
	LAYER_ROLES,
	PHRASE_BARS,
	STROBE_MAX_HZ,
	bpmAt,
	hitSeconds,
	onPhraseGrid,
	phraseOffset,
	sectionBase,
	strobePerBeat
} from '@mv/core';

export type Severity = 'error' | 'warning';

export interface Finding {
	severity: Severity;
	rule: string;
	message: string;
	/** Bar the finding attaches to, when it has one. */
	bar?: number;
}

export interface LintResult {
	ok: boolean;
	errors: Finding[];
	warnings: Finding[];
}

export interface LintContext {
	analysis: TrackAnalysis;
	/** Built-ins plus anything the show generated. */
	effects: Map<string, EffectDef>;
	/** What the track is; decides the flash allowance. Absent falls back to one flash. */
	context?: TrackContext | null;
}

/**
 * There is deliberately no minimum gap between strobes and no safety limiter here. A room this
 * size is one person's, the strobe is half the point of the genre, and a linter that refuses
 * the biggest card in the deck is a linter people route around. Anyone fitting this in a public
 * space owns that decision, and these rules are the only thing between a show and the room:
 * there is no limiter downstream of them.
 *
 * How LONG a gesture holds the room is capped in `HIT_RULES`, and how FAST it flashes in
 * `strobePerBeat`. Both are taste rather than safety: a strobe that outlasts the phrase it
 * points at has stopped being punctuation, and one past ~6 Hz has fused into a texture -
 * heard in the room as "the strobe is just noise now", not as a longer list of events.
 */
const SETTLE_BARS = 16;
/**
 * How long a void may hold the room before it stops reading as a held breath.
 *
 * Shared with `measureShow`, which excuses a cue-declared void from its dark-bar report up to
 * exactly this length. Two instruments complaining about one passage taught the author that the
 * strongest move in the vocabulary was a fault; past this, one of them still should.
 */
export const MAX_VOID_BARS = 2;
/** Distinct hues across the whole show, not at once. See the colour section below. */
const MAX_HUES = 6;
const MAX_BRIEF_CHARS = 1100;
const MAX_NOTE_CHARS = 90;
const MIN_GENERATED_EFFECTS = 2;

export function lintShow(show: Show, ctx: LintContext): LintResult {
	const findings: Finding[] = [];
	const err = (rule: string, message: string, bar?: number) =>
		findings.push({ severity: 'error', rule, message, bar });
	const warn = (rule: string, message: string, bar?: number) =>
		findings.push({ severity: 'warning', rule, message, bar });

	const { analysis, effects } = ctx;
	const lastBar = analysis.bars.length - 1;
	const tempo = analysis.tempo;
	const cues = [...show.cues].sort((a, b) => a.bar - b.bar);

	if (show.analysisHash !== analysis.hash) {
		err(
			'stale-analysis',
			`show pins analysisHash ${show.analysisHash} but the analysis is ${analysis.hash}`
		);
	}

	if (cues.length === 0) {
		err('no-cues', 'a show needs at least one cue');
		return split(findings);
	}

	// --- grid ---------------------------------------------------------------------------

	if (cues[0].bar !== 0) {
		warn('opening-cue', `first cue is at bar ${cues[0].bar}; bars 0-${cues[0].bar - 1} are dark`);
	}

	const seen = new Set<number>();
	for (const cue of cues) {
		if (!Number.isInteger(cue.bar) || cue.bar < 0 || cue.bar > lastBar) {
			err('bar-out-of-grid', `bar ${cue.bar} is not in the analysed grid (0-${lastBar})`, cue.bar);
		}
		if (seen.has(cue.bar)) err('duplicate-bar', `two cues share bar ${cue.bar}`, cue.bar);
		seen.add(cue.bar);
		if (!cue.note?.trim()) {
			warn('undocumented-cue', `cue at bar ${cue.bar} has no note explaining it`, cue.bar);
		}
	}

	// Structural changes land on a phrase multiple. Off-phrase cues read as wrong even when
	// the audience cannot say why.
	//
	// A void is the exception, and necessarily so: it is phrase-TERMINAL, occupying the last
	// bar or two before a drop, so its start is never on a phrase multiple. What has to be
	// on-grid is where it ends, which is the drop cue that follows it.
	//
	// A bar the analyser named as a section start is the other exception, and the rule is about
	// invention rather than about the grid: music does move off a four-bar phrase, after an
	// inserted break or a bar of 2/4, and a global anchor cannot follow it. Dragging those
	// boundaries onto the grid anyway cost 1.7 points of boundary F0.5 across 374 annotated
	// tracks. What this still forbids is a cue placed off-phrase where nothing changed.
	// A bar is on the phrase grid when it sits on a 4-bar multiple counted from ITS OWN
	// section's start. Phrases count from the drop, not from bar 0: a track that inserts an
	// odd passage shifts its phase mid-song, and the global anchor then disagrees with what
	// everyone in the room is counting. The global grid is still accepted, for cues placed
	// against the anchor on tracks where the two agree.
	const measured = new Set(analysis.sections.map((s) => s.startBar));
	const sectionStartOf = (bar: number): number => {
		for (const s of analysis.sections) if (bar >= s.startBar && bar < s.endBar) return s.startBar;
		return 0;
	};
	const onPhrase = (bar: number) =>
		onPhraseGrid(bar, tempo.phraseAnchorBar) ||
		measured.has(bar) ||
		(bar - sectionStartOf(bar)) % PHRASE_BARS === 0;

	for (let i = 1; i < cues.length; i++) {
		const cue = cues[i];
		if (cue.section === cues[i - 1].section) continue;

		if (cue.section === 'void') {
			const next = cues[i + 1];
			if (next && !onPhrase(next.bar)) {
				err(
					'off-phrase-change',
					`the void at bar ${cue.bar} resolves at bar ${next.bar}, which is off the ${PHRASE_BARS}-bar grid`,
					next.bar
				);
			}
			// Only when something follows it. A track that ends in silence ends in a void, and
			// that is the track ending rather than a held breath that outstayed its welcome.
			const lengthBars = (next ? next.bar : lastBar + 1) - cue.bar;
			if (next && lengthBars > MAX_VOID_BARS) {
				warn(
					'void-too-long',
					`the void at bar ${cue.bar} runs ${lengthBars} bars; past ${MAX_VOID_BARS} it stops reading as a held breath`,
					cue.bar
				);
			}
			continue;
		}

		if (!onPhrase(cue.bar)) {
			const down = cue.bar - phraseOffset(cue.bar, tempo.phraseAnchorBar);
			err(
				'off-phrase-change',
				`section change to ${cue.section} at bar ${cue.bar} is off the ${PHRASE_BARS}-bar grid; use ${down} or ${down + PHRASE_BARS}`,
				cue.bar
			);
		}
	}

	// --- effects ------------------------------------------------------------------------

	const peakUses = new Map<string, number[]>();
	const stacks: string[] = [];

	const cueEnd = (i: number) => (i + 1 < cues.length ? cues[i + 1].bar : lastBar + 1);

	/**
	 * How long an effect actually runs, across cue boundaries.
	 *
	 * The mixer keeps an effect instance while the id in a role does not change, so two
	 * consecutive cues naming the same bed are one continuous run and not two short ones.
	 * `minBars` asks whether a look gets long enough to read, which is a question about the run
	 * rather than about where an author happened to split it - and the peak's burst cue is a bar
	 * precisely so the master is not held longer, with the section's own look carried underneath.
	 * Measured per cue, that reported every layer under a burst as starved.
	 */
	const runBars = (i: number, role: LayerRole, id: string): number => {
		let from = i;
		while (from > 0 && cues[from - 1].layers[role]?.effect === id) from--;
		let to = i;
		while (to + 1 < cues.length && cues[to + 1].layers[role]?.effect === id) to++;
		return cueEnd(to) - cues[from].bar;
	};

	// One hit layer over a stable base. The engine spends `activityBudget` while it picks;
	// an authored show is held to the same sum, without its master, which is a moment rather
	// than a look. The cues the owner heard as "everything is flickering" were three layers
	// striking on the same kick, each defensible alone. The slack is what the engine's own
	// fallback may add: a pool with nothing under budget still lights its calmest member.
	const SLACK = 0.3;
	for (const cue of cues) {
		const span = analysis.sections.find((s) => cue.bar >= s.startBar && cue.bar < s.endBar);
		const budget = activityBudget((span?.meanEnergy ?? 70) / 100, cue.section);
		let busy = 0;
		const strikers: string[] = [];
		for (const role of LAYER_ROLES) {
			if (role === 'master') continue;
			const def = cue.layers[role] ? effects.get(cue.layers[role]!.effect) : undefined;
			const activity = def?.taste.activity ?? 0;
			busy += activity;
			if (def && activity >= 0.5) strikers.push(def.id);
		}
		if (busy > budget + SLACK) {
			warn(
				'busy-stack',
				`cue at bar ${cue.bar} stacks ${strikers.join(', ')} (activity ${busy.toFixed(1)} against ${budget.toFixed(1)} for a ${cue.section}); one hit layer over a stable base, or the room flickers`,
				cue.bar
			);
		}
	}

	for (let i = 0; i < cues.length; i++) {
		const cue = cues[i];
		const endBar = cueEnd(i);
		const lengthBars = endBar - cue.bar;
		const parts: string[] = [];

		for (const role of LAYER_ROLES) {
			const spec = cue.layers[role];
			if (!spec) continue;
			parts.push(`${role}:${spec.effect}`);

			const def = effects.get(spec.effect);
			if (!def) {
				const legal = [...effects.values()]
					.filter((e) => e.role === role)
					.map((e) => e.id)
					.join(', ');
				err(
					'unknown-effect',
					`cue at bar ${cue.bar} names unknown effect "${spec.effect}"; ${role} effects available: ${legal}`,
					cue.bar
				);
				continue;
			}
			if (def.role !== role) {
				err(
					'role-mismatch',
					`"${def.id}" is a ${def.role} effect but sits in the ${role} layer at bar ${cue.bar}; move it to "${def.role}"`,
					cue.bar
				);
			}
			// An outro keeps the bed the room was already wearing - the thinning is the
			// gesture, and demanding outro eligibility of it would force the look-change
			// the inheritance exists to prevent. Only the bed, and only when it really is
			// the previous cue's: anything else in an outro still answers for its sections.
			const inheritedOutroBed =
				cue.section === 'outro' &&
				role === 'bed' &&
				i > 0 &&
				cues[i - 1].layers.bed?.effect === spec.effect;
			if (
				!inheritedOutroBed &&
				!def.taste.sections.includes(cue.section) &&
				!def.taste.sections.includes(sectionBase(cue.section))
			) {
				warn(
					'effect-out-of-place',
					`"${def.id}" is not intended for a ${cue.section} (allowed: ${def.taste.sections.join(', ')})`,
					cue.bar
				);
			}
			const heldFor = runBars(i, role, spec.effect);
			if (heldFor < def.taste.minBars) {
				warn(
					'cue-too-short',
					`"${def.id}" wants at least ${def.taste.minBars} bars but gets ${heldFor} at bar ${cue.bar}`,
					cue.bar
				);
			}
			if (lengthBars > def.taste.maxBars) {
				warn(
					'cue-too-long',
					`"${def.id}" outstays its welcome after ${def.taste.maxBars} bars; it runs ${lengthBars} from bar ${cue.bar}`,
					cue.bar
				);
			}
			if (def.taste.peakReserved) {
				const uses = peakUses.get(def.id) ?? [];
				uses.push(cue.bar);
				peakUses.set(def.id, uses);
			}
			for (const key of Object.keys(spec.params ?? {})) {
				if (!def.params.some((p) => p.key === key)) {
					warn('unknown-param', `"${def.id}" has no param "${key}" (bar ${cue.bar})`, cue.bar);
				}
			}
		}

		stacks.push(parts.sort().join(' '));
		if (parts.length === 0) {
			warn('empty-cue', `cue at bar ${cue.bar} lights nothing`, cue.bar);
		}
	}

	for (const [id, bars] of peakUses) {
		if (bars.length > 1) {
			err(
				'peak-effect-reused',
				`"${id}" is reserved for one moment but appears at bars ${bars.join(', ')}`,
				bars[1]
			);
		}
	}

	// Your best trick loses value with every repeat. Except on the way out: an outro's
	// sameness IS the gesture - the look thins and holds - and warning on it pushes an
	// agent toward exactly the look-change the inheritance forbids. A decline step is
	// the same gesture wherever it lives: the record is leaving, the stack holds and
	// only the level falls.
	const level = (i: number) => cues[i].intensity ?? show.defaults.intensity;
	for (let i = 1; i < stacks.length; i++) {
		if (cues[i].section === 'outro' && cues[i - 1].section === 'outro') continue;
		if (cues[i].section === cues[i - 1].section && level(i) < level(i - 1) - 0.01) continue;
		if (stacks[i] && stacks[i] === stacks[i - 1]) {
			warn(
				'repeated-stack',
				`bar ${cues[i].bar} repeats the previous cue's stack exactly; change a fixture group or direction`,
				cues[i].bar
			);
		}
	}

	// --- energy discipline --------------------------------------------------------------

	const peakSection = enginePeakSection(analysis.sections);
	if (peakSection) {
		const maxIntensity = Math.max(...cues.map((c) => c.intensity ?? show.defaults.intensity));
		const loudest = cues.filter((c) => (c.intensity ?? show.defaults.intensity) === maxIntensity);
		const inPeak = loudest.some(
			(c) => c.bar >= peakSection.startBar && c.bar < peakSection.endBar
		);
		if (!inPeak) {
			warn(
				'peak-not-brightest',
				`the brightest cue is not in the peak section (bars ${peakSection.startBar}-${peakSection.endBar}); save the biggest look for the biggest moment`,
				loudest[0]?.bar
			);
		}
	}

	// Lighting strips in parallel with the music: a build reintroduces at the drop, it does
	// not add before it.
	for (let i = 0; i < cues.length - 1; i++) {
		if (cues[i].section !== 'build') continue;
		const next = cues.slice(i + 1).find((c) => sectionBase(c.section) === 'drop');
		if (!next) continue;
		const buildLayers = countLayers(cues[i].layers);
		const dropLayers = countLayers(next.layers);
		if (buildLayers >= dropLayers) {
			warn(
				'build-not-stripped',
				`the build at bar ${cues[i].bar} runs ${buildLayers} layers and the drop at ${next.bar} runs ${dropLayers}; a build should hold less back`,
				cues[i].bar
			);
		}
	}

	for (const span of analysis.sections) {
		if (span.kind !== 'void') continue;
		const covering = lastCueAtOrBefore(cues, span.startBar);
		if (!covering) continue;
		const intensity = covering.intensity ?? show.defaults.intensity;
		if (intensity > 0.25 && covering.bar !== span.startBar) {
			warn(
				'void-not-honoured',
				`the void at bar ${span.startBar} inherits intensity ${intensity}; cutting the light with the bass is what makes the drop a release`,
				span.startBar
			);
		}
	}

	// --- punctuation and safety ---------------------------------------------------------

	const hits = [...show.hits].sort((a, b) => a.bar - b.bar);
	const hitBars = (hit: Hit) => hit.beats / tempo.beatsPerBar;
	/** Where a hit finishes, in fractional bars. Whole whenever it ends on a downbeat. */
	const hitEnd = (hit: Hit) => hit.bar + ((hit.beat ?? 0) + hit.beats) / tempo.beatsPerBar;
	const whole = (v: number) => Math.abs(v - Math.round(v)) < 1e-9;

	for (const hit of hits) {
		if (!Number.isInteger(hit.bar) || hit.bar < 0 || hit.bar > lastBar) {
			err('hit-out-of-grid', `hit at bar ${hit.bar} is not in the analysed grid`, hit.bar);
			continue;
		}
		if (hit.beats <= 0) err('hit-zero-length', `hit at bar ${hit.bar} has no duration`, hit.bar);

		// Punctuation is counted in whole BEATS and must touch a downbeat at one end or the
		// other. A gesture that starts on one is the ordinary case; one that only ends on one is
		// a gesture whose whole job is the thing that follows it, and the held breath before a
		// drop is exactly that: at a whole bar it is four beats of nothing, and the only way to
		// be shorter and still finish on the downbeat is to start inside the bar.
		//
		// What this still forbids is a hit that touches a downbeat at neither end, which lands
		// the room back mid-bar with nothing to have marked.
		const beat = hit.beat ?? 0;
		if (!Number.isInteger(beat) || beat < 0 || beat >= tempo.beatsPerBar) {
			err(
				'hit-off-beat',
				`hit at bar ${hit.bar} starts on beat ${beat}; a hit starts on a beat of its bar, 0 to ${tempo.beatsPerBar - 1}`,
				hit.bar
			);
		}
		if (!Number.isInteger(hit.beats)) {
			err(
				'hit-part-beat',
				`${hit.kind} at bar ${hit.bar} runs ${hit.beats} beats; punctuation is counted in whole beats`,
				hit.bar
			);
		}
		const bars = hitBars(hit);
		if (beat !== 0 && !whole(hitEnd(hit))) {
			err(
				'hit-part-bar',
				`${hit.kind} at bar ${hit.bar} beat ${beat} runs ${bars.toFixed(2)} bars and so touches a downbeat at neither end; start it on one or land it on one`,
				hit.bar
			);
		}

		const rule = HIT_RULES[hit.kind];
		if (bars > rule.maxBars + 1e-9) {
			err(
				'hit-too-long',
				`${hit.kind} at bar ${hit.bar} runs ${bars} bars; ${rule.maxBars} is the longest it holds the room`,
				hit.bar
			);
		}
		// Length in seconds, not only in bars: a bar is 1.4 s at 175 bpm and 3 s at 80, so the
		// same bar count is a flourish at one tempo and an ordeal at the other. This caps how
		// long a flash lasts and says nothing about how fast it flashes.
		if (rule.maxSeconds !== undefined) {
			const seconds = hitSeconds(tempo, hit.bar, beat, hit.beats);
			if (seconds > rule.maxSeconds + 1e-6) {
				err(
					'hit-too-long-in-seconds',
					`${hit.kind} at bar ${hit.bar} runs ${seconds.toFixed(1)}s at ${Math.round(tempo.bpm)} bpm; past ${rule.maxSeconds}s it stops reading as punctuation`,
					hit.bar
				);
			}
		}

		// Rate, through the same function the planner sizes it with. The subdivision is the
		// author's, but past the ceiling the flashes fuse into a texture and stop reading as
		// events - measured in the room at 9.4 Hz, where the same gesture at 4.7 still lands.
		if (hit.kind === 'strobe') {
			const perBeat = hit.params?.perBeat ?? 2;
			// At the bar it fires on. Reading the track median here let a 9.2 Hz strobe past
			// on a track whose median said 5.2 - the planner and the linter agreed with each
			// other because they were both asking about a tempo the track never plays.
			const local = bpmAt(tempo, hit.bar);
			const ceiling = strobePerBeat({ bpm: local });
			if (perBeat > ceiling) {
				err(
					'strobe-too-fast',
					`strobe at bar ${hit.bar} flashes ${perBeat}/beat at ${Math.round(local)} bpm, ${((perBeat * local) / 60).toFixed(1)} Hz; past ${STROBE_MAX_HZ} Hz it reads as noise - ${ceiling}/beat is the fastest that bar carries`,
					hit.bar
				);
			}
		}

		if (hit.bar < SETTLE_BARS && (hit.kind === 'slam' || hit.kind === 'strobe')) {
			warn(
				'early-punctuation',
				`a ${hit.kind} at bar ${hit.bar} spends the show's biggest card in the first ${SETTLE_BARS} bars`,
				hit.bar
			);
		}

		if (hit.kind === 'blackout') {
			const section = analysis.bars[hit.bar]?.section;
			// A build is on the list because cutting the room to black on the last bar before a
			// drop is one of the oldest moves there is, not a mistake.
			const deliberate = ['void', 'breakdown', 'outro', 'build'];
			if (section && !deliberate.includes(section)) {
				warn(
					'blackout-placement',
					`blackout at bar ${hit.bar} lands in a ${section}; it reads as a mistake outside a void or breakdown`,
					hit.bar
				);
			}

			// The held breath exists to set up the downbeat after it. Ending anywhere else hands
			// the room back before the thing the silence was for.
			//
			// Only where the room would otherwise come back UP. A blackout cut from a void is
			// already inside darkness - the void cue runs at 0.05 with no house floor - so its
			// length decides how hard the cut is, not whether the room returns.
			const inVoid = section === 'void';
			const next = analysis.sections.find((s) => s.startBar > hit.bar);
			if (
				!inVoid &&
				next &&
				sectionBase(next.kind) === 'drop' &&
				next.startBar - hit.bar <= HIT_RULES.blackout.maxBars
			) {
				const end = hitEnd(hit);
				if (Math.abs(end - next.startBar) > 1e-9) {
					err(
						'blackout-ends-early',
						`the blackout at bar ${hit.bar} ends at bar ${end}; before the drop at ${next.startBar} it runs to that downbeat or the room comes back too soon`,
						hit.bar
					);
				}
			}
		}
	}

	// The flash allowance, counting strobes and blackouts together: genre times energy, one
	// for a track nothing could identify, zero for the families that forbid the gesture.
	//
	// The same function the engine plans against, so an agent's show cannot spend more.
	// Counted together because they are one gesture from the audience's side: the room stops
	// being a room and becomes an event, and past the budget it is a lighting rig. An error
	// rather than a warning, because it is the difference between a show with a biggest
	// moment and a show without one.
	const allowance = allowedFlashes(analysis, ctx.context);
	const flashes = hits.filter((h) => h.kind === 'strobe' || h.kind === 'blackout');
	// A strobe smuggled in as a cue's master layer with its trigger armed is the same gesture
	// as a strobe hit, and it spends the same card - otherwise the budget governs the timeline
	// and not the room.
	const armedStrobes = show.cues.filter((c) => {
		const master = c.layers.master;
		if (!master) return false;
		const def = ctx.effects.get(master.effect);
		return (
			def?.taste.hitOnly === true &&
			def.taste.character === 'flash' &&
			(master.params?.trigger ?? 0) > 0.5
		);
	});
	const spent = flashes.length + armedStrobes.length;
	if (spent > allowance) {
		const where = [
			...flashes.map((h) => `${h.kind} at ${h.bar}`),
			...armedStrobes.map((c) => `armed strobe master at ${c.bar}`)
		].join(', ');
		err(
			'flash-budget',
			`${spent} strobes and blackouts (${where}); this track earns ${allowance}, spent on the moments that deserve them`,
			flashes[Math.min(allowance, flashes.length - 1)]?.bar ?? armedStrobes[0].bar
		);
	}

	// The same allowance, applied to what the cues are made of: a family that has earned no
	// flashes does not get blinder slams or strobes as ordinary layers instead. Mirrors the
	// picker's veto, so an agent's revision cannot reintroduce what the engine refused.
	if (allowance === 0) {
		for (const cue of show.cues) {
			for (const role of LAYER_ROLES) {
				const spec = cue.layers[role];
				const character = spec ? ctx.effects.get(spec.effect)?.taste.character : undefined;
				if (!character) continue;
				err(
					'flash-character',
					`${spec!.effect} is a ${character} effect and this track's flash allowance is zero; the family forbids the gesture in any layer`,
					cue.bar
				);
			}
		}
	}

	// Punctuation is anchored to something an audience can hear: the phrase grid, a boundary the
	// analyser measured, a crash in the audio, or the gesture it hands over to. The last of those
	// is what makes strobe-then-black-then-slam one figure rather than three loose hits, and
	// without it the run into a drop is unplaceable - only its final part lands on a downbeat
	// anyone is counting.
	const anchoredStart = new Set<number>();
	for (const hit of [...hits].sort((a, b) => b.bar - a.bar)) {
		const end = hitEnd(hit);
		const ok =
			onPhrase(hit.bar) ||
			onPhrase(end) ||
			anchoredStart.has(end) ||
			// The finish line: a hit that ends exactly where the record does is anchored to
			// the one boundary every listener hears, whatever the phrase arithmetic says of
			// a final partial phrase. This is what lets the button exist on a track whose
			// last section is not a whole number of phrases.
			end >= analysis.bars.length ||
			(analysis.bars[hit.bar]?.events.includes('crash') ?? false);
		if (ok) anchoredStart.add(hit.bar);
		else {
			const down = hit.bar - phraseOffset(hit.bar, tempo.phraseAnchorBar);
			err(
				'unanchored-hit',
				`${hit.kind} at bar ${hit.bar} neither starts nor ends on the ${PHRASE_BARS}-bar grid, a measured boundary or another hit; use ${down} or ${down + PHRASE_BARS}`,
				hit.bar
			);
		}
	}

	// --- colour -------------------------------------------------------------------------

	const hues = new Set<number>([show.palette.base, show.palette.accent]);
	if (show.palette.third !== undefined) hues.add(show.palette.third);
	for (const cue of cues) {
		if (cue.palette && cue.palette !== 'swap' && cue.palette !== 'inherit') {
			hues.add(cue.palette.base);
			hues.add(cue.palette.accent);
			if (cue.palette.third !== undefined) hues.add(cue.palette.third);
		}
	}
	// What muds a room is three hues lit at once, not six visited over four minutes. A cue can
	// only ever declare base, accent and third, so simultaneity is bounded by the type; this
	// bounds how far the identity is allowed to wander before it stops being one. A track
	// that is several songs has an identity per song, and each is allowed its own six.
	const songs = Math.max(1, (analysis.movements ?? []).filter((m) => typeof m === 'object' && m !== null).length);
	const hueCap = MAX_HUES * songs;
	if (hues.size > hueCap) {
		warn(
			'too-many-hues',
			`the show visits ${hues.size} hues (${[...hues].join(', ')}); past ${hueCap} the room stops having a colour of its own`
		);
	}

	const separation = hueDistance(show.palette.base, show.palette.accent);
	if (separation < 90) {
		warn(
			'palette-no-contrast',
			`base ${show.palette.base} and accent ${show.palette.accent} are only ${Math.round(separation)} degrees apart; a warm/cool pair is what makes colour read as emotion`
		);
	}

	// --- anti-monotony ------------------------------------------------------------------
	// The documented failure mode of mechanical audio-to-light mapping: one light event per
	// audio event, which reads as repetitive and too explicit however well timed it is.
	const withTransient = cues.filter((c) => c.layers.transient).length;
	if (cues.length >= 4 && withTransient / cues.length > 0.8) {
		warn(
			'monotonous-transients',
			`${withTransient} of ${cues.length} cues fire on every drum hit; leaving the transient layer out is what makes it land when it returns`
		);
	}

	const distinctBeds = new Set(cues.map((c) => c.layers.bed?.effect).filter(Boolean));
	if (cues.length >= 6 && distinctBeds.size === 1) {
		warn(
			'single-bed',
			`every cue uses the same bed (${[...distinctBeds][0]}); the room never changes character`
		);
	}

	if (!show.brief?.trim()) {
		warn('no-brief', 'the show has no brief explaining its design');
	} else if (show.brief.length > MAX_BRIEF_CHARS) {
		// Asking for brevity in the prompt is not enough on its own; the effort belongs in the
		// effects, not in prose about them.
		warn(
			'brief-too-long',
			`the brief is ${show.brief.length} characters; keep it under ${MAX_BRIEF_CHARS}, roughly 150 words`
		);
	}

	const rambling = cues.filter((c) => (c.note?.length ?? 0) > MAX_NOTE_CHARS);
	if (rambling.length > 0) {
		warn(
			'notes-too-long',
			`${rambling.length} cue note(s) run past ${MAX_NOTE_CHARS} characters; a note says why the cue exists in a handful of words`,
			rambling[0].bar
		);
	}

	if (show.generatedEffects.length < MIN_GENERATED_EFFECTS) {
		warn(
			'few-generated-effects',
			`only ${show.generatedEffects.length} effect(s) written for this track; two to five is the target, and they are where the show gets its character`
		);
	}

	return split(findings);
}

function countLayers(layers: Show['cues'][number]['layers']): number {
	return LAYER_ROLES.filter((r: LayerRole) => layers[r]).length;
}

function lastCueAtOrBefore(cues: Show['cues'], bar: number): Show['cues'][number] | null {
	let best: Show['cues'][number] | null = null;
	for (const c of cues) if (c.bar <= bar && (!best || c.bar > best.bar)) best = c;
	return best;
}

function hueDistance(a: number, b: number): number {
	const d = Math.abs(((a - b) % 360 + 360) % 360);
	return Math.min(d, 360 - d);
}

function split(findings: Finding[]): LintResult {
	const errors = findings.filter((f) => f.severity === 'error');
	const warnings = findings.filter((f) => f.severity === 'warning');
	return { ok: errors.length === 0, errors, warnings };
}

export function formatFindings(result: LintResult): string {
	if (result.ok && result.warnings.length === 0) return 'Clean: no errors, no warnings.';
	const lines: string[] = [];
	for (const f of [...result.errors, ...result.warnings]) {
		const at = f.bar !== undefined ? ` (bar ${f.bar})` : '';
		lines.push(`${f.severity.toUpperCase()} [${f.rule}]${at}: ${f.message}`);
	}
	lines.push('');
	lines.push(
		`${result.errors.length} error(s), ${result.warnings.length} warning(s). ${
			result.ok ? 'Errors must be zero before the show is accepted.' : 'Fix the errors.'
		}`
	);
	return lines.join('\n');
}
