interface InviteInfo {
	token: string;
	address: string | null;
	/** Null when this machine has no network address a phone could reach. */
	url: string | null;
}

/**
 * Share invite state because the dialog must live outside panels whose backdrop-filter traps
 * fixed positioning.
 */
class InviteClient {
	info = $state<InviteInfo | null>(null);
	open = $state(false);
	rotating = $state(false);

	async load(): Promise<void> {
		try {
			const res = await fetch('/api/invite');
			if (res.ok) this.info = (await res.json()) as InviteInfo;
		} catch {
			// No code to show, which the dialog's empty state already covers.
		}
	}

	async rotate(): Promise<void> {
		this.rotating = true;
		try {
			const res = await fetch('/api/invite', {
				method: 'POST',
				headers: { 'content-type': 'application/json' },
				body: JSON.stringify({ action: 'rotate' })
			});
			if (res.ok) this.info = (await res.json()) as InviteInfo;
		} finally {
			this.rotating = false;
		}
	}
}

export const invite = new InviteClient();
