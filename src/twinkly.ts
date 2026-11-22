/** Helpers for Twinkly Pro OSC addressing. See https://help.twinklypro.com/guides/osc/ */

export const OSC_VERSION = 'v1'
export const DEFAULT_OSC_PORT = 9000

export type TargetMode = 'all' | 'pro' | 'plus' | 'device'
export type ProductType = 'TwPRO' | 'TwPLUS'

export interface TargetConfig {
	targetMode: TargetMode
	productType: ProductType
	mac: string
}

/** Strip separators and lowercase: `30:49:50:A0:30:EC` -> `304950a030ec` */
export function normaliseMac(mac: string): string {
	return mac.replace(/[^0-9a-fA-F]/g, '').toLowerCase()
}

export function isValidMac(mac: string): boolean {
	return /^[0-9a-f]{12}$/.test(normaliseMac(mac))
}

/** Returns the `<device_id>` path segment (may contain a wildcard), or null if the target is incomplete. */
export function deviceId(target: TargetConfig): string | null {
	switch (target.targetMode) {
		case 'all':
			return '*'
		case 'pro':
			return 'TwPRO*'
		case 'plus':
			return 'TwPLUS*'
		case 'device':
			return isValidMac(target.mac) ? `${target.productType}${normaliseMac(target.mac)}` : null
	}
}

export function buildAddress(id: string, path: string): string {
	return `/${OSC_VERSION}/${id}/${path}`
}

export const TARGET_MODE_CHOICES = [
	{ id: 'all', label: 'All Twinkly controllers (*)' },
	{ id: 'pro', label: 'All PRO / MAX controllers (TwPRO*)' },
	{ id: 'plus', label: 'All PLUS / Lightwall controllers (TwPLUS*)' },
	{ id: 'device', label: 'Specific controller (product + MAC)' },
]

export const PRODUCT_CHOICES = [
	{ id: 'TwPRO', label: 'PRO / MAX (TwPRO)' },
	{ id: 'TwPLUS', label: 'PLUS / Lightwall (TwPLUS)' },
]
