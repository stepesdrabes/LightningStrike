<script lang="ts">
	import type { Show, TrackAnalysis, TrackContext } from '@mv/core';
	import { tempoSegments } from '@mv/core';
	import type { Readout } from '$lib/viz.svelte.ts';
	import type { AuthorEffort, Settings, Step } from '$lib/types.ts';
	import { titleCase } from '$lib/format.ts';
	import { activeCue } from '$lib/timeline.ts';
	import { menu } from '$lib/menu.svelte.ts';
	import Activity from './Activity.svelte';
	import Badge from '$lib/ui/Badge.svelte';
	import Button from '$lib/ui/Button.svelte';
	import Icon from '$lib/ui/Icon.svelte';
	import Input from '$lib/ui/Input.svelte';
	import Section from '$lib/ui/Section.svelte';
	import Spinner from '$lib/ui/Spinner.svelte';
	import Tabs from '$lib/ui/Tabs.svelte';

	let {
		analysis,
		context = null,
		show,
		readout,
		log,
		steps,
		warnings,
		trustNote = null,
		settings,
		canAuthor = false,
		authoring = false,
		onauthor,
		onmodel,
		oneffort,
		onkey,
		onrelevel,
		onreroll,
		relevelling = false,
		rerolling = false
	}: {
		analysis: TrackAnalysis | null;
		context?: TrackContext | null;
		show: Show | null;
		readout: Readout;
		log: string[];
		steps: Step[];
		warnings: string[];
		/** Why the current track runs in lounge rather than its show; null when it does not. */
		trustNote?: string | null;
		settings: Settings;
		canAuthor?: boolean;
		authoring?: boolean;
		onauthor: () => void;
		onmodel: (id: string) => void;
		oneffort: (effort: AuthorEffort) => void;
		onkey: (key: string) => void;
		onrelevel: (level: number) => void;
		onreroll: () => void;
		relevelling?: boolean;
		rerolling?: boolean;
	} = $props();

	const tempoMap = $derived(analysis ? tempoSegments(analysis.tempo) : []);

	/** Display labels only; effort IDs remain the API contract. */
	const EFFORTS: { id: AuthorEffort; label: string; note?: string }[] = [
		{ id: 'low', label: 'Low' },
		{ id: 'medium', label: 'Medium' },
		{ id: 'high', label: 'High', note: 'Default' },
		{ id: 'xhigh', label: 'Very high' },
		{ id: 'max', label: 'Max' }
	];

	const model = $derived(
		settings.authorModels.find((m) => m.id === settings.authorModel) ?? settings.authorModels[0]
	);
	const needsKey = $derived(model?.backend === 'deepseek' && !settings.hasDeepseekKey);
	let draftKey = $state('');

	/** Model and effort share a menu; only an unavailable key disables a model. */
	function openMenu(e: MouseEvent) {
		menu.show(
			e.currentTarget as HTMLElement,
			() => [
				{
					label: 'Model',
					value: settings.authorModel,
					items: settings.authorModels.map((m) => ({
						id: m.id,
						label: m.label,
						note: m.note,
						disabled: m.backend === 'deepseek' && !settings.hasDeepseekKey,
						title:
							m.backend === 'deepseek' && !settings.hasDeepseekKey
								? 'Needs a DeepSeek API key'
								: undefined
					}))
				},
				{ label: 'Effort', value: settings.authorEffort, items: EFFORTS }
			],
			(group, id) => (group === 0 ? onmodel(id) : oneffort(id as AuthorEffort))
		);
	}

	const TABS = [
		{ id: 'show', label: 'Show' },
		{ id: 'design', label: 'Design' },
		{ id: 'log', label: 'Log' }
	];

	let tab = $state('show');

	// Follow the agent automatically while it works, then hand the view back.
	let followed = $state(false);
	$effect(() => {
		if (steps.length > 0 && !followed) {
			followed = true;
			tab = 'design';
		}
	});

	let logEl: HTMLPreElement | undefined = $state();
	$effect(() => {
		// Depend on length so a new line scrolls the view.
		void log.length;
		if (logEl) logEl.scrollTop = logEl.scrollHeight;
	});

	const liveCue = $derived(activeCue(show, readout.bar));

	// Rerolling an agent show would discard paid work; use revision instead.
	const byAgent = $derived(show !== null && !!show.authoredBy && show.authoredBy !== 'engine');
	const liveTabs = $derived(steps.some((s) => s.state === 'pending') ? ['design'] : []);

	function layerList(cue: Show['cues'][number]): string {
		return Object.entries(cue.layers)
			.filter(([, v]) => v)
			.map(([role, v]) => `${role[0]}:${v!.effect}`)
			.join(' ');
	}

	// Sort once because agent cues need not arrive in bar order.
	const ordered = $derived(show ? [...show.cues].sort((a, b) => a.bar - b.bar) : []);

	function cuesIn(startBar: number, endBar: number): Show['cues'] {
		return ordered.filter((c) => c.bar >= startBar && c.bar < endBar);
	}

	/** Auto-open the active section unless manually toggled; reset overrides for each show. */
	let manual = $state<Record<string, boolean>>({});
	const keyFor = (index: number) => `${show?.analysisHash ?? ''}:${index}`;

	function isOpen(index: number, live: boolean): boolean {
		return manual[keyFor(index)] ?? live;
	}

	function toggle(index: number, live: boolean): void {
		manual[keyFor(index)] = !isOpen(index, live);
	}
</script>

<aside class="floats">
	<div class="head">
		<Tabs tabs={TABS} bind:value={tab} live={liveTabs} />
	</div>

	<div class="scroll">
		{#if tab === 'show'}
			<div class="action">

				<div class="split">
					<Button
						variant="primary"
						disabled={!canAuthor || authoring || needsKey}
						title={needsKey ? 'Needs a DeepSeek API key' : `${model?.label} at ${settings.authorEffort} effort`}
						onclick={onauthor}>
						{#if authoring}
							<Spinner size={14} />
							Designing
						{:else}
							<Icon name="sparkles" size={15} />
							{show ? 'Revise with AI' : 'Design with AI'}
						{/if}
					</Button>
					<Button
						variant="primary"
						size="icon"
						disabled={authoring}
						title="Which model, and how hard it thinks"
						ariaLabel="Choose the model and effort"
						onclick={openMenu}>
						<Icon name="chevronDown" size={15} />
					</Button>
				</div>
				{#if model}
					<p class="chose">{model.label} <span class="sep">·</span> {settings.authorEffort} effort</p>
				{/if}

				<Button
					variant="outline"
					disabled={!show || authoring || rerolling || byAgent}
					title={byAgent
						? `${show?.authoredBy} wrote this one, and the engine cannot improve on it. Revise instead.`
						: 'Compose this track again, differently'}
					onclick={onreroll}>
					{#if rerolling}
						<Spinner size={14} />
					{:else}
						<Icon name="retry" size={15} />
					{/if}
					Reroll
				</Button>

				{#if needsKey}
					<form
						class="key"
						onsubmit={(e) => {
							e.preventDefault();
							onkey(draftKey);
							draftKey = '';
						}}>
						<Input bind:value={draftKey} placeholder="DeepSeek API key" size="sm" />
						<Button type="submit" size="sm" variant="outline" disabled={draftKey.trim().length === 0}>
							Save
						</Button>
					</form>
				{/if}
			</div>

			{#if analysis}
				<Section title="Track">
					<!-- The record, then the one figure worth reading, then the facts you check once. -->
					<div class="track">
						<div class="who">
							<span class="named truncate">
								{context?.artist && context?.title
									? `${context.artist} - ${context.title}`
									: analysis.title}
							</span>
							{#if context?.genreFamily}
								<Badge title="the family the show was lit as">{context.genreFamily}</Badge>
							{/if}
						</div>

						<div class="tempo">
							<span class="figure mono">{analysis.tempo.bpm}</span>
							<span class="unit">bpm</span>
							<span class="conf mono subtle" title="margin over the runner-up reading">
								{analysis.tempo.confidence.toFixed(2)}
							</span>
							{#if analysis.tempo.ambiguous}
								<!-- Offer tempo correction only when the evidence is split. -->
								<Badge
									variant="warn"
									title="an unusual tempo for a tactus; a commoner reading of the same beats is offered beside it">
									Ambiguous
								</Badge>
							{/if}
							{#each analysis.tempo.alternativeBpm as alt (alt)}
								<Button
									variant="outline"
									size="sm"
									disabled={relevelling}
									title="re-read the whole grid at this level"
									onclick={() => onrelevel(alt / analysis.tempo.bpm)}>
									{Math.round(alt)}
								</Button>
							{/each}
						</div>

						{#if tempoMap.length > 1}

							<p class="facts subtle">
								{#each tempoMap as seg, i (seg.startBar)}
									{#if i > 0}<span class="sep">·</span>{/if}
									<span class="mono">{seg.bpm.toFixed(0)}</span> bpm from bar
									<span class="mono">{seg.startBar}</span>
								{/each}
							</p>
						{/if}

						<p class="facts subtle">
							<span class="mono">{analysis.tempo.beatsPerBar}/4</span>
							<span class="sep">·</span>
							phrase <span class="mono">{analysis.tempo.barsPerPhrase}</span>
							<span class="sep">·</span>
							<span class="mono">{analysis.bars.length}</span> bars
							<span class="sep">·</span>
							<span class="mono">{analysis.integratedLufs}</span> LUFS
							{#if context?.lyrics}
								<span class="sep">·</span>
								<span class="mono">{context.lyrics.length}</span> synced lines
							{:else if context?.instrumental}
								<span class="sep">·</span> instrumental
							{/if}
						</p>
					</div>
				</Section>


				<Section title="Arrangement">
					<ul class="sections">
						{#each analysis.sections as s (s.index)}
							{@const live = readout.bar >= s.startBar && readout.bar < s.endBar}
							{@const cues = cuesIn(s.startBar, s.endBar)}
							{@const open = cues.length > 0 && isOpen(s.index, live)}
							<li class:now={live}>
								<button
									class="row"
									aria-expanded={open}
									disabled={cues.length === 0}
									onclick={() => toggle(s.index, live)}>
									<span class="swatch" style:background={`var(--sec-${s.kind})`}></span>
									<span class="kind">{titleCase(s.kind)}</span>
									<span class="mono subtle">{s.startBar}-{s.endBar}</span>
									<span class="spacer"></span>
									{#if s.energyRank === 1}<Badge variant="live">Peak</Badge>{/if}
									<span class="mono subtle">{s.meanEnergy}</span>
									<span class="caret" class:open>
										{#if cues.length > 0}<Icon name="chevronDown" size={13} />{/if}
									</span>
								</button>

								{#if open}
									<ul class="cues">
										{#each cues as cue (cue.bar)}
											<li class:live={liveCue?.bar === cue.bar}>
												<span class="mono bar">{cue.bar}</span>
												<span class="mono energy" title="intensity">
													{(cue.intensity ?? show?.defaults.intensity ?? 0).toFixed(2)}
												</span>
												<span class="layers truncate" title={cue.note ?? ''}>
													{layerList(cue)}
												</span>
											</li>
										{/each}
									</ul>
								{/if}
							</li>
						{/each}
					</ul>
				</Section>
			{/if}

			{#if trustNote}
				<Section title="Lounge carries this track">
					<p class="brief">
						The analyser lost this grid ({trustNote}), so the calm scenes follow the track
						instead of the authored show. The queue row can override it.
					</p>
				</Section>
			{/if}

			{#if show}
				<Section title="Palette">
					<div class="palette">
						{#each [['Base', show.palette.base], ['Accent', show.palette.accent], ...(show.palette.third !== undefined ? [['Third', show.palette.third] as const] : [])] as const as [label, hue] (label)}
							<div class="chip">
								<span class="fill" style:background={`hsl(${hue} 88% 50%)`}></span>
								<span class="chip-label subtle">{label} <span class="mono">{hue}</span></span>
							</div>
						{/each}
					</div>
				</Section>

				<Section title="Brief">
					<p class="brief">{show.brief}</p>
				</Section>

				{#if show.generatedEffects.length > 0}
					<Section title="Written for this track">
						{#each show.generatedEffects as g (g.id)}
							<div class="gen">
								<span class="gen-head">
									<strong class="mono">{g.id}</strong>
									<Badge variant="outline">{g.role}</Badge>
								</span>
								<span class="muted">{g.blurb}</span>
							</div>
						{/each}
					</Section>
				{/if}
			{/if}

			{#if warnings.length > 0}
				<Section title="Linter notes">
					<ul class="warns">
						{#each warnings as w (w)}<li>{w}</li>{/each}
					</ul>
				</Section>
			{/if}

		{:else if tab === 'design'}
			{#if steps.length > 0}
				<div class="pad"><Activity {steps} /></div>
			{:else}
				<p class="empty subtle">Nothing yet. Press Design with AI.</p>
			{/if}
		{:else}
			<pre class="mono" bind:this={logEl}>{log.join('\n')}</pre>
		{/if}
	</div>
</aside>

<style>
	aside {
		width: var(--rail-right);
		flex: none;
		display: flex;
		flex-direction: column;
		background: var(--panel);
		backdrop-filter: var(--panel-blur);
		border-left: 1px solid var(--border);
		min-height: 0;
	}
	.head {
		flex: none;
		padding: 8px;
		border-bottom: 1px solid var(--border);
	}
	.scroll {
		flex: 1;
		overflow-y: auto;
		min-height: 0;
	}
	.pad {
		padding: 16px;
	}
	/* The panel's one action, and it is about the show the panel describes. */
	.action {
		padding: 16px 16px 0;
	}
	.action :global(.btn) {
		width: 100%;
	}

	/* A faint rule keeps the split control visually one button; a gap exposes the dark panel. */
	.split {
		display: flex;
	}
	.split :global(.btn:first-child) {
		border-radius: var(--radius-md) 0 0 var(--radius-md);
	}
	.split :global(.btn:last-child) {
		width: 34px;
		flex: none;
		border-radius: 0 var(--radius-md) var(--radius-md) 0;
		border-left-color: #00000024;
	}
	.chose {
		margin: 6px 0 10px;
		font-size: 11.5px;
		text-align: center;
		color: var(--subtle-foreground);
	}

	.key {
		display: flex;
		gap: 6px;
		margin-top: 8px;
	}
	.key :global(.btn) {
		width: auto;
		flex: none;
	}

	.track {
		display: flex;
		flex-direction: column;
		gap: 10px;
	}
	.who {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
	}
	.named {
		font-size: 13.5px;
		font-weight: 500;
		color: var(--foreground);
	}
	.tempo {
		display: flex;
		align-items: baseline;
		gap: 7px;
		flex-wrap: wrap;
	}
	.figure {
		font-size: 26px;
		font-weight: 600;
		letter-spacing: -0.02em;
		line-height: 1;
		color: var(--foreground);
	}
	.unit {
		font-size: 13px;
		color: var(--muted-foreground);
	}
	.conf {
		font-size: 12px;
	}
	.facts {
		margin: 0;
		font-size: 12px;
	}
	.sep {
		opacity: 0.4;
	}
	/* Aligned to the figure's baseline rather than sitting under it: they re-read the same number. */
	.tempo :global(.btn) {
		width: auto;
	}

	ul.sections {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 2px;
	}
	ul.sections > li {
		border-radius: var(--radius-sm);
	}
	ul.sections > li.now {
		background: var(--muted);
	}
	.row {
		display: flex;
		align-items: center;
		gap: 9px;
		width: 100%;
		padding: 5px 8px;
		border-radius: var(--radius-sm);
		font-size: 13px;
		text-align: left;
		color: var(--muted-foreground);
	}
	.row:hover:not(:disabled) {
		color: var(--foreground);
	}
	ul.sections > li.now .row {
		color: var(--foreground);
	}
	.caret {
		display: flex;
		width: 13px;
		flex: none;
		color: var(--subtle-foreground);
		transition: rotate 0.14s ease;
	}
	.caret.open {
		rotate: 180deg;
	}

	ul.cues {
		list-style: none;
		margin: 0;
		padding: 0 8px 6px 25px;
		display: flex;
		flex-direction: column;
		gap: 1px;
	}
	ul.cues li {
		display: flex;
		align-items: center;
		gap: 8px;
		padding: 2px 6px;
		border-radius: var(--radius-sm);
		font-size: 12px;
		color: var(--subtle-foreground);
	}
	ul.cues li.live {
		background: var(--card-raised);
		color: var(--foreground);
	}
	.bar {
		width: 26px;
		flex: none;
		text-align: right;
	}
	.energy {
		width: 30px;
		flex: none;
	}
	.layers {
		flex: 1;
		min-width: 0;
	}
	.swatch {
		width: 9px;
		height: 9px;
		border-radius: 3px;
		flex: none;
	}
	.kind {
		font-weight: 500;
	}
	.spacer {
		flex: 1;
	}

	.palette {
		display: flex;
		gap: 8px;
	}
	.chip {
		display: flex;
		flex-direction: column;
		gap: 6px;
		align-items: center;
	}
	.fill {
		width: 56px;
		height: 32px;
		border-radius: var(--radius-sm);
		box-shadow: inset 0 0 0 1px #ffffff1f;
	}
	.chip-label {
		font-size: 12px;
	}

	.brief {
		font-size: 13px;
		line-height: 1.6;
		color: var(--muted-foreground);
		white-space: pre-wrap;
	}
	.gen {
		display: flex;
		flex-direction: column;
		gap: 4px;
		margin-bottom: 12px;
		font-size: 13px;
	}
	.gen:last-child {
		margin-bottom: 0;
	}
	.gen-head {
		display: flex;
		align-items: center;
		gap: 7px;
	}
	ul.warns {
		margin: 0;
		padding-left: 17px;
		color: var(--warn);
		font-size: 12.5px;
		line-height: 1.6;
	}
	ul.warns li {
		margin-bottom: 5px;
	}

	pre {
		margin: 0;
		padding: 16px;
		white-space: pre-wrap;
		word-break: break-word;
		color: var(--muted-foreground);
		line-height: 1.65;
		font-size: 11.5px;
	}
	.empty {
		padding: 24px 16px;
		font-size: 13px;
	}
</style>
