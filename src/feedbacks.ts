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
	playlist_is: {
		type: 'boolean'
		options: { index: number }
	}
}

export function UpdateFeedbacks(self: ModuleInstance): void {
	self.setFeedbackDefinitions({
		mode_is: {
			name: 'Mode matches',
			description:
				'True if the controller is in this mode. Read from the controller when state reading is on; otherwise the last mode Companion sent.',
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
						{ id: 'effect', label: 'Built-in effect (Twinkly)' },
						{ id: 'color', label: 'Solid colour (Twinkly)' },
					],
				},
			],
			callback: (feedback) => self.state.mode === feedback.options.mode,
		},
		effect_is: {
			name: 'Effect matches',
			description:
				'True if this effect is playing (handle, UUID or name; includes effects played by a playlist when state reading is on).',
			type: 'boolean',
			defaultStyle: { bgcolor: 0x006600, color: 0xffffff },
			options: [
				{ id: 'effect', type: 'textinput', label: 'Effect handle, UUID or name', default: '0', useVariables: true },
			],
			callback: (feedback) => {
				const want = String(feedback.options.effect).trim().toLowerCase()
				const s = self.state
				const playing = s.mode === 'movie' || (s.mode === 'playlist' && s.source === 'controller')
				return playing && want !== '' && (s.effect.toLowerCase() === want || s.effectName.toLowerCase() === want)
			},
		},
		playlist_is: {
			name: 'Playlist matches',
			description:
				'True if this playlist is playing (by index, 0 = first). Needs a controller IP, because the playlist is identified by name.',
			type: 'boolean',
			defaultStyle: { bgcolor: 0x006600, color: 0xffffff },
			options: [{ id: 'index', type: 'number', label: 'Playlist index', default: 0, min: 0, max: 255 }],
			callback: (feedback) => {
				const wanted = self.content?.playlists.find((p) => p.index === feedback.options.index)
				return self.state.mode === 'playlist' && wanted !== undefined && wanted.name === self.state.playlistName
			},
		},
		brightness_is: {
			name: 'Brightness matches',
			description: 'True if the brightness equals this value (read from the controller when state reading is on).',
			type: 'boolean',
			defaultStyle: { bgcolor: 0x006600, color: 0xffffff },
			options: [{ id: 'value', type: 'number', label: 'Brightness (%)', default: 100, min: 0, max: 100 }],
			callback: (feedback) => self.state.brightness === feedback.options.value,
		},
	})
}
