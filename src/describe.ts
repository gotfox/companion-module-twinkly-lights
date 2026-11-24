import type { DiscoveredDevice } from './discovery.js'
import { TwinklyRestClient } from './rest.js'
import type { Gestalt } from './rest-parse.js'

/** Gestalt needs no login, so scans can ask each controller for its name, model and role. */
const GESTALT_TIMEOUT_MS = 1500

export interface DescribedDevice {
	device: DiscoveredDevice
	gestalt: Gestalt | null
	error: string
}

/** Fetch gestalt for every Twinkly device in parallel; failures are reported per device, never thrown. */
export async function describeControllers(devices: readonly DiscoveredDevice[]): Promise<DescribedDevice[]> {
	return Promise.all(
		devices.map(async (device): Promise<DescribedDevice> => {
			if (device.family === 'unknown') return { device, gestalt: null, error: '' }
			try {
				const client = new TwinklyRestClient(device.address, { family: device.family, timeoutMs: GESTALT_TIMEOUT_MS })
				const gestalt = await client.gestalt()
				return { device, gestalt, error: '' }
			} catch (e) {
				return { device, gestalt: null, error: e instanceof Error ? e.message : String(e) }
			}
		}),
	)
}

const yesNo = (v: boolean | null): string => (v === null ? '?' : v ? 'on' : 'off')

/** One log line per controller, e.g. `"Yard Christmas Tree Back" TWPRO1500ETHP, group master, OSC on, Art-Net off` */
export function describeLine(g: Gestalt): string {
	const role = g.groupRole === 'none' ? 'not in a group' : `group ${g.groupRole}`
	return `"${g.deviceName}" ${g.productCode || '?'}, ${role}, OSC ${yesNo(g.oscEnabled)}, Art-Net ${yesNo(g.artnetEnabled)}`
}
