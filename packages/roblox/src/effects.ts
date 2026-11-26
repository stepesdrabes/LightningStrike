import type { Hit } from '@mv/core';

/** The effect each hit kind installs on the master layer, as the player maps them. A blackout dims the mixer. */
export const HIT_EFFECT: Readonly<Record<Hit['kind'], string | null>> = {
	slam: 'slam',
	strobe: 'strobe',
	bump: 'colorBump',
	blackout: null
};
