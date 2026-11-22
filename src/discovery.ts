import dgram from 'node:dgram'
import os from 'node:os'

/**
 * EXPERIMENTAL / UNVERIFIED for Twinkly Pro.
 *
 * Twinkly Pro's documentation describes no discovery mechanism. Consumer Twinkly lights answer a UDP
 * broadcast on port 5555 (see https://github.com/twinklyjs/twinklyjs and xled-docs). Published sources
 * disagree on whether the probe's first byte is 0x01 or the ASCII character "1", so both are sent.
 * Replies are returned raw so the real behaviour of Pro controllers can be inspected.
 */
export const DISCOVERY_PORT = 5555
export const PROBES: Buffer[] = [Buffer.from('\x01discover', 'latin1'), Buffer.from('1discover', 'latin1')]

export interface GestaltInfo {
	mac?: string
	productCode?: string
	deviceName?: string
}

export interface DiscoveredDevice {
	address: string
	text: string
	hex: string
	gestalt?: GestaltInfo
}

/** `ip | ~netmask` for IPv4 dotted strings, or null if either is malformed. */
export function broadcastAddress(ip: string, netmask: string): string | null {
	const a = ip.split('.').map(Number)
	const m = netmask.split('.').map(Number)
	if (a.length !== 4 || m.length !== 4 || [...a, ...m].some((n) => !Number.isInteger(n) || n < 0 || n > 255))
		return null
	return a.map((o, i) => (o | (~m[i] & 0xff)) & 0xff).join('.')
}

/** Broadcast addresses of every non-internal IPv4 interface. */
export function interfaceBroadcastAddresses(): string[] {
	const out = new Set<string>()
	for (const infos of Object.values(os.networkInterfaces())) {
		for (const info of infos ?? []) {
			if (info.family !== 'IPv4' || info.internal) continue
			const b = broadcastAddress(info.address, info.netmask)
			if (b) out.add(b)
		}
	}
	return [...out]
}

/** Printable ASCII of a reply, e.g. a device name such as "Twinkly_1CC190". */
export function printable(buf: Buffer): string {
	return buf
		.toString('latin1')
		.replace(/[^\x20-\x7e]/g, '')
		.trim()
}

export async function scanForDevices(
	extraBroadcast: string | undefined,
	timeoutMs = 2500,
): Promise<DiscoveredDevice[]> {
	const targets = new Set(interfaceBroadcastAddresses())
	if (extraBroadcast && /\.255$/.test(extraBroadcast)) targets.add(extraBroadcast)
	if (targets.size === 0) targets.add('255.255.255.255')

	return new Promise((resolve, reject) => {
		const found = new Map<string, DiscoveredDevice>()
		const socket = dgram.createSocket('udp4')
		let done = false
		const close = (): void => {
			try {
				socket.close()
			} catch {
				// already closed
			}
		}
		const timer = setTimeout(() => {
			done = true
			close()
			resolve([...found.values()])
		}, timeoutMs)
		const fail = (err: Error): void => {
			if (done) return
			done = true
			clearTimeout(timer)
			close()
			reject(err)
		}

		socket.on('error', fail)
		socket.on('message', (msg, rinfo) => {
			if (!found.has(rinfo.address)) {
				found.set(rinfo.address, { address: rinfo.address, text: printable(msg), hex: msg.toString('hex') })
			}
		})
		socket.bind(0, () => {
			try {
				socket.setBroadcast(true)
			} catch (e) {
				fail(e as Error)
				return
			}
			for (const target of targets) {
				for (const probe of PROBES) {
					socket.send(probe, DISCOVERY_PORT, target, (err) => {
						if (err) fail(err)
					})
				}
			}
		})
	})
}

/**
 * Try the consumer-Twinkly unauthenticated `GET /xled/v1/gestalt` (HTTP, port 80).
 * Returns undefined if the device doesn't answer or the reply isn't the expected JSON.
 */
export async function fetchGestalt(address: string, timeoutMs = 2000): Promise<GestaltInfo | undefined> {
	try {
		const res = await fetch(`http://${address}/xled/v1/gestalt`, { signal: AbortSignal.timeout(timeoutMs) })
		if (!res.ok) return undefined
		const json = (await res.json()) as Record<string, unknown>
		const str = (v: unknown): string | undefined => (typeof v === 'string' ? v : undefined)
		const info: GestaltInfo = {
			mac: str(json.mac),
			productCode: str(json.product_code),
			deviceName: str(json.device_name),
		}
		return info.mac || info.productCode || info.deviceName ? info : undefined
	} catch {
		return undefined
	}
}
