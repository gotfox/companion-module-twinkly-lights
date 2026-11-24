import { oscInt, oscString, type OscArg } from './osc.js'
import type { BrightnessCommand, TwinklyRestClient } from './rest.js'
import type { MovieInfo, PlaylistInfo } from './rest-parse.js'

/** Per-action target override (OSC only; REST always talks to the configured controller IP). */
export type TargetOptions = { target?: string; productType?: string; mac?: string }

export type EffectSelector = { handle: number } | { uuid: string }

/** The commands every control method supports. Each returns true if the command was sent. */
export interface Controller {
	readonly kind: 'osc' | 'rest'
	off(target: TargetOptions): Promise<boolean>
	movie(target: TargetOptions, effect: EffectSelector): Promise<boolean>
	playlist(target: TargetOptions, index: number): Promise<boolean>
	brightness(target: TargetOptions, command: BrightnessCommand): Promise<boolean>
	/** Consumer lights only */
	builtinEffect(target: TargetOptions, index: number): Promise<boolean>
}

export interface OscHost {
	resolveDeviceId(target: TargetOptions): string | null
	sendCommand(id: string | null, path: string, args: OscArg[]): boolean
}

export class OscController implements Controller {
	readonly kind = 'osc'
	constructor(
		private readonly host: OscHost,
		private readonly log: Logger,
	) {}

	private async send(target: TargetOptions, path: string, args: OscArg[]): Promise<boolean> {
		return Promise.resolve(this.host.sendCommand(this.host.resolveDeviceId(target), path, args))
	}

	async off(target: TargetOptions): Promise<boolean> {
		return this.send(target, 'application/mode', [oscString('off')])
	}

	async movie(target: TargetOptions, effect: EffectSelector): Promise<boolean> {
		const arg = 'uuid' in effect ? oscString(effect.uuid) : oscInt(effect.handle)
		return this.send(target, 'application/mode', [oscString('movie'), arg])
	}

	async playlist(target: TargetOptions, index: number): Promise<boolean> {
		return this.send(target, 'application/mode', [oscString('playlist'), oscInt(index)])
	}

	async brightness(target: TargetOptions, c: BrightnessCommand): Promise<boolean> {
		return this.send(target, 'led/brightness', [oscString(c.mode), oscString(c.type), oscInt(c.value)])
	}

	async builtinEffect(): Promise<boolean> {
		this.log(
			'warn',
			'Built-in effects are a Twinkly feature (not Twinkly Pro); use the REST control method with a Twinkly light',
		)
		return false
	}
}

export type Logger = (level: 'info' | 'warn' | 'error' | 'debug', message: string) => void

/** Used while the controller can't take commands (still connecting, wrong method for the device...). */
export class UnavailableController implements Controller {
	readonly kind = 'rest'
	constructor(
		private readonly reason: () => string,
		private readonly log: Logger,
	) {}

	private async refuse(): Promise<boolean> {
		this.log('warn', `Not sent: ${this.reason()}`)
		return false
	}

	async off(): Promise<boolean> {
		return this.refuse()
	}
	async movie(): Promise<boolean> {
		return this.refuse()
	}
	async playlist(): Promise<boolean> {
		return this.refuse()
	}
	async brightness(): Promise<boolean> {
		return this.refuse()
	}
	async builtinEffect(): Promise<boolean> {
		return this.refuse()
	}
}

/**
 * Lists of installed effects and playlists, fetched from the controller and refreshed on demand.
 * Needed because Pro's REST API selects content by UUID only, and for names in dropdowns and presets.
 */
export class ContentCache {
	movies: MovieInfo[] = []
	playlists: PlaylistInfo[] = []
	/** Consumer lights only */
	builtinEffects = 0
	/**
	 * Whether the last refresh got an answer from the device (empty lists count). The built-in effect
	 * count doesn't: on Pro it is 0 without asking the device.
	 */
	reachable = false
	constructor(private readonly client: TwinklyRestClient) {}

	/**
	 * Re-read both lists, keeping whichever one loads if the other fails.
	 * Throws only when both fail, so a missing playlist endpoint can't break the effect list.
	 */
	async refresh(): Promise<void> {
		const [movies, playlists, builtin] = await Promise.allSettled([
			this.client.getMovies(),
			this.client.getPlaylists(),
			this.client.getBuiltinEffectCount(),
		])
		if (movies.status === 'fulfilled') this.movies = movies.value
		if (playlists.status === 'fulfilled') this.playlists = playlists.value
		if (builtin.status === 'fulfilled') this.builtinEffects = builtin.value
		this.reachable = movies.status === 'fulfilled' || playlists.status === 'fulfilled'
		if (!this.reachable) throw movies.status === 'rejected' ? movies.reason : new Error('no reply')
	}

	/** Changes when the effect list changes, so dropdowns are only rebuilt when needed. */
	get moviesKey(): string {
		const movies = this.movies.map((m) => `${m.handle}:${m.uuid}:${m.name}`).join('|')
		const playlists = this.playlists.map((p) => `${p.index}:${p.uuid}:${p.name}`).join('|')
		return `${movies}#${playlists}#${this.builtinEffects}`
	}

	/** Look up with the cached list, refreshing once if the entry is missing (content may have changed). */
	async find<T>(pick: (cache: ContentCache) => T | undefined): Promise<T | undefined> {
		const hit = pick(this)
		if (hit !== undefined) return hit
		await this.refresh()
		return pick(this)
	}
}

export class RestController implements Controller {
	readonly kind = 'rest'
	constructor(
		private readonly client: TwinklyRestClient,
		private readonly content: ContentCache,
		private readonly log: Logger,
		private readonly onSent: () => void,
	) {}

	private async run(what: string, command: () => Promise<void>): Promise<boolean> {
		try {
			this.log('debug', `REST -> ${this.client.host}: ${what}`)
			await command()
			this.onSent()
			return true
		} catch (e) {
			this.log('error', `${what} failed: ${e instanceof Error ? e.message : String(e)}`)
			return false
		}
	}

	async off(): Promise<boolean> {
		return this.run('Lights off', async () => this.client.off())
	}

	async movie(_target: TargetOptions, effect: EffectSelector): Promise<boolean> {
		// Consumer lights accept a handle directly; Pro needs it mapped to a UUID first
		if ('uuid' in effect || this.client.selectsByHandle) {
			const label = 'uuid' in effect ? effect.uuid : `handle ${effect.handle}`
			return this.run(`Play effect ${label}`, async () => this.client.playMovie(effect))
		}
		let uuid: string | undefined
		try {
			uuid = (await this.content.find((c) => c.movies.find((m) => m.handle === effect.handle)))?.uuid
		} catch (e) {
			this.log('error', `Play effect: could not read the effect list: ${String(e)}`)
			return false
		}
		if (!uuid) {
			this.log('warn', `Play effect: no effect with handle ${effect.handle} on the controller`)
			return false
		}
		const id = uuid
		return this.run(`Play effect ${id}`, async () => this.client.playMovie({ uuid: id }))
	}

	async playlist(_target: TargetOptions, index: number): Promise<boolean> {
		let playlist: PlaylistInfo | undefined
		try {
			playlist = await this.content.find((c) => c.playlists.find((p) => p.index === index))
		} catch (e) {
			this.log('error', `Start playlist: could not read the playlist list: ${String(e)}`)
			return false
		}
		if (!playlist) {
			this.log('warn', `Start playlist: no playlist at index ${index} on the controller`)
			return false
		}
		const p = playlist
		return this.run(`Start playlist ${index} (${p.name || p.uuid})`, async () => this.client.startPlaylist(p))
	}

	async brightness(_target: TargetOptions, command: BrightnessCommand): Promise<boolean> {
		return this.run(`Brightness ${command.mode} ${command.type} ${command.value}`, async () =>
			this.client.setBrightness(command),
		)
	}

	async builtinEffect(_target: TargetOptions, index: number): Promise<boolean> {
		if (this.client.family === 'pro') {
			this.log('warn', 'Built-in effects are a Twinkly feature; this controller is Twinkly Pro')
			return false
		}
		return this.run(`Play built-in effect ${index}`, async () => this.client.playBuiltinEffect(index))
	}
}
