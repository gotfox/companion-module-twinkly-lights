import dgram from 'node:dgram'
import os from 'node:os'

/**
 * Discovery by UDP broadcast on port 5555.
 *
 * Twinkly Pro's documentation describes no discovery mechanism, but Pro controllers answer the same
 * probe that consumer Twinkly lights do (verified on PRO hardware). Probe: a 0x01 byte followed by
 * "discover" (as sent by xLights). Reply layout:
 *
 *   bytes 0-3  device IP (consumer lights: reversed byte order, Pro: normal order; unused, we use the sender address)
 *   bytes 4-5  tag: "OK" for consumer lights, "TP" for Twinkly Pro
 *   bytes 6+   NUL-terminated name, e.g. "Twinkly_D4807D" (consumer) or "TwPRO_a00f6c" (Pro)
 *
 * The name suffix is the last 3 bytes of the MAC address.
 */
export const DISCOVERY_PORT = 5555
export const PROBE = Buffer.from('\x01discover', 'latin1')

/**
 * First 3 bytes of the MAC address of PRO controllers. Taken from Twinkly's OSC guide example
 * (30:49:50:A0:30:EC) and confirmed on three real PRO controllers (TWPRO1500ETHP). Other Pro-family
 * products may use a different prefix.
 */
export const PRO_OUI = '304950'

export type DeviceFamily = 'pro' | 'consumer' | 'unknown'

export interface DiscoveredDevice {
	address: string
	family: DeviceFamily
	/** Controller name from byte 6 of the reply, if present */
	name?: string
	/** Best-guess OSC device ID (Pro only; assumes the OUI above) */
	suggestedId?: string
	text: string
	hex: string
}

/** `ip | ~netmask` for IPv4 dotted strings, or null if either is malformed. */
export function broadcastAddress(ip: string, netmask: string): string | null {
	const a = ip.split('.').map(Number)
	const m = netmask.split('.').map(Number)
	if (a.length !== 4 || m.length !== 4 || [...a, ...m].some((n) => !Number.isInteger(n) || n < 0 || n > 255))
		return null
	return a.map((o, i) => (o | (~m[i] & 0xff)) & 0xff).join('.')
}

/**
 * Point-to-point links such as VPN tunnels have a /32 (or /31) mask: their "broadcast address" is
 * just their own address, so probing or offering it is pointless.
 */
export function hasBroadcast(netmask: string): boolean {
	return netmask !== '255.255.255.255' && netmask !== '255.255.255.254'
}

/** Broadcast addresses of every non-internal IPv4 interface that has one. */
export function interfaceBroadcastAddresses(): string[] {
	const out = new Set<string>()
	for (const infos of Object.values(os.networkInterfaces())) {
		for (const info of infos ?? []) {
			if (info.family !== 'IPv4' || info.internal || !hasBroadcast(info.netmask)) continue
			const b = broadcastAddress(info.address, info.netmask)
			if (b) out.add(b)
		}
	}
	return [...out]
}

/** Printable ASCII of a buffer, e.g. a device name such as "TwPRO_a00f6c". */
export function printable(buf: Buffer): string {
	return buf
		.toString('latin1')
		.replace(/[^\x20-\x7e]/g, '')
		.trim()
}

export type ParsedReply = { kind: 'echo' } | { kind: 'reply'; tag: 'OK' | 'TP'; name: string } | { kind: 'other' }

/** Classify a UDP packet received while scanning. */
export function parseDiscoveryReply(msg: Buffer): ParsedReply {
	// Our own probe echoed back: 0x01 'd' 'i' ...
	if (msg.length >= 3 && msg[0] === 0x01 && msg[1] === 0x64 && msg[2] === 0x69) return { kind: 'echo' }
	if (msg.length >= 6) {
		const tag = msg.subarray(4, 6).toString('latin1')
		if (tag === 'OK' || tag === 'TP') {
			const end = msg.indexOf(0, 6)
			return { kind: 'reply', tag, name: printable(msg.subarray(6, end === -1 ? msg.length : end)) }
		}
	}
	return { kind: 'other' }
}

/**
 * Best-guess OSC device ID from a Pro controller name, e.g. "TwPRO_a00f6c" -> "TwPRO304950a00f6c".
 * Only PRO is handled; the MAC prefix for other Pro-family products isn't known.
 */
export function suggestDeviceId(name: string): string | undefined {
	const m = /^TwPRO_([0-9a-f]{6})$/i.exec(name)
	return m ? `TwPRO${PRO_OUI}${m[1].toLowerCase()}` : undefined
}

export function deviceFromReply(
	address: string,
	msg: Buffer,
	parsed: Extract<ParsedReply, { kind: 'reply' }>,
): DiscoveredDevice {
	return {
		address,
		family: parsed.tag === 'TP' ? 'pro' : 'consumer',
		name: parsed.name,
		suggestedId: parsed.tag === 'TP' ? suggestDeviceId(parsed.name) : undefined,
		text: printable(msg),
		hex: msg.toString('hex'),
	}
}

export interface FailedTarget {
	target: string
	error: string
}

export interface ScanResult {
	devices: DiscoveredDevice[]
	/** Addresses the probe could not be sent to, e.g. EHOSTUNREACH for 255.255.255.255 when a VPN owns the default route */
	failedTargets: FailedTarget[]
}

/** Addresses to probe: every interface's broadcast address, plus the configured host if it is a broadcast address. */
export function scanTargets(extraBroadcast: string | undefined): string[] {
	const targets = new Set(interfaceBroadcastAddresses())
	if (extraBroadcast && /\.255$/.test(extraBroadcast)) targets.add(extraBroadcast)
	if (targets.size === 0) targets.add('255.255.255.255')
	return [...targets]
}

export async function scanForDevices(extraBroadcast: string | undefined, timeoutMs = 2500): Promise<ScanResult> {
	return probeTargets(scanTargets(extraBroadcast), timeoutMs)
}

/**
 * Send the discovery probe to each target and collect replies until `timeoutMs`.
 * A failed send to one target is recorded and the scan carries on. It only rejects if the socket
 * itself fails or the probe could not be sent to any target.
 */
export async function probeTargets(
	targets: readonly string[],
	timeoutMs = 2500,
	port = DISCOVERY_PORT,
): Promise<ScanResult> {
	return new Promise((resolve, reject) => {
		const found = new Map<string, DiscoveredDevice>()
		const failedTargets: FailedTarget[] = []
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
			resolve({ devices: [...found.values()], failedTargets: [...failedTargets] })
		}, timeoutMs)
		const fail = (err: Error): void => {
			if (done) return
			done = true
			clearTimeout(timer)
			close()
			reject(err)
		}
		const recordFailure = (target: string, err: Error): void => {
			failedTargets.push({ target, error: err.message })
			if (failedTargets.length < targets.length) return
			const detail = failedTargets.map((f) => `${f.target} (${f.error})`).join(', ')
			fail(new Error(`Could not send the discovery probe to any address: ${detail}`))
		}

		socket.on('error', fail)
		socket.on('message', (msg, rinfo) => {
			const parsed = parseDiscoveryReply(msg)
			if (parsed.kind === 'echo' || found.has(rinfo.address)) return
			found.set(
				rinfo.address,
				parsed.kind === 'reply'
					? deviceFromReply(rinfo.address, msg, parsed)
					: { address: rinfo.address, family: 'unknown', text: printable(msg), hex: msg.toString('hex') },
			)
		})
		socket.bind(0, () => {
			try {
				socket.setBroadcast(true)
			} catch (e) {
				fail(e as Error)
				return
			}
			if (targets.length === 0) {
				fail(new Error('No addresses to send the discovery probe to'))
				return
			}
			for (const target of targets) {
				socket.send(PROBE, port, target, (err) => {
					if (err && !done) recordFailure(target, err)
				})
			}
		})
	})
}
