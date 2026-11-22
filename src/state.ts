export type AppMode = 'unknown' | 'off' | 'movie' | 'playlist'

/** Controllers send no feedback, so this is only what we last *told* them to do. */
export interface AssumedState {
	mode: AppMode
	effect: string
	brightness: number | null
	brightnessFilter: 'unknown' | 'enabled' | 'disabled'
}

export const initialState = (): AssumedState => ({
	mode: 'unknown',
	effect: '',
	brightness: null,
	brightnessFilter: 'unknown',
})
