import { Regex, type SomeCompanionConfigField } from '@companion-module/base'
import { DEFAULT_OSC_PORT, PRODUCT_CHOICES, TARGET_MODE_CHOICES, type ProductType, type TargetMode } from './twinkly.js'

export type ModuleConfig = {
	host: string
	port: number
	targetMode: TargetMode
	productType: ProductType
	mac: string
	verbose: boolean
}

export function GetConfigFields(): SomeCompanionConfigField[] {
	return [
		{
			type: 'static-text',
			id: 'info',
			label: 'Enable OSC first',
			width: 12,
			value:
				'OSC is off by default. In the Twinkly Pro app: Devices > Object > Object Information > Device Information > ' +
				'Advanced Configuration > OTHER > enable OSC. Controllers must be on the same LAN as Companion. ' +
				'Controllers send no replies, so button state in Companion is assumed from the last command sent.',
		},
		{
			type: 'textinput',
			id: 'host',
			label: 'Controller IP or broadcast address',
			tooltip:
				'A controller IP, or a subnet broadcast address (e.g. 192.168.0.255) to reach several controllers without knowing their IPs.',
			width: 8,
			default: '255.255.255.255',
			regex: Regex.IP,
		},
		{
			type: 'number',
			id: 'port',
			label: 'OSC port',
			width: 4,
			min: 1,
			max: 65535,
			default: DEFAULT_OSC_PORT,
		},
		{
			type: 'dropdown',
			id: 'targetMode',
			label: 'Default target',
			width: 6,
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
			isVisibleExpression: `$(options:targetMode) == "device"`,
		},
		{
			type: 'textinput',
			id: 'mac',
			label: 'Controller MAC address',
			tooltip: 'From the Twinkly Pro app: Device Information. Any separator style is fine.',
			width: 3,
			default: '',
			isVisibleExpression: `$(options:targetMode) == "device"`,
		},
		{
			type: 'checkbox',
			id: 'verbose',
			label: 'Log every OSC message sent',
			width: 12,
			default: false,
		},
	]
}
