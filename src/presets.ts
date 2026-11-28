import type { CompanionPresetDefinitions, CompanionPresetSection } from '@companion-module/base'
import type ModuleInstance from './main.js'
import type { ModuleSchema } from './main.js'
import type { MovieInfo, PlaylistInfo } from './rest-parse.js'
import { COLOR_PRESETS, colorToNumber, contrastText } from './color.js'

/** Capacity of a PRO controller (gestalt max_movies / max_playlists), used when the lists are unknown */
const PRO_MAX_EFFECTS = 32
const PRO_MAX_PLAYLISTS = 4
/** Fade time of the "Fade in / out" brightness presets */
const FADE_PRESET_SECONDS = 5

export interface EffectPresetEntry {
	id: string
	handle: number
	label: string
}

export interface PlaylistPresetEntry {
	id: string
	index: number
	label: string
}

/** One preset per installed effect when the list is known (named), otherwise numbered handles 0-31. */
export function effectPresetEntries(movies: readonly MovieInfo[]): EffectPresetEntry[] {
	if (movies.length > 0)
		return movies.map((m) => ({ id: `movie_${m.handle}`, handle: m.handle, label: m.name || `Effect ${m.handle}` }))
	return Array.from({ length: PRO_MAX_EFFECTS }, (_, i) => ({ id: `movie_${i}`, handle: i, label: `Effect ${i}` }))
}

/** One preset per playlist when the list is known (named), otherwise numbered indexes 0-3. */
export function playlistPresetEntries(playlists: readonly PlaylistInfo[]): PlaylistPresetEntry[] {
	if (playlists.length > 0)
		return playlists.map((p) => ({ id: `playlist_${p.index}`, index: p.index, label: p.name || `Playlist ${p.index}` }))
	return Array.from({ length: PRO_MAX_PLAYLISTS }, (_, i) => ({
		id: `playlist_${i}`,
		index: i,
		label: `Playlist ${i}`,
	}))
}

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

	const named = (self.content?.movies.length ?? 0) > 0
	const effects = effectPresetEntries(self.content?.movies ?? [])
	for (const e of effects) {
		presets[e.id] = {
			type: 'simple',
			name: named ? `${e.handle}: ${e.label}` : e.label,
			// Select by handle: works with both OSC and REST
			style: { text: e.label, size: 'auto', color: 0xffffff, bgcolor: 0x000000 },
			steps: [
				{
					down: [
						{
							actionId: 'movie',
							options: { ...defaultTarget, by: 'handle', handle: e.handle, uuid: '', listUuid: '' },
						},
					],
					up: [],
				},
			],
			feedbacks: [{ feedbackId: 'effect_is', options: { effect: String(e.handle) }, style: active }],
		}
	}

	const playlists = playlistPresetEntries(self.content?.playlists ?? [])
	for (const p of playlists) {
		presets[p.id] = {
			type: 'simple',
			name: `Start playlist: ${p.label}`,
			style: { text: p.label, size: 'auto', color: 0xffffff, bgcolor: 0x000000 },
			steps: [{ down: [{ actionId: 'playlist', options: { ...defaultTarget, index: p.index } }], up: [] }],
			feedbacks: [
				named
					? { feedbackId: 'playlist_is', options: { index: p.index }, style: active }
					: { feedbackId: 'mode_is', options: { mode: 'playlist' }, style: active },
			],
		}
	}

	const builtinIds: string[] = []
	for (let i = 0; i < (self.content?.builtinEffects ?? 0); i++) {
		const id = `builtin_${i}`
		builtinIds.push(id)
		presets[id] = {
			type: 'simple',
			name: `Built-in effect ${i}`,
			style: { text: `Built-in\\n${i}`, size: 'auto', color: 0xffffff, bgcolor: 0x000000 },
			steps: [{ down: [{ actionId: 'builtin_effect', options: { index: i } }], up: [] }],
			feedbacks: [],
		}
	}

	const brightnessIds: string[] = []
	for (const pct of [0, 25, 50, 75, 100]) {
		const id = `bright_${pct}`
		brightnessIds.push(id)
		presets[id] = {
			type: 'simple',
			name: `Brightness ${pct}%`,
			style: { text: `Bright\\n${pct}%`, size: 'auto', color: 0xffffff, bgcolor: 0x000000 },
			steps: [{ down: [{ actionId: 'brightness_set', options: { ...defaultTarget, value: pct, fade: 0 } }], up: [] }],
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
			steps: [{ down: [{ actionId: 'brightness_adjust', options: { ...defaultTarget, delta, fade: 0 } }], up: [] }],
			feedbacks: [],
		}
	}

	for (const [id, label, value] of [
		['bright_fade_out', 'Fade out\\n5 s', 0],
		['bright_fade_in', 'Fade in\\n5 s', 100],
	] as const) {
		brightnessIds.push(id)
		presets[id] = {
			type: 'simple',
			name: label.replace('\\n', ' '),
			style: { text: label, size: 'auto', color: 0xffffff, bgcolor: 0x000000 },
			steps: [
				{
					down: [{ actionId: 'brightness_set', options: { ...defaultTarget, value, fade: FADE_PRESET_SECONDS } }],
					up: [],
				},
			],
			feedbacks: [],
		}
	}

	const colorIds: string[] = []
	for (const p of COLOR_PRESETS) {
		const id = `color_${p.id}`
		const rgb = colorToNumber(p.color)
		colorIds.push(id)
		presets[id] = {
			type: 'simple',
			name: `Color: ${p.label}`,
			style: { text: p.label, size: 'auto', color: contrastText(p.display), bgcolor: colorToNumber(p.display) },
			steps: [{ down: [{ actionId: 'color_set', options: { ...defaultTarget, color: rgb, fade: 0 } }], up: [] }],
			feedbacks: [
				{
					feedbackId: 'color_is',
					options: { color: rgb },
					style: { text: `●\\n${p.label}` },
				},
			],
		}
	}

	const structure: CompanionPresetSection<ModuleSchema>[] = [
		{
			id: 'playback',
			name: 'Playback',
			definitions: [
				{ id: 'power', name: 'Power', type: 'simple', presets: ['off'] },
				{
					id: 'effects',
					name: named ? 'Effects (from the controller)' : 'Effects (handles 0-31; set a controller IP to see names)',
					type: 'simple',
					presets: effects.map((e) => e.id),
				},
				{
					id: 'playlists',
					name: named ? 'Playlists (from the controller)' : 'Playlists (index 0-3)',
					type: 'simple',
					presets: playlists.map((p) => p.id),
				},
				...(builtinIds.length > 0
					? [{ id: 'builtin', name: 'Built-in effects', type: 'simple' as const, presets: builtinIds }]
					: []),
			],
		},
		{
			id: 'brightness',
			name: 'Brightness',
			definitions: [{ id: 'levels', name: 'Brightness', type: 'simple', presets: brightnessIds }],
		},
		{
			id: 'colors',
			name: 'Colors',
			definitions: [{ id: 'solid', name: 'Solid colors (Twinkly Pro)', type: 'simple', presets: colorIds }],
		},
	]

	self.setPresetDefinitions(structure, presets)
}
