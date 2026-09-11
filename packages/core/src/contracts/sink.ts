/** Gamma-corrected, canonical RGB order, 0-255. Exactly the bytes a strip would clock. */
export interface LedFrame {
	rgb: Uint8Array;
	frameId: number;
	dt: number;
	/** performance.now() domain, when this frame should be visible. */
	presentAtMs: number;
}

export interface LedSinkStats {
	framesSent: number;
	framesDropped: number;
	bytesSent: number;
	lastError?: string;
}

/** Preview and hardware consume the same encoded bytes. */
export interface LedSink {
	readonly kind: string;
	open(): Promise<void>;
	/** Must not block and must not throw on transient network errors. */
	send(frame: LedFrame): void;
	close(): Promise<void>;
	stats(): LedSinkStats;
}
