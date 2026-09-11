<script lang="ts">
	import { room } from '$lib/room.svelte.ts';
	import Icon from '$lib/ui/Icon.svelte';
	import QrCode from './QrCode.svelte';

	/** Remember the invitation's open state; default closed to preserve queue space. */
	const REMEMBER = 'mv.invite.open';
	let open = $state(false);

	$effect(() => {
		void room.load();
		open = localStorage.getItem(REMEMBER) === '1';
	});

	function toggle() {
		open = !open;
		localStorage.setItem(REMEMBER, open ? '1' : '0');
	}
</script>

{#if room.info?.url}
	<div class="invite" class:open>
		<button class="bar" onclick={toggle} aria-expanded={open}>
			<Icon name="qr" size={15} />
			<span class="lead">Scan to add tracks</span>
			<Icon name={open ? 'chevronDown' : 'chevronUp'} size={14} />
		</button>

		{#if open}

			<button class="code" onclick={() => (room.open = true)} title="Show the code full size">
				<QrCode value={room.info.url} fluid />
			</button>
		{/if}
	</div>
{/if}

<style>
	.invite {
		flex: none;
		display: flex;
		flex-direction: column;
		border-top: 1px solid var(--border);
	}

	.bar {
		display: flex;
		align-items: center;
		gap: 10px;
		width: 100%;
		height: 38px;
		flex: none;
		padding: 0 14px;
		color: var(--subtle-foreground);
		transition: background-color 0.12s ease;
	}
	.bar:hover {
		background: var(--muted);
		color: var(--foreground);
	}
	.lead {
		flex: 1;
		text-align: left;
		font-size: 12.5px;
		font-weight: 500;
	}

	.code {
		padding: 0 14px 14px;
		border-radius: var(--radius-md);
	}
	.code:hover {
		background: var(--muted);
	}
</style>
