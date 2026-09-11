export interface MenuItem {
	id: string;
	label: string;
	/** Trailing text: what the option costs, what it is, why it is unavailable. */
	note?: string;
	disabled?: boolean;
	title?: string;
}

export interface MenuGroup {
	/** Absent for a group that needs no heading, which is most of them. */
	label?: string;
	/** The item currently chosen in this group, which is drawn with a tick. */
	value?: string;
	items: MenuItem[];
}

/**
 * Mount menus at the page root: backdrop-filter on panels creates containing blocks that clip
 * fixed descendants.
 */
class MenuClient {
	/** Build items reactively so an open menu reflects model and effort choices immediately. */
	build = $state<(() => MenuGroup[]) | null>(null);
	/** Viewport coordinates of the control that opened it. Null when closed. */
	anchor = $state<DOMRect | null>(null);

	private handler: ((group: number, id: string) => void) | null = null;

	get open(): boolean {
		return this.anchor !== null;
	}

	show(
		trigger: HTMLElement,
		build: () => MenuGroup[],
		onpick: (group: number, id: string) => void
	): void {
		this.build = build;
		this.handler = onpick;
		this.anchor = trigger.getBoundingClientRect();
	}

	close(): void {
		this.anchor = null;
		this.build = null;
		this.handler = null;
	}

	pick(group: number, id: string): void {
		this.handler?.(group, id);
	}
}

export const menu = new MenuClient();
