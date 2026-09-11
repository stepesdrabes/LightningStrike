import type { SectionKind } from '@mv/core';

/**
 * Explicit annotation-to-lighting mappings. Prechorus maps to build because it leads into a
 * chorus.
 */

/**
 * Club mapping: bridges retain groove unless annotated as breaks; postchoruses retain drop
 * energy.
 */
export const KIND_CLUB: Record<string, SectionKind> = {
	intro: 'intro',
	fadein: 'intro',
	outro: 'outro',
	fadeout: 'outro',
	end: 'outro',
	verse: 'groove',
	bridge: 'groove',
	inst: 'groove',
	instrumental: 'groove',
	solo: 'groove',
	gtr: 'groove',
	section: 'groove',
	rap: 'groove',
	chorus: 'drop',
	altchorus: 'drop',
	postchorus: 'drop',
	instchorus: 'drop',
	prechorus: 'build',
	build: 'build',
	transition: 'build',
	break: 'breakdown',
	breakdown: 'breakdown',
	quiet: 'breakdown',
	silence: 'void'
};

/**
 * Song mapping keeps verse/chorus, treats bridges as breakdowns and preserves postchorus
 * energy.
 */
export const KIND_SONG: Record<string, SectionKind> = {
	intro: 'intro',
	fadein: 'intro',
	outro: 'outro',
	fadeout: 'outro',
	end: 'outro',
	verse: 'verse',
	rap: 'verse',
	bridge: 'breakdown',
	inst: 'groove',
	instrumental: 'groove',
	solo: 'groove',
	gtr: 'groove',
	section: 'groove',
	chorus: 'chorus',
	altchorus: 'chorus',
	postchorus: 'chorus',
	instchorus: 'chorus',
	prechorus: 'build',
	build: 'build',
	transition: 'build',
	break: 'breakdown',
	breakdown: 'breakdown',
	quiet: 'breakdown',
	silence: 'void'
};

/**
 * Maximum relative duration mismatch. Different Rock Band edits cannot align by a constant
 * offset.
 */
export const MAX_DURATION_DRIFT = 0.02;
