import type { SomeCompanionActionInputField } from '@companion-module/base'
import type ModuleInstance from './main.js'
import { oscInt, oscString } from './osc.js'
import { normaliseMac, PRODUCT_CHOICES, TARGET_MODE_CHOICES } from './twinkly.js'
import { fetchGestalt, scanForDevices } from './discovery.js'

type TargetOptions = { target: string; productType: string; mac: string }

export type ActionsSchema = {
	lights_off: { options: TargetOptions }
	movie: { options: TargetOptions & { by: string; handle: number; uuid: string } }
	playlist: { options: TargetOptions & { index: number } }
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

export function UpdateActions(self: ModuleInstance): void {
	const id = (o: TargetOptions): string | null => self.resolveDeviceId(o)

	self.setActionDefinitions({
		lights_off: {
			name: 'Lights off',
			description: 'Set application mode to off.',
			options: [...targetFields],
			callback: async ({ options }) => {
				if (self.sendCommand(id(options), 'application/mode', [oscString('off')])) {
					self.setState({ mode: 'off' })
				}
			},
		},

		movie: {
			name: 'Play effect (movie mode)',
			description: 'Switch to movie mode and play an installed effect, selected by handle number or UUID.',
			options: [
				...targetFields,
				{
					id: 'by',
					type: 'dropdown',
					label: 'Select effect by',
					default: 'handle',
					choices: [
						{ id: 'handle', label: 'Handle (number)' },
						{ id: 'uuid', label: 'UUID' },
					],
					disableAutoExpression: true,
				},
				{
					id: 'handle',
					type: 'number',
					label: 'Effect handle',
					tooltip: 'Shown in the Twinkly Pro app Controls panel, starting at 0.',
					default: 0,
					min: 0,
					max: 255,
					isVisibleExpression: `$(options:by) == "handle"`,
				},
				{
					id: 'uuid',
					type: 'textinput',
					label: 'Effect UUID',
					default: '',
					useVariables: true,
					isVisibleExpression: `$(options:by) == "uuid"`,
				},
			],
			callback: async ({ options }) => {
				const byUuid = options.by === 'uuid'
				const uuid = String(options.uuid).trim()
				if (byUuid && !uuid) {
					self.log('warn', 'Play effect: no UUID given')
					return
				}
				const arg = byUuid ? oscString(uuid) : oscInt(clamp(options.handle, 0, 255))
				if (self.sendCommand(id(options), 'application/mode', [oscString('movie'), arg])) {
					self.setState({ mode: 'movie', effect: byUuid ? uuid : String(arg.value) })
				}
			},
		},

		playlist: {
			name: 'Start playlist',
			description:
				'Set application mode to playlist. The OSC guide example sends an integer after "playlist" (0) but does not document it; leave at 0 unless you know better.',
			options: [
				...targetFields,
				{ id: 'index', type: 'number', label: 'Playlist index (undocumented)', default: 0, min: 0, max: 255 },
			],
			callback: async ({ options }) => {
				if (
					self.sendCommand(id(options), 'application/mode', [
						oscString('playlist'),
						oscInt(clamp(options.index, 0, 255)),
					])
				) {
					self.setState({ mode: 'playlist', effect: '' })
				}
			},
		},

		brightness_set: {
			name: 'Set brightness',
			description: 'Absolute brightness 0-100 % (also enables the brightness filter).',
			options: [
				...targetFields,
				{ id: 'value', type: 'number', label: 'Brightness (%)', default: 100, min: 0, max: 100, clampValues: true },
			],
			callback: async ({ options }) => {
				const value = clamp(options.value, 0, 100)
				if (self.sendCommand(id(options), 'led/brightness', [oscString('enabled'), oscString('A'), oscInt(value)])) {
					self.setState({ brightness: value, brightnessFilter: 'enabled' })
				}
			},
		},

		brightness_adjust: {
			name: 'Adjust brightness (relative)',
			description: 'Relative brightness change, -100 to 100. Companion tracks the result locally as an estimate.',
			options: [
				...targetFields,
				{ id: 'delta', type: 'number', label: 'Change (%)', default: 10, min: -100, max: 100, clampValues: true },
			],
			callback: async ({ options }) => {
				const delta = clamp(options.delta, -100, 100)
				if (self.sendCommand(id(options), 'led/brightness', [oscString('enabled'), oscString('R'), oscInt(delta)])) {
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
				'Enable or disable the brightness filter. Disabling sends "disabled A 100"; the guide does not say which value to send in that case.',
			options: [...targetFields, { id: 'enabled', type: 'checkbox', label: 'Enabled', default: true }],
			callback: async ({ options }) => {
				const mode = options.enabled ? 'enabled' : 'disabled'
				const value = options.enabled ? (self.state.brightness ?? 100) : 100
				if (self.sendCommand(id(options), 'led/brightness', [oscString(mode), oscString('A'), oscInt(value)])) {
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
				self.sendCommand(id(options), String(options.path).replace(/^\/+/, ''), args)
			},
		},

		scan: {
			name: 'Scan network for controllers (experimental)',
			description:
				'UNVERIFIED. Twinkly Pro documents no discovery. Broadcasts a consumer-Twinkly style probe on UDP 5555 to every network interface, then tries an unauthenticated HTTP device-info lookup on each reply. Results go to the module log. It may find nothing.',
			options: [],
			callback: async () => {
				self.log('info', 'Scanning for controllers on UDP 5555 (experimental)...')
				try {
					const found = await scanForDevices(self.config.host)
					if (found.length === 0) {
						self.log('info', 'Scan finished: no replies. Pro controllers may not support this probe.')
					}
					await Promise.all(
						found.map(async (d) => {
							d.gestalt = await fetchGestalt(d.address)
						}),
					)
					for (const d of found) {
						self.log(
							'info',
							`Reply from ${d.address}: name=${d.name ?? '(not in expected OK format)'} text="${d.text}" (hex ${d.hex})`,
						)
						const g = d.gestalt
						if (g?.mac) {
							const mac = normaliseMac(g.mac)
							self.log(
								'info',
								`  ${d.address} device info: name=${g.deviceName ?? '?'} product=${g.productCode ?? '?'} mac=${g.mac}. ` +
									`Candidate device IDs: TwPRO${mac} or TwPLUS${mac} (which prefix applies depends on the model)`,
							)
						} else {
							self.log('info', `  ${d.address}: no HTTP device info (/xled/v1/gestalt) available`)
						}
					}
					self.setVariableValues({
						discovered_devices: found
							.map((d) => (d.gestalt?.mac ? `${d.address} (${d.gestalt.mac})` : d.address))
							.join(', '),
					})
				} catch (e) {
					self.log('error', `Scan failed: ${String(e)}`)
				}
			},
		},
	})
}
