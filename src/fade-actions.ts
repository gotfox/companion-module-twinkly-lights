import type { TargetOptions } from './controller.js'
import type { RgbColor } from './color.js'
import { FADE_STEP_MS } from './fade.js'
import type ModuleInstance from './main.js'
import type { AssumedState } from './state.js'

/** What the brightness and colour actions need from the module, so they can be tested without one. */
export type FadeHost = Pick<ModuleInstance, 'state' | 'fader' | 'controller' | 'setState' | 'log'>

/** Fader channel used by every brightness change, so a new command can cancel a running fade */
export const BRIGHTNESS_CHANNEL = 'brightness'
const COLOR_CHANNEL = 'color'
const MS_PER_SECOND = 1000
const FULL_BRIGHTNESS = 100

const clampPercent = (n: number): number => Math.min(FULL_BRIGHTNESS, Math.max(0, Math.round(n)))
const toVector = (c: RgbColor): number[] => [c.red, c.green, c.blue]
const fromVector = (v: readonly number[]): RgbColor => ({ red: v[0] ?? 0, green: v[1] ?? 0, blue: v[2] ?? 0 })

const timing = (host: FadeHost, fadeSeconds: number) => ({
	durationMs: fadeSeconds * MS_PER_SECOND,
	stepMs: FADE_STEP_MS[host.controller.kind],
})

/**
 * The level a fade starts from: the stored level, or full while the brightness filter is off
 * (the controller keeps the stored value but ignores it). Null when it isn't known.
 */
export function startBrightness(state: Pick<AssumedState, 'brightness' | 'brightnessFilter'>): number | null {
	return state.brightnessFilter === 'disabled' ? FULL_BRIGHTNESS : state.brightness
}

const warnInstant = (host: FadeHost, what: string): void =>
	host.log('warn', `Fade skipped: ${what} is not known yet, so the change was sent instantly.`)

/** Set an absolute brightness, fading from the current level when `fadeSeconds` is above 0. */
export async function setBrightness(
	host: FadeHost,
	target: TargetOptions,
	value: number,
	fadeSeconds: number,
): Promise<boolean> {
	host.fader.cancel(BRIGHTNESS_CHANNEL)
	const send = async (level: number): Promise<boolean> =>
		host.controller.brightness(target, { mode: 'enabled', type: 'A', value: level })
	const record = (): void => host.setState({ brightness: value, brightnessFilter: 'enabled' })

	if (fadeSeconds > 0) {
		const from = startBrightness(host.state)
		if (from === null) {
			warnInstant(host, 'the current brightness')
		} else {
			const reached = await host.fader.run(
				BRIGHTNESS_CHANNEL,
				[from],
				[value],
				timing(host, fadeSeconds),
				async (level) => send(level[0] ?? value),
			)
			if (reached) record()
			return reached
		}
	}
	const sent = await send(value)
	if (sent) record()
	return sent
}

/** Change brightness by `delta`. With a fade this becomes an absolute fade to the new level. */
export async function adjustBrightness(
	host: FadeHost,
	target: TargetOptions,
	delta: number,
	fadeSeconds: number,
): Promise<boolean> {
	const from = startBrightness(host.state)
	if (fadeSeconds > 0 && from !== null) {
		return setBrightness(host, target, clampPercent(from + delta), fadeSeconds)
	}
	host.fader.cancel(BRIGHTNESS_CHANNEL)
	if (fadeSeconds > 0) warnInstant(host, 'the current brightness')
	const sent = await host.controller.brightness(target, { mode: 'enabled', type: 'R', value: delta })
	if (sent) {
		const base = host.state.brightness
		host.setState({ brightness: base === null ? null : clampPercent(base + delta), brightnessFilter: 'enabled' })
	}
	return sent
}

/**
 * Show a solid colour. A fade only runs when the lights are already showing a known solid colour;
 * from anything else there is no colour to start from, so the change is instant.
 */
export async function setColor(
	host: FadeHost,
	target: TargetOptions,
	color: RgbColor,
	fadeSeconds: number,
): Promise<boolean> {
	host.fader.cancel(COLOR_CHANNEL)
	const send = async (c: RgbColor, alreadySolid: boolean): Promise<boolean> =>
		host.controller.color(target, c, { alreadySolid })
	const record = (): void => host.setState({ mode: 'color', color })

	if (fadeSeconds > 0) {
		const from = host.state.mode === 'color' ? host.state.color : null
		if (from === null) {
			warnInstant(host, 'the current colour')
		} else {
			// The first step sets the colour mode; the rest use the cheaper update, which keeps REST steps fast
			let firstStep = true
			const reached = await host.fader.run(
				COLOR_CHANNEL,
				toVector(from),
				toVector(color),
				timing(host, fadeSeconds),
				async (v) => {
					const alreadySolid = !firstStep
					firstStep = false
					return send(fromVector(v), alreadySolid)
				},
			)
			if (reached) record()
			return reached
		}
	}
	const sent = await send(color, false)
	if (sent) record()
	return sent
}
