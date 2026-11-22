import type { CompanionPresetDefinitions, CompanionPresetSection } from '@companion-module/base'
import type ModuleInstance from './main.js'
import type { ModuleSchema } from './main.js'

const defaultTarget = { target: 'default', productType: 'TwPRO', mac: '' }
const active = { bgcolor: 0x006600, color: 0xffffff }

export function UpdatePresets(self: ModuleInstance): void {
	const presets: CompanionPresetDefinitions<ModuleSchema> = {}

	presets['off'] = {
		type: 'simple',
		name: 'Lights off',
		style: { text: 'Lights\\nOFF', size: 'auto', color: 0xffffff, bgcolor: 0x000000 },
		steps: [{ down: [{ actionId: 'lights_off', options: { ...defaultTarget } }], up: [] }],
		feedbacks: [{ feedbackId: 'mode_is', options: { mode: 'off' }, style: active }],
	}

	const movieIds: string[] = []
	for (let i = 0; i < 16; i++) {
		const id = `movie_${i}`
		movieIds.push(id)
		presets[id] = {
			type: 'simple',
			name: `Effect ${i}`,
			style: { text: `Effect\\n${i}`, size: 'auto', color: 0xffffff, bgcolor: 0x000000 },
			steps: [
				{ down: [{ actionId: 'movie', options: { ...defaultTarget, by: 'handle', handle: i, uuid: '' } }], up: [] },
			],
			feedbacks: [{ feedbackId: 'effect_is', options: { effect: String(i) }, style: active }],
		}
	}

	presets['playlist'] = {
		type: 'simple',
		name: 'Start playlist',
		style: { text: 'Playlist', size: 'auto', color: 0xffffff, bgcolor: 0x000000 },
		steps: [{ down: [{ actionId: 'playlist', options: { ...defaultTarget, index: 0 } }], up: [] }],
		feedbacks: [{ feedbackId: 'mode_is', options: { mode: 'playlist' }, style: active }],
	}

	const brightnessIds: string[] = []
	for (const pct of [0, 25, 50, 75, 100]) {
		const id = `bright_${pct}`
		brightnessIds.push(id)
		presets[id] = {
			type: 'simple',
			name: `Brightness ${pct}%`,
			style: { text: `Bright\\n${pct}%`, size: 'auto', color: 0xffffff, bgcolor: 0x000000 },
			steps: [{ down: [{ actionId: 'brightness_set', options: { ...defaultTarget, value: pct } }], up: [] }],
			feedbacks: [{ feedbackId: 'brightness_is', options: { value: pct }, style: active }],
		}
	}
	for (const [id, label, delta] of [
		['bright_up', 'Bright\\n+10%', 10],
		['bright_down', 'Bright\\n-10%', -10],
	] as const) {
		brightnessIds.push(id)
		presets[id] = {
			type: 'simple',
			name: label.replace('\\n', ' '),
			style: { text: label, size: 'auto', color: 0xffffff, bgcolor: 0x000000 },
			steps: [{ down: [{ actionId: 'brightness_adjust', options: { ...defaultTarget, delta } }], up: [] }],
			feedbacks: [],
		}
	}

	const structure: CompanionPresetSection<ModuleSchema>[] = [
		{
			id: 'playback',
			name: 'Playback',
			definitions: [
				{ id: 'power', name: 'Power & playlist', type: 'simple', presets: ['off', 'playlist'] },
				{ id: 'effects', name: 'Effects (handles 0-15)', type: 'simple', presets: movieIds },
			],
		},
		{
			id: 'brightness',
			name: 'Brightness',
			definitions: [{ id: 'levels', name: 'Brightness', type: 'simple', presets: brightnessIds }],
		},
	]

	self.setPresetDefinitions(structure, presets)
}
