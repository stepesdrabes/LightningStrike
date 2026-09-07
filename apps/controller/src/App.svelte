<script lang="ts">
	import { onMount } from 'svelte';
	import { effectIcon } from './lib/icons.ts';
	import { Room } from './lib/room.svelte.ts';
	import { effectLabel, isStreaming, type Policy } from './lib/protocol.ts';
	import Icon from './ui/Icon.svelte';
	import Panel from './ui/Panel.svelte';
	import Segmented from './ui/Segmented.svelte';
	import Slider from './ui/Slider.svelte';
	import Swatches from './ui/Swatches.svelte';

	const room = new Room();

	let manual = $state('');
	let manualFailed = $state(false);
	let identified = $state(false);

	const device = $derived(room.selected);
	const light = $derived(device?.state ?? null);
	const streaming = $derived(isStreaming(light));

	const POLICIES: readonly { value: Policy; label: string }[] = [
		{ value: 'restore', label: 'Stay as it was' },
		{ value: 'always-on', label: 'Light up' }
	];

	const effects = $derived(
		(device?.effects ?? []).map((e) => ({
			value: e,
			label: effectLabel(e),
			icon: effectIcon(e)
		}))
	);

	onMount(() => {
		void room.search();
		return room.watch();
	});

	async function addManual(): Promise<void> {
		manualFailed = !(await room.addByHost(manual));
		if (!manualFailed) manual = '';
	}

	async function identify(): Promise<void> {
		if (!device) return;
		identified = await device.client.identify();
		setTimeout(() => (identified = false), 1600);
	}
</script>

<main>
	<header>
		<h1>
			<Icon name="zap" size={17} />
			{device?.title ?? 'Lights'}
		</h1>
		<button
			class="ghost"
			onclick={() => room.search()}
			disabled={room.phase === 'searching'}
			aria-label="search again"
		>
			<Icon name="refresh" size={16} spin={room.phase === 'searching'} />
		</button>
	</header>

	{#if room.devices.length > 1}
		<nav aria-label="lights">
			{#each room.devices as d (d.host)}
				<button
					type="button"
					class="chip"
					aria-pressed={d.host === room.selectedHost}
					onclick={() => room.select(d.host)}
				>
					<span
						class="dot"
						class:on={d.online && d.state?.power === 'on'}
						class:off={d.online && d.state?.power !== 'on'}
					></span>
					{d.title}
				</button>
			{/each}
		</nav>
	{/if}

	{#if device && light}
		{#if streaming}
			<p class="notice live">
				<Icon name="zap" size={15} />
				{light.mode === 'party-muted'
					? 'Muted while a show is running. Changes are kept for when it ends.'
					: 'A show is driving this light. Changes are kept for when it ends.'}
			</p>
		{:else if !device.online}
			<p class="notice bad">
				<Icon name="offline" size={15} />
				Out of reach. Still trying.
			</p>
		{/if}

		<button
			class="power"
			aria-pressed={light.power === 'on'}
			onclick={() => device.apply({ power: light.power === 'on' ? 'off' : 'on' })}
		>
			<Icon name="power" size={19} />
			{light.power === 'on' ? 'On' : 'Off'}
		</button>

		<Panel icon="brightness" label="Brightness" value={String(light.brightness)}>
			<Slider
				value={light.brightness}
				disabled={light.power === 'off'}
				oninput={(v) => device.apply({ brightness: v })}
			/>
		</Panel>

		<Panel icon="palette" label="Colour" value={light.colour}>
			<Swatches
				colour={light.colour}
				disabled={light.power === 'off'}
				onpick={(hex) => device.apply({ colour: hex })}
			/>
		</Panel>

		<!-- One effect is not a choice, and a picker with a single button says only that the
		     fixture is limited. The lamp is a single pixel, so a wash is all it can be. -->
		{#if effects.length > 1}
			<Panel icon="sparkles" label="Effect">
				<Segmented
					options={effects}
					selected={light.effect}
					disabled={light.power === 'off'}
					onpick={(e) => device.apply({ effect: e })}
				/>
			</Panel>
		{/if}

		<Panel icon="plug" label="When power comes back">
			<Segmented
				options={POLICIES}
				selected={light.powerOn}
				onpick={(p) => device.apply({ powerOn: p })}
			/>
		</Panel>

		<footer>
			<button class="ghost wide" onclick={identify}>
				<Icon name={identified ? 'check' : 'zap'} size={15} />
				{identified ? 'Blinking' : 'Identify'}
			</button>
			<span class="meta">{device.info?.name} · {device.host} · {device.info?.firmware}</span>
		</footer>
	{:else if room.phase === 'searching'}
		<p class="notice">
			<Icon name="spinner" size={15} spin />
			{room.sweeping ? 'Checking every address on your network' : 'Looking for lights'}
		</p>
	{:else}
		<p class="notice">
			<Icon name="offline" size={15} />
			No lights answered. They have to be on this network, and opening this page at an
			address rather than a name is what lets it scan.
		</p>
	{/if}

	<details>
		<summary>Add by address</summary>
		<form
			onsubmit={(e) => {
				e.preventDefault();
				void addManual();
			}}
		>
			<input
				bind:value={manual}
				placeholder="192.168.0.106"
				spellcheck="false"
				autocapitalize="off"
				autocomplete="off"
				aria-label="board address"
			/>
			<button type="submit" class="ghost">Add</button>
		</form>
		{#if manualFailed}<p class="meta bad">Nothing answered there.</p>{/if}
	</details>
</main>

<style>
	main {
		display: flex;
		flex-direction: column;
		gap: 10px;
		width: 100%;
		max-width: 460px;
		margin: 0 auto;
		padding: 22px 16px 40px;
	}

	header {
		display: flex;
		align-items: center;
		justify-content: space-between;
		gap: 10px;
		margin-bottom: 4px;
	}

	h1 {
		display: flex;
		align-items: center;
		gap: 8px;
		margin: 0;
		font-size: 19px;
		font-weight: 600;
		letter-spacing: -0.01em;
	}

	nav {
		display: flex;
		gap: 6px;
		overflow-x: auto;
		scrollbar-width: none;
	}

	.chip {
		display: flex;
		align-items: center;
		gap: 7px;
		flex: none;
		padding: 7px 12px;
		font-size: 13px;
		color: var(--muted-foreground);
		background: var(--card);
		border: 1px solid var(--border-soft);
		border-radius: 999px;
	}

	.chip[aria-pressed='true'] {
		color: var(--foreground);
		border-color: var(--border);
		background: var(--raised);
	}

	.dot {
		width: 7px;
		height: 7px;
		border-radius: 50%;
		background: var(--subtle-foreground);
	}

	.dot.on {
		background: var(--live);
	}

	.dot.off {
		background: var(--border);
	}

	.power {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 9px;
		width: 100%;
		min-height: 58px;
		font-size: 16px;
		font-weight: 500;
		color: var(--muted-foreground);
		background: var(--card);
		border: 1px solid var(--border-soft);
		border-radius: var(--radius);
		transition:
			background 140ms,
			color 140ms;
	}

	.power[aria-pressed='true'] {
		color: var(--primary-foreground);
		background: var(--primary);
		border-color: var(--primary);
	}

	.power:active {
		transform: translateY(1px);
	}

	.notice {
		display: flex;
		align-items: center;
		gap: 9px;
		margin: 0;
		padding: 12px 14px;
		font-size: 13px;
		color: var(--muted-foreground);
		background: var(--card);
		border: 1px solid var(--border-soft);
		border-radius: var(--radius);
	}

	.notice.live {
		color: var(--live);
		border-color: #ff6a1a33;
		background: #ff6a1a12;
	}

	.notice.bad {
		color: var(--bad);
	}

	.ghost {
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 7px;
		min-height: var(--h);
		padding: 0 14px;
		font-size: 14px;
		color: var(--muted-foreground);
		background: var(--card);
		border: 1px solid var(--border-soft);
		border-radius: var(--radius-sm);
	}

	.ghost:disabled {
		opacity: 0.5;
	}

	.wide {
		flex: 1;
	}

	@media (hover: hover) {
		.ghost:not(:disabled):hover,
		.chip:hover {
			background: var(--hover);
			color: var(--foreground);
		}
	}

	footer {
		display: flex;
		align-items: center;
		gap: 12px;
		margin-top: 2px;
	}

	.meta {
		font-family: var(--mono);
		font-size: 11px;
		color: var(--subtle-foreground);
		text-align: right;
		overflow-wrap: anywhere;
	}

	.meta.bad {
		color: var(--bad);
		text-align: left;
		margin: 8px 0 0;
	}

	details {
		margin-top: 6px;
	}

	summary {
		font-size: 12px;
		color: var(--subtle-foreground);
		cursor: pointer;
		padding: 6px 2px;
	}

	form {
		display: flex;
		gap: 6px;
		margin-top: 6px;
	}

	input {
		flex: 1;
		min-width: 0;
		min-height: var(--h);
		padding: 0 12px;
		font-family: var(--mono);
		font-size: 14px;
		color: var(--foreground);
		background: var(--card);
		border: 1px solid var(--border);
		border-radius: var(--radius-sm);
		-webkit-user-select: text;
		user-select: text;
	}

	input:focus {
		outline: none;
		border-color: var(--subtle-foreground);
	}
</style>
