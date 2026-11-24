import test from 'node:test'
import assert from 'node:assert/strict'
import { applyDiscoveredSelection, discoveredChoices, MANUAL_CHOICE } from '../dist/discovered.js'
import { withDefaults } from '../dist/config.js'

// As built from a real scan of this network
const LIST = [
	{
		key: 'TwPRO304950a00f6c',
		address: '192.168.7.187',
		family: 'pro',
		name: 'Yard Christmas Tree Back',
		productCode: 'TWPRO1500ETHP',
		groupRole: 'master',
		groupUid: '1CD99EEF',
		mac: '304950a00f6c',
	},
	{
		key: 'TwPRO304950a01029',
		address: '192.168.4.26',
		family: 'pro',
		name: 'Yard Christmas Tree Front',
		productCode: 'TWPRO1500ETHP',
		groupRole: 'slave',
		groupUid: '1CD99EEF',
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

test('dropdown lists one entry per object: group masters (with members) and standalone devices', () => {
	const choices = discoveredChoices(LIST, '')
	assert.equal(choices[0].id, MANUAL_CHOICE)
	assert.deepEqual(
		choices.slice(1).map((c) => c.label),
		[
			'Deck: Twinkly Pro TWPRO1500ETHP (192.168.7.235)',
			'Squares: Twinkly TWQ064STW (192.168.4.25)',
			'Yard Christmas Tree Back: Twinkly Pro TWPRO1500ETHP, group of 2 with Yard Christmas Tree Front (192.168.7.187)',
		],
	)
})

test('a slave whose master was not found is still listed, with a warning', () => {
	const noMaster = LIST.filter((d) => d.groupRole !== 'master')
	const labels = discoveredChoices(noMaster, '').map((c) => c.label)
	assert.ok(
		labels.includes(
			"Yard Christmas Tree Front: Twinkly Pro TWPRO1500ETHP, group member; its master wasn't found, so commands may be ignored (192.168.4.26)",
		),
	)
})

test('a saved slave selection shows as its master, not as "not found"', () => {
	const choices = discoveredChoices(LIST, 'TwPRO304950a01029')
	assert.ok(!choices.some((c) => /not found/.test(c.label)))
})

test('a saved device that is not currently found stays in the list, so the selection is kept', () => {
	const choices = discoveredChoices([], 'TwPRO304950a00f6c')
	assert.equal(choices.length, 2)
	assert.equal(choices[1].id, 'TwPRO304950a00f6c')
	assert.match(choices[1].label, /not found in the last scan/)
})

test('selecting a Pro master sets IP, type and the specific OSC target', () => {
	const before = withDefaults({ host: '255.255.255.255', method: 'osc', discovered: 'TwPRO304950a00f6c' })
	const after = applyDiscoveredSelection(before, LIST)
	assert.equal(after.host, '192.168.7.187')
	assert.equal(after.family, 'pro')
	assert.equal(after.method, 'osc', 'Pro keeps the chosen control method')
	assert.equal(after.targetMode, 'device')
	assert.equal(after.productType, 'TwPRO')
	assert.equal(after.mac, '304950a00f6c')
	assert.notEqual(after, before, 'returns a new object')
	assert.equal(before.host, '255.255.255.255', 'input is not mutated')
})

test('selecting a group slave points the connection at its master', () => {
	const after = applyDiscoveredSelection(withDefaults({ discovered: 'TwPRO304950a01029' }), LIST)
	assert.equal(after.host, '192.168.7.187')
	assert.equal(after.mac, '304950a00f6c')
	assert.equal(after.discovered, 'TwPRO304950a00f6c', 'selection moves to the master so the dropdown shows it')
})

test('selecting a consumer light switches to REST and consumer type', () => {
	const after = applyDiscoveredSelection(withDefaults({ method: 'osc', discovered: 'Twinkly_CE3949' }), LIST)
	assert.equal(after.host, '192.168.4.25')
	assert.equal(after.family, 'consumer')
	assert.equal(after.method, 'rest')
})

test('returns null when nothing would change, or the selection is manual / not found', () => {
	const applied = applyDiscoveredSelection(withDefaults({ discovered: 'Twinkly_CE3949' }), LIST)
	assert.equal(applyDiscoveredSelection(applied, LIST), null)
	assert.equal(applyDiscoveredSelection(withDefaults({ discovered: MANUAL_CHOICE }), LIST), null)
	assert.equal(applyDiscoveredSelection(withDefaults({ discovered: 'TwPROgone' }), LIST), null)
})

test('follows a device to its new IP after DHCP changes it', () => {
	const applied = applyDiscoveredSelection(withDefaults({ discovered: 'Twinkly_CE3949' }), LIST)
	const moved = LIST.map((d) => (d.key === 'Twinkly_CE3949' ? { ...d, address: '192.168.4.77' } : d))
	assert.equal(applyDiscoveredSelection(applied, moved).host, '192.168.4.77')
})
