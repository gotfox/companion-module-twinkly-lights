import test from 'node:test'
import assert from 'node:assert/strict'
import { encodeOscMessage, oscInt, oscString } from '../dist/osc.js'
import { buildAddress, deviceId, isValidMac, normaliseMac } from '../dist/twinkly.js'

test('encodes the documented brightness example (ssi enabled A 50)', () => {
	const buf = encodeOscMessage('/v1/*/led/out/brightness', [oscString('enabled'), oscString('A'), oscInt(50)])
	assert.equal(buf.length % 4, 0)
	assert.equal(buf.length, 52)
	assert.equal(buf.subarray(0, 24).toString(), '/v1/*/led/out/brightness')
	assert.equal(buf.subarray(28, 32).toString(), ',ssi')
	assert.equal(buf.subarray(36, 43).toString(), 'enabled')
	assert.equal(buf.readInt32BE(48), 50)
})

test('OSC brightness goes to led/out/brightness, and disabling sends only the mode', async () => {
	const { OscController } = await import('../dist/controller.js')
	const sent = []
	const host = {
		resolveDeviceId: () => 'TwPRO*',
		sendCommand: (id, path, args) => {
			sent.push({ id, path, args })
			return true
		},
	}
	const controller = new OscController(host, () => {})
	await controller.brightness({}, { mode: 'enabled', type: 'A', value: 50 })
	await controller.brightness({}, { mode: 'disabled', type: 'A', value: 100 })
	assert.equal(sent[0].path, 'led/out/brightness')
	assert.deepEqual(sent[0].args, [oscString('enabled'), oscString('A'), oscInt(50)])
	assert.equal(sent[1].path, 'led/out/brightness')
	assert.deepEqual(sent[1].args, [oscString('disabled')])
})

test('encodes a message with no arguments and pads strings', () => {
	const buf = encodeOscMessage('/a', [])
	assert.deepEqual([...buf], [0x2f, 0x61, 0, 0, 0x2c, 0, 0, 0])
	// string whose length is an exact multiple of 4 still needs a NUL terminator + padding
	const b2 = encodeOscMessage('/abc', [oscString('abcd')])
	assert.equal(b2.length % 4, 0)
	assert.equal(b2.subarray(12, 16).toString(), 'abcd')
	assert.equal(b2.length, 20)
})

test('encodes negative int32', () => {
	const buf = encodeOscMessage('/x', [oscInt(-10)])
	assert.equal(buf.readInt32BE(buf.length - 4), -10)
})

test('rejects addresses without a leading slash', () => {
	assert.throws(() => encodeOscMessage('v1/x', []))
})

test('builds device IDs from the documented examples', () => {
	assert.equal(normaliseMac('30:49:50:A0:30:EC'), '304950a030ec')
	assert.equal(deviceId({ targetMode: 'device', productType: 'TwPRO', mac: '30:49:50:A0:30:EC' }), 'TwPRO304950a030ec')
	assert.equal(
		deviceId({ targetMode: 'device', productType: 'TwPLUS', mac: 'A4:CF:12:B5:67:E0' }),
		'TwPLUSa4cf12b567e0',
	)
	assert.equal(deviceId({ targetMode: 'device', productType: 'TwPRO', mac: 'nope' }), null)
	assert.equal(deviceId({ targetMode: 'all', productType: 'TwPRO', mac: '' }), '*')
	assert.equal(deviceId({ targetMode: 'pro', productType: 'TwPRO', mac: '' }), 'TwPRO*')
	assert.equal(deviceId({ targetMode: 'plus', productType: 'TwPRO', mac: '' }), 'TwPLUS*')
	assert.equal(isValidMac('30-49-50-a0-30-ec'), true)
	assert.equal(buildAddress('TwPRO304950a030ec', 'application/mode'), '/v1/TwPRO304950a030ec/application/mode')
})

test('computes broadcast addresses', async () => {
	const { broadcastAddress, printable } = await import('../dist/discovery.js')
	assert.equal(broadcastAddress('192.168.0.104', '255.255.255.0'), '192.168.0.255')
	assert.equal(broadcastAddress('10.1.2.3', '255.255.0.0'), '10.1.255.255')
	assert.equal(broadcastAddress('10.0.0.5', '255.255.255.252'), '10.0.0.7')
	assert.equal(broadcastAddress('bad', '255.255.255.0'), null)
	const { hasBroadcast } = await import('../dist/discovery.js')
	assert.equal(hasBroadcast('255.255.252.0'), true)
	assert.equal(hasBroadcast('255.255.255.255'), false, 'VPN tunnel (/32)')
	assert.equal(hasBroadcast('255.255.255.254'), false, 'point-to-point (/31)')
	assert.equal(printable(Buffer.from([0xc0, 0xa8, 0, 1, 0x4f, 0x4b, 0x54, 0x77])), 'OKTw')
})

test('parses discovery replies captured from real controllers', async () => {
	const { parseDiscoveryReply, deviceFromReply, suggestDeviceId, PROBE } = await import('../dist/discovery.js')
	assert.deepEqual([...PROBE], [0x01, ...Buffer.from('discover')])
	assert.equal(parseDiscoveryReply(PROBE).kind, 'echo')

	// Twinkly Pro (PRO) reply: tag "TP", normal-order IP bytes
	const pro = Buffer.from('c0a807bb5450547750524f5f61303066366300', 'hex')
	assert.deepEqual(parseDiscoveryReply(pro), { kind: 'reply', tag: 'TP', name: 'TwPRO_a00f6c' })
	const proDevice = deviceFromReply('192.168.7.187', pro, parseDiscoveryReply(pro))
	assert.equal(proDevice.family, 'pro')
	// Verified against the MAC shown in the Twinkly Pro app for this controller
	assert.equal(proDevice.suggestedId, 'TwPRO304950a00f6c')

	// Consumer Twinkly reply: tag "OK", reversed IP bytes
	const retail = Buffer.from('fd07a8c04f4b5477696e6b6c795f443438303744' + '00', 'hex')
	assert.deepEqual(parseDiscoveryReply(retail), { kind: 'reply', tag: 'OK', name: 'Twinkly_D4807D' })
	const retailDevice = deviceFromReply('192.168.7.253', retail, parseDiscoveryReply(retail))
	assert.equal(retailDevice.family, 'consumer')
	assert.equal(retailDevice.suggestedId, undefined)

	assert.equal(parseDiscoveryReply(Buffer.from('hello')).kind, 'other')
	assert.equal(suggestDeviceId('TwPLUS_aabbcc'), undefined)
	assert.equal(suggestDeviceId('TwPRO_A01029'), 'TwPRO304950a01029')
})

test('scan keeps going when one target fails, and reports the failure', async () => {
	const dgram = await import('node:dgram')
	const { probeTargets } = await import('../dist/discovery.js')
	// Fake PRO controller on localhost that answers any probe
	const reply = Buffer.from('c0a807bb5450547750524f5f61303066366300', 'hex')
	const fake = dgram.createSocket('udp4')
	fake.on('message', (_msg, rinfo) => fake.send(reply, rinfo.port, rinfo.address))
	await new Promise((resolve) => fake.bind(0, '127.0.0.1', resolve))
	try {
		const result = await probeTargets(['no-such-host.invalid', '127.0.0.1'], 500, fake.address().port)
		assert.equal(result.devices.length, 1)
		assert.equal(result.devices[0].suggestedId, 'TwPRO304950a00f6c')
		assert.equal(result.failedTargets.length, 1)
		assert.equal(result.failedTargets[0].target, 'no-such-host.invalid')
	} finally {
		fake.close()
	}
})

test('scan rejects only when every target fails', async () => {
	const { probeTargets } = await import('../dist/discovery.js')
	await assert.rejects(probeTargets(['no-such-host.invalid'], 500, 9))
})
