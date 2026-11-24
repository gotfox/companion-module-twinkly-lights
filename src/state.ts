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
	brightness: number | null
	brightnessFilter: 'unknown' | 'enabled' | 'disabled'
}

export const initialState = (): AssumedState => ({
	source: 'assumed',
	mode: 'unknown',
	effect: '',
	effectName: '',
	playlistName: '',
	brightness: null,
	brightnessFilter: 'unknown',
})

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
		brightness: brightness.value,
		brightnessFilter: brightness.filter,
	}
}
