import dgram from 'node:dgram'

/**
 * EXPERIMENTAL / UNVERIFIED.
 *
 * Twinkly Pro's OSC guide documents no discovery mechanism. Consumer Twinkly lights answer a UDP
 * broadcast of "\x01discover" on port 5555; this probe tries the same thing in case Pro controllers
 * do too. It may find nothing. Replies are returned raw so the behaviour can be inspected.
 */
export const DISCOVERY_PORT = 5555

export interface DiscoveredDevice {
	address: string
	text: string
	hex: string
}

export async function scanForDevices(broadcastAddress: string, timeoutMs = 3000): Promise<DiscoveredDevice[]> {
	return new Promise((resolve, reject) => {
		const found = new Map<string, DiscoveredDevice>()
		const socket = dgram.createSocket('udp4')
		const finish = (): void => {
			clearTimeout(timer)
			try {
				socket.close()
			} catch {
				// already closed
			}
			resolve([...found.values()])
		}
		const timer = setTimeout(finish, timeoutMs)

		socket.on('error', (err) => {
			clearTimeout(timer)
			try {
				socket.close()
			} catch {
				// already closed
			}
			reject(err)
		})
		socket.on('message', (msg, rinfo) => {
			found.set(rinfo.address, {
				address: rinfo.address,
				text: msg
					.toString('latin1')
					.replace(/[^\x20-\x7e]/g, '')
					.trim(),
				hex: msg.toString('hex'),
			})
		})
		socket.bind(0, () => {
			socket.setBroadcast(true)
			socket.send(Buffer.from('\x01discover', 'latin1'), DISCOVERY_PORT, broadcastAddress, (err) => {
				if (err) {
					clearTimeout(timer)
					try {
						socket.close()
					} catch {
						// already closed
					}
					reject(err)
				}
			})
		})
	})
}
