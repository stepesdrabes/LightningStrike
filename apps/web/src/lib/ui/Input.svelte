<script lang="ts">
	let {
		value = $bindable(''),
		placeholder = '',
		size = 'default'
	}: {
		value?: string;
		placeholder?: string;
		size?: 'default' | 'sm';
	} = $props();
</script>

<div class="wrap {size}">
	<input
		bind:value
		type="text"
		{placeholder}
		aria-label={placeholder} />
</div>

<style>
	.wrap {
		position: relative;
		display: flex;
		align-items: center;
		width: 100%;
		min-width: 0;
	}
	input {
		width: 100%;
		min-width: 0;
		height: var(--h);
		padding: 0 12px;
		background: var(--card-raised);
		border: 1px solid var(--border);
		border-radius: var(--radius-md);
		color: var(--foreground);
		font-size: 13.5px;
		transition:
			border-color 0.13s ease,
			background-color 0.13s ease;
	}
	.sm input {
		height: var(--h-sm);
		font-size: 13px;
	}
	input::placeholder {
		color: var(--subtle-foreground);
	}
	input:hover:not(:disabled) {
		border-color: #33333c;
	}
	input:focus {
		outline: none;
		border-color: var(--ring);
		background: var(--popover);
	}
</style>
