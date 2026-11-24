import type { ModuleConfig } from './config.js'
import type { DescribedDevice } from './describe.js'
import type { GroupRole } from './rest-parse.js'
import type { DeviceFamily } from './rest.js'

/** Dropdown value meaning "don't use discovery; I'll enter the address myself" */
export const MANUAL_CHOICE = ''

/** A Twinkly device found by a scan, with what it told us about itself. */
export interface DiscoveredController {
	/** Stable across IP changes: `TwPRO<mac>` for Pro, the reply name (e.g. `Twinkly_CE3949`) for consumer lights */
	key: string
	address: string
	family: DeviceFamily
	name: string
	productCode: string
	groupRole: GroupRole
	groupUid: string
	/** Lowercase hex, '' if unknown */
	mac: string
}

const PRO_ID_PREFIX = 'TwPRO'

/** Turn scan results into the list the config dropdown offers. Devices that gave no details are skipped. */
export function toDiscoveredList(described: readonly DescribedDevice[]): DiscoveredController[] {
	return described.flatMap(({ device, gestalt }): DiscoveredController[] => {
		if (!gestalt || device.family === 'unknown') return []
		const key = device.suggestedId ?? device.name ?? device.address
		const mac =
			gestalt.mac ||
			(device.suggestedId?.startsWith(PRO_ID_PREFIX) ? device.suggestedId.slice(PRO_ID_PREFIX.length) : '')
		return [
			{
				key,
				address: device.address,
				family: device.family,
				name: gestalt.deviceName || device.name || device.address,
				productCode: gestalt.productCode,
				groupRole: gestalt.groupRole,
				groupUid: gestalt.groupUid,
				mac,
			},
		]
	})
}

const sameGroup = (a: DiscoveredController, b: DiscoveredController): boolean =>
	a.groupUid !== '' && a.groupUid === b.groupUid

/** The group's master, if the scan found it */
const masterOf = (d: DiscoveredController, list: readonly DiscoveredController[]): DiscoveredController | undefined =>
	list.find((m) => m.groupRole === 'master' && sameGroup(m, d))

function describeChoice(d: DiscoveredController, list: readonly DiscoveredController[]): string {
	const type = `${d.family === 'pro' ? 'Twinkly Pro' : 'Twinkly'}${d.productCode ? ` ${d.productCode}` : ''}`
	let role = ''
	if (d.groupRole === 'master') {
		const members = list.filter((m) => m.groupRole === 'slave' && sameGroup(m, d)).map((m) => m.name)
		role = members.length > 0 ? `, group of ${members.length + 1} with ${members.join(', ')}` : ', group master'
	} else if (d.groupRole === 'slave') {
		role = ", group member; its master wasn't found, so commands may be ignored"
	}
	return `${d.name}: ${type}${role} (${d.address})`
}

/**
 * Choices for the "Discovered device" dropdown: one per object, i.e. each group's master and each
 * standalone device. Group members are folded into their master (they may ignore direct commands),
 * unless the master wasn't found. Keeps the saved selection even if this scan missed it.
 */
export function discoveredChoices(
	list: readonly DiscoveredController[],
	selected: string,
): { id: string; label: string }[] {
	const objects = list.filter((d) => d.groupRole !== 'slave' || !masterOf(d, list))
	const choices = [...objects]
		.sort((a, b) => a.name.localeCompare(b.name))
		.map((d) => ({ id: d.key, label: describeChoice(d, list) }))
	if (selected !== MANUAL_CHOICE && !list.some((d) => d.key === selected)) {
		choices.push({ id: selected, label: `${selected} (not found in the last scan)` })
	}
	return [{ id: MANUAL_CHOICE, label: 'Enter the address manually' }, ...choices]
}

/** For a group member, the device to talk to is the group's master (when the scan found it). */
function commandTarget(device: DiscoveredController, list: readonly DiscoveredController[]): DiscoveredController {
	return device.groupRole === 'slave' ? (masterOf(device, list) ?? device) : device
}

/**
 * The config that follows from the selected discovered device, or null if nothing needs to change
 * (manual entry, device not found, or already applied). Never mutates its input.
 */
export function applyDiscoveredSelection(
	config: ModuleConfig,
	list: readonly DiscoveredController[],
): ModuleConfig | null {
	if (config.discovered === MANUAL_CHOICE) return null
	const picked = list.find((d) => d.key === config.discovered)
	if (!picked) return null
	const target = commandTarget(picked, list)

	const next: ModuleConfig = {
		...config,
		// Point the selection at the object (master) so the dropdown shows what is actually controlled
		discovered: target.key,
		host: target.address,
		hostRest: target.address,
		// Twinkly lights have no OSC, so leave the OSC address as it was for them
		hostOsc: target.family === 'pro' ? target.address : config.hostOsc,
		family: target.family,
		// Consumer lights have no OSC; Pro keeps whichever method the user chose
		method: target.family === 'consumer' ? 'rest' : config.method,
		...(target.family === 'pro' && target.mac
			? { targetMode: 'device' as const, productType: 'TwPRO' as const, mac: target.mac }
			: {}),
	}
	const changed = (Object.keys(next) as (keyof ModuleConfig)[]).some((k) => next[k] !== config[k])
	return changed ? next : null
}
