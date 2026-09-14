<script lang="ts">
	import type { Show, TrackAnalysis, TrackContext } from '@mv/core';
	import type { EveningClient } from '$lib/evening.svelte.ts';
	import type { SegmentProjection } from '$lib/evening/plan.ts';
	import type { EveningRowView } from '$lib/evening/view.ts';
	import {
		ROW_ICON,
		ROW_LABEL,
		SEGMENT_ICON,
		SEGMENT_LABEL,
		clockTime,
		lengthLabel,
		untilLabel
	} from '$lib/evening/format.ts';
	import { clock } from '$lib/format.ts';
	import { menu } from '$lib/menu.svelte.ts';
	import type { QueueItem } from '$lib/queueModel.ts';
	import type { Readout } from '$lib/viz.svelte.ts';
	import Button from '$lib/ui/Button.svelte';
	import Dialog from '$lib/ui/Dialog.svelte';
	import Icon from '$lib/ui/Icon.svelte';
	import Input from '$lib/ui/Input.svelte';
	import Spinner from '$lib/ui/Spinner.svelte';
	import EveningStrip from './EveningStrip.svelte';
	import TrackDetails from './TrackDetails.svelte';

	let {
		evening,
		current,
		readout,
		analysis,
		context = null,
		show,
		trustNote = null,
		onrelevel,
		onreroll,
		relevelling = false,
		rerolling = false
	}: {
		evening: EveningClient;
		/** The queue's current row. */
		current: QueueItem | null;
		readout: Readout;
		analysis: TrackAnalysis | null;
		context?: TrackContext | null;
		show: Show | null;
		trustNote?: string | null;
		onrelevel: (level: number) => void;
		onreroll: () => void;
		relevelling?: boolean;
		rerolling?: boolean;
	} = $props();

	const view = $derived(evening.view);
	const live = $derived(view.status === 'running' || view.status === 'rehearsal');

	// The evening's clock ticks here between published views.
	let wall = $state(Date.now());
	$effect(() => {
		const timer = setInterval(() => (wall = Date.now()), 1000);
		return () => clearInterval(timer);
	});
	let receivedAt = $state(Date.now());
	$effect(() => {
		void view.now;
		receivedAt = Date.now();
	});
	const now = $derived(view.now + (wall - receivedAt));

	const errors = $derived(view.findings.filter((f) => f.severity === 'error'));
	const warnings = $derived(view.findings.filter((f) => f.severity === 'warning'));
	let showAllFindings = $state(false);
	const findings = $derived(
		[...errors, ...warnings, ...view.findings.filter((f) => f.severity === 'info')].slice(0, showAllFindings ? undefined : 3)
	);

	const songs = $derived([...view.past, ...view.rows].filter((r) => r.kind === 'song'));
	const readyCount = $derived(songs.filter((r) => r.ready).length);

	const currentSegment = $derived(view.segments.find((s) => s.state === 'current') ?? null);
	const nextSegment = $derived(
		view.segments.find((s) => s.state === 'upcoming' && s.id !== currentSegment?.id && s.startAt >= (currentSegment?.startAt ?? 0)) ?? null
	);
	const holding = $derived(live && current?.kind === 'hold');
	// Projections stand still while playback does; the clock itself keeps going.
	const projected = $derived(readout.playing ? now : view.now);
	const segmentLeft = $derived(currentSegment ? Math.max(0, (currentSegment.endAt - projected) / 1000) : 0);

	let expanded = $state<string | null>(null);
	let path = $state('');
	let confirming = $state<'start' | 'bail' | 'end' | null>(null);

	function fileName(file: string): string {
		return file.split(/[\\/]/).pop() ?? file;
	}

	function folderName(file: string): string {
		const parts = file.split(/[\\/]/);
		return parts.slice(-2, -1)[0] ?? '';
	}

	function rowsOf(segment: SegmentProjection): EveningRowView[] {
		return [...view.past, ...view.rows].filter((r) => r.segment === segment.id && r.kind !== 'sting');
	}

	function lengthOf(segment: SegmentProjection): string {
		if (segment.open) return 'open';
		const seconds = (segment.endAt - segment.startAt) / 1000;
		if (segment.kind === 'hold') return '';
		return lengthLabel(seconds);
	}

	function openMenu(e: MouseEvent) {
		menu.show(
			e.currentTarget as HTMLElement,
			() => [
				{
					items: [
						{ id: 'reload', label: 'Reload the file' },
						...(live ? [] : [{ id: 'close', label: 'Close the evening' }]),
						...(view.status === 'rehearsal' ? [{ id: 'end', label: 'End rehearsal' }] : []),
						...(view.status === 'running'
							? [
									{ id: 'bail', label: 'Bail out', note: 'keep the music' },
									{ id: 'end', label: 'End the evening' }
								]
							: []),
						...(view.setAside > 0 && !live ? [{ id: 'restore', label: 'Restore the queue', note: `${view.setAside} rows` }] : [])
					]
				}
			],
			(_group, id) => {
				if (id === 'reload') void evening.reload();
				else if (id === 'close') void evening.close();
				else if (id === 'bail') confirming = 'bail';
				else if (id === 'end') {
					if (view.status === 'rehearsal') void evening.end();
					else confirming = 'end';
				} else if (id === 'restore') void evening.restore();
			}
		);
	}

	function start() {
		if (errors.length > 0) confirming = 'start';
		else void evening.start();
	}

	async function confirm() {
		const action = confirming;
		confirming = null;
		if (action === 'start') await evening.start();
		else if (action === 'bail') await evening.bail();
		else if (action === 'end') await evening.end();
	}
</script>

<aside class="floats">
	<div class="scroll">
		{#if view.status === 'idle' || !view.file}
			<section class="open">
				<header><h2>Evening</h2></header>
				{#if view.files.length > 0}
					<ul class="files">
						{#each view.files as file (file)}
							<li>
								<button class="file" onclick={() => void evening.open(file)} title={file}>
									<Icon name="file" size={15} />
									<span class="truncate">{fileName(file)}</span>
									<span class="folder truncate">{folderName(file)}</span>
								</button>
							</li>
						{/each}
					</ul>
				{/if}
				<form
					class="path"
					onsubmit={(e) => {
						e.preventDefault();
						if (path.trim()) void evening.open(path.trim());
					}}>
					<Input bind:value={path} placeholder="Path to an evening file" size="sm" />
					<Button type="submit" size="sm" variant="outline" disabled={!path.trim()}>Open</Button>
				</form>
				{#if evening.failure}<p class="failure">{evening.failure}</p>{/if}
			</section>
		{:else}
			<section class="head">
				<div class="title-row">
					<div class="titles">
						<h2 class="truncate" title={view.file ?? ''}>{view.name ?? fileName(view.file)}</h2>
						<span class="sub truncate">{fileName(view.file)}</span>
					</div>
					{#if view.loading}<Spinner size={14} />{/if}
					{#if live}
						<span class="state live"><i></i>{view.status === 'rehearsal' ? 'Rehearsal' : 'Live'}</span>
					{:else if view.status === 'ended'}
						<span class="state">{view.bailed ? 'Bailed out' : 'Ended'}</span>
					{/if}
					<Button variant="ghost" size="icon-sm" ariaLabel="Evening actions" onclick={openMenu}>
						<Icon name="more" size={16} />
					</Button>
				</div>
				{#if live}
					<p class="clock">
						<span class="mono">{clockTime(now)}</span>
						{#if view.endsAt}<span class="sub">· ends about <span class="mono">{clockTime(view.endsAt)}</span></span>{/if}
					</p>
				{/if}
				{#if evening.failure}<p class="failure">{evening.failure}</p>{/if}
			</section>

			{#if findings.length > 0}
				<section class="findings">
					<ul>
						{#each findings as finding, i (i)}
							<li class={finding.severity}>
								<Icon name="alert" size={13} />
								<span class="message">
									{finding.message}
									{#if finding.line}<span class="line">line {finding.line.line}</span>{/if}
								</span>
							</li>
						{/each}
					</ul>
					{#if view.findings.length > 3}
						<button class="more-findings" onclick={() => (showAllFindings = !showAllFindings)}>
							{showAllFindings ? 'Show fewer' : `Show all ${view.findings.length}`}
						</button>
					{/if}
				</section>
			{/if}

			{#if !live && view.status !== 'ended'}
				<section class="ready">
					<div class="prepared">
						{#if view.prepare.running}
							<span class="sub truncate">
								Preparing {view.prepare.current ?? ''}
							</span>
							<span class="mono count">{view.prepare.done} / {view.prepare.total}</span>
						{:else}
							<span class="sub">
								<span class="mono">{readyCount}</span> of <span class="mono">{songs.length}</span> songs prepared
							</span>
							<Button size="sm" variant="ghost" disabled={readyCount === songs.length} onclick={() => void evening.prepare()}>
								Prepare
							</Button>
						{/if}
					</div>
					{#if view.prepare.running}
						<div class="bar"><i style:width="{(view.prepare.done / Math.max(1, view.prepare.total)) * 100}%"></i></div>
					{/if}
					<div class="actions">
						<Button variant="primary" onclick={start}>
							<Icon name="play" size={14} fill />
							Start evening
						</Button>
						<Button variant="secondary" onclick={() => void evening.rehearse()}>Rehearse</Button>
					</div>
				</section>
			{/if}

			{#if live && current}
				<section class="now">
					<div class="label-row">
						<Icon name={holding ? 'hold' : ROW_ICON[current.kind ?? 'song']} size={14} />
						<span class="segment truncate">{currentSegment?.name ?? current.evening?.name ?? ''}</span>
						{#if currentSegment && !holding}
							<span class="sub right"><span class="mono">{lengthLabel(segmentLeft)}</span> left</span>
						{/if}
					</div>
					{#if holding}
						<p class="waiting">
							Waiting for Go <span class="mono">{clock(Math.max(0, (now - (view.hold?.since ?? now)) / 1000))}</span>
						</p>
						<Button variant="primary" onclick={() => void evening.go()}>
							<Icon name="play" size={15} fill />
							Go
						</Button>
					{:else}
						<p class="title truncate">{current.kind && current.kind !== 'song' ? ROW_LABEL[current.kind] : current.title}</p>
						{#if (current.kind ?? 'song') === 'song'}<p class="sub truncate">{current.uploader}</p>{/if}
						<div class="bar live"><i style:width="{(readout.duration > 0 ? Math.min(1, readout.position / readout.duration) : 0) * 100}%"></i></div>
						<div class="times">
							<span class="mono">{clock(readout.position)}</span>
							<span class="mono">-{clock(Math.max(0, readout.duration - readout.position))}</span>
						</div>
					{/if}
					<div class="controls">
						<Button variant="ghost" size="icon-sm" ariaLabel="Back a segment" title="Back a segment" onclick={() => void evening.skip(-1)}>
							<Icon name="segmentBack" size={16} />
						</Button>
						<Button
							variant={view.holdsAfter.includes(currentSegment?.id ?? '') ? 'secondary' : 'ghost'}
							size="sm"
							disabled={holding}
							title="Wait for Go when this segment ends"
							onclick={() => void evening.holdAfter()}>
							<Icon name="hold" size={14} />
							{view.holdsAfter.includes(currentSegment?.id ?? '') ? 'Holding after this' : 'Hold after this'}
						</Button>
						<Button variant="ghost" size="icon-sm" ariaLabel="Forward a segment" title="Forward a segment" onclick={() => void evening.skip(1)}>
							<Icon name="segmentForward" size={16} />
						</Button>
					</div>
				</section>

				{#if currentSegment && view.holdsAfter.includes(currentSegment.id)}
					<section class="next">
						<span class="sub">Next</span>
						<Icon name="hold" size={14} />
						<span class="name truncate">Waiting for Go</span>
						<span class="sub right">then {nextSegment?.name ?? 'the end'}</span>
					</section>
				{:else if nextSegment}
					<section class="next">
						<span class="sub">Next</span>
						<Icon name={SEGMENT_ICON[nextSegment.kind]} size={14} />
						<span class="name truncate">{nextSegment.name}</span>
						<span class="sub right"><span class="mono">{clockTime(nextSegment.startAt)}</span> · {untilLabel(nextSegment.startAt, projected)}</span>
					</section>
				{/if}
			{/if}

			{#if view.status === 'ended' && view.setAside > 0}
				<section class="ended">
					<Button variant="secondary" onclick={() => void evening.restore()}>
						<Icon name="retry" size={14} />
						Restore the queue
					</Button>
				</section>
			{/if}

			{#if view.segments.length > 0}
				<section class="outline">
					{#if view.past.length + view.rows.length > 0}
						<EveningStrip
							rows={[...view.past, ...view.rows]}
							{now}
							seekable={view.status === 'rehearsal'}
							onseek={(t) => void evening.seek(t)} />
					{/if}
					<ul class="segments">
						{#each view.segments as segment (segment.id)}
							{@const open = expanded === segment.id}
							<li class={segment.state}>
								<button class="segment" aria-expanded={open} onclick={() => (expanded = open ? null : segment.id)}>
									<span class="mono time">{segment.state === 'done' ? '' : clockTime(segment.startAt)}</span>
									<span class="kind" title={SEGMENT_LABEL[segment.kind]}><Icon name={SEGMENT_ICON[segment.kind]} size={13} /></span>
									<span class="name truncate">{segment.name}</span>
									{#if segment.anchor && segment.state !== 'done'}
										{@const late = segment.anchor.late}
										<span class="anchor" class:late={late > 60} title={`${segment.anchor.kind === 'at' ? 'At' : 'Not before'} ${segment.anchor.clock}`}>
											{late > 60 ? `+${Math.round(late / 60)} min` : segment.anchor.clock}
										</span>
									{/if}
									<span class="length">{lengthOf(segment)}</span>
								</button>
								{#if open}
									<ul class="rows">
										{#each rowsOf(segment) as row (row.key)}
											<li class:playing={row.key === current?.key}>
												<button
													class="row"
													disabled={!live || row.key === current?.key}
													title={live ? 'Jump here' : ''}
													onclick={() => void evening.jump(row.key)}>
													<span class="mono time">{row.startAt >= now - 1000 || row.key === current?.key ? clockTime(row.startAt) : ''}</span>
													<Icon name={ROW_ICON[row.kind]} size={12} />
													<span class="truncate">{row.kind === 'song' ? row.title : ROW_LABEL[row.kind]}</span>
													{#if row.addedBy}<span class="guest">{row.addedBy}</span>{/if}
													{#if row.kind === 'song' && !row.ready}<span class="unready" title="Not prepared yet"></span>{/if}
												</button>
											</li>
										{:else}
											<li class="empty">Played</li>
										{/each}
									</ul>
								{/if}
							</li>
						{/each}
					</ul>
					{#if view.waiting > 0}
						<p class="sub requests"><span class="mono">{view.waiting}</span> {view.waiting === 1 ? 'request waits' : 'requests wait'} for a slot</p>
					{/if}
				</section>
			{/if}
		{/if}

		{#if analysis && (current?.kind ?? 'song') === 'song'}
			<div class="track-divider"></div>
			<TrackDetails {analysis} {context} {show} {readout} {trustNote} {onrelevel} {onreroll} {relevelling} {rerolling} />
		{/if}
	</div>
</aside>

<Dialog open={confirming !== null} onclose={() => (confirming = null)} labelledBy="evening-confirm" width="min(420px, calc(100vw - 32px))">
	<div class="confirm">
		{#if confirming === 'start'}
			<h2 id="evening-confirm">Start with {errors.length} {errors.length === 1 ? 'problem' : 'problems'}?</h2>
			<ul>
				{#each errors.slice(0, 5) as finding, i (i)}<li>{finding.message}</li>{/each}
			</ul>
			<p>The evening runs anyway; what cannot play is left out.</p>
		{:else if confirming === 'bail'}
			<h2 id="evening-confirm">Bail out of the evening?</h2>
			<p>The song playing now carries on and the planned songs stay as a plain queue. Holds, pauses and light moments are dropped.</p>
		{:else if confirming === 'end'}
			<h2 id="evening-confirm">End the evening?</h2>
			<p>Playback stops and the queue from before the evening comes back.</p>
		{/if}
		<div class="confirm-actions">
			<Button variant="ghost" onclick={() => (confirming = null)}>Cancel</Button>
			<Button variant={confirming === 'start' ? 'primary' : 'danger'} onclick={() => void confirm()}>
				{confirming === 'start' ? 'Start anyway' : confirming === 'bail' ? 'Bail out' : 'End evening'}
			</Button>
		</div>
	</div>
</Dialog>

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
	.scroll {
		flex: 1;
		overflow-y: auto;
		min-height: 0;
	}
	section {
		padding: 14px 16px;
		border-bottom: 1px solid var(--border-soft);
	}
	h2 {
		font-size: 14px;
		font-weight: 600;
		letter-spacing: -0.005em;
	}
	.sub {
		font-size: 12px;
		color: var(--subtle-foreground);
	}
	.right {
		margin-left: auto;
		flex: none;
	}
	.failure {
		margin-top: 8px;
		font-size: 12.5px;
		color: var(--bad);
	}

	.open header {
		margin-bottom: 10px;
	}
	.files {
		list-style: none;
		margin: 0 -8px 10px;
		padding: 0;
	}
	.file {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		padding: 6px 8px;
		border-radius: var(--radius-sm);
		font-size: 13px;
		color: var(--foreground);
		text-align: left;
	}
	.file :global(.lucide-icon) {
		color: var(--subtle-foreground);
	}
	.file:hover {
		background: var(--muted);
	}
	.folder {
		margin-left: auto;
		font-size: 12px;
		color: var(--subtle-foreground);
	}
	.path {
		display: flex;
		gap: 6px;
	}

	.title-row {
		display: flex;
		align-items: center;
		gap: 8px;
		min-width: 0;
	}
	.titles {
		display: flex;
		flex-direction: column;
		min-width: 0;
		flex: 1;
	}
	.state {
		display: inline-flex;
		align-items: center;
		gap: 6px;
		height: 20px;
		padding: 0 8px;
		border-radius: 999px;
		background: var(--muted);
		color: var(--muted-foreground);
		font-size: 11.5px;
		font-weight: 500;
		flex: none;
	}
	.state.live {
		background: #ff6a1a1f;
		color: var(--live);
	}
	.state i {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: currentColor;
		animation: pulse 1.6s ease-in-out infinite;
	}
	@keyframes pulse {
		50% {
			opacity: 0.35;
		}
	}
	.clock {
		margin-top: 6px;
		display: flex;
		align-items: baseline;
		gap: 6px;
	}
	.clock > .mono {
		font-size: 13px;
		color: var(--foreground);
	}

	.findings ul {
		list-style: none;
		margin: 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 6px;
	}
	.findings li {
		display: flex;
		gap: 8px;
		font-size: 12.5px;
		line-height: 1.5;
		color: var(--muted-foreground);
	}
	.findings li :global(.lucide-icon) {
		margin-top: 3px;
		color: var(--subtle-foreground);
	}
	.findings li.error :global(.lucide-icon) {
		color: var(--bad);
	}
	.findings li.warning :global(.lucide-icon) {
		color: var(--warn);
	}
	.line {
		margin-left: 4px;
		color: var(--subtle-foreground);
		white-space: nowrap;
	}
	.more-findings {
		margin-top: 8px;
		font-size: 12px;
		color: var(--subtle-foreground);
	}
	.more-findings:hover {
		color: var(--foreground);
	}

	.prepared {
		display: flex;
		align-items: center;
		gap: 8px;
		min-height: 30px;
	}
	.prepared .sub {
		flex: 1;
		min-width: 0;
	}
	.count {
		color: var(--muted-foreground);
	}
	.bar {
		height: 3px;
		border-radius: 99px;
		background: var(--muted);
		overflow: hidden;
		margin: 8px 0 2px;
	}
	.bar i {
		display: block;
		height: 100%;
		background: var(--foreground);
		border-radius: 99px;
		transition: width 0.3s ease;
	}
	.bar.live i {
		background: var(--live);
		transition: width 0.25s linear;
	}
	.actions {
		display: flex;
		gap: 8px;
		margin-top: 10px;
	}
	.actions :global(.btn:first-child) {
		flex: 1;
	}

	.label-row {
		display: flex;
		align-items: center;
		gap: 7px;
		min-width: 0;
		color: var(--muted-foreground);
	}
	.label-row :global(.lucide-icon) {
		color: var(--live);
	}
	.segment {
		font-size: 12.5px;
		font-weight: 500;
	}
	.now .title {
		margin-top: 8px;
		font-size: 15px;
		font-weight: 600;
		letter-spacing: -0.01em;
	}
	.waiting {
		margin: 8px 0 10px;
		font-size: 13px;
		color: var(--muted-foreground);
	}
	.waiting .mono {
		margin-left: 4px;
		color: var(--foreground);
	}
	.now > :global(.btn.primary) {
		width: 100%;
		height: 40px;
		font-size: 14px;
	}
	.times {
		display: flex;
		justify-content: space-between;
		color: var(--subtle-foreground);
	}
	.times .mono {
		font-size: 11px;
	}
	.controls {
		display: flex;
		align-items: center;
		justify-content: space-between;
		margin-top: 10px;
	}

	.next {
		display: flex;
		align-items: center;
		gap: 8px;
		color: var(--muted-foreground);
	}
	.next :global(.lucide-icon) {
		color: var(--subtle-foreground);
		flex: none;
	}
	.next .name {
		font-size: 13px;
		color: var(--foreground);
	}

	.ended :global(.btn) {
		width: 100%;
	}

	.outline {
		padding-top: 30px;
	}
	.segments {
		list-style: none;
		margin: 12px -8px 0;
		padding: 0;
		display: flex;
		flex-direction: column;
		gap: 1px;
	}
	.segments > li {
		border-radius: var(--radius-sm);
	}
	.segments > li.current {
		background: var(--muted);
	}
	.segments > li.done {
		opacity: 0.5;
	}
	.segments .segment {
		display: grid;
		grid-template-columns: 38px 16px 1fr auto auto;
		align-items: center;
		gap: 8px;
		width: 100%;
		padding: 5px 8px;
		border-radius: var(--radius-sm);
		font-weight: 400;
		text-align: left;
		color: var(--muted-foreground);
	}
	.segments .segment:hover {
		color: var(--foreground);
	}
	.segments > li.current .segment {
		color: var(--foreground);
	}
	.time {
		font-size: 11.5px;
		color: var(--subtle-foreground);
	}
	.kind {
		display: grid;
		place-items: center;
		color: var(--subtle-foreground);
	}
	.segments > li.current .kind {
		color: var(--live);
	}
	.segments .name {
		font-size: 13px;
	}
	.anchor {
		font-size: 11.5px;
		color: var(--subtle-foreground);
	}
	.anchor.late {
		color: var(--warn);
	}
	.length {
		font-size: 12px;
		color: var(--subtle-foreground);
		text-align: right;
		min-width: 44px;
	}
	.rows {
		list-style: none;
		margin: 0;
		padding: 0 0 6px;
	}
	.rows .row {
		display: grid;
		grid-template-columns: 38px 16px 1fr auto auto;
		align-items: center;
		gap: 8px;
		width: 100%;
		padding: 3px 8px;
		font-size: 12.5px;
		text-align: left;
		color: var(--subtle-foreground);
	}
	.rows .row :global(.lucide-icon) {
		justify-self: center;
	}
	.rows .row:hover:not(:disabled) {
		color: var(--foreground);
	}
	.rows li.playing .row {
		color: var(--foreground);
	}
	.rows li.empty {
		padding: 3px 8px 3px 62px;
		font-size: 12px;
		color: var(--subtle-foreground);
	}
	.guest {
		font-size: 11.5px;
		color: var(--muted-foreground);
	}
	.unready {
		width: 5px;
		height: 5px;
		border-radius: 50%;
		background: var(--warn);
	}
	.requests {
		margin-top: 10px;
	}

	.track-divider {
		height: 1px;
		background: var(--border);
	}

	.confirm {
		display: flex;
		flex-direction: column;
		gap: 12px;
		padding: 20px 22px;
	}
	.confirm h2 {
		font-size: 15px;
	}
	.confirm p,
	.confirm li {
		font-size: 13px;
		line-height: 1.6;
		color: var(--muted-foreground);
	}
	.confirm ul {
		margin: 0;
		padding-left: 18px;
	}
	.confirm-actions {
		display: flex;
		justify-content: flex-end;
		gap: 8px;
		margin-top: 4px;
	}
</style>
