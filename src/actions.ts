import type { SomeCompanionActionInputField } from '@companion-module/base'
import type ModuleInstance from './main.js'
import { oscInt, oscString } from './osc.js'
import { PRODUCT_CHOICES, TARGET_MODE_CHOICES } from './twinkly.js'
import { runScan } from './scan.js'

type TargetOptions = { target: string; productType: string; mac: string }

export type ActionsSchema = {
	lights_off: { options: TargetOptions }
	movie: { options: TargetOptions & { by: string; handle: number; uuid: string; listUuid: string } }
	playlist: { options: TargetOptions & { index: number } }
	builtin_effect: { options: { index: number } }
	brightness_set: { options: TargetOptions & { value: number } }
	brightness_adjust: { options: TargetOptions & { delta: number } }
	brightness_filter: { options: TargetOptions & { enabled: boolean } }
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

/** Appended to brightness action descriptions: OSC brightness is ignored on the firmware we tested, REST works. */
const BRIGHTNESS_NOTE =
	' With OSC, the controller ignored brightness in testing on PRO firmware 4.1.0; use the REST control method for brightness.'

const NO_LIST_CHOICE = { id: '', label: '(set a controller IP to load the effect list)' }

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
				if (await self.controller.off(options))
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
				if (!(await self.controller.movie(options, effect))) return
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
				const index = clamp(options.index, 0, 255)
				if (await self.controller.playlist(options, index)) {
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
			description: 'Absolute brightness 0-100 % (also enables the brightness filter).' + BRIGHTNESS_NOTE,
			options: [
				...targetFields,
				{ id: 'value', type: 'number', label: 'Brightness (%)', default: 100, min: 0, max: 100, clampValues: true },
			],
			callback: async ({ options }) => {
				const value = clamp(options.value, 0, 100)
				if (await self.controller.brightness(options, { mode: 'enabled', type: 'A', value })) {
					self.setState({ brightness: value, brightnessFilter: 'enabled' })
				}
			},
		},

		brightness_adjust: {
			name: 'Adjust brightness (relative)',
			description:
				'Relative brightness change, -100 to 100. Without state reading, Companion tracks the result locally as an estimate.' +
				BRIGHTNESS_NOTE,
			options: [
				...targetFields,
				{ id: 'delta', type: 'number', label: 'Change (%)', default: 10, min: -100, max: 100, clampValues: true },
			],
			callback: async ({ options }) => {
				const delta = clamp(options.delta, -100, 100)
				if (await self.controller.brightness(options, { mode: 'enabled', type: 'R', value: delta })) {
					const base = self.state.brightness
					self.setState({
						brightness: base === null ? null : clamp(base + delta, 0, 100),
						brightnessFilter: 'enabled',
					})
				}
			},
		},

		brightness_filter: {
			name: 'Brightness filter on/off',
			description:
				'Enable or disable the brightness filter. Disabling sends "disabled A 100"; the guide does not say which value to send in that case.' +
				BRIGHTNESS_NOTE,
			options: [...targetFields, { id: 'enabled', type: 'checkbox', label: 'Enabled', default: true }],
			callback: async ({ options }) => {
				const mode = options.enabled ? 'enabled' : 'disabled'
				const value = options.enabled ? (self.state.brightness ?? 100) : 100
				if (await self.controller.brightness(options, { mode, type: 'A', value })) {
					self.setState({ brightnessFilter: mode })
				}
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
				self.sendCommand(self.resolveDeviceId(options), String(options.path).replace(/^\/+/, ''), args)
			},
		},

		scan: {
			name: 'Scan network for controllers',
			description:
				'Broadcasts a discovery probe on UDP 5555 to every network interface and logs the controllers that reply: name, model, group role and OSC status, and a suggested OSC device ID for Pro controllers. Twinkly Pro does not document this; it was verified on PRO controllers only. Twinkly lights also reply; they have no OSC.',
			options: [],
			callback: async () => runScan(self),
		},
	})
}
