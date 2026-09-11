import { error, json } from '@sveltejs/kit';
import { DEFAULT_ROOM, buildGeometry, roomRegions } from '@mv/core';
import { hardware } from '$lib/server/hardware.ts';
import { isLocal } from '$lib/server/access.ts';
import { isDeviceRole } from '$lib/hardware.ts';
import type { RequestHandler } from './$types';

export const GET: RequestHandler = async () => json(hardware.statuses);

/** Hosts are used as an argument to a UDP send, so anything shell-like is simply not one. */
const HOST = /^[A-Za-z0-9._-]{1,253}$/;

export const POST: RequestHandler = async (event) => {
	if (!isLocal(event)) error(403, 'the hardware belongs to the machine running the show');

	const body = (await event.request.json()) as {
		action: 'set';
		role?: string;
		host?: string;
		region?: string;
	};

	if (body.action === 'set') {
		if (!isDeviceRole(body.role)) error(400, 'that is not a device in this room');
		const link = hardware.link(body.role);

		const host = (body.host ?? '').trim();
		if (host && !HOST.test(host)) error(400, 'that does not look like a host or an address');
		link.setHost(host);

		if (typeof body.region === 'string') {
			// Validate region IDs against geometry so unknown regions cannot silently light nothing.
			const known = roomRegions(buildGeometry(DEFAULT_ROOM)).some((r) => r.id === body.region);
			if (!known) error(400, 'that is not a part of this room');
			link.setRegion(body.region);
		}
		return json(hardware.statuses);
	}

	error(400, 'unknown action');
};
