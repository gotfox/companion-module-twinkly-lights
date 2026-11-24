import type { CompanionStaticUpgradeScript } from '@companion-module/base'
import type { ModuleConfig } from './config.js'

type Script = CompanionStaticUpgradeScript<ModuleConfig>

const NO_CHANGE = { updatedConfig: null, updatedActions: [], updatedFeedbacks: [] }

const isIpv4Unicast = (v: string): boolean => /^\d{1,3}(\.\d{1,3}){3}$/.test(v) && !/\.255$/.test(v)
const nonEmpty = (v: unknown): v is string => typeof v === 'string' && v !== ''

/**
 * v0.2: the single address field was split into hostOsc (IP or broadcast) and hostRest (device IP
 * only). Copy the old address into both; a broadcast address is not carried into the REST field.
 */
const splitHostField: Script = (_context, props) => {
	const config = props.config
	if (!config || !nonEmpty(config.host) || (nonEmpty(config.hostOsc) && nonEmpty(config.hostRest))) return NO_CHANGE
	const host = config.host
	return {
		...NO_CHANGE,
		updatedConfig: {
			...config,
			hostOsc: nonEmpty(config.hostOsc) ? config.hostOsc : host,
			hostRest: nonEmpty(config.hostRest) ? config.hostRest : isIpv4Unicast(host) ? host : '',
		},
	}
}

/** Remember that once a script has been added it cannot be removed! */
export const UpgradeScripts: Script[] = [splitHostField]
