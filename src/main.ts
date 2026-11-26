import dgram from 'node:dgram'
import { InstanceBase, InstanceStatus, type SomeCompanionConfigField } from '@companion-module/base'
import { GetConfigFields, isUnicastHost, withDefaults, type ModuleConfig } from './config.js'
import { UpdateVariableDefinitions, UpdateVariableValues, type VariablesSchema } from './variables.js'
import { UpgradeScripts } from './upgrades.js'
import { UpdateActions, type ActionsSchema } from './actions.js'
import { UpdateFeedbacks, type FeedbacksSchema } from './feedbacks.js'
import { UpdatePresets } from './presets.js'
import { encodeOscMessage, type OscArg } from './osc.js'
import { buildAddress, DEFAULT_OSC_PORT, deviceId, type TargetConfig } from './twinkly.js'
import { initialState, type AssumedState } from './state.js'
import { Fader } from './fade.js'
import {
	OscController,
	RestController,
	UnavailableController,
	type ContentCache,
	type Controller,
	type Logger,
} from './controller.js'
import { detectFamily, type DeviceFamily } from './rest.js'
import { discover } from './scan.js'
import { interfaceBroadcastAddresses } from './discovery.js'
import { hostChoices } from './host-choices.js'
import {
	applyDiscoveredSelection,
	discoveredChoices,
	MANUAL_CHOICE,
	toDiscoveredList,
	type DiscoveredController,
} from './discovered.js'
import type { Gestalt } from './rest-parse.js'

/** How often the background scan for the "Discovered device" dropdown runs */
const DISCOVERY_INTERVAL_MS = 5 * 60_000
/** While the controller can't be reached, try to detect it again this often */
const DETECT_RETRY_MS = 10_000
import { LiveConnection, type LiveHost } from './live.js'

export type ModuleSchema = {
	config: ModuleConfig
	secrets: undefined
	actions: ActionsSchema
	feedbacks: FeedbacksSchema
	variables: VariablesSchema
}

export { UpgradeScripts }

export default class ModuleInstance extends InstanceBase<ModuleSchema> {
	config!: ModuleConfig // Setup in init()
	state: AssumedState = initialState()
	/** Runs the brightness and colour fades (the controller has no fade command) */
	readonly fader = new Fader()

	private socket: dgram.Socket | undefined
	private live: LiveConnection | null = null
	private readonly quietLogger: Logger = (level, msg) => this.logUnlessQuiet(level, msg)
	controller: Controller = new OscController(this, this.quietLogger)
	/** What the device reported about itself (null until detected, or when the family is set by hand) */
	device: Gestalt | null = null
	deviceFamily: DeviceFamily | null = null
	private notReadyReason = ''
	private lastDetectError = ''
	private retryTimer: NodeJS.Timeout | undefined
	private discoveryTimer: NodeJS.Timeout | undefined
	private discoveredList: DiscoveredController[] = []
	private destroyed = false
	/** Bumped on every config change and on destroy, so setup still in flight can tell it is stale */
	private generation = 0
	private lastStatus = ''

	constructor(internal: unknown) {
		super(internal)
	}

	/** Effect and playlist lists from the controller, when a controller IP is set */
	get content(): ContentCache | null {
		return this.live?.content ?? null
	}

	async init(config: ModuleConfig): Promise<void> {
		this.config = withDefaults(config)

		this.updateActions()
		this.updateFeedbacks()
		this.updatePresets()
		this.updateVariableDefinitions()
		this.refreshState()

		this.scheduleDiscovery(0)
		await this.applyConfig()
	}

	/** Fill in settings from the device picked in the "Discovered device" dropdown, and save them. */
	private withDiscoveredApplied(config: ModuleConfig): ModuleConfig {
		const next = applyDiscoveredSelection(config, this.discoveredList)
		if (!next) return config
		this.saveConfig(next, undefined)
		return next
	}

	/** Background scan so the config dropdown has devices to offer and IP changes are noticed. */
	private scheduleDiscovery(delayMs: number): void {
		clearTimeout(this.discoveryTimer)
		this.discoveryTimer = setTimeout(() => void this.backgroundDiscovery(), delayMs)
	}

	private async backgroundDiscovery(): Promise<void> {
		const { described } = await discover(this.config.host)
		if (this.destroyed) return
		this.setDiscovered(described)
		this.scheduleDiscovery(DISCOVERY_INTERVAL_MS)
	}

	/** Record scan results; if the selected device moved to a new IP, follow it. */
	setDiscovered(described: Parameters<typeof toDiscoveredList>[0]): void {
		this.discoveredList = toDiscoveredList(described)
		const next = applyDiscoveredSelection(this.config, this.discoveredList)
		if (!next) return
		if (next.host !== this.config.host)
			this.log('info', `Selected device is now at ${next.host}; updating the connection`)
		this.config = next
		this.saveConfig(next, undefined)
		void this.applyConfig()
	}

	async destroy(): Promise<void> {
		this.destroyed = true
		this.fader.cancelAll()
		clearTimeout(this.discoveryTimer)
		this.generation++
		clearTimeout(this.retryTimer)
		this.live?.stop()
		this.live = null
		this.closeSocket()
		this.log('debug', 'destroy')
	}

	async configUpdated(config: ModuleConfig): Promise<void> {
		this.config = this.withDiscoveredApplied(withDefaults(config))
		this.state = initialState()
		this.refreshState()
		await this.applyConfig()
	}

	/** (Re)build transports, the active controller and state reading from the current config. */
	private async applyConfig(): Promise<void> {
		const generation = ++this.generation
		clearTimeout(this.retryTimer)
		this.live?.stop()
		this.live = null
		this.device = null
		this.notReadyReason = 'still connecting to the controller'
		this.controller =
			this.config.method === 'osc'
				? new OscController(this, this.quietLogger)
				: new UnavailableController(() => this.notReadyReason, this.quietLogger)

		await this.openSocket(generation) // also used by "Send raw OSC" in REST mode
		if (generation !== this.generation) return

		if (!isUnicastHost(this.config.host)) {
			if (this.config.method === 'rest') {
				this.notReadyReason = 'REST needs a controller IP, not a broadcast address'
				this.setStatus(InstanceStatus.BadConfig, this.notReadyReason)
			}
			return
		}
		if (this.config.method === 'rest') this.setStatus(InstanceStatus.Connecting)
		await this.connectLive(generation)
	}

	/** Find out what the device is, then start talking to it over REST. Retries while it is unreachable. */
	private async connectLive(generation: number): Promise<void> {
		let family: DeviceFamily
		try {
			// Even when the type is set, read gestalt: it gives the device's name and model
			const families: DeviceFamily[] = this.config.family === 'auto' ? ['pro', 'consumer'] : [this.config.family]
			const found = await detectFamily(this.config.host, undefined, families)
			family = found.family
			this.device = found.gestalt
		} catch (e) {
			if (generation !== this.generation) return
			this.onDetectFailed(generation, e instanceof Error ? e.message : String(e))
			return
		}
		if (generation !== this.generation) return
		this.lastDetectError = ''
		this.deviceFamily = family
		UpdateVariableValues(this)

		const live = new LiveConnection(this.config.host, family, this.liveHost(generation), this.config.pollInterval)
		this.live = live
		if (this.config.method === 'osc' && family === 'consumer') {
			this.notReadyReason = 'Twinkly lights have no OSC (only Twinkly Pro does); set Control method to REST'
			this.controller = new UnavailableController(() => this.notReadyReason, this.quietLogger)
			this.setStatus(InstanceStatus.BadConfig, this.notReadyReason)
		} else if (this.config.method === 'rest') {
			this.controller = new RestController(live.client, live.content, this.quietLogger, () => live.requestSoon())
		}

		await live.start()
		// Without polling nothing else checks the controller, so judge REST by whether the lists loaded
		if (generation === this.generation && !live.polling && this.config.method === 'rest') {
			// A device with nothing uploaded still answers with empty lists, so judge by the answer, not the content
			const reachable = live.content.reachable
			this.setStatus(
				reachable ? InstanceStatus.Ok : InstanceStatus.ConnectionFailure,
				reachable ? undefined : 'Could not read from the controller',
			)
		}
	}

	private onDetectFailed(generation: number, message: string): void {
		if (message !== this.lastDetectError) this.log('warn', `Could not reach the controller: ${message}`)
		this.lastDetectError = message
		this.notReadyReason = `controller not reachable (${message})`
		if (this.config.method === 'rest') this.setStatus(InstanceStatus.ConnectionFailure, 'Controller not reachable')
		this.retryTimer = setTimeout(() => {
			if (generation === this.generation) void this.connectLive(generation)
		}, DETECT_RETRY_MS)
	}

	/** Callbacks for one LiveConnection; ignored once a newer config has replaced it. */
	private liveHost(generation: number): LiveHost {
		const current = (): boolean => generation === this.generation
		return {
			log: (level, message) => current() && this.log(level, message),
			onState: (state) => {
				if (!current()) return
				this.state = state
				this.refreshState()
				this.setStatus(InstanceStatus.Ok)
			},
			onReadError: (message) => {
				if (!current()) return
				this.log('warn', `Could not read state: ${message}`)
				// Values may now be stale: let local updates show again until the controller answers
				this.state = { ...this.state, source: 'assumed' }
				this.refreshState()
				// With OSC, commands still go out without REST; only flag the connection when REST is the control path
				if (this.config.method === 'rest') this.setStatus(InstanceStatus.ConnectionFailure, message)
			},
			onReadRecovered: () => current() && this.log('info', 'Reading state from the controller again'),
			onContentChanged: () => {
				if (!current()) return
				this.updateActions()
				this.updatePresets()
				this.refreshState() // playlist_is depends on the playlist list
			},
		}
	}

	/** Report status only when it changes; polling would otherwise log "Status: ok" every interval. */
	private setStatus(status: InstanceStatus, message?: string): void {
		const key = `${status}|${message ?? ''}`
		if (key === this.lastStatus) return
		this.lastStatus = key
		this.updateStatus(status, message)
	}

	/** Debug lines (each command sent) only appear when "Log every command sent" is on. */
	private logUnlessQuiet(level: 'info' | 'warn' | 'error' | 'debug', message: string): void {
		if (level !== 'debug' || this.config.verbose) this.log(level, message)
	}

	/** True when state comes from the controller, so local guesses must not overwrite it. */
	get stateIsLive(): boolean {
		return this.state.source === 'controller' && this.live?.polling === true
	}

	getConfigFields(): SomeCompanionConfigField[] {
		const broadcasts = interfaceBroadcastAddresses()
		return GetConfigFields(discoveredChoices(this.discoveredList, this.config?.discovered ?? MANUAL_CHOICE), {
			osc: hostChoices(this.discoveredList, 'osc', broadcasts, this.config?.hostOsc ?? ''),
			rest: hostChoices(this.discoveredList, 'rest', broadcasts, this.config?.hostRest ?? ''),
		})
	}

	/** Device ID segment for the configured default target, or null if the config is incomplete. */
	defaultDeviceId(): string | null {
		return deviceId(this.config)
	}

	/** Resolve the device ID for an action, honouring its per-action target override. */
	resolveDeviceId(override?: { target?: string; productType?: string; mac?: string }): string | null {
		if (!override || !override.target || override.target === 'default') return this.defaultDeviceId()
		return deviceId({
			targetMode: override.target as TargetConfig['targetMode'],
			productType: (override.productType ?? this.config.productType) as TargetConfig['productType'],
			mac: override.mac ?? this.config.mac,
		})
	}

	/**
	 * Send an OSC message to `/v1/<device_id>/<path>`.
	 * Returns true if the datagram was handed to the socket.
	 */
	sendCommand(id: string | null, path: string, args: OscArg[]): boolean {
		if (!id) {
			this.log('warn', 'Not sending: target controller is not fully configured (check the MAC address)')
			return false
		}
		return this.sendRaw(buildAddress(id, path), args)
	}

	sendRaw(address: string, args: OscArg[]): boolean {
		if (!this.socket) {
			this.log('warn', 'Not sending: UDP socket is not open')
			return false
		}
		let packet: Buffer
		try {
			packet = encodeOscMessage(address, args)
		} catch (e) {
			this.log('error', `Could not encode OSC message: ${String(e)}`)
			return false
		}
		const port = this.config.port || DEFAULT_OSC_PORT
		if (this.config.verbose) {
			this.log(
				'debug',
				`OSC -> ${this.config.host}:${port} ${address} ${args.map((a) => `${a.type}:${a.value}`).join(' ')}`,
			)
		}
		this.socket.send(packet, port, this.config.host, (err) => {
			if (err) {
				this.log('error', `UDP send failed: ${err.message}`)
				this.setStatus(InstanceStatus.ConnectionFailure, err.message)
			}
		})
		return true
	}

	/** Record what a command just did. Ignored when polling reports the real state (it re-reads shortly). */
	setState(patch: Partial<AssumedState>): void {
		if (this.stateIsLive) {
			this.live?.requestSoon()
			return
		}
		this.state = { ...this.state, ...patch, source: 'assumed' }
		this.refreshState()
	}

	private refreshState(): void {
		UpdateVariableValues(this)
		this.checkFeedbacks('mode_is', 'effect_is', 'brightness_is', 'playlist_is', 'color_is')
	}

	private async openSocket(generation: number): Promise<void> {
		this.closeSocket()

		if (!this.config.host) {
			this.setStatus(InstanceStatus.BadConfig, 'No target IP set')
			return
		}

		const socket = dgram.createSocket('udp4')
		this.socket = socket
		socket.on('error', (err) => {
			this.log('error', `UDP socket error: ${err.message}`)
			this.setStatus(InstanceStatus.ConnectionFailure, err.message)
		})

		// Also resolve if the socket is closed (e.g. a newer config) before bind completes, so we never hang
		await new Promise<void>((resolve) => {
			socket.once('close', resolve)
			socket.bind(0, () => {
				try {
					socket.setBroadcast(true) // needed for subnet-broadcast targets
				} catch (e) {
					this.log('warn', `Could not enable broadcast: ${String(e)}`)
				}
				resolve()
			})
		})

		if (generation !== this.generation || this.socket !== socket) return
		// UDP is connectionless and OSC gets no replies, so "Ok" only means we can transmit.
		// In REST mode the status comes from the REST requests instead.
		if (this.config.method === 'osc') this.setStatus(InstanceStatus.Ok)
	}

	private closeSocket(): void {
		if (!this.socket) return
		try {
			this.socket.close()
		} catch {
			// already closed
		}
		this.socket = undefined
	}

	updateActions(): void {
		UpdateActions(this)
	}

	updateFeedbacks(): void {
		UpdateFeedbacks(this)
	}

	updatePresets(): void {
		UpdatePresets(this)
	}

	updateVariableDefinitions(): void {
		UpdateVariableDefinitions(this)
	}
}
