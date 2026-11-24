import test from 'node:test'
import assert from 'node:assert/strict'
import { hostChoices } from '../dist/host-choices.js'
import { applyDiscoveredSelection } from '../dist/discovered.js'
import { withDefaults } from '../dist/config.js'
import { UpgradeScripts } from '../dist/upgrades.js'

const LIST = [
	{
		key: 'TwPRO304950a00f6c',
		address: '192.168.7.187',
		family: 'pro',
		name: 'Yard Christmas Tree Back',
		productCode: 'TWPRO1500ETHP',
		groupRole: 'master',
		groupUid: 'G',
		mac: '304950a00f6c',
	},
	{
		key: 'TwPRO304950a01029',
		address: '192.168.4.26',
		family: 'pro',
		name: 'Yard Christmas Tree Front',
		productCode: 'TWPRO1500ETHP',
		groupRole: 'slave',
		groupUid: 'G',
		mac: '304950a01029',
	},
	{
		key: 'TwPRO304950a00f05',
		address: '192.168.7.235',
		family: 'pro',
		name: 'Deck',
		productCode: 'TWPRO1500ETHP',
		groupRole: 'none',
		groupUid: '',
		mac: '304950a00f05',
	},
	{
		key: 'Twinkly_CE3949',
		address: '192.168.4.25',
		family: 'consumer',
		name: 'Squares',
		productCode: 'TWQ064STW',
		groupRole: 'none',
		groupUid: '',
		mac: 'c4dee2ce3949',
	},
]

test('REST offers one IP per object (no group members, no broadcast)', () => {
	assert.deepEqual(hostChoices(LIST, 'rest', ['192.168.7.255'], ''), [
		{ id: '192.168.7.235', label: '192.168.7.235: Deck (Twinkly Pro)' },
		{ id: '192.168.4.25', label: '192.168.4.25: Squares (Twinkly)' },
		{ id: '192.168.7.187', label: '192.168.7.187: Yard Christmas Tree Back (Twinkly Pro, group of 2)' },
	])
})

test('OSC offers Pro objects plus broadcast addresses, and no Twinkly lights (they have no OSC)', () => {
	assert.deepEqual(hostChoices(LIST, 'osc', ['192.168.7.255'], ''), [
		{ id: '192.168.7.255', label: '192.168.7.255: broadcast to every Twinkly Pro on this network' },
		{ id: '255.255.255.255', label: '255.255.255.255: broadcast on every network (can fail on a computer with a VPN)' },
		{ id: '192.168.7.235', label: '192.168.7.235: Deck (Twinkly Pro)' },
		{ id: '192.168.7.187', label: '192.168.7.187: Yard Christmas Tree Back (Twinkly Pro, group of 2)' },
	])
})

test('an address that is not in the list is kept, so the field never shows blank', () => {
	const choices = hostChoices(LIST, 'rest', [], '10.0.0.9')
	assert.deepEqual(choices.at(-1), {
		id: '10.0.0.9',
		label: '10.0.0.9 (entered manually, or not found by the last scan)',
	})
	assert.equal(hostChoices(LIST, 'rest', [], '').length, 3, 'no blank entry for an empty value')
})

test('the address used depends on the control method; old single-host configs carry over', () => {
	const old = withDefaults({ host: '192.168.7.187', method: 'rest' })
	assert.equal(old.hostRest, '192.168.7.187')
	assert.equal(old.hostOsc, '192.168.7.187')
	assert.equal(old.host, '192.168.7.187')
	const broadcastOnly = withDefaults({ host: '255.255.255.255', method: 'rest' })
	assert.equal(broadcastOnly.hostRest, '', 'a broadcast address is never carried into the REST field')
	assert.equal(broadcastOnly.host, '')
	const both = withDefaults({ hostOsc: '192.168.7.255', hostRest: '192.168.4.25', method: 'osc' })
	assert.equal(both.host, '192.168.7.255')
	assert.equal(withDefaults({ ...both, method: 'rest' }).host, '192.168.4.25')
})

test('choosing a discovered device fills both address fields', () => {
	const next = applyDiscoveredSelection(
		withDefaults({ method: 'osc', hostOsc: '192.168.7.255', discovered: 'TwPRO304950a00f05' }),
		LIST,
	)
	assert.equal(next.hostOsc, '192.168.7.235')
	assert.equal(next.hostRest, '192.168.7.235')
	assert.equal(next.host, '192.168.7.235')
})

test('upgrade script copies the old address into the new fields, once', () => {
	const script = UpgradeScripts.at(-1)
	const props = (config) => ({ config, secrets: null, actions: [], feedbacks: [] })
	const res = script({ currentConfig: {} }, props({ host: '192.168.7.187', method: 'rest' }))
	assert.equal(res.updatedConfig.hostRest, '192.168.7.187')
	assert.equal(res.updatedConfig.hostOsc, '192.168.7.187')
	const already = script({ currentConfig: {} }, props({ host: 'x', hostOsc: 'a', hostRest: 'b' }))
	assert.equal(already.updatedConfig, null)
	assert.equal(script({ currentConfig: {} }, props(null)).updatedConfig, null)
})
