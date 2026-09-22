<script lang="ts">
	import { roomState, STATE_WORDS } from '$lib/controllers.ts';
	import { menu } from '$lib/menu.svelte.ts';
	import type { RoomsClient } from '$lib/rooms.svelte.ts';
	import Icon from '$lib/ui/Icon.svelte';
	import Button from '$lib/ui/Button.svelte';
	import Spinner from '$lib/ui/Spinner.svelte';
	import StatusDot from './StatusDot.svelte';

	let {
		busy = false,
		busyLabel = '',
		failure = '',
		rooms,
		setupOpen = false,
		cached = 0,
		onsearch,
		onlibrary,
		onsetup,
		ontoggleLeft,
		ontoggleRight
	}: {
		busy?: boolean;
		busyLabel?: string;
		failure?: string;
		rooms: RoomsClient;
		setupOpen?: boolean;
		/** Tracks already downloaded, which is the only thing the library button has to say. */
		cached?: number;
		onsearch: (seed: string) => void;
		onlibrary: () => void;
		onsetup: () => void;
		ontoggleLeft: () => void;
		ontoggleRight: () => void;
	} = $props();

	const running = $derived(rooms.output.running);
	const health = $derived(roomState(rooms.output.controllers, running));
	const addressed = $derived(rooms.room?.controllers.filter((c) => c.host).length ?? 0);

	/** Whether the room is lit, and how its controllers are, in one short line. */
	const summary = $derived.by(() => {
		if (addressed === 0) return 'No controllers with an address yet';
		const plural = addressed === 1 ? 'controller' : 'controllers';
		return `${running ? 'Lit' : 'Not lit'}, ${addressed} ${plural}: ${STATE_WORDS[health].toLowerCase()}`;
	});

	function openRooms(e: MouseEvent) {
		menu.show(
			e.currentTarget as HTMLElement,
			() => [
				{
					label: 'Rooms',
					value: rooms.state?.active,
					items: rooms.rooms.map((r) => ({
						id: r.id,
						label: r.name,
						note: r.id === rooms.state?.active && running ? 'lit' : undefined
					}))
				},
				{
					items: [
						running
							? { id: 'stop', label: 'Stop the lights' }
							: {
									id: 'start',
									label: 'Light the room',
									disabled: addressed === 0,
									note: addressed === 0 ? 'nothing to send to' : undefined
								},
						{ id: 'setup', label: setupOpen ? 'Close the setup' : 'Set up rooms and lights' }
					]
				}
			],
			(group, id) => {
				menu.close();
				if (group === 0) void rooms.activate(id);
				else if (id === 'start') void rooms.start();
				else if (id === 'stop') void rooms.stop();
				else onsetup();
			}
		);
	}

	/** Seed the palette from a keypress; a real input would compete with the modal for focus. */
	function onkeydown(e: KeyboardEvent) {
		if (e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
			e.preventDefault();
			onsearch(e.key);
		}
	}
</script>

<header class="floats" data-tauri-drag-region="deep">
	<div class="side">
		<Button
			variant="ghost"
			size="icon"
			title="Queue"
			ariaLabel="Toggle the queue"
			onclick={ontoggleLeft}>
			<Icon name="panelLeft" size={17} />
		</Button>
		<span class="brand">
			<span class="bolt"><Icon name="bolt" size={13} fill /></span>
			<span class="mark">LightningStrike</span>
		</span>
	</div>

	<button class="search" aria-label="Search" onclick={() => onsearch('')} {onkeydown}>
		<Icon name="search" size={15} />
		<span>Search for a song, or paste a link</span>
		<kbd>⌘K</kbd>
	</button>

	<div class="side end">
		{#if busy}
			<span class="status">
				<Spinner size={13} accent />
				<span class="truncate">{busyLabel}</span>
			</span>
		{:else if failure}
			<span class="status bad truncate" title={failure}>
				<Icon name="alert" size={14} />
				<span class="truncate">{failure}</span>
			</span>
		{/if}

		<button class="link" onclick={onlibrary} title="What is already downloaded">
			<Icon name="listMusic" size={14} />
			<span class="label mono">{cached}</span>
		</button>

		<button
			class="link room"
			class:live={running && (health === 'streaming' || health === 'sending')}
			class:warn={health === 'degraded'}
			class:bad={running && health === 'offline'}
			class:open={setupOpen}
			aria-haspopup="menu"
			onclick={openRooms}
			title={summary}>
			<StatusDot state={health} />
			<span class="label truncate">{rooms.room?.name ?? 'Room'}</span>
			<Icon name="chevronDown" size={13} />
		</button>

		<Button
			variant="ghost"
			size="icon"
			title="Inspector"
			ariaLabel="Toggle the inspector"
			onclick={ontoggleRight}>
			<Icon name="panelRight" size={17} />
		</Button>
	</div>
</header>

<style>
	header {
		display: grid;
		/* Three columns keep search centred regardless of status-text width. */
		grid-template-columns: 1fr minmax(280px, 460px) 1fr;
		align-items: center;
		gap: 16px;
		height: var(--topbar-h);
		flex: none;
		/* The desktop shell sets --traffic-inset for native window controls; browsers omit it. */
		padding: 0 12px 0 calc(12px + var(--traffic-inset, 0px));
		background: var(--panel);
		backdrop-filter: var(--panel-blur);
		border-bottom: 1px solid var(--border);
	}

	.side {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
	}
	.side.end {
		justify-content: flex-end;
	}
	.brand {
		display: flex;
		align-items: center;
		gap: 8px;
		padding-left: 2px;
		min-width: 0;
	}
	.bolt {
		display: grid;
		place-items: center;
		width: 22px;
		height: 22px;
		border-radius: 6px;
		background: var(--foreground);
		color: var(--primary-foreground);
		flex: none;
	}
	.mark {
		font-size: 14px;
		font-weight: 600;
		letter-spacing: -0.012em;
		white-space: nowrap;
	}
	/* The wordmark is the first thing to go: the search field matters more than the name. */
	@media (max-width: 1200px) {
		.mark {
			display: none;
		}
	}

	.search {
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		height: var(--h);
		padding: 0 10px 0 12px;
		border-radius: var(--radius-md);
		border: 1px solid var(--border);
		background: var(--card-raised);
		color: var(--subtle-foreground);
		font-size: 13.5px;
		transition:
			background-color 0.13s ease,
			border-color 0.13s ease;
	}
	.search:hover {
		background: var(--muted);
		border-color: #33333c;
	}
	.search span {
		flex: 1;
		text-align: left;
	}
	kbd {
		font-family: var(--sans);
		font-size: 11.5px;
		padding: 2px 5px;
		border: 1px solid var(--border);
		border-radius: 5px;
		background: var(--muted);
	}

	.status {
		display: flex;
		align-items: center;
		gap: 7px;
		min-width: 0;
		max-width: 260px;
		font-size: 12.5px;
		color: var(--muted-foreground);
	}
	.status.bad {
		color: var(--bad);
	}

	.link {
		display: inline-flex;
		align-items: center;
		gap: 8px;
		height: var(--h);
		padding: 0 13px;
		border-radius: var(--radius-md);
		border: 1px solid var(--border);
		background: var(--card-raised);
		color: var(--muted-foreground);
		font-size: 13px;
		font-weight: 500;
		transition:
			background-color 0.13s ease,
			border-color 0.13s ease,
			color 0.13s ease;
	}
	.link:hover {
		background: var(--muted);
		border-color: #33333c;
		color: var(--foreground);
	}
	.link.live {
		color: var(--foreground);
	}
	.link.warn {
		color: var(--warn);
	}
	.link.bad {
		color: var(--bad);
	}
	.link .label {
		font-variant-numeric: tabular-nums;
	}
	.room {
		max-width: 220px;
		padding: 0 10px 0 13px;
	}
	.room :global(.lucide-icon) {
		color: var(--subtle-foreground);
	}
	.link.open {
		background: var(--muted);
		border-color: #33333c;
		color: var(--foreground);
	}
</style>
