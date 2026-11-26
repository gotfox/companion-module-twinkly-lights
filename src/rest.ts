import { randomBytes } from 'node:crypto'
import type { RgbColor } from './color.js'
import {
	checkResult,
	parseBrightness,
	parseConsumerPlaylist,
	parseEffectsCount,
	parseGestalt,
	parseMode,
	parseMovies,
	parsePlaylists,
	RestResponseError,
	type BrightnessInfo,
	type Gestalt,
	type ModeInfo,
	type MovieInfo,
	type PlaylistInfo,
} from './rest-parse.js'

const rgbBody = (c: RgbColor): { red: number; green: number; blue: number } => ({
	red: c.red,
	green: c.green,
	blue: c.blue,
})

/**
 * Client for a Twinkly controller's local REST API on port 80.
 *
 * - Twinkly Pro (verified on PRO firmware 4.1.0) serves `/xled/v2/`. Content is chosen through
 *   `application/mode`, by UUID only.
 * - Consumer lights (verified on firmware 2.11.0) serve `/xled/v1/`, as documented at
 *   https://xled-docs.readthedocs.io. Mode is `led/mode`, the effect is chosen with `movies/current`,
 *   and there is a single playlist plus built-in effects.
 *
 * Both log in the same way: POST `login` with a random base64 challenge, then POST `verify` echoing
 * the returned `challenge-response` with the token in the `X-Auth-Token` header.
 */

export type DeviceFamily = 'pro' | 'consumer'

const API_PREFIX: Record<DeviceFamily, string> = { pro: '/xled/v2', consumer: '/xled/v1' }
const DEFAULT_TIMEOUT_MS = 3000
/** Renew this long before the controller's stated expiry, to avoid racing it. */
const EXPIRY_MARGIN_MS = 60_000
const HTTP_UNAUTHORIZED = 401
/** If the controller doesn't say how long a token lasts, assume this (seconds) rather than logging in every request */
const FALLBACK_TOKEN_LIFETIME_S = 300
/** Error bodies are echoed into logs; keep them short */
const MAX_ERROR_BODY_CHARS = 200

export type MovieSelector = { handle: number } | { uuid: string }

export interface BrightnessCommand {
	mode: 'enabled' | 'disabled'
	type: 'A' | 'R'
	value: number
}

export interface RestClientOptions {
	/** Which API the device speaks; default 'pro'. Use detectFamily() when unknown. */
	family?: DeviceFamily
	timeoutMs?: number
}

/**
 * Work out whether a device is Twinkly Pro or a consumer light from which gestalt path answers.
 * Gestalt needs no login.
 */
export async function detectFamily(
	host: string,
	timeoutMs = DEFAULT_TIMEOUT_MS,
	/** Restrict to one family when it is already known; gestalt is still read for the device's name and model */
	families: readonly DeviceFamily[] = ['pro', 'consumer'],
): Promise<{ family: DeviceFamily; gestalt: Gestalt }> {
	const errors: string[] = []
	for (const family of families) {
		try {
			return { family, gestalt: await new TwinklyRestClient(host, { family, timeoutMs }).gestalt() }
		} catch (e) {
			errors.push(e instanceof Error ? e.message : String(e))
		}
	}
	throw new Error(`Not a Twinkly controller, or unreachable: ${errors.join('; ')}`)
}

interface Session {
	token: string
	expiresAt: number
}

class HttpStatusError extends Error {
	constructor(
		message: string,
		readonly status: number,
	) {
		super(message)
	}
}

export class TwinklyRestClient {
	private session: Session | null = null
	private loginInFlight: Promise<Session> | null = null
	private readonly timeoutMs: number
	readonly family: DeviceFamily

	/** @param host controller IP, optionally with `:port` */
	constructor(
		readonly host: string,
		options: RestClientOptions = {},
	) {
		this.timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS
		this.family = options.family ?? 'pro'
	}

	private get modePath(): string {
		return this.family === 'pro' ? 'application/mode' : 'led/mode'
	}

	/** Pro selects effects by UUID only, so callers must map a handle first; consumer lights accept either. */
	get selectsByHandle(): boolean {
		return this.family === 'consumer'
	}

	/** Device information. Needs no login. */
	async gestalt(): Promise<Gestalt> {
		return parseGestalt(await this.http('GET', 'gestalt', undefined, null))
	}

	async getMode(): Promise<ModeInfo> {
		return parseMode(await this.authed('GET', this.modePath))
	}

	private async post(path: string, body: unknown): Promise<void> {
		checkResult(await this.authed('POST', path, body), path)
	}

	async off(): Promise<void> {
		await this.post(this.modePath, { mode: 'off' })
	}

	async playMovie(movie: MovieSelector): Promise<void> {
		if (this.family === 'pro') {
			if (!('uuid' in movie)) throw new RestResponseError('Twinkly Pro selects effects by UUID only')
			return this.post('application/mode', { mode: 'movie', unique_id: movie.uuid })
		}
		// Consumer: choose the effect, then switch to movie mode (choosing alone doesn't leave a playlist)
		await this.post('movies/current', 'uuid' in movie ? { unique_id: movie.uuid } : { id: movie.handle })
		await this.post('led/mode', { mode: 'movie' })
	}

	async startPlaylist(playlist: PlaylistInfo): Promise<void> {
		if (this.family === 'pro') return this.post('application/mode', { mode: 'playlist', unique_id: playlist.uuid })
		await this.post('led/mode', { mode: 'playlist' }) // consumer lights have a single playlist
	}

	/** Consumer lights only: play built-in effect `index` (0-based). */
	async playBuiltinEffect(index: number): Promise<void> {
		if (this.family === 'pro') throw new RestResponseError('Twinkly Pro has no built-in effects')
		await this.post('led/effects/current', { effect_id: index })
		await this.post('led/mode', { mode: 'effect' })
	}

	/** Consumer lights only: how many built-in effects there are (0 on Pro). */
	async getBuiltinEffectCount(): Promise<number> {
		if (this.family === 'pro') return 0
		return parseEffectsCount(await this.authed('GET', 'led/effects'))
	}

	async getMovies(): Promise<MovieInfo[]> {
		return parseMovies(await this.authed('GET', 'movies'))
	}

	async getPlaylists(): Promise<PlaylistInfo[]> {
		if (this.family === 'consumer') return parseConsumerPlaylist(await this.authed('GET', 'playlist'))
		return parsePlaylists(await this.authed('GET', 'playlists'))
	}

	async getBrightness(): Promise<BrightnessInfo> {
		return parseBrightness(await this.authed('GET', 'led/out/brightness'))
	}

	async setBrightness(command: BrightnessCommand): Promise<void> {
		await this.post('led/out/brightness', command)
	}

	/** Show a solid colour. Verified on Twinkly Pro (firmware 4.1.0) and on Twinkly Squares (firmware 2.11.0). */
	async setColor(color: RgbColor): Promise<void> {
		if (this.family === 'pro') {
			await this.post('application/mode', { mode: 'color', color_config: rgbBody(color) })
			return
		}
		// Consumer lights (verified on Twinkly Squares, firmware 2.11.0): store the colour, then show it
		await this.post('led/color', rgbBody(color))
		await this.post('led/mode', { mode: 'color' })
	}

	/**
	 * Change the colour while the lights already show a solid colour. Much faster than `setColor`
	 * (about 30 ms against 180 ms on PRO firmware 4.1.0), which suits the steps of a fade. It does not
	 * switch the mode, so use `setColor` first.
	 */
	async updateColor(color: RgbColor): Promise<void> {
		await this.post('led/color', rgbBody(color))
	}

	/** Request with a valid token, logging in again once if the controller rejects it. */
	private async authed(method: 'GET' | 'POST', path: string, body?: unknown): Promise<unknown> {
		const session = await this.ensureSession()
		try {
			return await this.http(method, path, body, session.token)
		} catch (e) {
			if (!(e instanceof HttpStatusError) || e.status !== HTTP_UNAUTHORIZED) throw e
			// Only drop our own session: a concurrent request may already have logged in again
			if (this.session === session) this.session = null
			const fresh = await this.ensureSession()
			return this.http(method, path, body, fresh.token)
		}
	}

	private async ensureSession(): Promise<Session> {
		if (this.session && Date.now() < this.session.expiresAt) return this.session
		// Share one login between concurrent requests
		this.loginInFlight ??= this.login().finally(() => {
			this.loginInFlight = null
		})
		this.session = await this.loginInFlight
		return this.session
	}

	private async login(): Promise<Session> {
		const challenge = randomBytes(32).toString('base64')
		const reply = checkResult(await this.http('POST', 'login', { challenge }, null), 'login')
		const token = reply.authentication_token
		const response = reply['challenge-response']
		if (typeof token !== 'string' || typeof response !== 'string') {
			throw new RestResponseError('login: reply has no token or challenge-response')
		}
		checkResult(await this.http('POST', 'verify', { 'challenge-response': response }, token), 'verify')
		const stated = reply.authentication_token_expires_in
		const lifetimeS = typeof stated === 'number' && stated > 0 ? stated : FALLBACK_TOKEN_LIFETIME_S
		return { token, expiresAt: Date.now() + Math.max(0, lifetimeS * 1000 - EXPIRY_MARGIN_MS) }
	}

	private async http(method: 'GET' | 'POST', path: string, body: unknown, token: string | null): Promise<unknown> {
		const url = `http://${this.host}${API_PREFIX[this.family]}/${path}`
		const headers: Record<string, string> = {}
		if (body !== undefined) headers['Content-Type'] = 'application/json'
		if (token) headers['X-Auth-Token'] = token

		let res: Response
		try {
			res = await fetch(url, {
				method,
				headers,
				body: body === undefined ? undefined : JSON.stringify(body),
				signal: AbortSignal.timeout(this.timeoutMs),
			})
		} catch (e) {
			const reason =
				e instanceof Error && e.name === 'TimeoutError' ? `no reply within ${this.timeoutMs} ms` : String(e)
			throw new Error(`REST ${method} ${this.host}/${path} failed: ${reason}`, { cause: e })
		}

		let text: string
		try {
			text = await res.text()
		} catch (e) {
			throw new Error(`REST ${method} ${this.host}/${path}: reply was cut off: ${String(e)}`, { cause: e })
		}
		if (!res.ok) {
			const snippet = text.slice(0, MAX_ERROR_BODY_CHARS)
			throw new HttpStatusError(`REST ${method} ${this.host}/${path}: HTTP ${res.status} ${snippet}`, res.status)
		}
		try {
			return JSON.parse(text) as unknown
		} catch {
			throw new RestResponseError(`REST ${method} ${this.host}/${path}: reply is not JSON`)
		}
	}
}
