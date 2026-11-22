/**
 * Minimal OSC 1.0 encoder. Twinkly Pro only receives OSC (no feedback is documented),
 * so we only need to build messages with string / int32 / float32 arguments.
 */
export type OscArg = { type: 's'; value: string } | { type: 'i'; value: number } | { type: 'f'; value: number }

function pad4(len: number): number {
	return (4 - (len % 4)) % 4
}

function encodeString(value: string): Buffer {
	const raw = Buffer.from(value, 'utf8')
	// OSC strings are NUL-terminated and padded to a multiple of 4 bytes
	return Buffer.concat([raw, Buffer.alloc(1 + pad4(raw.length + 1))])
}

export function encodeOscMessage(address: string, args: OscArg[]): Buffer {
	if (!address.startsWith('/')) throw new Error(`OSC address must start with "/": ${address}`)

	const parts: Buffer[] = [encodeString(address), encodeString(',' + args.map((a) => a.type).join(''))]
	for (const arg of args) {
		if (arg.type === 's') {
			parts.push(encodeString(arg.value))
		} else {
			const buf = Buffer.alloc(4)
			if (arg.type === 'i') buf.writeInt32BE(Math.trunc(arg.value))
			else buf.writeFloatBE(arg.value)
			parts.push(buf)
		}
	}
	return Buffer.concat(parts)
}

export const oscString = (value: string): OscArg => ({ type: 's', value })
export const oscInt = (value: number): OscArg => ({ type: 'i', value })
