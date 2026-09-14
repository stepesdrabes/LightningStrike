/** Set by the evening store for queue helpers that must not import it. */
export const eveningGate = {
	/** An evening owns the queue: the radio stays out of it. */
	active: false,
	/** Pending rows to prepare after the current and next ones, soonest first. */
	ahead: [] as string[]
};
