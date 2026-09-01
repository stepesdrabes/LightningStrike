<script lang="ts">
	import {
		CONTRAST_MAX,
		CONTRAST_MIN,
		OFFSET_MAX_MS,
		OFFSET_MIN_MS,
		OUTPUT_BRIGHTNESS_MIN,
		OUTPUT_FPS_CHOICES,
		WIRE_PROTOCOLS,
		DEVICE_NAMES,
		faultsIn,
		lightsRoom,
		type DeviceRole,
		type HardwareStatus,
		type WireProtocol
	} from '$lib/hardware.ts';
	import { DEFAULT_ROOM, buildGeometry, roomRegions } from '@mv/core';
	import { uptime } from '$lib/hardware.svelte.ts';
	import Dialog from '$lib/ui/Dialog.svelte';
	import Button from '$lib/ui/Button.svelte';
	import Icon from '$lib/ui/Icon.svelte';
	import Segmented from '$lib/ui/Segmented.svelte';
	import Slider from '$lib/ui/Slider.svelte';
	import Spinner from '$lib/ui/Spinner.svelte';
	import PicoBoard from './PicoBoard.svelte';
	import StatusDot from './StatusDot.svelte';

	let {
		open = false,
		statuses,
		offsetMs = 0,
		fps = 60,
		brightness = 1,
		contrast = 2.45,
		lampBrightness = 1,
		protocol = 'ddp',
		onclose,
		onhost,
		onfps,
		onbrightness,
		onbrightnessdone,
		oncontrast,
		oncontrastdone,
		onlampbrightness,
		onlampbrightnessdone,
		onprotocol,
		onoffset,
		onoffsetdone,
		onregion,
		onconnect,
		ondisconnect
	}: {
		open?: boolean;
		/** One per device. The Frame is the panel's subject; the lamp is listed under it. */
		statuses: HardwareStatus[];
		/** How far ahead of the audio the strips run, milliseconds. */
		offsetMs?: number;
		/** Frames a second on the wire. */
		fps?: number;
		/** Master dimmer, 0..1. After gamma, so it costs no contrast. */
		brightness?: number;
		/** The tone curve's exponent, which is what decides whether a hit lands. */
		contrast?: number;
		/** The lamp's own dimmer. */
		lampBrightness?: number;
		/** Which wire the fixture is addressed on. Takes effect the next time output starts. */
		protocol?: WireProtocol;
		onclose: () => void;
		onhost: (role: DeviceRole, host: string) => void;
		onfps: (fps: number) => void;
		/** While dragging, then on release. Same split as the trim: one write per gesture. */
		onbrightness: (v: number) => void;
		onbrightnessdone: (v: number) => void;
		oncontrast: (v: number) => void;
		oncontrastdone: (v: number) => void;
		onlampbrightness: (v: number) => void;
		onlampbrightnessdone: (v: number) => void;
		onprotocol: (protocol: WireProtocol) => void;
		/** While the trim is being dragged. The running stream picks it up on its next sync. */
		onoffset: (ms: number) => void;
		/** On release, which is the only point worth writing to disk. */
		onoffsetdone: (ms: number) => void;
		/** Which part of the room this board is fed. Takes effect the next time output starts. */
		onregion: (id: string) => void;
		onconnect: (host: string) => void;
		ondisconnect: () => void;
	} = $props();

	// The room does not change while the app is running, so the parts of it do not either.
	const REGIONS = roomRegions(buildGeometry(DEFAULT_ROOM));

	const blank = (role: DeviceRole): HardwareStatus => ({
		role,
		host: '',
		region: 'all',
		state: 'unconfigured',
		streaming: false,
		identity: null,
		telemetry: null,
		latencyMs: null,
		message: ''
	});
	const status = $derived(statuses.find((s) => s.role === 'frame') ?? blank('frame'));
	const lamp = $derived(statuses.find((s) => s.role === 'bounce') ?? blank('bounce'));

	let draft = $state('');
	let touched = $state(false);
	let lampDraft = $state('');
	let lampTouched = $state(false);

	// The fields follow the server until they are typed in, so a host set from another tab shows
	// up here without overwriting something half-typed.
	$effect(() => {
		if (!touched) draft = status.host;
	});
	$effect(() => {
		if (!lampTouched) lampDraft = lamp.host;
	});
	$effect(() => {
		if (open) {
			touched = false;
			lampTouched = false;
		}
	});

	const identity = $derived(status.identity);
	const telemetry = $derived(status.telemetry);
	const faults = $derived(telemetry ? faultsIn(telemetry) : []);
	const dark = $derived(identity !== null && !lightsRoom(identity));
	const region = $derived(REGIONS.find((r) => r.id === status.region) ?? REGIONS[0]);

	const FPS_OPTIONS = OUTPUT_FPS_CHOICES.map((f) => ({ id: String(f), label: `${f}` }));
	const WIRE_LABEL: Record<WireProtocol, string> = { ddp: 'DDP', sacn: 'sACN' };
	const WIRE_OPTIONS = WIRE_PROTOCOLS.map((p) => ({ id: p, label: WIRE_LABEL[p] }));

	/**
	 * Connect is one action, so it is one button.
	 *
	 * Committing an edited address used to be its own press, and testing it a second - but the
	 * probe already runs on a timer for as long as this dialog is watching, so the only thing
	 * either of them added was a decision about which to press first.
	 *
	 * The address goes with the press rather than being read back off the status: setting it is
	 * a round trip through the server and an SSE frame, and starting output in between would
	 * stream to whatever the previous host was.
	 */
	function connect() {
		const host = draft.trim();
		if (!host) return;
		touched = false;
		onconnect(host);
	}

	const HEADLINE: Record<HardwareStatus['state'], string> = {
		unconfigured: 'No device',
		searching: 'Looking',
		offline: 'Not answering',
		online: 'Ready',
		streaming: 'Streaming',
		degraded: 'Dropping frames'
	};
</script>

<Dialog {open} {onclose} labelledBy="hardware-title">
	<header>
		<StatusDot state={status.state} size={9} />
		<h2 id="hardware-title">{DEVICE_NAMES.frame}</h2>
		<span class="state" class:bad={status.state === 'offline'} class:warn={status.state === 'degraded'}>
			{#if status.state === 'searching'}<Spinner size={12} />{/if}
			{HEADLINE[status.state]}
		</span>
	</header>

	<!--
		One scroller for everything under the header, rather than one around the device rows. With
		the settings fixed above it, every control added to them came out of the readout's height
		instead of the panel's, and the stats ended up in a two-line window.
	-->
	<div class="scroll">
	<div class="address">
		<div class="field">
			<Icon name="radio" size={15} />
			<input
				type="text"
				placeholder="192.168.0.106"
				spellcheck="false"
				autocomplete="off"
				aria-label="The Frame's address"
				bind:value={draft}
				oninput={() => (touched = true)}
				onkeydown={(e) => e.key === 'Enter' && connect()} />
		</div>
		<!--
			Enabled with nothing playing on purpose: a board joined before the music starts takes the
			resting scenes, which is what the room is doing at that moment.
		-->
		<Button
			variant={status.streaming ? 'danger' : 'primary'}
			onclick={status.streaming ? ondisconnect : connect}
			disabled={!status.streaming && !draft.trim()}>
			{status.streaming ? 'Disconnect' : 'Connect'}
		</Button>
	</div>

	{#if status.host}
		<div class="trim">
			<span>Shows</span>
			<select value={status.region} onchange={(e) => onregion(e.currentTarget.value)}>
				{#each REGIONS as r (r.id)}
					<option value={r.id}>{r.name}</option>
				{/each}
			</select>
			<span class="ms mono">{region.count} px</span>
		</div>
		<div class="trim">
			<span>Lead</span>
			<Slider
				value={offsetMs}
				min={OFFSET_MIN_MS}
				max={OFFSET_MAX_MS}
				step={5}
				ariaLabel="How far ahead of the audio the strips run"
				oninput={onoffset}
				onchange={onoffsetdone} />
			<span class="ms mono">{offsetMs > 0 ? '+' : ''}{offsetMs} ms</span>
		</div>
		<div class="trim">
			<span>Level</span>
			<Slider
				value={brightness}
				min={OUTPUT_BRIGHTNESS_MIN}
				max={1}
				step={0.01}
				ariaLabel="How much of full output the room gets"
				oninput={onbrightness}
				onchange={onbrightnessdone} />
			<span class="ms mono">{Math.round(brightness * 100)}%</span>
		</div>
		<div class="trim">
			<span>Punch</span>
			<Slider
				value={contrast}
				min={CONTRAST_MIN}
				max={CONTRAST_MAX}
				step={0.05}
				ariaLabel="How far the mids sit under the hits"
				oninput={oncontrast}
				onchange={oncontrastdone} />
			<span class="ms mono">{contrast.toFixed(2)}</span>
		</div>
		<div class="trim">
			<span>Rate</span>
			<Segmented
				options={FPS_OPTIONS}
				value={String(fps)}
				ariaLabel="Frames a second on the wire"
				onpick={(id) => onfps(Number(id))} />
			<span class="hint subtle">
				<!-- The cap is the strip's, not this program's: one data line is 30 us per LED. -->
				{fps > 60 ? 'needs an output per strip' : fps < 60 ? 'below what the show was judged at' : 'fps'}
			</span>
		</div>
		<div class="trim">
			<span>Wire</span>
			<Segmented
				options={WIRE_OPTIONS}
				value={protocol}
				ariaLabel="Which wire the fixture is addressed on"
				onpick={(id) => onprotocol(id as WireProtocol)} />
			<span class="hint subtle">
				{protocol === 'sacn' ? '170 pixels a universe' : 'two packets a frame'}
			</span>
		</div>
	{/if}

	<div class="lamp">
		<StatusDot state={lamp.state} size={8} />
		<span class="name">{DEVICE_NAMES.bounce}</span>
		<div class="field">
			<input
				type="text"
				placeholder="192.168.0.107"
				spellcheck="false"
				autocomplete="off"
				aria-label="The Bounce Lamp's address"
				bind:value={lampDraft}
				oninput={() => (lampTouched = true)}
				onchange={() => ((lampTouched = false), onhost('bounce', lampDraft.trim()))}
				onkeydown={(e) => e.key === 'Enter' && e.currentTarget.blur()} />
		</div>
		<span class="lamp-state subtle">
			{#if lamp.identity}
				<span class="mono">{lamp.identity.firmware}</span>
			{:else if lamp.host}
				{HEADLINE[lamp.state]}
			{:else}
				one pixel, the show's accent
			{/if}
		</span>
	</div>

	{#if lamp.host}
		<!-- Its own, because it is a different fixture at a different distance in a corner. -->
		<div class="trim">
			<span>Level</span>
			<Slider
				value={lampBrightness}
				min={OUTPUT_BRIGHTNESS_MIN}
				max={1}
				step={0.01}
				ariaLabel="How much of full output the lamp gets"
				oninput={onlampbrightness}
				onchange={onlampbrightnessdone} />
			<span class="ms mono">{Math.round(lampBrightness * 100)}%</span>
		</div>
	{/if}

	<div class="body">
		<div class="device">
			<PicoBoard state={status.state} />

			{#if identity}
				<dl class="facts">
					<dt>Address</dt>
					<dd class="mono">{status.host}</dd>
					<dt>Firmware</dt>
					<dd><span class="mono">{identity.firmware}</span></dd>
					<dt>Ports</dt>
					<dd>
						<span class="mono">{identity.ddpPort}</span> in
						<span class="sep">·</span>
						<span class="mono">{identity.statsPort}</span> out
					</dd>
					<dt>Capacity</dt>
					<dd><span class="mono">{identity.pixels}</span> pixels</dd>
					<dt>Output</dt>
					<dd>
						{#if dark}
							<span class="warn">Lights nothing</span>
						{:else}
							<span class="mono">{identity.leds}</span>
						{/if}
					</dd>
					<dt>Awake</dt>
					<dd>{uptime(identity.uptimeS)}</dd>
					{#if status.latencyMs !== null}
						<dt>Round trip</dt>
						<dd><span class="mono">{status.latencyMs}</span> ms</dd>
					{/if}
				</dl>
			{:else}
				<p class="advice">
					{#if status.state === 'offline'}
						{status.message} Check it is powered and on this network; its console prints the
						address DHCP gave it.
					{:else if status.state === 'searching'}
						Asking that address who it is.
					{:else}
						Flash <span class="mono">firmware/</span>, then paste the address from its console.
						It offers the hostname <span class="mono">room-frame</span> over DHCP.
					{/if}
				</p>
			{/if}
		</div>

		{#if telemetry}
			<div class="figures">
				<div class="figure">
					<span class="value mono">{telemetry.fps.toFixed(1)}</span>
					<span class="label muted">fps</span>
				</div>
				<div class="figure">
					<span class="value mono">{telemetry.packetsPerSecond}</span>
					<span class="label muted">packets/s</span>
				</div>
				<div class="figure">
					<span class="value mono">{telemetry.kbPerSecond.toFixed(0)}</span>
					<span class="label muted">KB/s</span>
				</div>
				<div class="figure">
					<span class="value mono" class:bad={telemetry.torn > 0}>{telemetry.torn}</span>
					<span class="label muted">torn frames</span>
				</div>
			</div>

			<dl class="stream">
				<dt>Frame gap</dt>
				<dd>
					<span class="mono">{telemetry.gapMinMs.toFixed(1)}</span> to
					<span class="mono">{telemetry.gapMaxMs.toFixed(1)}</span> ms
				</dd>
				<dt>Late frames</dt>
				<dd>
					<span class="mono">{telemetry.late.join(' / ')}</span>
					<span class="subtle">past 20 / 50 / 100 ms</span>
				</dd>
				<dt>Assembly</dt>
				<dd><span class="mono">{telemetry.assemblyMaxMs.toFixed(1)}</span> ms worst</dd>
				<dt>Rejected</dt>
				<dd>
					<span class="mono">{telemetry.bad}</span> bad
					<span class="sep">·</span>
					<span class="mono">{telemetry.outOfRange}</span> out of range
				</dd>
				<dt>Fed</dt>
				<dd>
					<span class="mono">{telemetry.pixels}</span> of
					<span class="mono">{identity?.pixels ?? telemetry.pixels}</span> pixels
				</dd>
			</dl>

			{#if faults.length > 0}
				<p class="note">
					<Icon name="alert" size={14} />
					{faults.join(', ')} in the last second.
				</p>
			{/if}
		{/if}
	</div>
	</div>

	{#if dark}
		<footer>
			<Icon name="alert" size={13} />
			This build receives and scores the stream but lights nothing, so the room stays dark
			whatever these numbers say.
		</footer>
	{/if}
</Dialog>

<style>
	header {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 16px;
		flex: none;
		border-bottom: 1px solid var(--border);
	}
	h2 {
		font-size: 14px;
		font-weight: 600;
		flex: 1;
		min-width: 0;
	}
	.state {
		display: inline-flex;
		align-items: center;
		gap: 7px;
		flex: none;
		font-size: 12.5px;
		font-weight: 500;
		color: var(--muted-foreground);
	}
	.state.warn {
		color: var(--warn);
	}
	.state.bad {
		color: var(--bad);
	}
	.sep {
		opacity: 0.4;
	}
	.warn {
		color: var(--warn);
	}

	.address {
		display: flex;
		gap: 8px;
		padding: 14px 16px;
		flex: none;
		border-bottom: 1px solid var(--border);
	}
	.field {
		position: relative;
		display: flex;
		align-items: center;
		flex: 1;
		min-width: 0;
	}
	.field :global(svg) {
		position: absolute;
		left: 11px;
		color: var(--subtle-foreground);
		pointer-events: none;
	}
	.field input {
		width: 100%;
		height: var(--h);
		padding: 0 12px 0 35px;
		background: var(--card-raised);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		color: var(--foreground);
		font-size: 13.5px;
		font-family: var(--mono);
	}
	.field input:focus {
		outline: none;
		border-color: var(--ring);
	}

	.trim select {
		flex: 1;
		min-width: 0;
		padding: 5px 9px;
		background: var(--card-raised);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		color: var(--foreground);
		font: inherit;
	}
	.trim select:focus {
		outline: none;
		border-color: var(--ring);
	}

	/* The second device: one line, because it has one address and nothing to point at. */
	.lamp {
		display: flex;
		align-items: center;
		gap: 10px;
		padding: 11px 16px;
		flex: none;
		border-bottom: 1px solid var(--border);
	}
	.lamp .name {
		flex: none;
		font-size: 13px;
	}
	.lamp .field {
		flex: 1;
	}
	.lamp .field input {
		height: 30px;
		padding: 0 10px;
		font-size: 12.5px;
	}
	.lamp-state {
		flex: none;
		font-size: 12px;
	}

	.trim {
		display: flex;
		align-items: center;
		gap: 12px;
		padding: 11px 16px;
		flex: none;
		border-bottom: 1px solid var(--border);
		font-size: 13px;
		color: var(--muted-foreground);
	}
	.trim :global(.slider) {
		flex: 1;
		min-width: 0;
	}
	.ms {
		/* Fixed, so the digits changing under the thumb do not shove the slider around. */
		width: 58px;
		text-align: right;
		flex: none;
	}
	.hint {
		/* A picker's note is prose rather than digits, so it takes the row's spare width instead
		   of the slider's fixed column, where anything longer than "fps" wrapped three ways. */
		flex: 1;
		min-width: 0;
	}

	.scroll {
		flex: 1;
		overflow-y: auto;
		min-height: 0;
	}

	.body {
		padding: 16px;
	}

	.device {
		display: flex;
		align-items: center;
		gap: 20px;
		padding: 16px;
		border-radius: var(--radius-md);
		background: var(--card-raised);
		border: 1px solid var(--border-soft);
	}
	.advice {
		flex: 1;
		font-size: 13px;
		line-height: 1.6;
		color: var(--muted-foreground);
	}

	dl {
		display: grid;
		gap: 8px 14px;
		margin: 0;
		font-size: 13px;
	}
	.facts {
		flex: 1;
		grid-template-columns: auto 1fr;
		gap: 6px 14px;
	}
	.stream {
		grid-template-columns: 108px 1fr;
		margin-top: 16px;
	}
	dt {
		color: var(--subtle-foreground);
	}
	dd {
		margin: 0;
		color: var(--muted-foreground);
		display: flex;
		align-items: baseline;
		gap: 6px;
		flex-wrap: wrap;
	}

	.figures {
		display: grid;
		grid-template-columns: repeat(4, 1fr);
		gap: 8px;
		margin-top: 16px;
	}
	.figure {
		display: flex;
		flex-direction: column;
		gap: 3px;
		padding: 12px;
		border-radius: var(--radius-md);
		background: var(--card-raised);
		border: 1px solid var(--border-soft);
	}
	.value {
		font-size: 21px;
		font-weight: 600;
		letter-spacing: -0.02em;
		line-height: 1.1;
	}
	.value.bad {
		color: var(--bad);
	}
	.label {
		font-size: 11.5px;
	}

	.note {
		display: flex;
		align-items: center;
		gap: 8px;
		margin-top: 16px;
		padding: 10px 12px;
		border-radius: var(--radius-md);
		background: #fbbf2414;
		color: var(--warn);
		font-size: 12.5px;
	}

	footer {
		display: flex;
		align-items: center;
		gap: 9px;
		flex: none;
		padding: 11px 16px;
		border-top: 1px solid var(--border);
		background: var(--card);
		font-size: 12px;
		line-height: 1.5;
		color: var(--subtle-foreground);
	}
</style>
