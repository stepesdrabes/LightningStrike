<script lang="ts">
	import { invite } from '$lib/invite.svelte.ts';
	import Dialog from '$lib/ui/Dialog.svelte';
	import Button from '$lib/ui/Button.svelte';
	import Icon from '$lib/ui/Icon.svelte';
	import QrCode from './QrCode.svelte';
</script>

<Dialog open={invite.open} onclose={() => (invite.open = false)} labelledBy="invite-title">
	<div class="big">
		<h2 id="invite-title">Scan to add tracks</h2>
		{#if invite.info?.url}
			<QrCode value={invite.info.url} size={264} />
			<p class="url mono">{invite.info.url}</p>
			<p class="note">
				Anyone on this network who scans this can search and add to the queue, and take back
				what they added. Rotating the code shuts out everyone who has it.
			</p>
			<Button variant="outline" size="sm" disabled={invite.rotating} onclick={() => invite.rotate()}>
				<Icon name="retry" size={14} />
				New code
			</Button>
		{:else}
			<p class="note">
				This machine has no network address, so there is nothing a phone could reach. Join a
				network and reopen this.
			</p>
		{/if}
	</div>
</Dialog>

<style>
	.big {
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 16px;
		padding: 28px 24px;
		text-align: center;
	}
	h2 {
		font-size: 15px;
		font-weight: 600;
	}
	.url {
		font-size: 12.5px;
		color: var(--muted-foreground);
		word-break: break-all;
	}
	.note {
		font-size: 12.5px;
		line-height: 1.6;
		color: var(--subtle-foreground);
		max-width: 40ch;
	}
</style>
