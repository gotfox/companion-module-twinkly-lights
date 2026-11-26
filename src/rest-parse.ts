/**
 * Validation and parsing of the controller's local REST API (`/xled/v2/...`).
 *
 * The local endpoints follow the community xled-docs (Twinkly's own reference covers the cloud API). The shapes below were captured from a
 * TWPRO1500ETHP on firmware 4.1.0 and follow the consumer API described at https://xled-docs.readthedocs.io
 * (which uses `/xled/v1/`). Every response is treated as untrusted and checked before use.
 */

import { clampByte, type RgbColor } from './color.js'

export const RESULT_OK = 1000
/** Far above the 32 effects a PRO holds; guards dropdowns against a runaway reply */
const MAX_LIST_ENTRIES = 256

export class RestResponseError extends Error {
	constructor(
		message: string,
		readonly code?: number,
	) {
		super(message)
		this.name = 'RestResponseError'
	}
}

export type GroupRole = 'master' | 'slave' | 'none' | 'unknown'
/** `effect` (built-in effects) exists on consumer lights only; `color` (a solid colour) is also a Pro mode */
export type ControllerMode = 'off' | 'movie' | 'playlist' | 'effect' | 'color' | 'unknown'
const KNOWN_MODES: readonly ControllerMode[] = ['off', 'movie', 'playlist', 'effect', 'color']
/** Consumer firmware reports an empty playlist with this UUID */
const NIL_UUID = '00000000-0000-0000-0000-000000000000'

export interface Gestalt {
	productCode: string
	deviceName: string
	groupRole: GroupRole
	groupUid: string
	maxMovies: number | null
	maxPlaylists: number | null
	oscEnabled: boolean | null
	artnetEnabled: boolean | null
	/** Lowercase hex without separators; consumer lights report it, Pro gestalt does not ('') */
	mac: string
}

export interface ModeInfo {
	mode: ControllerMode
	effectName: string
	effectUuid: string
	playlistName: string
	playlistUuid: string
	/** The solid colour shown. Only present in colour mode, when the controller reports it. */
	color?: RgbColor
}

export interface MovieInfo {
	handle: number
	name: string
	uuid: string
}

export interface PlaylistInfo {
	index: number
	name: string
	uuid: string
}

export interface BrightnessInfo {
	filter: 'enabled' | 'disabled'
	value: number
}

type Json = Record<string, unknown>

const isObject = (v: unknown): v is Json => typeof v === 'object' && v !== null && !Array.isArray(v)
/** Controller strings end up in logs and button text: drop control characters and cap the length. */
const MAX_TEXT_CHARS = 120
const DEL = 0x7f
const FIRST_PRINTABLE = 0x20
const isPrintable = (ch: string): boolean => {
	const code = ch.charCodeAt(0)
	return code >= FIRST_PRINTABLE && code !== DEL
}
const str = (v: unknown): string =>
	typeof v === 'string' ? [...v].filter(isPrintable).join('').slice(0, MAX_TEXT_CHARS) : ''
const numOrNull = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null)
const boolOrNull = (v: unknown): boolean | null => (typeof v === 'boolean' ? v : null)

/**
 * Throws unless the body is an object whose status code (when present) is 1000.
 * PRO firmware nests it as `result.code`; consumer firmware puts `code` at the top level.
 */
export function checkResult(body: unknown, what: string): Json {
	if (!isObject(body)) throw new RestResponseError(`${what}: response is not a JSON object`)
	const code = isObject(body.result) ? body.result.code : body.code
	if (typeof code === 'number' && code !== RESULT_OK) {
		throw new RestResponseError(`${what}: controller returned code ${code}`, code)
	}
	return body
}

export function parseGestalt(body: unknown): Gestalt {
	const b = checkResult(body, 'gestalt')
	// Consumer lights have no group object at all
	const group = isObject(b.group) ? b.group : { mode: 'none' }
	const role = str(group.mode)
	return {
		productCode: str(b.product_code),
		deviceName: str(b.device_name),
		groupRole: role === 'master' || role === 'slave' || role === 'none' ? role : 'unknown',
		groupUid: str(group.uid),
		maxMovies: numOrNull(b.max_movies),
		maxPlaylists: numOrNull(b.max_playlists),
		oscEnabled: boolOrNull(b.osc_en),
		artnetEnabled: boolOrNull(b.artnet_en),
		mac: str(b.mac)
			.replace(/[^0-9a-fA-F]/g, '')
			.toLowerCase(),
	}
}

/** `color_config` as reported in colour mode: red, green and blue as numbers. Anything else is ignored. */
function parseColorConfig(value: unknown): RgbColor | undefined {
	if (!isObject(value)) return undefined
	const red = numOrNull(value.red)
	const green = numOrNull(value.green)
	const blue = numOrNull(value.blue)
	if (red === null || green === null || blue === null) return undefined
	return { red: clampByte(red), green: clampByte(green), blue: clampByte(blue) }
}

export function parseMode(body: unknown): ModeInfo {
	const b = checkResult(body, 'application/mode')
	if (typeof b.mode !== 'string') throw new RestResponseError('application/mode: missing "mode"')
	const mode = KNOWN_MODES.find((m) => m === b.mode) ?? 'unknown'
	if (mode === 'playlist') {
		const movie = isObject(b.movie) ? b.movie : {}
		return {
			mode,
			effectName: str(movie.name),
			effectUuid: str(movie.unique_id),
			playlistName: str(b.name),
			playlistUuid: str(b.unique_id),
		}
	}
	const color = mode === 'color' ? parseColorConfig(b.color_config) : undefined
	return {
		mode,
		effectName: mode === 'movie' ? str(b.name) : '',
		effectUuid: mode === 'movie' ? str(b.unique_id) : '',
		playlistName: '',
		playlistUuid: '',
		...(color ? { color } : {}),
	}
}

export function parseMovies(body: unknown): MovieInfo[] {
	const b = checkResult(body, 'movies')
	if (!Array.isArray(b.movies)) throw new RestResponseError('movies: missing "movies" list')
	return b.movies
		.slice(0, MAX_LIST_ENTRIES)
		.filter(isObject)
		.map((m) => ({ handle: numOrNull(m.id) ?? -1, name: str(m.name), uuid: str(m.unique_id) }))
		.filter((m) => m.handle >= 0 && m.uuid !== '')
		.sort((a, b) => a.handle - b.handle)
}

export function parsePlaylists(body: unknown): PlaylistInfo[] {
	const b = checkResult(body, 'playlists')
	if (!Array.isArray(b.list)) throw new RestResponseError('playlists: missing "list"')
	// Index is the position in the controller's own list, so it matches OSC's playlist index
	return b.list
		.map((p: unknown, index) => (isObject(p) ? { index, name: str(p.name), uuid: str(p.unique_id) } : null))
		.filter((p): p is PlaylistInfo => p !== null && p.uuid !== '')
}

/** Consumer lights hold a single playlist (`GET playlist`); return it as a one-entry list, or none if empty. */
export function parseConsumerPlaylist(body: unknown): PlaylistInfo[] {
	const b = checkResult(body, 'playlist')
	const uuid = str(b.unique_id)
	const hasEntries = Array.isArray(b.entries) && b.entries.length > 0
	if (!uuid || uuid === NIL_UUID || !hasEntries) return []
	return [{ index: 0, name: str(b.name) || 'Playlist', uuid }]
}

/** Number of built-in effects on a consumer light (`GET led/effects`). */
export function parseEffectsCount(body: unknown): number {
	const b = checkResult(body, 'led/effects')
	const n = numOrNull(b.effects_number)
	return n !== null && n >= 0 ? Math.min(n, MAX_LIST_ENTRIES) : 0
}

export function parseBrightness(body: unknown): BrightnessInfo {
	const b = checkResult(body, 'led/out/brightness')
	const value = numOrNull(b.value)
	if (value === null) throw new RestResponseError('led/out/brightness: missing numeric "value"')
	return { filter: b.mode === 'disabled' ? 'disabled' : 'enabled', value }
}
