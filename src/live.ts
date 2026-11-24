import { ContentCache } from './controller.js'
import { Poller } from './poller.js'
import { TwinklyRestClient, type DeviceFamily } from './rest.js'
import { stateFromController, type AssumedState } from './state.js'

/** After a command, re-read state this soon so buttons update quickly */
const READ_AFTER_COMMAND_MS = 300
/**
 * Read once more this long after a command: consumer lights apply changes in steps and fade
 * between effects, so the quick read can catch them halfway.
 */
const SETTLE_READ_MS = 1500
/** Refresh the effect and playlist lists at least this often */
const CONTENT_REFRESH_MS = 60_000
/** When the controller plays an effect missing from the list, refresh it, but no more often than this */
const UNKNOWN_EFFECT_REFRESH_MS = 10_000

export interface LiveHost {
	log(level: 'info' | 'warn' | 'error' | 'debug', message: string): void
	/** The controller reported its state */
	onState(state: AssumedState): void
	/** Reading state failed; `message` is already de-duplicated */
	onReadError(message: string): void
	onReadRecovered(): void
	/** The effect or playlist list changed (rebuild dropdowns) */
	onContentChanged(): void
}

/**
 * Everything that talks to one controller over REST for one config: the client, the effect and
 * playlist lists, and state polling. Make a new one when the config changes; `stop()` is final, and
 * nothing from a stopped instance reaches the host.
 */
export class LiveConnection {
	readonly client: TwinklyRestClient
	readonly content: ContentCache
	private poller: Poller<AssumedState> | null = null
	private stopped = false
	private lastError = ''
	private lastContentKey = ''
	private lastContentRefresh = 0
	private refreshing: Promise<void> | null = null
	private settleTimer: NodeJS.Timeout | undefined

	constructor(
		host: string,
		readonly family: DeviceFamily,
		private readonly h: LiveHost,
		private readonly pollIntervalS: number,
	) {
		this.client = new TwinklyRestClient(host, { family })
		this.content = new ContentCache(this.client)
	}

	get polling(): boolean {
		return this.poller !== null && !this.stopped
	}

	/** Load the lists, then start polling if enabled. Safe to stop() at any point. */
	async start(): Promise<void> {
		await this.refreshContent()
		if (this.stopped || this.pollIntervalS <= 0) return
		this.poller = new Poller({
			intervalMs: this.pollIntervalS * 1000,
			soonMs: READ_AFTER_COMMAND_MS,
			read: async () => this.read(),
			onResult: (state) => this.handleState(state),
			onError: (e) => this.handleError(e),
		})
		this.poller.start()
	}

	stop(): void {
		this.stopped = true
		clearTimeout(this.settleTimer)
		this.poller?.stop()
	}

	/** Call after a command so the display catches up quickly, and again once the device has settled. */
	requestSoon(): void {
		if (this.stopped || !this.poller) return
		this.poller.requestSoon()
		clearTimeout(this.settleTimer)
		this.settleTimer = setTimeout(() => {
			if (!this.stopped) this.poller?.requestSoon()
		}, SETTLE_READ_MS)
	}

	/** Re-read the effect and playlist lists (shared if one is already running). */
	async refreshContent(): Promise<void> {
		this.refreshing ??= this.doRefreshContent().finally(() => {
			this.refreshing = null
		})
		return this.refreshing
	}

	private async doRefreshContent(): Promise<void> {
		this.lastContentRefresh = Date.now()
		try {
			await this.content.refresh()
		} catch (e) {
			if (!this.stopped) this.h.log('warn', `Could not read effects and playlists from the controller: ${String(e)}`)
			return
		}
		if (this.stopped || this.content.moviesKey === this.lastContentKey) return
		const first = this.lastContentKey === ''
		this.lastContentKey = this.content.moviesKey
		if (first) {
			const c = this.content
			const builtin = this.family === 'consumer' ? `, ${c.builtinEffects} built-in effect(s)` : ''
			this.h.log('info', `Found ${c.movies.length} effect(s), ${c.playlists.length} playlist(s)${builtin}`)
		}
		this.h.onContentChanged()
	}

	private async read(): Promise<AssumedState> {
		const [mode, brightness] = await Promise.all([this.client.getMode(), this.client.getBrightness()])
		const state = stateFromController(mode, brightness, this.content.movies)
		const unknownEffect = mode.effectUuid !== '' && state.effect === mode.effectUuid
		const age = Date.now() - this.lastContentRefresh
		// Refresh in the background so the state read is never held up by it
		if (age > CONTENT_REFRESH_MS || (unknownEffect && age > UNKNOWN_EFFECT_REFRESH_MS)) void this.refreshContent()
		return state
	}

	private handleState(state: AssumedState): void {
		if (this.lastError) this.h.onReadRecovered()
		this.lastError = ''
		this.h.onState(state)
	}

	private handleError(e: Error): void {
		if (e.message === this.lastError) return
		this.lastError = e.message
		this.h.onReadError(e.message)
	}
}
