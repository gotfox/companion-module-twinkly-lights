/**
 * Periodic reader with a safe lifecycle.
 *
 * - `stop()` is final: a read still in flight is discarded and nothing is rescheduled. Make a new
 *   Poller when the config changes, instead of reusing one.
 * - `requestSoon()` (call it after sending a command) reads again shortly. If a read is already in
 *   flight, its result may predate the command, so it is discarded and a fresh read follows at once.
 * - Only one read runs at a time.
 */
export interface PollerOptions<T> {
	intervalMs: number
	/** Delay for a read requested by `requestSoon()` */
	soonMs: number
	read: () => Promise<T>
	onResult: (result: T) => void
	onError: (error: Error) => void
}

export class Poller<T> {
	private timer: NodeJS.Timeout | undefined
	private running = false
	private requestedDuringRead = false
	private stopped = false

	constructor(private readonly opts: PollerOptions<T>) {}

	start(): void {
		this.schedule(0)
	}

	stop(): void {
		this.stopped = true
		clearTimeout(this.timer)
		this.timer = undefined
	}

	requestSoon(): void {
		if (this.stopped) return
		if (this.running) {
			this.requestedDuringRead = true
			return
		}
		this.schedule(this.opts.soonMs)
	}

	private schedule(delayMs: number): void {
		if (this.stopped) return
		clearTimeout(this.timer)
		this.timer = setTimeout(() => void this.tick(), delayMs)
	}

	private async tick(): Promise<void> {
		if (this.stopped || this.running) return
		this.running = true
		this.requestedDuringRead = false
		let result: { ok: true; value: T } | { ok: false; error: Error }
		try {
			result = { ok: true, value: await this.opts.read() }
		} catch (e) {
			result = { ok: false, error: e instanceof Error ? e : new Error(String(e)) }
		}
		this.running = false
		if (this.stopped) return

		const stale = this.requestedDuringRead
		if (!stale) {
			if (result.ok) this.opts.onResult(result.value)
			else this.opts.onError(result.error)
		}
		this.schedule(stale ? this.opts.soonMs : this.opts.intervalMs)
	}
}
