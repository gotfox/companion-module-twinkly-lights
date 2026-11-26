import type ModuleInstance from './main.js'
import { PRO_OUI, scanForDevices, type DiscoveredDevice } from './discovery.js'
import { describeControllers, describeLine, type DescribedDevice } from './describe.js'

/** Discover devices and ask each for its details. Never throws: failures come back as `error`. */
export async function discover(
	extraBroadcast: string | undefined,
): Promise<{ described: DescribedDevice[]; failedTargets: { target: string; error: string }[]; error: string }> {
	try {
		const { devices, failedTargets } = await scanForDevices(extraBroadcast)
		return { described: await describeControllers(devices), failedTargets, error: '' }
	} catch (e) {
		return { described: [], failedTargets: [], error: e instanceof Error ? e.message : String(e) }
	}
}

const familyLabel = (d: DiscoveredDevice): string =>
	d.family === 'pro' ? 'Twinkly Pro' : d.family === 'consumer' ? 'Twinkly (no OSC; use REST)' : 'unrecognised'

/**
 * Rescan action: discover controllers again (refreshing the "Discovered device" list), ask each Pro
 * controller for its details, and log the results.
 */
export async function runScan(self: ModuleInstance): Promise<void> {
	self.log('info', 'Scanning for controllers on UDP 5555...')
	try {
		const { described, failedTargets, error } = await discover(self.config.host)
		if (error) throw new Error(error)
		self.setDiscovered(described)
		const devices = described.map((x) => x.device)
		for (const f of failedTargets) {
			self.log('warn', `Scan: could not send the probe to ${f.target} (${f.error}); other addresses were still scanned`)
		}
		if (devices.length === 0) self.log('info', 'Scan finished: no replies.')

		for (const { device: d, gestalt, error } of described) {
			self.log('info', `${d.address}: ${familyLabel(d)} name=${d.name ?? '?'} (hex ${d.hex})`)
			if (gestalt) self.log('info', `  ${describeLine(gestalt)}`)
			else if (error) self.log('info', `  details unavailable: ${error}`)
			if (d.suggestedId) {
				self.log(
					'info',
					`  suggested device ID: ${d.suggestedId} (name suffix = last 3 MAC bytes; prefix ${PRO_OUI} confirmed on PRO, other models may differ, so check against the MAC in the app)`,
				)
			}
			if (gestalt?.groupRole === 'slave')
				self.log('info', "  send commands to this group's master, not to this controller")
			if (gestalt?.oscEnabled === false) self.log('warn', '  OSC is switched off on this controller')
		}

		const pro = described.filter((x) => x.device.family === 'pro')
		self.log('info', `Scan finished: ${pro.length} Pro controller(s), ${devices.length - pro.length} other.`)
	} catch (e) {
		self.log('error', `Scan failed: ${String(e)}`)
	}
}
