import { colorHex, type RgbColor } from './color.js'
import type { BrightnessInfo, ControllerMode, ModeInfo, MovieInfo } from './rest-parse.js'

export type AppMode = ControllerMode

/**
 * What Companion believes the controller is doing. With OSC only, this is what we last *told* it
 * (`source: 'assumed'`). When REST polling is on, it is replaced by what the controller reports
 * (`source: 'controller'`).
 */
export interface AssumedState {
	source: 'assumed' | 'controller'
	mode: AppMode
	/** Handle number as text when known, otherwise the effect UUID */
	effect: string
	effectName: string
	playlistName: string
	/** Identifies the playlist even when two share a name ('' when unknown) */
	playlistUuid: string
	brightness: number | null
	brightnessFilter: 'unknown' | 'enabled' | 'disabled'
	/** The solid colour shown; null unless in colour mode with a known colour */
	color: RgbColor | null
}

export const initialState = (): AssumedState => ({
	source: 'assumed',
	mode: 'unknown',
	effect: '',
	effectName: '',
	playlistName: '',
	playlistUuid: '',
	brightness: null,
	brightnessFilter: 'unknown',
	color: null,
})

/**
 * The `color` variable: RRGGBB while in colour mode, empty otherwise. Checking the mode matters because
 * a command that only records the mode (Lights off, Play effect...) leaves an old colour in the state.
 */
export const colorVariable = (state: Pick<AssumedState, 'mode' | 'color'>): string =>
	state.mode === 'color' && state.color !== null ? colorHex(state.color) : ''

/** Build state from a REST poll. The effect is reported by UUID; map it to a handle when the list has it. */
export function stateFromController(mode: ModeInfo, brightness: BrightnessInfo, movies: MovieInfo[]): AssumedState {
	const uuid = mode.effectUuid.toLowerCase()
	const movie = uuid ? movies.find((m) => m.uuid.toLowerCase() === uuid) : undefined
	return {
		source: 'controller',
		mode: mode.mode,
		effect: movie ? String(movie.handle) : mode.effectUuid,
		effectName: mode.effectName,
		playlistName: mode.playlistName,
		playlistUuid: mode.playlistUuid,
		brightness: brightness.value,
		brightnessFilter: brightness.filter,
		color: mode.color ?? null,
	}
}
