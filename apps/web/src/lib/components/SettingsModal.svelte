<script lang="ts">
	import type {
		AnalysisModelId,
		AnalysisProvider,
		Settings,
		SystemInfo,
		YouTubeBrowser,
		YouTubeSession
	} from '$lib/types.ts';
	import Button from '$lib/ui/Button.svelte';
	import Dialog from '$lib/ui/Dialog.svelte';
	import Icon from '$lib/ui/Icon.svelte';
	import Segmented from '$lib/ui/Segmented.svelte';
	import Spinner from '$lib/ui/Spinner.svelte';
	import Switch from '$lib/ui/Switch.svelte';

	let {
		open = false,
		settings,
		youtubeSession = null,
		onclose,
		onanalysismodel,
		onanalysisprovider,
		onyoutubebrowser,
		onautopilot,
		onrest
	}: {
		open?: boolean;
		settings: Settings;
		/** What the last check found in the chosen browser; null while it runs. */
		youtubeSession?: YouTubeSession | null;
		onclose: () => void;
		onanalysismodel: (id: AnalysisModelId) => void;
		onanalysisprovider: (id: AnalysisProvider) => void;
		onyoutubebrowser: (browser: YouTubeBrowser | 'none') => void;
		onautopilot: (on: boolean) => void;
		onrest: (on: boolean) => void;
	} = $props();

	let system = $state<SystemInfo | null>(null);

	// Read on every opening: the library grows and tools get upgraded while the app runs.
	$effect(() => {
		if (!open) return;
		void fetch('/api/system')
			.then((r) => (r.ok ? (r.json() as Promise<SystemInfo>) : null))
			.then((info) => (system = info))
			.catch(() => {});
	});

	const modelOptions = $derived(
		settings.analysisModels.map((m) => ({
			id: m.id,
			label: m.label,
			disabled: m.problem !== null && m.id !== settings.analysisModel,
			title: m.problem ?? m.name ?? undefined
		}))
	);
	const chosen = $derived(settings.analysisModels.find((m) => m.id === settings.analysisModel));
	const providerOptions: { id: AnalysisProvider; label: string; title: string }[] = [
		{ id: 'auto', label: 'Auto', title: 'The graphics card (Core ML, DirectML or CUDA) once it passes its check, else the CPU' },
		{ id: 'cpu', label: 'CPU', title: 'The processor only' }
	];

	const BROWSER_LABELS: Record<YouTubeBrowser, string> = {
		brave: 'Brave', chrome: 'Chrome', edge: 'Edge', firefox: 'Firefox', safari: 'Safari'
	};
	const youtubeOptions = $derived([
		{ id: 'none' as const, label: 'Off', title: 'Download signed out' },
		...settings.youtubeBrowsers.map((b) => ({
			id: b, label: BROWSER_LABELS[b], title: `Download with ${BROWSER_LABELS[b]}'s YouTube sign-in`
		}))
	]);
	const session = $derived(youtubeSession?.browser === settings.youtubeBrowser ? youtubeSession : null);

	function size(bytes: number): string {
		if (bytes >= 1e9) return `${(bytes / 1e9).toFixed(1)} GB`;
		return `${Math.round(bytes / 1e6)} MB`;
	}

	function show(which: 'cache' | 'models') {
		void fetch('/api/system', {
			method: 'POST',
			headers: { 'content-type': 'application/json' },
			body: JSON.stringify({ reveal: which })
		});
	}

	const finder = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform) ? 'Show in Finder' : 'Show folder';
</script>

<Dialog {open} {onclose} width="min(580px, calc(100vw - 32px))" labelledBy="settings-title">
	<header>
		<span class="bolt"><Icon name="bolt" size={13} fill /></span>
		<h2 id="settings-title">Settings</h2>
		<kbd>⌘,</kbd>
	</header>

	<div class="scroll">
		<section>
			<h3>Analysis</h3>
			<div class="row">
				<span class="label">Model</span>
				<Segmented
					options={modelOptions}
					value={settings.analysisModel}
					ariaLabel="The model that prepares songs"
					onpick={onanalysismodel} />
			</div>
			<div class="row">
				<span class="label">Runs on</span>
				<Segmented
					options={providerOptions}
					value={settings.analysisProvider}
					ariaLabel="Where the model runs"
					onpick={onanalysisprovider} />
			</div>
			<p class="note" class:warn={chosen?.problem}>
				{#if chosen?.problem}
					{chosen.problem}
				{:else if chosen?.name}
					{chosen.name}. Auto uses the graphics card only after it gives every event exactly as the
					CPU does; switching never changes what the room hears.
				{/if}
			</p>
		</section>

		<section>
			<h3>YouTube</h3>
			<div class="row">
				<span class="label">Sign in with</span>
				<Segmented
					options={youtubeOptions}
					value={settings.youtubeBrowser}
					ariaLabel="The browser whose YouTube sign-in downloads use"
					onpick={onyoutubebrowser} />
			</div>
			<p class="note" class:warn={session?.problem}>
				{#if settings.youtubeBrowser === 'none'}
					Downloads go signed out. Choose the browser you watch YouTube in if a network refuses them;
					only YouTube receives its cookies.
				{:else if !session}
					<Spinner size={11} /> Checking {BROWSER_LABELS[settings.youtubeBrowser]}'s sign-in. macOS may ask
					once to let it read the browser's cookie key.
				{:else if session.problem}
					{session.problem}
				{:else}
					<span class="ok"><Icon name="check" size={12} /> Signed in</span>; downloads use
					{BROWSER_LABELS[settings.youtubeBrowser]}'s YouTube session.
				{/if}
			</p>
		</section>

		<section>
			<h3>Playback</h3>
			<div class="row">
				<span class="label">Radio</span>
				<span class="what">Keep the queue going with songs like the last one</span>
				<Switch checked={settings.autopilot} ariaLabel="Radio" onchange={onautopilot} />
			</div>
			<div class="row">
				<span class="label">Rest</span>
				<span class="what">Drift into ambient scenes when nothing plays</span>
				<Switch checked={settings.rest} ariaLabel="Rest" onchange={onrest} />
			</div>
		</section>

		<section>
			<h3>Storage</h3>
			<div class="row">
				<span class="label">Library</span>
				<span class="path" title={system?.cacheDir}><bdi>{system?.cacheDir ?? ''}</bdi></span>
				<Button size="sm" variant="ghost" onclick={() => show('cache')}>
					<Icon name="folder" size={13} />{finder}
				</Button>
			</div>
			<div class="row">
				<span class="label">Models</span>
				<span class="path" title={system?.modelDir}><bdi>{system?.modelDir ?? ''}</bdi></span>
				<Button size="sm" variant="ghost" onclick={() => show('models')}>
					<Icon name="folder" size={13} />{finder}
				</Button>
			</div>
			{#if system}
				<p class="note">
					<span class="mono">{system.library.songs}</span> {system.library.songs === 1 ? 'song' : 'songs'} prepared,
					<span class="mono">{size(system.library.bytes)}</span> with {system.library.songs === 1 ? 'its' : 'their'} audio.
				</p>
			{/if}
		</section>

		<section>
			<h3>Tools</h3>
			{#each system?.tools ?? [] as tool (tool.name)}
				<div class="row tool">
					<span class="label">{tool.name}</span>
					{#if tool.version}<span class="mono version">{tool.version}</span>{/if}
					{#if tool.note}<span class="what warn">{tool.note}</span>{/if}
				</div>
			{:else}
				<div class="row"><Spinner size={12} /></div>
			{/each}
		</section>
	</div>

	{#if system}
		<footer>
			Analysis <span class="mono">{system.runtime.analysis}</span> · Show <span class="mono">{system.runtime.show}</span> ·
			Node <span class="mono">{system.runtime.node}</span>
			{#if system.runtime.onnxruntime}· ONNX Runtime <span class="mono">{system.runtime.onnxruntime}</span>{/if}
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
	.bolt {
		display: grid;
		place-items: center;
		width: 22px;
		height: 22px;
		border-radius: 6px;
		background: var(--foreground);
		color: var(--background);
	}
	h2 {
		flex: 1;
		font-size: 14px;
		font-weight: 600;
	}
	kbd {
		padding: 1px 6px;
		border: 1px solid var(--border);
		border-radius: 5px;
		font-family: var(--sans);
		font-size: 11px;
		color: var(--subtle-foreground);
	}
	.scroll {
		overflow-y: auto;
		min-height: 0;
	}
	section {
		padding: 14px 16px 12px;
		border-bottom: 1px solid var(--border-soft);
	}
	h3 {
		margin-bottom: 8px;
		font-size: 12.5px;
		font-weight: 600;
		color: var(--foreground);
	}
	.row {
		display: flex;
		align-items: center;
		gap: 12px;
		min-height: 34px;
		font-size: 13px;
		color: var(--muted-foreground);
	}
	.label {
		width: 92px;
		flex: none;
		color: var(--muted-foreground);
	}
	.tool .label {
		font-family: var(--sans);
	}
	.what {
		flex: 1;
		min-width: 0;
		font-size: 12.5px;
		color: var(--subtle-foreground);
	}
	.path {
		flex: 1;
		min-width: 0;
		overflow: hidden;
		white-space: nowrap;
		text-overflow: ellipsis;
		direction: rtl;
		text-align: left;
		font-size: 12.5px;
		color: var(--subtle-foreground);
	}
	.version {
		font-size: 12px;
		color: var(--foreground);
	}
	.note {
		margin-top: 4px;
		padding-left: 104px;
		font-size: 12px;
		line-height: 1.5;
		color: var(--subtle-foreground);
	}
	.warn {
		color: var(--warn);
	}
	.ok {
		display: inline-flex;
		align-items: center;
		gap: 4px;
		vertical-align: -2px;
		color: var(--ok);
	}
	.note :global(.spinner) {
		display: inline-block;
		vertical-align: -1px;
		margin-right: 4px;
	}
	.mono {
		font-family: var(--mono);
	}
	footer {
		padding: 10px 16px;
		font-size: 11.5px;
		color: var(--subtle-foreground);
	}
	footer .mono {
		font-size: 11px;
	}
</style>
