import type { SomeCompanionActionInputField } from '@companion-module/base'
import type ModuleInstance from './main.js'
import { oscInt, oscString } from './osc.js'
import { PRODUCT_CHOICES, TARGET_MODE_CHOICES } from './twinkly.js'
import { runScan } from './scan.js'
import { rgbFromNumber } from './color.js'
import { MAX_FADE_SECONDS } from './fade.js'
import {
	adjustBrightness,
	adjustFades,
	brightnessFades,
	cancelBrightnessFades,
	cancelColorFades,
	colorFades,
	isModePath,
	setBrightness,
	setColor,
	stateApplies,
} from './fade-actions.js'

type TargetOptions = { target: string; productType: string; mac: string }

export type ActionsSchema = {
	lights_off: { options: TargetOptions }
	movie: { options: TargetOptions & { by: string; handle: number; uuid: string; listUuid: string } }
	playlist: { options: TargetOptions & { index: number } }
	builtin_effect: { options: { index: number } }
	brightness_set: { options: TargetOptions & { value: number; fade: number } }
	brightness_adjust: { options: TargetOptions & { delta: number; fade: number } }
	brightness_filter: { options: TargetOptions & { enabled: boolean } }
	color_set: { options: TargetOptions & { color: number; fade: number } }
	raw_osc: { options: TargetOptions & { path: string; types: string; values: string } }
	scan: { options: Record<string, never> }
}

/** Per-action target override, shown on every action. */
const targetFields: SomeCompanionActionInputField<keyof TargetOptions>[] = [
	{
		id: 'target',
		type: 'dropdown',
		label: 'Target controller',
		default: 'default',
		choices: [{ id: 'default', label: 'Module default (see config)' }, ...TARGET_MODE_CHOICES],
		disableAutoExpression: true,
	},
	{
		id: 'productType',
		type: 'dropdown',
		label: 'Product',
		default: 'TwPRO',
		choices: PRODUCT_CHOICES,
		isVisibleExpression: `$(options:target) == "device"`,
	},
	{
		id: 'mac',
		type: 'textinput',
		label: 'Controller MAC address',
		default: '',
		isVisibleExpression: `$(options:target) == "device"`,
	},
]

const clamp = (n: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, Math.round(n)))

const NO_LIST_CHOICE = { id: '', label: '(set a controller IP to load the effect list)' }

const fadeField: SomeCompanionActionInputField<'fade'> = {
	id: 'fade',
	type: 'number',
	label: 'Fade time (seconds, 0 = instant)',
	tooltip:
		'Companion fades by sending small steps; the controller has no fade command. Needs a known starting level (state reading, or a level set earlier). Another command on the same setting cancels a running fade.',
	default: 0,
	min: 0,
	max: MAX_FADE_SECONDS,
	step: 0.5,
	clampValues: true,
}

/**
 * A fade carries on in the background so the button's other actions aren't held up. Anything sent at
 * once, including a change that fell back to instant, is awaited so later actions can't overtake it.
 */
async function settle(self: ModuleInstance, fades: boolean, change: Promise<boolean>): Promise<void> {
	if (fades) {
		change.catch((e: unknown) => self.log('error', `Fade failed: ${e instanceof Error ? e.message : String(e)}`))
		return
	}
	await change
}

export function UpdateActions(self: ModuleInstance): void {
	const movies = self.content?.movies ?? []
	const movieChoices =
		movies.length > 0 ? movies.map((m) => ({ id: m.uuid, label: `${m.handle}: ${m.name}` })) : [NO_LIST_CHOICE]

	self.setActionDefinitions({
		lights_off: {
			name: 'Lights off',
			description: 'Set application mode to off.',
			options: [...targetFields],
			callback: async ({ options }) => {
				cancelColorFades(self, options) // a running color fade would switch the lights back on at its next step
				if ((await self.controller.off(options)) && stateApplies(self, options))
					self.setState({ mode: 'off', effect: '', effectName: '', playlistName: '', playlistUuid: '' })
			},
		},

		movie: {
			name: 'Play effect (movie mode)',
			description:
				'Switch to movie mode and play an installed effect, chosen from the list read from the controller, or by handle number or UUID.',
			options: [
				...targetFields,
				{
					id: 'by',
					type: 'dropdown',
					label: 'Select effect by',
					default: 'handle',
					choices: [
						{ id: 'list', label: 'Name (list from the controller)' },
						{ id: 'handle', label: 'Handle (number)' },
						{ id: 'uuid', label: 'UUID' },
					],
					disableAutoExpression: true,
				},
				{
					id: 'listUuid',
					type: 'dropdown',
					label: 'Effect',
					tooltip: 'Read from the controller when a controller IP is set. Refreshed every minute or so.',
					default: movieChoices[0].id,
					choices: movieChoices,
					allowCustom: true,
					isVisibleExpression: `$(options:by) == "list"`,
				},
				{
					id: 'handle',
					type: 'number',
					label: 'Effect handle',
					tooltip:
						'In the Twinkly Pro app, press and hold an effect on the device\'s Controls tab: the "ID" shown is the handle (starts at 0, in list order). A handle that does not exist is ignored by the controller.',
					default: 0,
					min: 0,
					max: 255,
					isVisibleExpression: `$(options:by) == "handle"`,
				},
				{
					id: 'uuid',
					type: 'textinput',
					label: 'Effect UUID',
					tooltip:
						"In the Twinkly Pro app, press and hold an effect on the device's Controls tab to see its UUID. Upper or lower case both work.",
					default: '',
					useVariables: true,
					isVisibleExpression: `$(options:by) == "uuid"`,
				},
			],
			callback: async ({ options }) => {
				cancelColorFades(self, options)
				// Actions saved before "by" existed, or with an unexpected value, play by handle
				const by = options.by === 'list' || options.by === 'uuid' ? options.by : 'handle'
				const raw = by === 'list' ? options.listUuid : options.uuid
				const uuid = typeof raw === 'string' ? raw.trim() : ''
				if (by !== 'handle' && !uuid) {
					self.log('warn', 'Play effect: no effect selected')
					return
				}
				const handle = clamp(Number(options.handle) || 0, 0, 255)
				const effect = by === 'handle' ? { handle } : { uuid }
				if (!(await self.controller.movie(options, effect)) || !stateApplies(self, options)) return
				const current = self.content?.movies ?? []
				const known = current.find((m) =>
					by === 'handle' ? m.handle === handle : m.uuid.toLowerCase() === uuid.toLowerCase(),
				)
				self.setState({
					mode: 'movie',
					effect: known ? String(known.handle) : by === 'handle' ? String(handle) : uuid,
					effectName: known?.name ?? '',
					playlistName: '',
					playlistUuid: '',
				})
			},
		},

		playlist: {
			name: 'Start playlist',
			description:
				'Set application mode to playlist and start the playlist at this index (0 is the first playlist). An index that does not exist is ignored by the controller.',
			options: [
				...targetFields,
				{ id: 'index', type: 'number', label: 'Playlist index (0 = first)', default: 0, min: 0, max: 255 },
			],
			callback: async ({ options }) => {
				cancelColorFades(self, options)
				const index = clamp(options.index, 0, 255)
				if ((await self.controller.playlist(options, index)) && stateApplies(self, options)) {
					const known = self.content?.playlists.find((p) => p.index === index)
					self.setState({
						mode: 'playlist',
						effect: '',
						effectName: '',
						playlistName: known?.name ?? '',
						playlistUuid: known?.uuid ?? '',
					})
				}
			},
		},

		builtin_effect: {
			name: 'Play built-in effect (Twinkly)',
			description:
				'Twinkly lights only (not Twinkly Pro), with the REST control method: play one of the effects built into the light (0 = first).',
			options: [
				{
					id: 'index',
					type: 'number',
					label: 'Built-in effect (0 = first)',
					tooltip: 'How many there are depends on the light; the connection log lists the count when it connects.',
					default: 0,
					min: 0,
					max: 255,
				},
			],
			callback: async ({ options }) => {
				cancelColorFades(self, {}) // the built-in effect action always uses the default target
				const index = clamp(Number(options.index) || 0, 0, 255)
				if (await self.controller.builtinEffect({}, index)) {
					self.setState({
						mode: 'effect',
						effect: '',
						effectName: `Built-in effect ${index}`,
						playlistName: '',
						playlistUuid: '',
					})
				}
			},
		},

		brightness_set: {
			name: 'Set brightness',
			description: 'Absolute brightness 0-100 % (also enables the brightness filter), optionally faded.',
			options: [
				...targetFields,
				{ id: 'value', type: 'number', label: 'Brightness (%)', default: 100, min: 0, max: 100, clampValues: true },
				fadeField,
			],
			callback: async ({ options }) => {
				const value = clamp(options.value, 0, 100)
				const fades = brightnessFades(self, options, options.fade, value)
				await settle(self, fades, setBrightness(self, options, value, options.fade))
			},
		},

		brightness_adjust: {
			name: 'Adjust brightness (relative)',
			description:
				'Relative brightness change, -100 to 100. Without state reading, Companion tracks the result locally as an estimate. With a fade it fades to the new level, which needs a known starting level.',
			options: [
				...targetFields,
				{ id: 'delta', type: 'number', label: 'Change (%)', default: 10, min: -100, max: 100, clampValues: true },
				fadeField,
			],
			callback: async ({ options }) => {
				const delta = clamp(options.delta, -100, 100)
				const fades = adjustFades(self, options, options.fade, delta)
				await settle(self, fades, adjustBrightness(self, options, delta, options.fade))
			},
		},

		brightness_filter: {
			name: 'Brightness filter on/off',
			description:
				'Enable or disable the brightness filter. Disabling keeps the stored level and sends only "disabled".',
			options: [...targetFields, { id: 'enabled', type: 'checkbox', label: 'Enabled', default: true }],
			callback: async ({ options }) => {
				cancelBrightnessFades(self, options)
				const mode = options.enabled ? 'enabled' : 'disabled'
				const value = options.enabled ? (self.state.brightness ?? 100) : 100
				if ((await self.controller.brightness(options, { mode, type: 'A', value })) && stateApplies(self, options)) {
					self.setState({ brightnessFilter: mode })
				}
			},
		},

		color_set: {
			name: 'Set color',
			description:
				'Show a solid color. Verified on Twinkly Pro (firmware 4.1.0) and Twinkly Squares (firmware 2.11.0, REST only). Optionally fade from the color already showing; a fade needs the lights to be in a known solid color, otherwise the change is instant.',
			options: [
				...targetFields,
				{ id: 'color', type: 'colorpicker', label: 'Color', default: 0xff0000, returnType: 'number' },
				fadeField,
			],
			callback: async ({ options }) => {
				const color = rgbFromNumber(Number(options.color))
				const fades = colorFades(self, options, options.fade, color)
				await settle(self, fades, setColor(self, options, color, options.fade))
			},
		},

		raw_osc: {
			name: 'Send raw OSC',
			description:
				'Send any message to /v1/<device_id>/<path>. Type tags: s = string, i = int32, f = float32. Values are space separated.',
			options: [
				...targetFields,
				{
					id: 'path',
					type: 'textinput',
					label: 'Path after device ID',
					default: 'application/mode',
					useVariables: true,
				},
				{ id: 'types', type: 'textinput', label: 'Type tags (e.g. si)', default: 's', regex: '/^[sif]*$/' },
				{ id: 'values', type: 'textinput', label: 'Values (e.g. movie 0)', default: 'off', useVariables: true },
			],
			callback: async ({ options }) => {
				const types = String(options.types).trim()
				const values = String(options.values).trim().split(/\s+/).filter(Boolean)
				if (types.length !== values.length) {
					self.log('warn', `Raw OSC: ${types.length} type tags but ${values.length} values`)
					return
				}
				const args = [...types].map((t, i) => {
					const v = values[i]
					if (t === 's') return oscString(v)
					const n = Number(v)
					if (!Number.isFinite(n)) throw new Error(`"${v}" is not a number`)
					return t === 'i' ? oscInt(n) : { type: 'f' as const, value: n }
				})
				const path = String(options.path).replace(/^\/+/, '')
				// A raw mode change would otherwise be undone by the next step of a running color fade
				if (isModePath(path)) cancelColorFades(self, options)
				self.sendCommand(self.resolveDeviceId(options), path, args)
			},
		},

		scan: {
			name: 'Rescan network for controllers',
			description:
				'Scans the network again to refresh the "Discovered device" list in the connection settings, and logs each controller that replies: name, model, group role and OSC status, and a suggested OSC device ID for Pro controllers. Twinkly Pro does not document the scan; it was verified on PRO controllers only. Twinkly lights also reply; they have no OSC.',
			options: [],
			callback: async () => runScan(self),
		},
	})
}
