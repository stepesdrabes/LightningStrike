<script lang="ts">
	import { menu } from '$lib/menu.svelte.ts';
	import Icon from './Icon.svelte';

	/** Enough for the model list without the effort group falling off a short window. */
	const MAX_HEIGHT = 420;
	const GAP = 6;
	const WIDTH = 260;

	let panel: HTMLDivElement | undefined = $state();

	// Rebuilt rather than snapshotted, so a tick moves the moment the choice behind it does.
	const groups = $derived(menu.build?.() ?? []);

	/** DOMRect and fixed positioning both use viewport coordinates; close on scroll or resize. */
	const placement = $derived.by(() => {
		const rect = menu.anchor;
		if (!rect) return null;
		const below = window.innerHeight - rect.bottom - GAP;
		const above = rect.top - GAP;
		const flip = below < 220 && above > below;
		return {
			left: Math.max(8, Math.min(rect.right - WIDTH, window.innerWidth - WIDTH - 8)),
			top: flip ? undefined : rect.bottom + GAP,
			bottom: flip ? window.innerHeight - rect.top + GAP : undefined,
			maxHeight: Math.min(MAX_HEIGHT, (flip ? above : below) - 8)
		};
	});

	$effect(() => {
		if (!menu.open || !panel) return;
		// The chosen item rather than the first, so the keyboard starts where the eye does.
		const focus = panel.querySelector<HTMLElement>('[aria-checked="true"]:not([disabled])');
		(focus ?? panel.querySelector<HTMLElement>('button:not([disabled])'))?.focus();
	});

	function onkeydown(e: KeyboardEvent) {
		if (!menu.open) return;
		if (e.key === 'Escape') {
			e.stopPropagation();
			menu.close();
			return;
		}
		if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp' && e.key !== 'Tab') return;
		if (!panel) return;
		const items = [...panel.querySelectorAll<HTMLElement>('button:not([disabled])')];
		if (items.length === 0) return;
		e.preventDefault();
		const at = items.indexOf(document.activeElement as HTMLElement);
		const step = e.key === 'ArrowUp' || (e.key === 'Tab' && e.shiftKey) ? -1 : 1;
		items[(at + step + items.length) % items.length].focus();
	}
</script>

<svelte:window
	on:keydown={onkeydown}
	on:resize={() => menu.close()}
	on:scroll={() => menu.close()} />

<!-- At the page root. See the note in `lib/menu.svelte.ts` for why it cannot live anywhere else. -->
{#if menu.open && placement}
	<div class="veil" onclick={() => menu.close()} role="presentation"></div>
	<div
		class="menu"
		bind:this={panel}
		role="menu"
		style:left={`${placement.left}px`}
		style:top={placement.top === undefined ? undefined : `${placement.top}px`}
		style:bottom={placement.bottom === undefined ? undefined : `${placement.bottom}px`}
		style:max-height={`${placement.maxHeight}px`}
		style:width={`${WIDTH}px`}>
		{#each groups as group, g (group.label ?? g)}
			{#if group.label}<div class="heading">{group.label}</div>{/if}
			{#each group.items as item (item.id)}
				<button
					role="menuitemradio"
					aria-checked={group.value === item.id}
					disabled={item.disabled}
					title={item.title}
					onclick={() => menu.pick(g, item.id)}>
					<span class="tick">
						{#if group.value === item.id}<Icon name="check" size={13} />{/if}
					</span>
					<span class="label truncate">{item.label}</span>
					{#if item.note}<span class="note truncate">{item.note}</span>{/if}
				</button>
			{/each}
		{/each}
	</div>
{/if}

<style>
	.veil {
		position: fixed;
		inset: 0;
		z-index: 70;
	}
	.menu {
		position: fixed;
		z-index: 71;
		display: flex;
		flex-direction: column;
		gap: 1px;
		padding: 5px;
		overflow-y: auto;
		background: var(--popover);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		box-shadow: var(--shadow-md);
		animation: rise 0.12s cubic-bezier(0.16, 1, 0.3, 1);
	}
	.heading {
		padding: 8px 8px 4px;
		font-size: 11.5px;
		font-weight: 500;
		color: var(--subtle-foreground);
	}
	.heading:not(:first-child) {
		margin-top: 4px;
		border-top: 1px solid var(--border-soft);
		padding-top: 9px;
	}
	button {
		display: flex;
		align-items: center;
		gap: 8px;
		width: 100%;
		padding: 6px 8px;
		border-radius: var(--radius-sm);
		font-size: 13px;
		text-align: left;
		color: var(--muted-foreground);
	}
	button:hover:not(:disabled),
	button:focus-visible {
		background: var(--hover);
		color: var(--foreground);
	}
	button:disabled {
		opacity: 0.45;
		cursor: not-allowed;
	}
	button[aria-checked='true'] {
		color: var(--foreground);
	}
	.tick {
		display: flex;
		width: 13px;
		flex: none;
		color: var(--foreground);
	}
	.label {
		flex: 1;
		min-width: 0;
	}
	.note {
		flex: none;
		max-width: 96px;
		font-size: 11.5px;
		color: var(--subtle-foreground);
	}
	@keyframes rise {
		from {
			opacity: 0;
			scale: 0.98;
		}
	}
</style>
