import type { Light, LightPart, Mount } from '@mv/core';
import type { IconName } from '$lib/ui/icons.ts';
import type { Room } from '$lib/rooms.ts';
import { pixelsOf } from '$lib/wiring.ts';

export function glyphOf(light: Light): IconName {
	switch (light.kind) {
		case 'path':
			return light.closed ? 'loop' : 'strip';
		case 'ring':
			return 'ring';
		case 'matrix':
			return 'matrix';
		case 'lamp':
			return 'lamp';
	}
}

export const MOUNTS: readonly { id: Mount; label: string }[] = [
	{ id: 'ceiling', label: 'Ceiling' },
	{ id: 'floor', label: 'Floor' },
	{ id: 'north', label: 'North wall' },
	{ id: 'east', label: 'East wall' },
	{ id: 'south', label: 'South wall' },
	{ id: 'west', label: 'West wall' }
];

export const PARTS: Record<LightPart, { label: string; note: string }> = {
	ring: { label: 'Ring', note: 'Effects that travel round the room walk along it.' },
	spine: { label: 'Spine', note: 'Effects drawn through the middle of the room follow it.' },
	field: { label: 'Field', note: 'Lit by where its LEDs are, like the rest of the room.' }
};

/** How a light is wired, in a few words. */
export function wiredTo(light: Light, room: Room): string {
	const wiring = light.wiring;
	if (!wiring) return 'Preview only';
	const controller = room.controllers.find((c) => c.id === wiring.controller);
	const n = pixelsOf(light);
	const range = n === 1 ? `pixel ${wiring.start}` : `${wiring.start} to ${wiring.start + n - 1}`;
	return `${controller?.name ?? 'A missing controller'}, ${range}`;
}

/** Metres, as few digits as say it. */
export function metres(v: number): string {
	return `${Number(v.toFixed(2))} m`;
}
