import type { TargetOptions } from './controller.js'
import { sameColor, type RgbColor } from './color.js'
import { FADE_STEP_MS } from './fade.js'
import type ModuleInstance from './main.js'
import type { AssumedState } from './state.js'

/** What the brightness and colour actions need from the module, so they can be tested without one. */
export type FadeHost = Pick<ModuleInstance, 'state' | 'fader' | 'controller' | 'setState' | 'log' | 'resolveDeviceId'>

const BRIGHTNESS_PREFIX = 'brightness:'
const COLOR_PREFIX = 'color:'
const MS_PER_SECOND = 1000
const FULL_BRIGHTNESS = 100

const clampPercent = (n: number): number => Math.min(FULL_BRIGHTNESS, Math.max(0, Math.round(n)))
const toVector = (c: RgbColor): number[] => [c.red, c.green, c.blue]
const fromVector = (v: readonly number[]): RgbColor => ({ red: v[0] ?? 0, green: v[1] ?? 0, blue: v[2] ?? 0 })

/**
 * The fader channel for one setting on one controller. With OSC each action can pick its own target,
 * so a fade for one controller must not cancel another's; REST always talks to a single device.
 */
const channelFor = (prefix: string, host: FadeHost, target: TargetOptions): string =>
	prefix + (host.controller.kind === 'osc' ? (host.resolveDeviceId(target) ?? 'invalid') : 'device')

/** Stop running brightness fades on every controller (for example when the filter is toggled). */
export const cancelBrightnessFades = (host: Pick<FadeHost, 'fader'>): void =>
	host.fader.cancelMatching(BRIGHTNESS_PREFIX)

/**
 * Stop running colour fades on every controller. Each colour step (over OSC) switches the controller to
 * colour mode, so a fade left running would undo Lights off, Play effect or Start playlist.
 */
export const cancelColorFades = (host: Pick<FadeHost, 'fader'>): void => host.fader.cancelMatching(COLOR_PREFIX)

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

/** Where the brightness is now: the last step of a running fade, otherwise the stored level. */
const brightnessNow = (host: FadeHost, channel: string): number | null =>
	host.fader.current(channel)?.[0] ?? startBrightness(host.state)

/** The colour showing now: the last step of a running fade, otherwise the known solid colour. */
const colorNow = (host: FadeHost, channel: string): RgbColor | null => {
	const running = host.fader.current(channel)
	if (running) return fromVector(running)
	return host.state.mode === 'color' ? host.state.color : null
}

/**
 * Will this brightness change run as a fade? False with no fade time, an unknown starting level, or
 * nothing to fade (already at the target), in which case one command is sent at once instead.
 */
export function brightnessFades(host: FadeHost, target: TargetOptions, fadeSeconds: number, value: number): boolean {
	const from = brightnessNow(host, channelFor(BRIGHTNESS_PREFIX, host, target))
	return fadeSeconds > 0 && from !== null && from !== value
}

/** Will a relative brightness change by `delta` run as a fade? */
export function adjustFades(host: FadeHost, target: TargetOptions, fadeSeconds: number, delta: number): boolean {
	const from = brightnessNow(host, channelFor(BRIGHTNESS_PREFIX, host, target))
	return from !== null && brightnessFades(host, target, fadeSeconds, clampPercent(from + delta))
}

/** Will this colour change run as a fade? Only from a known solid colour, and only to a different one. */
export function colorFades(host: FadeHost, target: TargetOptions, fadeSeconds: number, color: RgbColor): boolean {
	const from = colorNow(host, channelFor(COLOR_PREFIX, host, target))
	return fadeSeconds > 0 && from !== null && !sameColor(from, color)
}

const warnInstant = (host: FadeHost, what: string): void =>
	host.log('warn', `Fade skipped: ${what} is not known yet, so the change was sent instantly.`)

/**
 * Set an absolute brightness, fading from the current level when `fadeSeconds` is above 0. A fade
 * this replaces hands over where it got to, so the new one carries on from there instead of jumping.
 */
export async function setBrightness(
	host: FadeHost,
	target: TargetOptions,
	value: number,
	fadeSeconds: number,
): Promise<boolean> {
	const channel = channelFor(BRIGHTNESS_PREFIX, host, target)
	const interrupted = host.fader.cancel(channel)
	const send = async (level: number): Promise<boolean> =>
		host.controller.brightness(target, { mode: 'enabled', type: 'A', value: level })
	const record = (): void => host.setState({ brightness: value, brightnessFilter: 'enabled' })

	const from = interrupted?.[0] ?? startBrightness(host.state)
	if (from !== null && fadeSeconds > 0 && from !== value) {
		const reached = await host.fader.run(channel, [from], [value], timing(host, fadeSeconds), async (level) =>
			send(level[0] ?? value),
		)
		if (reached) record()
		return reached
	}
	if (fadeSeconds > 0 && from === null) warnInstant(host, 'the current brightness')
	// Also when there is nothing to fade: one command still switches the brightness filter on
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
	const channel = channelFor(BRIGHTNESS_PREFIX, host, target)
	const from = brightnessNow(host, channel)
	if (fadeSeconds > 0 && from !== null) {
		return setBrightness(host, target, clampPercent(from + delta), fadeSeconds)
	}
	const interrupted = host.fader.cancel(channel)
	if (fadeSeconds > 0) warnInstant(host, 'the current brightness')
	const sent = await host.controller.brightness(target, { mode: 'enabled', type: 'R', value: delta })
	if (sent) {
		const base = interrupted?.[0] ?? host.state.brightness
		host.setState({ brightness: base === null ? null : clampPercent(base + delta), brightnessFilter: 'enabled' })
	}
	return sent
}

/**
 * Show a solid colour. A fade only runs when the lights are already showing a known solid colour;
 * from anything else there is no colour to start from, so the change is instant. A fade this replaces
 * hands over the colour it reached.
 */
export async function setColor(
	host: FadeHost,
	target: TargetOptions,
	color: RgbColor,
	fadeSeconds: number,
): Promise<boolean> {
	const channel = channelFor(COLOR_PREFIX, host, target)
	const interrupted = host.fader.cancel(channel)
	const send = async (c: RgbColor, alreadySolid: boolean): Promise<boolean> =>
		host.controller.color(target, c, { alreadySolid })
	const record = (): void => host.setState({ mode: 'color', color })

	const from = interrupted ? fromVector(interrupted) : host.state.mode === 'color' ? host.state.color : null
	if (from !== null && fadeSeconds > 0 && !sameColor(from, color)) {
		// The first step sets the colour mode; the rest use the cheaper update, which keeps REST steps fast
		let firstStep = true
		const reached = await host.fader.run(
			channel,
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
	if (fadeSeconds > 0 && from === null) warnInstant(host, 'the current colour')
	const sent = await send(color, false)
	if (sent) record()
	return sent
}
