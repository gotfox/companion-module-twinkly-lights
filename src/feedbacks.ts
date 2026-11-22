import type ModuleInstance from './main.js'

export type FeedbacksSchema = {
	mode_is: {
		type: 'boolean'
		options: { mode: string }
	}
	effect_is: {
		type: 'boolean'
		options: { effect: string }
	}
	brightness_is: {
		type: 'boolean'
		options: { value: number }
	}
}

export function UpdateFeedbacks(self: ModuleInstance): void {
	self.setFeedbackDefinitions({
		mode_is: {
			name: 'Assumed mode matches',
			description: 'True if the last command sent by Companion set this mode. Controllers do not report state.',
			type: 'boolean',
			defaultStyle: { bgcolor: 0x006600, color: 0xffffff },
			options: [
				{
					id: 'mode',
					type: 'dropdown',
					label: 'Mode',
					default: 'movie',
					choices: [
						{ id: 'off', label: 'Off' },
						{ id: 'movie', label: 'Movie (effect)' },
						{ id: 'playlist', label: 'Playlist' },
					],
				},
			],
			callback: (feedback) => self.state.mode === feedback.options.mode,
		},
		effect_is: {
			name: 'Assumed effect matches',
			description: 'True if the last movie command used this handle number or UUID.',
			type: 'boolean',
			defaultStyle: { bgcolor: 0x006600, color: 0xffffff },
			options: [{ id: 'effect', type: 'textinput', label: 'Effect handle or UUID', default: '0', useVariables: true }],
			callback: (feedback) =>
				self.state.mode === 'movie' &&
				self.state.effect.toLowerCase() === String(feedback.options.effect).trim().toLowerCase(),
		},
		brightness_is: {
			name: 'Assumed brightness matches',
			description: 'True if the tracked brightness equals this value.',
			type: 'boolean',
			defaultStyle: { bgcolor: 0x006600, color: 0xffffff },
			options: [{ id: 'value', type: 'number', label: 'Brightness (%)', default: 100, min: 0, max: 100 }],
			callback: (feedback) => self.state.brightness === feedback.options.value,
		},
	})
}
