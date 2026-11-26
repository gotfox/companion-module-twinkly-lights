import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { parseGestalt, parseMode, parseMovies, parseConsumerPlaylist, RestResponseError } from '../dist/rest-parse.js'
import { TwinklyRestClient, detectFamily } from '../dist/rest.js'

// Captured from consumer lights on firmware 2.11.0 (trimmed)
const GESTALT_SQUARES = {
	product_name: 'Twinkly',
	product_code: 'TWQ064STW',
	device_name: 'Squares',
	fw_family: 'T',
	number_of_led: 768,
	max_movies: 55,
	mac: 'c4:de:e2:ce:39:49',
	code: 1000,
}
const MODE_PLAYLIST = {
	mode: 'playlist',
	detect_mode: 0,
	shop_mode: 0,
	movie: { id: 0, unique_id: '528F5967-C23E-4795-A014-08E360FE4B5A', name: 'Enchanted', duration: 30 },
	name: 'Playlist',
	unique_id: 'C51A514A-75C4-0524-A8B0-BDFB77626993',
	code: 1000,
}
const MODE_MOVIE = { mode: 'movie', detect_mode: 0, shop_mode: 0, name: 'Liquified', code: 1000 }
const MODE_EFFECT = { mode: 'effect', detect_mode: 0, shop_mode: 0, code: 1000 }
const PLAYLIST = {
	unique_id: 'C51A514A-75C4-0524-A8B0-BDFB77626993',
	name: 'Playlist',
	entries: [{ id: 0, handle: 39, name: 'Enchanted', unique_id: '528F5967-C23E-4795-A014-08E360FE4B5A', duration: 30 }],
	code: 1000,
}
const EMPTY_PLAYLIST = { unique_id: '00000000-0000-0000-0000-000000000000', name: '', entries: [], code: 1000 }

test('consumer responses use a top-level code', () => {
	assert.equal(parseGestalt(GESTALT_SQUARES).productCode, 'TWQ064STW')
	assert.equal(parseGestalt(GESTALT_SQUARES).groupRole, 'none')
	assert.throws(() => parseMode({ mode: 'movie', code: 1104 }), RestResponseError)
})

test('consumer modes: playlist, movie (name only), built-in effect', () => {
	assert.deepEqual(parseMode(MODE_PLAYLIST), {
		mode: 'playlist',
		effectName: 'Enchanted',
		effectUuid: '528F5967-C23E-4795-A014-08E360FE4B5A',
		playlistName: 'Playlist',
		playlistUuid: 'C51A514A-75C4-0524-A8B0-BDFB77626993',
	})
	assert.equal(parseMode(MODE_MOVIE).effectName, 'Liquified')
	assert.equal(parseMode(MODE_MOVIE).effectUuid, '')
	assert.equal(parseMode(MODE_EFFECT).mode, 'effect')
	assert.equal(parseMode({ mode: 'color', code: 1000 }).mode, 'color')
})

test('consumer single playlist becomes a one-entry list, or none when empty', () => {
	assert.deepEqual(parseConsumerPlaylist(PLAYLIST), [
		{ index: 0, name: 'Playlist', uuid: 'C51A514A-75C4-0524-A8B0-BDFB77626993' },
	])
	assert.deepEqual(parseConsumerPlaylist(EMPTY_PLAYLIST), [])
})

test('consumer movie list parses like PRO', () => {
	const movies = parseMovies({
		movies: [{ id: 2, name: 'Ice Echo', unique_id: '166CE4FD-8204-4C8F-951B-159CDC78470A' }],
		code: 1000,
	})
	assert.deepEqual(movies, [{ handle: 2, name: 'Ice Echo', uuid: '166CE4FD-8204-4C8F-951B-159CDC78470A' }])
})

/** Fake consumer light: /xled/v1 only, records every POST. */
function fakeConsumer() {
	const state = { posts: [], token: '' }
	const server = http.createServer((req, res) => {
		let body = ''
		req.on('data', (c) => (body += c))
		req.on('end', () => {
			const send = (status, obj) => {
				res.writeHead(status, { 'Content-Type': 'application/json' })
				res.end(JSON.stringify(obj))
			}
			const path = req.url.replace(/^\/xled\/v1\//, '')
			if (!req.url.startsWith('/xled/v1/')) return send(404, { code: 1104 })
			if (path === 'gestalt') return send(200, GESTALT_SQUARES)
			if (path === 'login') {
				state.token = 'ctok'
				return send(200, {
					authentication_token: 'ctok',
					authentication_token_expires_in: 14400,
					'challenge-response': 'r',
					code: 1000,
				})
			}
			if (path === 'verify') return send(200, { code: 1000 })
			if (req.headers['x-auth-token'] !== state.token) return send(401, { code: 1104 })
			if (req.method === 'POST') {
				state.posts.push([path, JSON.parse(body)])
				return send(200, { code: 1000 })
			}
			if (path === 'led/mode') return send(200, MODE_PLAYLIST)
			if (path === 'playlist') return send(200, PLAYLIST)
			if (path === 'led/effects') return send(200, { code: 1000, effects_number: 5, unique_ids: [] })
			return send(404, { code: 1104 })
		})
	})
	return new Promise((resolve) =>
		server.listen(0, '127.0.0.1', () => resolve({ server, state, host: `127.0.0.1:${server.address().port}` })),
	)
}

test('detects a consumer light from which API version answers', async () => {
	const { server, host } = await fakeConsumer()
	try {
		const { family, gestalt } = await detectFamily(host, 1000)
		assert.equal(family, 'consumer')
		assert.equal(gestalt.deviceName, 'Squares')
	} finally {
		server.close()
	}
})

test('consumer client sends the consumer command sequence', async () => {
	const { server, state, host } = await fakeConsumer()
	try {
		const c = new TwinklyRestClient(host, { family: 'consumer', timeoutMs: 1000 })
		assert.equal((await c.getMode()).playlistName, 'Playlist')
		assert.deepEqual(await c.getPlaylists(), [
			{ index: 0, name: 'Playlist', uuid: 'C51A514A-75C4-0524-A8B0-BDFB77626993' },
		])
		assert.equal(await c.getBuiltinEffectCount(), 5)
		await c.off()
		await c.playMovie({ handle: 3 })
		await c.playMovie({ uuid: 'ABC' })
		await c.startPlaylist({ index: 0, name: 'Playlist', uuid: 'C51A514A' })
		await c.playBuiltinEffect(2)
		await c.setBrightness({ mode: 'enabled', type: 'A', value: 10 })
		assert.deepEqual(state.posts, [
			['led/mode', { mode: 'off' }],
			['movies/current', { id: 3 }],
			['led/mode', { mode: 'movie' }],
			['movies/current', { unique_id: 'ABC' }],
			['led/mode', { mode: 'movie' }],
			['led/mode', { mode: 'playlist' }],
			['led/effects/current', { effect_id: 2 }],
			['led/mode', { mode: 'effect' }],
			['led/out/brightness', { mode: 'enabled', type: 'A', value: 10 }],
		])
	} finally {
		server.close()
	}
})

test('consumer lights refuse a solid colour instead of guessing at an untested call', async () => {
	const { server, state, host } = await fakeConsumer()
	try {
		const c = new TwinklyRestClient(host, { family: 'consumer', timeoutMs: 1000 })
		await assert.rejects(c.setColor({ red: 1, green: 2, blue: 3 }), /only supported on Twinkly Pro/)
		assert.deepEqual(state.posts, [])
	} finally {
		server.close()
	}
})

test('with a known family, detection only tries that API but still returns device info', async () => {
	const { server, host } = await fakeConsumer()
	try {
		const { family, gestalt } = await detectFamily(host, 1000, ['consumer'])
		assert.equal(family, 'consumer')
		assert.equal(gestalt.productCode, 'TWQ064STW')
		await assert.rejects(detectFamily(host, 1000, ['pro']), /Not a Twinkly controller/)
	} finally {
		server.close()
	}
})
