import test from 'node:test'
import assert from 'node:assert/strict'
import { Poller } from '../dist/poller.js'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

/** A read that the test resolves by hand, so we control when a poll is "in flight". */
function controlledReads() {
	const pending = []
	let calls = 0
	return {
		read: () => {
			calls++
			return new Promise((resolve, reject) => pending.push({ resolve, reject }))
		},
		resolveNext: (value) => pending.shift().resolve(value),
		rejectNext: (err) => pending.shift().reject(err),
		get calls() {
			return calls
		},
	}
}

test('poller does not reschedule after stop, even if a read was in flight', async () => {
	const reads = controlledReads()
	const results = []
	const p = new Poller({
		intervalMs: 5,
		soonMs: 1,
		read: reads.read,
		onResult: (r) => results.push(r),
		onError: () => {},
	})
	p.start()
	await sleep(5)
	assert.equal(reads.calls, 1)
	p.stop()
	reads.resolveNext('late')
	await sleep(30)
	assert.deepEqual(results, [], 'result from a stopped poller must be discarded')
	assert.equal(reads.calls, 1, 'no further reads after stop')
})

test('a poll requested during an in-flight read discards that result and reads again soon', async () => {
	const reads = controlledReads()
	const results = []
	const p = new Poller({
		intervalMs: 10_000,
		soonMs: 1,
		read: reads.read,
		onResult: (r) => results.push(r),
		onError: () => {},
	})
	p.start()
	await sleep(5)
	assert.equal(reads.calls, 1)
	p.requestSoon() // e.g. a command was just sent
	reads.resolveNext('before-command')
	await sleep(10)
	assert.equal(reads.calls, 2, 'a follow-up read must run without waiting for the long interval')
	reads.resolveNext('after-command')
	await sleep(5)
	assert.deepEqual(results, ['after-command'])
	p.stop()
})

test('requestSoon when idle reads promptly instead of waiting for the interval', async () => {
	const reads = controlledReads()
	const p = new Poller({ intervalMs: 10_000, soonMs: 1, read: reads.read, onResult: () => {}, onError: () => {} })
	p.start()
	await sleep(5)
	reads.resolveNext('first')
	await sleep(5)
	assert.equal(reads.calls, 1)
	p.requestSoon()
	await sleep(10)
	assert.equal(reads.calls, 2)
	p.stop()
})

test('errors are reported and polling continues', async () => {
	const reads = controlledReads()
	const errors = []
	const results = []
	const p = new Poller({
		intervalMs: 2,
		soonMs: 1,
		read: reads.read,
		onResult: (r) => results.push(r),
		onError: (e) => errors.push(e.message),
	})
	p.start()
	await sleep(5)
	reads.rejectNext(new Error('timeout'))
	await sleep(10)
	assert.deepEqual(errors, ['timeout'])
	assert.equal(reads.calls, 2)
	reads.resolveNext('ok')
	await sleep(3)
	assert.deepEqual(results, ['ok'])
	p.stop()
})
