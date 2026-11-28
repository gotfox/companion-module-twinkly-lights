import test from 'node:test'
import assert from 'node:assert/strict'
import { COLOR_PRESETS, clampByte, colorHex, colorToNumber, contrastText, rgbFromNumber, sameColor } from '../dist/color.js'
import { colorVariable } from '../dist/state.js'

test('the color variable is empty unless the lights are in color mode', () => {
	const red = { red: 255, green: 0, blue: 0 }
	assert.equal(colorVariable({ mode: 'color', color: red }), 'ff0000')
	assert.equal(colorVariable({ mode: 'off', color: red }), '', 'a stale color after another mode was chosen')
	assert.equal(colorVariable({ mode: 'movie', color: red }), '')
	assert.equal(colorVariable({ mode: 'color', color: null }), '')
})

test('rgbFromNumber splits a Companion color (0xRRGGBB)', () => {
	assert.deepEqual(rgbFromNumber(0xff8000), { red: 255, green: 128, blue: 0 })
	assert.deepEqual(rgbFromNumber(0x000000), { red: 0, green: 0, blue: 0 })
	assert.deepEqual(rgbFromNumber(0x0000ff), { red: 0, green: 0, blue: 255 })
})

test('rgbFromNumber ignores anything above 24 bits and survives bad input', () => {
	assert.deepEqual(rgbFromNumber(0xff112233), { red: 0x11, green: 0x22, blue: 0x33 })
	assert.deepEqual(rgbFromNumber(Number.NaN), { red: 0, green: 0, blue: 0 })
	assert.deepEqual(rgbFromNumber(-1), { red: 255, green: 255, blue: 255 })
})

test('colorToNumber is the inverse of rgbFromNumber', () => {
	for (const n of [0, 0xff0000, 0x00ff00, 0x0000ff, 0x123456, 0xffffff]) {
		assert.equal(colorToNumber(rgbFromNumber(n)), n)
	}
})

test('colorHex pads each channel', () => {
	assert.equal(colorHex({ red: 255, green: 0, blue: 10 }), 'ff000a')
	assert.equal(colorHex({ red: 0, green: 0, blue: 0 }), '000000')
})

test('clampByte rounds and limits to 0-255', () => {
	assert.equal(clampByte(-5), 0)
	assert.equal(clampByte(300), 255)
	assert.equal(clampByte(127.6), 128)
})

test('sameColor compares channels and treats null as different', () => {
	assert.equal(sameColor({ red: 1, green: 2, blue: 3 }, { red: 1, green: 2, blue: 3 }), true)
	assert.equal(sameColor({ red: 1, green: 2, blue: 3 }, { red: 1, green: 2, blue: 4 }), false)
	assert.equal(sameColor(null, { red: 1, green: 2, blue: 3 }), false)
	assert.equal(sameColor(null, null), false)
})

test('contrastText picks black on light colors and white on dark ones', () => {
	assert.equal(contrastText({ red: 255, green: 255, blue: 255 }), 0x000000)
	assert.equal(contrastText({ red: 255, green: 220, blue: 0 }), 0x000000)
	assert.equal(contrastText({ red: 0, green: 0, blue: 255 }), 0xffffff)
	assert.equal(contrastText({ red: 0, green: 0, blue: 0 }), 0xffffff)
})

test('no two color presets are the same color', () => {
	const values = COLOR_PRESETS.map((p) => colorToNumber(p.color))
	assert.equal(new Set(values).size, values.length)
})

test('the warm presets run orange, amber, gold, yellow, each with more green than the last', () => {
	const green = (id) => COLOR_PRESETS.find((p) => p.id === id)?.color.green
	const [orange, amber, gold, yellow] = ['orange', 'amber', 'gold', 'yellow'].map(green)
	assert.ok([orange, amber, gold, yellow].every((g) => g !== undefined), 'all four presets exist')
	assert.ok(orange < amber && amber < gold && gold < yellow)
})

test('color presets have unique ids and valid channel values', () => {
	assert.ok(COLOR_PRESETS.length >= 19)
	assert.equal(new Set(COLOR_PRESETS.map((p) => p.id)).size, COLOR_PRESETS.length)
	for (const p of COLOR_PRESETS) {
		assert.ok(p.label.length > 0)
		for (const v of [p.color.red, p.color.green, p.color.blue]) {
			assert.ok(Number.isInteger(v) && v >= 0 && v <= 255, `${p.id} has an invalid channel ${v}`)
		}
	}
})
