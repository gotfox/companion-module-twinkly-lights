import test from 'node:test'
import assert from 'node:assert/strict'
import { COLOR_PRESETS, colorToNumber, contrastText } from '../dist/color.js'
import { UpdatePresets } from '../dist/presets.js'

/** Build the presets the way the module does, with no controller content loaded. */
const buildPresets = () => {
	let built
	UpdatePresets({
		content: undefined,
		setPresetDefinitions: (_structure, presets) => {
			built = presets
		},
	})
	return built
}

test('a color button is drawn in the preset display color, while the lights get the tuned color', () => {
	const presets = buildPresets()
	for (const p of COLOR_PRESETS) {
		const preset = presets[`color_${p.id}`]
		const lights = colorToNumber(p.color)
		assert.equal(preset.style.bgcolor, colorToNumber(p.display), `${p.id} button face`)
		assert.equal(preset.style.color, contrastText(p.display), `${p.id} button text`)
		assert.equal(preset.steps[0].down[0].options.color, lights, `${p.id} action`)
		assert.equal(preset.feedbacks[0].options.color, lights, `${p.id} feedback`)
	}
})

test('every color preset has a valid display color, and the tuned warm ones differ from the lights', () => {
	for (const p of COLOR_PRESETS) {
		for (const v of [p.display.red, p.display.green, p.display.blue]) {
			assert.ok(Number.isInteger(v) && v >= 0 && v <= 255, `${p.id} has an invalid display channel ${v}`)
		}
	}
	const orange = COLOR_PRESETS.find((p) => p.id === 'orange')
	assert.notEqual(colorToNumber(orange.display), colorToNumber(orange.color))
})

test('no two color presets share a button color', () => {
	const faces = COLOR_PRESETS.map((p) => colorToNumber(p.display))
	assert.equal(new Set(faces).size, faces.length)
})
