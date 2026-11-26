import test from 'node:test'
import assert from 'node:assert/strict'
import { Fader, lerpVector } from '../dist/fade.js'

/** A clock that only moves when the fader sleeps, so fades run instantly and deterministically. */
const fakeClock = () => {
	let t = 0
	return {
		now: () => t,
		sleep: (ms) =>
			new Promise((resolve) =>
				setImmediate(() => {
					t += ms
					resolve()
				}),
			),
	}
}

test('lerpVector interpolates and rounds each channel', () => {
	assert.deepEqual(lerpVector([0, 100], [100, 0], 0.25), [25, 75])
	assert.deepEqual(lerpVector([0], [255], 0.5), [128])
	assert.deepEqual(lerpVector([10, 20, 30], [10, 20, 30], 0.7), [10, 20, 30])
	assert.deepEqual(lerpVector([0], [10], 0), [0])
	assert.deepEqual(lerpVector([0], [10], 1), [10])
})

test('a fade steps from start to target over the duration and ends exactly on the target', async () => {
	const fader = new Fader(fakeClock())
	const applied = []
	const done = await fader.run('b', [0], [100], { durationMs: 1000, stepMs: 250 }, async (v) => {
		applied.push(v[0])
		return true
	})
	assert.equal(done, true)
	assert.deepEqual(applied, [25, 50, 75, 100])
})

test('a fade ends on time even when the duration is not a multiple of the step', async () => {
	const clock = fakeClock()
	const fader = new Fader(clock)
	let finishedAt = -1
	await fader.run('b', [0], [100], { durationMs: 1000, stepMs: 400 }, async (v) => {
		if (v[0] === 100) finishedAt = clock.now()
		return true
	})
	assert.equal(finishedAt, 1000)
})

test('steps keep a steady rate when each send takes time, instead of adding the send time to every step', async () => {
	let t = 0
	const clock = {
		now: () => t,
		sleep: async (ms) => {
			t += Math.max(0, ms)
		},
	}
	const fader = new Fader(clock)
	const sentAt = []
	await fader.run('b', [0], [100], { durationMs: 500, stepMs: 100 }, async () => {
		sentAt.push(t)
		t += 30 // each send takes 30 ms
		return true
	})
	assert.deepEqual(sentAt, [100, 200, 300, 400, 500])
})

test('a send that overruns the fade never makes the fader sleep for a negative time', async () => {
	let t = 0
	const sleeps = []
	const clock = {
		now: () => t,
		sleep: async (ms) => {
			sleeps.push(ms)
			t += Math.max(0, ms)
		},
	}
	const fader = new Fader(clock)
	await fader.run('b', [0], [100], { durationMs: 300, stepMs: 100 }, async () => {
		t += 250 // a slow controller: the send itself outlasts the time left
		return true
	})
	assert.ok(
		sleeps.every((ms) => ms >= 0),
		`slept for ${sleeps.join(', ')}`,
	)
})

test('a fade never sends the starting value or repeats a value', async () => {
	const fader = new Fader(fakeClock())
	const applied = []
	// 10 steps over a range of 3: most steps round to the same value
	await fader.run('b', [0], [3], { durationMs: 1000, stepMs: 100 }, async (v) => {
		applied.push(v[0])
		return true
	})
	assert.deepEqual(applied, [1, 2, 3])
})

test('fading between identical values sends nothing', async () => {
	const fader = new Fader(fakeClock())
	const applied = []
	const done = await fader.run('b', [50], [50], { durationMs: 1000, stepMs: 100 }, async (v) => {
		applied.push(v)
		return true
	})
	assert.equal(done, true)
	assert.deepEqual(applied, [])
})

test('a zero duration jumps straight to the target', async () => {
	const fader = new Fader(fakeClock())
	const applied = []
	await fader.run('b', [0], [100], { durationMs: 0, stepMs: 100 }, async (v) => {
		applied.push(v[0])
		return true
	})
	assert.deepEqual(applied, [100])
})

test('a fade can interpolate several channels together', async () => {
	const fader = new Fader(fakeClock())
	const applied = []
	await fader.run('c', [0, 0, 0], [100, 50, 0], { durationMs: 200, stepMs: 100 }, async (v) => {
		applied.push(v)
		return true
	})
	assert.deepEqual(applied, [
		[50, 25, 0],
		[100, 50, 0],
	])
})

test('a failed send stops the fade and reports it', async () => {
	const fader = new Fader(fakeClock())
	let calls = 0
	const done = await fader.run('b', [0], [100], { durationMs: 1000, stepMs: 100 }, async () => {
		calls++
		return false
	})
	assert.equal(done, false)
	assert.equal(calls, 1)
})

test('cancel() stops a running fade before its next step', async () => {
	const fader = new Fader(fakeClock())
	const applied = []
	const done = await fader.run('b', [0], [100], { durationMs: 1000, stepMs: 100 }, async (v) => {
		applied.push(v[0])
		if (applied.length === 2) fader.cancel('b')
		return true
	})
	assert.equal(done, false)
	assert.deepEqual(applied, [10, 20])
})

test('starting a new fade on the same channel replaces the old one; other channels are unaffected', async () => {
	const fader = new Fader(fakeClock())
	const slow = []
	const other = []
	const first = fader.run('b', [0], [100], { durationMs: 10_000, stepMs: 100 }, async (v) => {
		slow.push(v[0])
		return true
	})
	const unrelated = fader.run('c', [0], [10], { durationMs: 1000, stepMs: 100 }, async (v) => {
		other.push(v[0])
		return true
	})
	await new Promise((r) => setImmediate(r))
	await new Promise((r) => setImmediate(r))
	const replacement = []
	const second = fader.run('b', [50], [60], { durationMs: 100, stepMs: 100 }, async (v) => {
		replacement.push(v[0])
		return true
	})
	assert.equal(await first, false)
	assert.equal(await second, true)
	assert.equal(await unrelated, true)
	assert.deepEqual(replacement, [60])
	assert.equal(other.at(-1), 10)
	// The replaced fade stopped well short of its target
	assert.ok(slow.length < 10 && slow.at(-1) < 100)
})

test('cancelAll() stops every running fade', async () => {
	const fader = new Fader(fakeClock())
	const a = fader.run('a', [0], [100], { durationMs: 10_000, stepMs: 100 }, async () => true)
	const b = fader.run('b', [0], [100], { durationMs: 10_000, stepMs: 100 }, async () => true)
	await new Promise((r) => setImmediate(r))
	fader.cancelAll()
	assert.equal(await a, false)
	assert.equal(await b, false)
})
