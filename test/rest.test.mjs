import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import {
	parseGestalt,
	parseMode,
	parseMovies,
	parsePlaylists,
	parseBrightness,
	RestResponseError,
} from '../dist/rest-parse.js'
import { TwinklyRestClient } from '../dist/rest.js'

// Responses captured from a TWPRO1500ETHP on firmware 4.1.0 (trimmed)
const GESTALT = {
	product_code: 'TWPRO1500ETHP',
	device_name: 'Yard Christmas Tree Back',
	number_of_led: 1500,
	group: { mode: 'master', uid: '1CD99EEF-D13D-4FB9-ADDB-ACD9D49B0256', size: 3000, offset: 0 },
	max_movies: 32,
	max_playlists: 4,
	osc_en: true,
	artnet_en: false,
	result: { code: 1000 },
}
const MODE_PLAYLIST = {
	mode: 'playlist',
	name: 'Xmas 1',
	unique_id: 'cd7bb2fd-4fda-1fe3-b1a3-25f2febef01a',
	size: 10,
	movie: { name: 'Rotor', unique_id: 'E2514276-100B-47B1-AAD0-B28F65C5B64E', index: 3, duration: 30 },
	result: { code: 1000 },
}
const MODE_MOVIE = {
	mode: 'movie',
	name: 'Twist Vertigo',
	unique_id: '2713901A-B9C9-4134-A853-79FA42158BCE',
	result: { code: 1000 },
}
const MOVIES = {
	size: 2,
	max: 32,
	movies: [
		{ id: 0, name: 'Twist Vertigo', unique_id: '2713901A-B9C9-4134-A853-79FA42158BCE', fps: 12 },
		{ id: 1, name: 'Rotor', unique_id: 'E2514276-100B-47B1-AAD0-B28F65C5B64E', fps: 12 },
	],
	result: { code: 1000 },
}
const PLAYLISTS = {
	size: 2,
	max: 4,
	list: [
		{ name: 'Xmas 1', unique_id: 'cd7bb2fd-4fda-1fe3-b1a3-25f2febef01a', entries: [] },
		{ name: 'Xmas 2', unique_id: 'b8528343-0e81-22f5-9889-5b91def976ef', entries: [] },
	],
	result: { code: 1000 },
}

test('parses gestalt from a PRO group master', () => {
	assert.deepEqual(parseGestalt(GESTALT), {
		productCode: 'TWPRO1500ETHP',
		deviceName: 'Yard Christmas Tree Back',
		groupRole: 'master',
		groupUid: '1CD99EEF-D13D-4FB9-ADDB-ACD9D49B0256',
		maxMovies: 32,
		maxPlaylists: 4,
		oscEnabled: true,
		artnetEnabled: false,
		mac: '',
	})
	assert.equal(parseGestalt({ ...GESTALT, group: { mode: 'none', uid: '' } }).groupRole, 'none')
})

test('parses application mode for playlist, movie and off', () => {
	assert.deepEqual(parseMode(MODE_PLAYLIST), {
		mode: 'playlist',
		effectName: 'Rotor',
		effectUuid: 'E2514276-100B-47B1-AAD0-B28F65C5B64E',
		playlistName: 'Xmas 1',
		playlistUuid: 'cd7bb2fd-4fda-1fe3-b1a3-25f2febef01a',
	})
	assert.deepEqual(parseMode(MODE_MOVIE), {
		mode: 'movie',
		effectName: 'Twist Vertigo',
		effectUuid: '2713901A-B9C9-4134-A853-79FA42158BCE',
		playlistName: '',
		playlistUuid: '',
	})
	assert.equal(parseMode({ mode: 'off', result: { code: 1000 } }).mode, 'off')
	assert.equal(parseMode({ mode: 'rt', result: { code: 1000 } }).mode, 'unknown')
})

test('playlist index is the position in the controller list, even with junk entries', () => {
	const withJunk = { ...PLAYLISTS, list: [null, ...PLAYLISTS.list] }
	assert.deepEqual(
		parsePlaylists(withJunk).map((p) => p.index),
		[1, 2],
	)
})

test('controller strings are stripped of control characters', () => {
	assert.equal(parseGestalt({ ...GESTALT, device_name: 'Tree\u001b[31m\nBack' }).deviceName, 'Tree[31mBack')
})

test('parses movie and playlist lists in handle / index order', () => {
	assert.deepEqual(parseMovies(MOVIES), [
		{ handle: 0, name: 'Twist Vertigo', uuid: '2713901A-B9C9-4134-A853-79FA42158BCE' },
		{ handle: 1, name: 'Rotor', uuid: 'E2514276-100B-47B1-AAD0-B28F65C5B64E' },
	])
	assert.deepEqual(parsePlaylists(PLAYLISTS), [
		{ index: 0, name: 'Xmas 1', uuid: 'cd7bb2fd-4fda-1fe3-b1a3-25f2febef01a' },
		{ index: 1, name: 'Xmas 2', uuid: 'b8528343-0e81-22f5-9889-5b91def976ef' },
	])
})

test('parses brightness', () => {
	assert.deepEqual(parseBrightness({ mode: 'enabled', value: 30, result: { code: 1000 } }), {
		filter: 'enabled',
		value: 30,
	})
	assert.deepEqual(parseBrightness({ mode: 'disabled', value: 0, result: { code: 1000 } }), {
		filter: 'disabled',
		value: 0,
	})
})

test('rejects malformed or failed responses', () => {
	assert.throws(() => parseMode({ result: { code: 2401 } }), RestResponseError)
	assert.throws(() => parseMovies({ movies: 'nope', result: { code: 1000 } }), RestResponseError)
	assert.throws(() => parseBrightness({ mode: 'enabled', value: 'x', result: { code: 1000 } }), RestResponseError)
	assert.throws(() => parseGestalt(null), RestResponseError)
})

/** Minimal fake controller: login/verify, one protected GET and one POST, 401 without a valid token. */
function fakeController() {
	const state = { logins: 0, token: '', posts: [] }
	const server = http.createServer((req, res) => {
		let body = ''
		req.on('data', (c) => (body += c))
		req.on('end', () => {
			const send = (status, obj) => {
				res.writeHead(status, { 'Content-Type': 'application/json' })
				res.end(JSON.stringify(obj))
			}
			if (req.url === '/xled/v2/login' && req.method === 'POST') {
				state.logins++
				state.token = `tok${state.logins}`
				return send(200, {
					authentication_token: state.token,
					authentication_token_expires_in: 14400,
					'challenge-response': 'abc',
					result: { code: 1000 },
				})
			}
			if (req.url === '/xled/v2/verify') {
				const ok = req.headers['x-auth-token'] === state.token && JSON.parse(body)['challenge-response'] === 'abc'
				return send(ok ? 200 : 401, { result: { code: ok ? 1000 : 2401 } })
			}
			if (req.headers['x-auth-token'] !== state.token) return send(401, { result: { code: 2401 } })
			if (req.url === '/xled/v2/application/mode' && req.method === 'GET') return send(200, MODE_MOVIE)
			if (req.url === '/xled/v2/application/mode' && req.method === 'POST') {
				state.posts.push(JSON.parse(body))
				return send(200, { result: { code: 1000 } })
			}
			return send(404, { result: { code: 2404 } })
		})
	})
	return new Promise((resolve) =>
		server.listen(0, '127.0.0.1', () => resolve({ server, state, host: `127.0.0.1:${server.address().port}` })),
	)
}

test('REST client logs in once, reuses the token, and re-logs in after a 401', async () => {
	const { server, state, host } = await fakeController()
	try {
		const client = new TwinklyRestClient(host, { timeoutMs: 2000 })
		assert.equal((await client.getMode()).effectName, 'Twist Vertigo')
		await client.playMovie({ uuid: 'X' })
		await assert.rejects(client.playMovie({ handle: 1 }), /UUID only/)
		assert.equal(state.logins, 1)
		assert.deepEqual(state.posts, [{ mode: 'movie', unique_id: 'X' }])

		state.token = 'expired-elsewhere' // controller dropped our session
		assert.equal((await client.getMode()).mode, 'movie')
		assert.equal(state.logins, 2)
	} finally {
		server.close()
	}
})

test('REST client fails with a clear error when the controller is unreachable', async () => {
	const client = new TwinklyRestClient('127.0.0.1:9', { timeoutMs: 500 })
	await assert.rejects(client.getMode(), /127\.0\.0\.1:9/)
})

test('REST controller maps handles and playlist indexes to UUIDs, refreshing the list once if needed', async () => {
	const { ContentCache, RestController } = await import('../dist/controller.js')
	const sent = []
	let listReads = 0
	const client = {
		host: 'fake',
		family: 'pro',
		selectsByHandle: false,
		getMovies: async () => (listReads++, parseMovies(MOVIES)),
		getPlaylists: async () => parsePlaylists(PLAYLISTS),
		getBuiltinEffectCount: async () => 0,
		off: async () => void sent.push({ mode: 'off' }),
		playMovie: async (m) => void sent.push({ mode: 'movie', ...m }),
		startPlaylist: async (p) => void sent.push({ mode: 'playlist', uuid: p.uuid }),
		setBrightness: async (c) => void sent.push(c),
	}
	const logs = []
	const cache = new ContentCache(client)
	const ctl = new RestController(
		client,
		cache,
		(level, msg) => logs.push([level, msg]),
		() => {},
	)

	assert.equal(await ctl.movie({}, { handle: 1 }), true)
	assert.equal(listReads, 1) // empty cache -> one refresh
	assert.equal(await ctl.playlist({}, 1), true)
	assert.equal(await ctl.movie({}, { uuid: 'ABC' }), true)
	assert.equal(await ctl.off({}), true)
	assert.deepEqual(sent, [
		{ mode: 'movie', uuid: 'E2514276-100B-47B1-AAD0-B28F65C5B64E' },
		{ mode: 'playlist', uuid: 'b8528343-0e81-22f5-9889-5b91def976ef' },
		{ mode: 'movie', uuid: 'ABC' },
		{ mode: 'off' },
	])
	// Pro has no built-in effects: refused without sending
	assert.equal(await ctl.builtinEffect({}, 1), false)

	// Unknown handle: refresh once more, then refuse without sending
	assert.equal(await ctl.movie({}, { handle: 40 }), false)
	assert.equal(listReads, 2) // one more refresh for the miss, not a loop
	assert.equal(sent.length, 4)
	assert.ok(logs.some(([level, msg]) => level === 'warn' && msg.includes('handle 40')))
})

test('REST controller reports a failed command instead of throwing', async () => {
	const { ContentCache, RestController } = await import('../dist/controller.js')
	const client = { host: 'fake', family: 'pro', off: async () => Promise.reject(new Error('HTTP 500')) }
	const logs = []
	const ctl = new RestController(
		client,
		new ContentCache(client),
		(l, m) => logs.push([l, m]),
		() => {},
	)
	assert.equal(await ctl.off({}), false)
	assert.ok(logs.some(([l, m]) => l === 'error' && m.includes('HTTP 500')))
})

test('polled state maps the effect UUID to a handle when known', async () => {
	const { stateFromController } = await import('../dist/state.js')
	const movies = parseMovies(MOVIES)
	const bright = { filter: 'enabled', value: 30 }
	const fromPlaylist = stateFromController(parseMode(MODE_PLAYLIST), bright, movies)
	assert.deepEqual(fromPlaylist, {
		source: 'controller',
		mode: 'playlist',
		effect: '1',
		effectName: 'Rotor',
		playlistName: 'Xmas 1',
		playlistUuid: 'cd7bb2fd-4fda-1fe3-b1a3-25f2febef01a',
		brightness: 30,
		brightnessFilter: 'enabled',
	})
	const unknown = stateFromController({ ...parseMode(MODE_MOVIE), effectUuid: 'NEW-UUID' }, bright, movies)
	assert.equal(unknown.effect, 'NEW-UUID')
})

test('config helpers: unicast detection and defaults for old saved configs', async () => {
	const { isUnicastHost, withDefaults } = await import('../dist/config.js')
	assert.equal(isUnicastHost('192.168.7.187'), true)
	assert.equal(isUnicastHost('255.255.255.255'), false)
	assert.equal(isUnicastHost('192.168.7.255', ['192.168.7.255']), false, 'the local subnet broadcast')
	assert.equal(isUnicastHost(''), false)
	assert.equal(isUnicastHost('twinkly.local'), false)
	const old = withDefaults({
		host: '192.168.7.187',
		port: 9000,
		targetMode: 'all',
		productType: 'TwPRO',
		mac: '',
		verbose: true,
	})
	assert.equal(old.method, 'osc')
	assert.equal(old.pollInterval, 0, 'connections saved before state reading existed keep it off')
	assert.equal(withDefaults({ pollInterval: 2 }).pollInterval, 2)
	assert.equal(withDefaults({ pollInterval: 0.001 }).pollInterval, 1, 'tiny intervals are raised to 1 s')
	assert.equal(withDefaults({ pollInterval: 999 }).pollInterval, 60)
	assert.equal(isUnicastHost('192.168.999.1'), false)
	assert.equal(withDefaults({ method: 'rest', pollInterval: 0 }).pollInterval, 0)
})

test('preset entries use controller names when known, otherwise the full PRO range', async () => {
	const { effectPresetEntries, playlistPresetEntries } = await import('../dist/presets.js')
	assert.deepEqual(effectPresetEntries(parseMovies(MOVIES)), [
		{ id: 'movie_0', handle: 0, label: 'Twist Vertigo' },
		{ id: 'movie_1', handle: 1, label: 'Rotor' },
	])
	const fallback = effectPresetEntries([])
	assert.equal(fallback.length, 32)
	assert.deepEqual(fallback[31], { id: 'movie_31', handle: 31, label: 'Effect 31' })

	assert.deepEqual(playlistPresetEntries(parsePlaylists(PLAYLISTS)), [
		{ id: 'playlist_0', index: 0, label: 'Xmas 1' },
		{ id: 'playlist_1', index: 1, label: 'Xmas 2' },
	])
	assert.equal(playlistPresetEntries([]).length, 4)
})

test('REST controller passes handles straight through on consumer lights', async () => {
	const { ContentCache, RestController } = await import('../dist/controller.js')
	const sent = []
	const client = {
		host: 'fake',
		family: 'consumer',
		selectsByHandle: true,
		playMovie: async (m) => void sent.push(m),
		playBuiltinEffect: async (i) => void sent.push({ builtin: i }),
	}
	const ctl = new RestController(
		client,
		new ContentCache(client),
		() => {},
		() => {},
	)
	assert.equal(await ctl.movie({}, { handle: 3 }), true)
	assert.equal(await ctl.builtinEffect({}, 2), true)
	assert.deepEqual(sent, [{ handle: 3 }, { builtin: 2 }])
})

test('content refresh counts a controller with empty lists as reachable, and one that fails as not', async () => {
	const { ContentCache } = await import('../dist/controller.js')
	const empty = {
		getMovies: async () => [],
		getPlaylists: async () => [],
		getBuiltinEffectCount: async () => 0, // Pro answers 0 without asking the device
	}
	const ok = new ContentCache(empty)
	assert.equal(ok.reachable, false, 'unknown before the first refresh')
	await ok.refresh()
	assert.equal(ok.reachable, true, 'empty lists are a valid answer')

	const down = {
		getMovies: async () => Promise.reject(new Error('timeout')),
		getPlaylists: async () => Promise.reject(new Error('timeout')),
		getBuiltinEffectCount: async () => 0,
	}
	const failed = new ContentCache(down)
	await assert.rejects(failed.refresh())
	assert.equal(failed.reachable, false, 'the built-in count alone must not count as a reply')
})
