import test from 'node:test'
import assert from 'node:assert/strict'
import { Fader } from '../dist/fade.js'
import { initialState } from '../dist/state.js'
import {
	adjustBrightness,
	adjustFades,
	brightnessFades,
	cancelBrightnessFades,
	cancelColorFades,
	colorFades,
	setBrightness,
	setColor,
	startBrightness,
} from '../dist/fade-actions.js'

const fakeClock = () => {
	let t = 0
	return {
		now: () => t,
		sleep: (ms) =>
			new Promise((resolve) =>
				setImmediate(() => {
					t += ms
					resolve()
				}),
			),
	}
}

/** A stand-in for the module instance with just what the fade helpers use. */
function fakeHost(state = {}, kind = 'osc') {
	const host = {
		state: { ...initialState(), ...state },
		fader: new Fader(fakeClock()),
		sentBrightness: [],
		sentColor: [],
		sentColorOptions: [],
		logs: [],
		controller: {
			kind,
			brightness: async (_target, command) => {
				host.sentBrightness.push(command)
				return true
			},
			color: async (_target, color, options) => {
				host.sentColor.push(color)
				host.sentColorOptions.push(options)
				return true
			},
		},
		resolveDeviceId: (target) => target?.id ?? 'TwPRO*',
		setState: (patch) => {
			host.state = { ...host.state, ...patch }
		},
		log: (level, message) => host.logs.push([level, message]),
	}
	return host
}

const TARGET = {}

test('startBrightness: the stored level, 100 while the filter is off, null when unknown', () => {
	assert.equal(startBrightness({ ...initialState(), brightness: 40, brightnessFilter: 'enabled' }), 40)
	assert.equal(startBrightness({ ...initialState(), brightness: 40, brightnessFilter: 'disabled' }), 100)
	assert.equal(startBrightness({ ...initialState(), brightness: 40, brightnessFilter: 'unknown' }), 40)
	assert.equal(startBrightness(initialState()), null)
})

test('set brightness without a fade sends once and records it', async () => {
	const host = fakeHost({ brightness: 100, brightnessFilter: 'enabled' })
	assert.equal(await setBrightness(host, TARGET, 50, 0), true)
	assert.deepEqual(host.sentBrightness, [{ mode: 'enabled', type: 'A', value: 50 }])
	assert.equal(host.state.brightness, 50)
	assert.equal(host.state.brightnessFilter, 'enabled')
})

test('set brightness with a fade steps down to the target, absolute and enabled', async () => {
	const host = fakeHost({ brightness: 100, brightnessFilter: 'enabled' })
	assert.equal(await setBrightness(host, TARGET, 50, 1), true)
	const values = host.sentBrightness.map((c) => c.value)
	assert.ok(values.length >= 5, `expected several steps, got ${values.length}`)
	assert.equal(values.at(-1), 50)
	assert.deepEqual(values, [...values].sort((a, b) => b - a))
	for (const c of host.sentBrightness) {
		assert.equal(c.mode, 'enabled')
		assert.equal(c.type, 'A')
	}
	assert.equal(host.state.brightness, 50)
})

test('REST fades use fewer, slower steps than OSC', async () => {
	const osc = fakeHost({ brightness: 0, brightnessFilter: 'enabled' }, 'osc')
	const rest = fakeHost({ brightness: 0, brightnessFilter: 'enabled' }, 'rest')
	await setBrightness(osc, TARGET, 100, 2)
	await setBrightness(rest, TARGET, 100, 2)
	assert.ok(rest.sentBrightness.length < osc.sentBrightness.length)
})

test('a fade starts from 100 when the brightness filter is off', async () => {
	const host = fakeHost({ brightness: 10, brightnessFilter: 'disabled' })
	await setBrightness(host, TARGET, 60, 1)
	assert.ok(host.sentBrightness[0].value <= 100 && host.sentBrightness[0].value > 60)
	assert.equal(host.sentBrightness.at(-1).value, 60)
})

test('a fade with an unknown starting level is sent instantly, with a warning', async () => {
	const host = fakeHost({}, 'osc')
	assert.equal(await setBrightness(host, TARGET, 30, 5), true)
	assert.deepEqual(host.sentBrightness, [{ mode: 'enabled', type: 'A', value: 30 }])
	assert.ok(host.logs.some(([level]) => level === 'warn'))
})

test('adjust with a fade becomes an absolute fade to start + change', async () => {
	const host = fakeHost({ brightness: 40, brightnessFilter: 'enabled' })
	await adjustBrightness(host, TARGET, 20, 1)
	assert.ok(host.sentBrightness.length > 1)
	assert.equal(host.sentBrightness.at(-1).value, 60)
	assert.ok(host.sentBrightness.every((c) => c.type === 'A'))
})

test('adjust clamps the target to 0-100', async () => {
	const host = fakeHost({ brightness: 90, brightnessFilter: 'enabled' })
	await adjustBrightness(host, TARGET, 50, 1)
	assert.equal(host.sentBrightness.at(-1).value, 100)
})

test('adjust without a fade, or with an unknown level, sends the relative command', async () => {
	const known = fakeHost({ brightness: 40, brightnessFilter: 'enabled' })
	await adjustBrightness(known, TARGET, -10, 0)
	assert.deepEqual(known.sentBrightness, [{ mode: 'enabled', type: 'R', value: -10 }])
	assert.equal(known.state.brightness, 30)

	const unknown = fakeHost({})
	await adjustBrightness(unknown, TARGET, 15, 3)
	assert.deepEqual(unknown.sentBrightness, [{ mode: 'enabled', type: 'R', value: 15 }])
})

test('set color without a fade sends once and records mode and color', async () => {
	const host = fakeHost({ mode: 'movie' })
	const red = { red: 255, green: 0, blue: 0 }
	assert.equal(await setColor(host, TARGET, red, 0), true)
	assert.deepEqual(host.sentColor, [red])
	assert.equal(host.state.mode, 'color')
	assert.deepEqual(host.state.color, red)
})

test('a color fade runs from the current color when already in color mode', async () => {
	const host = fakeHost({ mode: 'color', color: { red: 0, green: 0, blue: 0 } })
	assert.equal(await setColor(host, TARGET, { red: 100, green: 50, blue: 0 }, 1), true)
	assert.ok(host.sentColor.length > 2)
	assert.deepEqual(host.sentColor.at(-1), { red: 100, green: 50, blue: 0 })
	const reds = host.sentColor.map((c) => c.red)
	assert.deepEqual(reds, [...reds].sort((a, b) => a - b))
	assert.deepEqual(host.state.color, { red: 100, green: 50, blue: 0 })
})

test('a color fade sets the color first, then uses the cheaper update for the remaining steps', async () => {
	const host = fakeHost({ mode: 'color', color: { red: 0, green: 0, blue: 0 } }, 'rest')
	await setColor(host, TARGET, { red: 100, green: 0, blue: 0 }, 1)
	assert.ok(host.sentColorOptions.length > 2)
	assert.deepEqual(host.sentColorOptions[0], { alreadySolid: false })
	assert.ok(host.sentColorOptions.slice(1).every((o) => o.alreadySolid === true))
})

test('an instant color change always sets the mode', async () => {
	const host = fakeHost({ mode: 'color', color: { red: 1, green: 1, blue: 1 } })
	await setColor(host, TARGET, { red: 9, green: 9, blue: 9 }, 0)
	assert.deepEqual(host.sentColorOptions, [{ alreadySolid: false }])
})

test('a color fade outside color mode is sent instantly, with a warning', async () => {
	const host = fakeHost({ mode: 'movie' })
	const blue = { red: 0, green: 0, blue: 255 }
	assert.equal(await setColor(host, TARGET, blue, 3), true)
	assert.deepEqual(host.sentColor, [blue])
	assert.ok(host.logs.some(([level]) => level === 'warn'))
})

test('a new brightness command cancels a fade that is still running', async () => {
	const host = fakeHost({ brightness: 0, brightnessFilter: 'enabled' })
	const slow = setBrightness(host, TARGET, 100, 30)
	await new Promise((r) => setImmediate(r))
	await new Promise((r) => setImmediate(r))
	await setBrightness(host, TARGET, 5, 0)
	assert.equal(await slow, false)
	assert.equal(host.sentBrightness.at(-1).value, 5)
	assert.equal(host.state.brightness, 5)
})

test('a change is only reported as a fade when steps will actually be sent', () => {
	const bright = fakeHost({ brightness: 100, brightnessFilter: 'enabled' })
	assert.equal(brightnessFades(bright, TARGET, 2, 50), true)
	assert.equal(brightnessFades(bright, TARGET, 0, 50), false, 'no fade time')
	assert.equal(brightnessFades(bright, TARGET, 2, 100), false, 'already at that level')
	assert.equal(brightnessFades(fakeHost({}), TARGET, 2, 50), false, 'unknown starting level')
	assert.equal(adjustFades(bright, TARGET, 2, -20), true)
	assert.equal(adjustFades(bright, TARGET, 2, 20), false, 'clamped to where it already is')
	assert.equal(adjustFades(fakeHost({}), TARGET, 2, -20), false)

	const red = { red: 255, green: 0, blue: 0 }
	const blue = { red: 0, green: 0, blue: 255 }
	const inColor = fakeHost({ mode: 'color', color: red })
	assert.equal(colorFades(inColor, TARGET, 2, blue), true)
	assert.equal(colorFades(inColor, TARGET, 0, blue), false, 'no fade time')
	assert.equal(colorFades(inColor, TARGET, 2, red), false, 'already that color')
	assert.equal(colorFades(fakeHost({ mode: 'movie' }), TARGET, 2, red), false, 'not in color mode')
	assert.equal(colorFades(fakeHost({ mode: 'color' }), TARGET, 2, red), false, 'color not known')
})

const ticks = async (n = 8) => {
	for (let i = 0; i < n; i++) await new Promise((r) => setImmediate(r))
}

test('a fade interrupted by another command starts the next one from where it got to', async () => {
	const host = fakeHost({ brightness: 0, brightnessFilter: 'enabled' })
	const slow = setBrightness(host, TARGET, 100, 30)
	await ticks()
	const reached = host.sentBrightness.at(-1).value
	assert.ok(reached > 0 && reached < 100, `interrupted at ${reached}`)
	const before = host.sentBrightness.length
	assert.equal(await adjustBrightness(host, TARGET, 10, 1), true)
	assert.equal(await slow, false)
	const resumed = host.sentBrightness.slice(before).map((c) => c.value)
	assert.ok(resumed[0] >= reached, `restarted from ${resumed[0]} after being interrupted at ${reached}`)
	assert.equal(resumed.at(-1), reached + 10)
})

test('a color fade interrupted by another color starts the next fade from the color it reached', async () => {
	const red = { red: 255, green: 0, blue: 0 }
	const host = fakeHost({ mode: 'color', color: red })
	const slow = setColor(host, TARGET, { red: 0, green: 0, blue: 255 }, 30)
	await ticks()
	const reached = host.sentColor.at(-1)
	assert.ok(reached.red < 255 && reached.blue > 0, 'the first fade made progress')
	const before = host.sentColor.length
	assert.equal(await setColor(host, TARGET, { red: 0, green: 255, blue: 0 }, 1), true)
	assert.equal(await slow, false)
	const resumed = host.sentColor.slice(before)
	assert.ok(resumed[0].red <= reached.red, `restarted from red ${resumed[0].red}, was at ${reached.red}`)
})

test('fades for different controllers run side by side', async () => {
	const host = fakeHost({ brightness: 100, brightnessFilter: 'enabled' })
	const a = setBrightness(host, { id: 'A' }, 20, 1)
	const b = setBrightness(host, { id: 'B' }, 30, 1)
	assert.equal(await a, true)
	assert.equal(await b, true)
})

test('cancelColorFades stops color fades for every controller and leaves brightness fades alone', async () => {
	const red = { red: 255, green: 0, blue: 0 }
	const blue = { red: 0, green: 0, blue: 255 }
	const host = fakeHost({ mode: 'color', color: red, brightness: 100, brightnessFilter: 'enabled' })
	const a = setColor(host, { id: 'A' }, blue, 30)
	const b = setColor(host, { id: 'B' }, blue, 30)
	const level = setBrightness(host, { id: 'A' }, 50, 1)
	await ticks()
	cancelColorFades(host)
	const sentColors = host.sentColor.length
	assert.equal(await a, false)
	assert.equal(await b, false)
	assert.equal(await level, true, 'the brightness fade carried on')
	assert.equal(host.sentColor.length, sentColors, 'no color step was sent after the cancel')
})

test('cancelBrightnessFades stops brightness fades for every controller', async () => {
	const host = fakeHost({ brightness: 0, brightnessFilter: 'enabled' })
	const a = setBrightness(host, { id: 'A' }, 100, 30)
	const b = setBrightness(host, { id: 'B' }, 100, 30)
	await ticks()
	cancelBrightnessFades(host)
	assert.equal(await a, false)
	assert.equal(await b, false)
})

test('setting 100% when the filter is off and the level is already 100% still sends the enabling command', async () => {
	const host = fakeHost({ brightness: 100, brightnessFilter: 'disabled' })
	assert.equal(await setBrightness(host, TARGET, 100, 3), true)
	assert.deepEqual(host.sentBrightness, [{ mode: 'enabled', type: 'A', value: 100 }])
	assert.equal(host.state.brightnessFilter, 'enabled')
})

test('fading to the color already showing sends it once instead of doing nothing', async () => {
	const red = { red: 255, green: 0, blue: 0 }
	const host = fakeHost({ mode: 'color', color: red })
	assert.equal(await setColor(host, TARGET, red, 3), true)
	assert.deepEqual(host.sentColor, [red])
})

test('a failed send during a fade reports false', async () => {
	const host = fakeHost({ brightness: 100, brightnessFilter: 'enabled' })
	host.controller.brightness = async () => false
	assert.equal(await setBrightness(host, TARGET, 0, 1), false)
})
