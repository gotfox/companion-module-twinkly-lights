import test from 'node:test'
import assert from 'node:assert/strict'
import { Fader } from '../dist/fade.js'
import { initialState } from '../dist/state.js'
import { adjustBrightness, setBrightness, setColor, startBrightness } from '../dist/fade-actions.js'

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

test('set colour without a fade sends once and records mode and colour', async () => {
	const host = fakeHost({ mode: 'movie' })
	const red = { red: 255, green: 0, blue: 0 }
	assert.equal(await setColor(host, TARGET, red, 0), true)
	assert.deepEqual(host.sentColor, [red])
	assert.equal(host.state.mode, 'color')
	assert.deepEqual(host.state.color, red)
})

test('a colour fade runs from the current colour when already in colour mode', async () => {
	const host = fakeHost({ mode: 'color', color: { red: 0, green: 0, blue: 0 } })
	assert.equal(await setColor(host, TARGET, { red: 100, green: 50, blue: 0 }, 1), true)
	assert.ok(host.sentColor.length > 2)
	assert.deepEqual(host.sentColor.at(-1), { red: 100, green: 50, blue: 0 })
	const reds = host.sentColor.map((c) => c.red)
	assert.deepEqual(reds, [...reds].sort((a, b) => a - b))
	assert.deepEqual(host.state.color, { red: 100, green: 50, blue: 0 })
})

test('a colour fade sets the colour first, then uses the cheaper update for the remaining steps', async () => {
	const host = fakeHost({ mode: 'color', color: { red: 0, green: 0, blue: 0 } }, 'rest')
	await setColor(host, TARGET, { red: 100, green: 0, blue: 0 }, 1)
	assert.ok(host.sentColorOptions.length > 2)
	assert.deepEqual(host.sentColorOptions[0], { alreadySolid: false })
	assert.ok(host.sentColorOptions.slice(1).every((o) => o.alreadySolid === true))
})

test('an instant colour change always sets the mode', async () => {
	const host = fakeHost({ mode: 'color', color: { red: 1, green: 1, blue: 1 } })
	await setColor(host, TARGET, { red: 9, green: 9, blue: 9 }, 0)
	assert.deepEqual(host.sentColorOptions, [{ alreadySolid: false }])
})

test('a colour fade outside colour mode is sent instantly, with a warning', async () => {
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

test('a failed send during a fade reports false', async () => {
	const host = fakeHost({ brightness: 100, brightnessFilter: 'enabled' })
	host.controller.brightness = async () => false
	assert.equal(await setBrightness(host, TARGET, 0, 1), false)
})
