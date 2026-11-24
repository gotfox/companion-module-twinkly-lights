import { Regex, type SomeCompanionConfigField } from '@companion-module/base'
import { interfaceBroadcastAddresses } from './discovery.js'
import { DEFAULT_OSC_PORT, PRODUCT_CHOICES, TARGET_MODE_CHOICES, type ProductType, type TargetMode } from './twinkly.js'

export type ControlMethod = 'osc' | 'rest'

export type FamilySetting = 'auto' | 'pro' | 'consumer'

export type ModuleConfig = {
	/** Key of the device picked from the discovery dropdown ('' = address entered manually) */
	discovered: string
	method: ControlMethod
	/** Which Twinkly API the device speaks; 'auto' asks the device */
	family: FamilySetting
	/** Address in use: hostRest or hostOsc depending on the method (derived, not a form field) */
	host: string
	/** Address chosen for OSC (device IP or broadcast) */
	hostOsc: string
	/** Address chosen for REST (device IP only) */
	hostRest: string
	port: number
	targetMode: TargetMode
	productType: ProductType
	mac: string
	verbose: boolean
	/** Seconds between REST state reads; 0 turns polling off */
	pollInterval: number
}

export const DEFAULT_POLL_INTERVAL_S = 2
export const MAX_POLL_INTERVAL_S = 60

/**
 * REST needs one device's IP; broadcast addresses only work for OSC. Broadcast is decided from this
 * machine's own network masks, so on a /23 or wider network an address such as 192.168.5.255 is still a
 * valid device address.
 */
export function isUnicastHost(
	host: string | undefined,
	localBroadcasts: readonly string[] = interfaceBroadcastAddresses(),
): boolean {
	if (!host || !/^\d{1,3}(\.\d{1,3}){3}$/.test(host)) return false
	if (!host.split('.').every((o) => Number(o) <= 255)) return false
	return host !== '0.0.0.0' && host !== '255.255.255.255' && !localBroadcasts.includes(host)
}

export const MIN_POLL_INTERVAL_S = 1

/** 0 = off; otherwise kept within 1-60 s so a typo can't flood the controller. */
export function clampPollInterval(seconds: number): number {
	if (!Number.isFinite(seconds) || seconds <= 0) return 0
	return Math.min(MAX_POLL_INTERVAL_S, Math.max(MIN_POLL_INTERVAL_S, seconds))
}

const LEGACY_DEFAULT_HOST = '255.255.255.255'

/**
 * Configs from before the split address fields only have `host`. Carry it into whichever field it
 * suits (a broadcast address never goes into the REST field), then pick the one the method uses.
 */
function resolveHosts(config: Partial<ModuleConfig>): Pick<ModuleConfig, 'host' | 'hostOsc' | 'hostRest'> {
	const legacy = typeof config.host === 'string' && config.host ? config.host : LEGACY_DEFAULT_HOST
	const hostOsc = typeof config.hostOsc === 'string' && config.hostOsc ? config.hostOsc : legacy
	const hostRest =
		typeof config.hostRest === 'string' && config.hostRest ? config.hostRest : isUnicastHost(legacy) ? legacy : ''
	return { host: config.method === 'rest' ? hostRest : hostOsc, hostOsc, hostRest }
}

/** Companion keeps old saved configs, so fill in fields added after a connection was created. */
export function withDefaults(config: Partial<ModuleConfig>): ModuleConfig {
	return {
		discovered: typeof config.discovered === 'string' ? config.discovered : '',
		method: config.method === 'rest' ? 'rest' : 'osc',
		family: config.family === 'pro' || config.family === 'consumer' ? config.family : 'auto',
		...resolveHosts(config),
		port: config.port ?? DEFAULT_OSC_PORT,
		targetMode: config.targetMode ?? 'all',
		productType: config.productType ?? 'TwPRO',
		mac: config.mac ?? '',
		verbose: config.verbose ?? false,
		// New connections get the field default (2 s). Connections saved before state reading existed have no
		// value, so keep their behaviour unchanged (off) instead of silently starting HTTP polling.
		pollInterval: typeof config.pollInterval === 'number' ? clampPollInterval(config.pollInterval) : 0,
	}
}

/** @param discoveredChoices options for the "Discovered device" dropdown, from the module's latest scan */
export function GetConfigFields(
	discoveredChoices: { id: string; label: string }[],
	hostOptions: { osc: { id: string; label: string }[]; rest: { id: string; label: string }[] },
): SomeCompanionConfigField[] {
	return [
		{
			type: 'dropdown',
			id: 'discovered',
			label: 'Discovered device',
			tooltip:
				'Twinkly devices found on the network (scanned when the connection starts and every 5 minutes, or with the ' +
				'"Scan network" action). Saving a choice fills in the IP, device type and target below, and the connection ' +
				'follows the device if its IP changes. For a group, choosing any member uses the group master.',
			width: 12,
			choices: discoveredChoices,
			default: '',
		},
		{
			type: 'static-text',
			id: 'info',
			label: 'Control methods',
			width: 12,
			value:
				'OSC (documented by Twinkly): works with broadcast and wildcard targets, but the controller sends no replies, ' +
				'and brightness had no effect in testing on PRO firmware 4.1.0. Enable it in the Twinkly Pro app: Devices > Object > ' +
				'Object Information > Device Information > Advanced Configuration > OTHER > OSC. ' +
				'REST (the local Twinkly API described at xled-docs.readthedocs.io, verified on PRO firmware 4.1.0): needs the IP of one controller (for a group, the ' +
				'master), and supports brightness. Both methods can read the real state from the controller when a controller IP is set. ' +
				'Twinkly lights: REST only (verified on firmware 2.11.0).',
		},
		{
			type: 'dropdown',
			id: 'method',
			label: 'Control method',
			width: 12,
			choices: [
				{ id: 'osc', label: 'OSC (UDP 9000)' },
				{ id: 'rest', label: 'REST (HTTP, needs a controller IP)' },
			],
			default: 'osc',
		},
		{
			type: 'dropdown',
			id: 'family',
			label: 'Device type',
			tooltip:
				'Auto asks the device whether it is Twinkly Pro or Twinkly (needs a controller IP). Twinkly lights support REST only.',
			width: 12,
			choices: [
				{ id: 'auto', label: 'Auto-detect' },
				{ id: 'pro', label: 'Twinkly Pro (PRO, MAX, PLUS, Lightwall)' },
				{ id: 'consumer', label: 'Twinkly (REST only)' },
			],
			default: 'auto',
		},
		{
			type: 'dropdown',
			id: 'hostOsc',
			label: 'Controller IP or broadcast address',
			tooltip:
				'A Twinkly Pro IP (for a group, its master), or a broadcast address to reach every Twinkly Pro at once. ' +
				'You can also type an address.',
			width: 8,
			choices: hostOptions.osc,
			default: '255.255.255.255',
			allowCustom: true,
			regex: Regex.IP,
			isVisibleExpression: `$(options:method) == "osc" && $(options:discovered) == ""`,
		},
		{
			type: 'dropdown',
			id: 'hostRest',
			label: 'Device IP',
			tooltip: 'The device to control (for a group, its master controller). You can also type an address.',
			width: 8,
			choices: hostOptions.rest,
			default: '',
			allowCustom: true,
			regex: Regex.IP,
			isVisibleExpression: `$(options:method) == "rest" && $(options:discovered) == ""`,
		},
		{
			type: 'number',
			id: 'port',
			label: 'OSC port',
			width: 4,
			isVisibleExpression: `$(options:method) == "osc"`,
			min: 1,
			max: 65535,
			default: DEFAULT_OSC_PORT,
		},
		{
			type: 'dropdown',
			id: 'targetMode',
			label: 'Default target',
			width: 6,
			isVisibleExpression: `$(options:method) == "osc"`,
			choices: TARGET_MODE_CHOICES,
			default: 'all',
		},
		{
			type: 'dropdown',
			id: 'productType',
			label: 'Product',
			width: 3,
			choices: PRODUCT_CHOICES,
			default: 'TwPRO',
			isVisibleExpression: `$(options:method) == "osc" && $(options:targetMode) == "device"`,
		},
		{
			type: 'textinput',
			id: 'mac',
			label: 'Controller MAC address',
			tooltip: 'From the Twinkly Pro app: Device Information. Any separator style is fine.',
			width: 3,
			default: '',
			isVisibleExpression: `$(options:method) == "osc" && $(options:targetMode) == "device"`,
		},
		{
			type: 'checkbox',
			id: 'verbose',
			label: 'Log every command sent',
			width: 12,
			default: false,
		},
		{
			type: 'number',
			id: 'pollInterval',
			label: 'Read state from controller every (seconds, 0 = off)',
			tooltip:
				'Uses the REST API to read the real mode, effect, playlist and brightness. Needs a controller IP (not a broadcast ' +
				'address). For a group, use the master: other members do not report the group state.',
			width: 12,
			min: 0,
			max: MAX_POLL_INTERVAL_S,
			default: DEFAULT_POLL_INTERVAL_S,
		},
	]
}
