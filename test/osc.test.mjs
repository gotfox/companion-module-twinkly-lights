import test from 'node:test'
import assert from 'node:assert/strict'
import { encodeOscMessage, oscInt, oscString } from '../dist/osc.js'
import { buildAddress, deviceId, isValidMac, normaliseMac } from '../dist/twinkly.js'

test('encodes the documented brightness example (ssi enabled A 50)', () => {
	const buf = encodeOscMessage('/v1/*/led/brightness', [oscString('enabled'), oscString('A'), oscInt(50)])
	assert.equal(buf.length % 4, 0)
	assert.equal(buf.length, 48)
	assert.equal(buf.subarray(0, 20).toString(), '/v1/*/led/brightness')
	assert.equal(buf.subarray(24, 28).toString(), ',ssi')
	assert.equal(buf.subarray(32, 39).toString(), 'enabled')
	assert.equal(buf.readInt32BE(44), 50)
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
