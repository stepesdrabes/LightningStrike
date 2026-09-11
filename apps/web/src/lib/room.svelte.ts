interface RoomInfo {
	token: string;
	address: string | null;
	/** Null when this machine has no network address a phone could reach. */
	url: string | null;
}

/**
 * Share room state because the dialog must live outside panels whose backdrop-filter traps
 * fixed positioning.
 */
class RoomClient {
	info = $state<RoomInfo | null>(null);
	open = $state(false);
	rotating = $state(false);

	async load(): Promise<void> {
		try {
			const res = await fetch('/api/room');
			if (res.ok) this.info = (await res.json()) as RoomInfo;
		} catch {
			// No code to show, which the dialog's empty state already covers.
		}
	}

	async rotate(): Promise<void> {
		this.rotating = true;
		try {
			const res = await fetch('/api/room', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ action: 'rotate' })
			});
			if (res.ok) this.info = (await res.json()) as RoomInfo;
		} finally {
			this.rotating = false;
		}
	}
}

export const room = new RoomClient();
