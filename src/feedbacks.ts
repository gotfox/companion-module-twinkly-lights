import { rgbFromNumber, sameColor } from './color.js'
import type ModuleInstance from './main.js'
import type { PlaylistInfo } from './rest-parse.js'
import type { AssumedState } from './state.js'

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
	color_is: {
		type: 'boolean'
		options: { color: number }
	}
}

/**
 * Is the playlist at `index` the one playing? Matched by UUID, so two playlists with the same name are
 * told apart; by name only when the UUID isn't known (e.g. right after a command, before state is read).
 */
export function playlistMatches(
	state: Pick<AssumedState, 'mode' | 'playlistName' | 'playlistUuid'>,
	playlists: readonly PlaylistInfo[],
	index: number,
): boolean {
	const wanted = playlists.find((p) => p.index === index)
	if (state.mode !== 'playlist' || !wanted) return false
	if (state.playlistUuid) return wanted.uuid.toLowerCase() === state.playlistUuid.toLowerCase()
	return wanted.name === state.playlistName
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
						{ id: 'color', label: 'Solid colour' },
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
			callback: (feedback) =>
				playlistMatches(self.state, self.content?.playlists ?? [], Number(feedback.options.index)),
		},
		brightness_is: {
			name: 'Brightness matches',
			description: 'True if the brightness equals this value (read from the controller when state reading is on).',
			type: 'boolean',
			defaultStyle: { bgcolor: 0x006600, color: 0xffffff },
			options: [{ id: 'value', type: 'number', label: 'Brightness (%)', default: 100, min: 0, max: 100 }],
			callback: (feedback) => self.state.brightness === feedback.options.value,
		},
		color_is: {
			name: 'Colour matches',
			description:
				'True if the lights are showing this solid colour (read from the controller when state reading is on; otherwise the last colour Companion sent).',
			type: 'boolean',
			defaultStyle: { bgcolor: 0x006600, color: 0xffffff },
			options: [{ id: 'color', type: 'colorpicker', label: 'Colour', default: 0xff0000, returnType: 'number' }],
			callback: (feedback) =>
				self.state.mode === 'color' && sameColor(self.state.color, rgbFromNumber(Number(feedback.options.color))),
		},
	})
}
