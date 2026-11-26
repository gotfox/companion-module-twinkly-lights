/**
 * Fades are done here, not by the controller: Twinkly's OSC and REST have no fade command (the
 * documented QLab example fades by sending a stream of values too). A fade sends stepped values
 * from a known start to the target, timed by the clock so slow REST calls don't stretch it.
 */

export type Vector = readonly number[]

/** Seconds a fade may last, to keep a typo from running for hours. */
export const MAX_FADE_SECONDS = 300

/**
 * Time between steps. The controller renders about 12 frames a second (about 83 ms), so OSC steps
 * faster than that to keep a fresh value ready for every frame. REST is slower and keeps one login
 * per controller, so it steps less often.
 */
export const FADE_STEP_MS = { osc: 50, rest: 125 } as const

export interface FadeClock {
	now(): number
	sleep(ms: number): Promise<void>
}

const realClock: FadeClock = {
	now: () => Date.now(),
	sleep: async (ms) => new Promise<void>((resolve) => setTimeout(resolve, ms)),
}

export interface FadeTiming {
	durationMs: number
	stepMs: number
}

export const lerpVector = (from: Vector, to: Vector, t: number): number[] =>
	from.map((start, i) => Math.round(start + ((to[i] ?? start) - start) * t))

const sameVector = (a: Vector, b: Vector): boolean => a.length === b.length && a.every((v, i) => v === b[i])

/** A fade in progress: which run it is, and the last value it sent. */
interface ActiveRun {
	readonly id: number
	readonly last: Vector
}

/** Runs fades by channel name. Starting a fade on a channel replaces the one running on it. */
export class Fader {
	private readonly runs = new Map<string, ActiveRun>()
	private counter = 0

	constructor(private readonly clock: FadeClock = realClock) {}

	/**
	 * Stop the fade on this channel before its next step. Returns the last value it sent (or its start
	 * value), so whatever replaces it can carry on from there; undefined when nothing was running.
	 */
	cancel(channel: string): Vector | undefined {
		const run = this.runs.get(channel)
		this.runs.delete(channel)
		return run?.last
	}

	/** The last value sent by the fade running on this channel, without stopping it. */
	current(channel: string): Vector | undefined {
		return this.runs.get(channel)?.last
	}

	/** Stop every fade whose channel starts with `prefix`. */
	cancelMatching(prefix: string): void {
		for (const channel of [...this.runs.keys()]) {
			if (channel.startsWith(prefix)) this.runs.delete(channel)
		}
	}

	cancelAll(): void {
		this.runs.clear()
	}

	/**
	 * Fade from `from` to `to`, calling `apply` with each new value (never the start value, never the
	 * same value twice). Resolves true when it reached the target, false when it was cancelled,
	 * replaced, or a send failed.
	 */
	async run(
		channel: string,
		from: Vector,
		to: Vector,
		timing: FadeTiming,
		apply: (value: Vector) => Promise<boolean>,
	): Promise<boolean> {
		const id = ++this.counter
		this.runs.set(channel, { id, last: from })
		const isCurrent = (): boolean => this.runs.get(channel)?.id === id
		const finish = (result: boolean): boolean => {
			if (isCurrent()) this.runs.delete(channel)
			return result
		}

		const startedAt = this.clock.now()
		let last: Vector = from
		while (isCurrent()) {
			const progress = timing.durationMs > 0 ? Math.min(1, (this.clock.now() - startedAt) / timing.durationMs) : 1
			const value = progress >= 1 ? to : lerpVector(from, to, progress)
			if (!sameVector(value, last)) {
				if (!(await apply(value))) return finish(false)
				last = value
				if (isCurrent()) this.runs.set(channel, { id, last: value })
			}
			if (progress >= 1) return finish(true)
			// Wait for the next tick on a fixed schedule, so a slow send doesn't add its time to every step,
			// and never sleep past the end, so the last value goes out on time
			const elapsedMs = this.clock.now() - startedAt
			const stepMs = Math.max(1, timing.stepMs)
			const untilNextTickMs = (Math.floor(elapsedMs / stepMs) + 1) * stepMs - elapsedMs
			const remainingMs = timing.durationMs - elapsedMs
			await this.clock.sleep(Math.max(0, Math.min(untilNextTickMs, remainingMs)))
		}
		return false
	}
}
