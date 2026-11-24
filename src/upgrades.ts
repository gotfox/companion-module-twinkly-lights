import type { CompanionStaticUpgradeScript } from '@companion-module/base'
import { isUnicastHost, type ModuleConfig } from './config.js'

type Script = CompanionStaticUpgradeScript<ModuleConfig>

const NO_CHANGE = { updatedConfig: null, updatedActions: [], updatedFeedbacks: [] }

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
			hostRest: nonEmpty(config.hostRest) ? config.hostRest : isUnicastHost(host) ? host : '',
		},
	}
}

/** Remember that once a script has been added it cannot be removed! */
export const UpgradeScripts: Script[] = [splitHostField]
