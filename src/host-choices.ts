import type { ControlMethod } from './config.js'
import type { DiscoveredController } from './discovered.js'

export const LIMITED_BROADCAST = '255.255.255.255'

export interface HostChoice {
	id: string
	label: string
}

const groupSize = (d: DiscoveredController, list: readonly DiscoveredController[]): number =>
	d.groupRole === 'master' ? 1 + list.filter((m) => m.groupRole === 'slave' && m.groupUid === d.groupUid).length : 1

function deviceLabel(d: DiscoveredController, list: readonly DiscoveredController[]): string {
	const type = d.family === 'pro' ? 'Twinkly Pro' : 'Twinkly'
	const size = groupSize(d, list)
	return `${d.address}: ${d.name} (${type}${size > 1 ? `, group of ${size}` : ''})`
}

/**
 * Address options for one control method, so users only see addresses that work with it:
 * - REST: one IP per object (group masters and standalone devices). Group members and broadcast don't work.
 * - OSC: Pro objects plus broadcast addresses. Twinkly lights have no OSC.
 * The current value is always kept, so a typed or no-longer-found address still shows.
 */
export function hostChoices(
	list: readonly DiscoveredController[],
	method: ControlMethod,
	subnetBroadcasts: readonly string[],
	current: string,
): HostChoice[] {
	const objects = list
		.filter((d) => d.groupRole !== 'slave')
		.filter((d) => method === 'rest' || d.family === 'pro')
		.sort((a, b) => a.name.localeCompare(b.name))
		.map((d) => ({ id: d.address, label: deviceLabel(d, list) }))

	const broadcasts =
		method === 'osc'
			? [
					...subnetBroadcasts
						.filter((b) => b !== LIMITED_BROADCAST)
						.map((b) => ({ id: b, label: `${b}: broadcast to every Twinkly Pro on this network` })),
					{
						id: LIMITED_BROADCAST,
						label: `${LIMITED_BROADCAST}: broadcast on every network (can fail on a computer with a VPN)`,
					},
				]
			: []

	const choices = [...broadcasts, ...objects]
	if (current && !choices.some((c) => c.id === current)) {
		choices.push({ id: current, label: `${current} (entered manually, or not found by the last scan)` })
	}
	return choices
}
