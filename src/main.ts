import dgram from 'node:dgram'
import { InstanceBase, InstanceStatus, type SomeCompanionConfigField } from '@companion-module/base'
import { GetConfigFields, type ModuleConfig } from './config.js'
import { UpdateVariableDefinitions, UpdateVariableValues, type VariablesSchema } from './variables.js'
import { UpgradeScripts } from './upgrades.js'
import { UpdateActions, type ActionsSchema } from './actions.js'
import { UpdateFeedbacks, type FeedbacksSchema } from './feedbacks.js'
import { UpdatePresets } from './presets.js'
import { encodeOscMessage, type OscArg } from './osc.js'
import { buildAddress, DEFAULT_OSC_PORT, deviceId, type TargetConfig } from './twinkly.js'
import { initialState, type AssumedState } from './state.js'

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

	private socket: dgram.Socket | undefined

	constructor(internal: unknown) {
		super(internal)
	}

	async init(config: ModuleConfig): Promise<void> {
		this.config = config

		this.updateActions()
		this.updateFeedbacks()
		this.updatePresets()
		this.updateVariableDefinitions()
		this.refreshState()

		await this.openSocket()
	}

	async destroy(): Promise<void> {
		this.closeSocket()
		this.log('debug', 'destroy')
	}

	async configUpdated(config: ModuleConfig): Promise<void> {
		this.config = config
		this.refreshState()
		await this.openSocket()
	}

	getConfigFields(): SomeCompanionConfigField[] {
		return GetConfigFields()
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
				this.updateStatus(InstanceStatus.ConnectionFailure, err.message)
			}
		})
		return true
	}

	/** Update the assumed state and refresh variables and feedbacks. */
	setState(patch: Partial<AssumedState>): void {
		this.state = { ...this.state, ...patch }
		this.refreshState()
	}

	private refreshState(): void {
		UpdateVariableValues(this)
		this.checkFeedbacks('mode_is', 'effect_is', 'brightness_is')
	}

	private async openSocket(): Promise<void> {
		this.closeSocket()

		if (!this.config.host) {
			this.updateStatus(InstanceStatus.BadConfig, 'No target IP set')
			return
		}

		const socket = dgram.createSocket('udp4')
		this.socket = socket
		socket.on('error', (err) => {
			this.log('error', `UDP socket error: ${err.message}`)
			this.updateStatus(InstanceStatus.ConnectionFailure, err.message)
		})

		await new Promise<void>((resolve) => {
			socket.bind(0, () => {
				try {
					socket.setBroadcast(true) // needed for subnet-broadcast targets
				} catch (e) {
					this.log('warn', `Could not enable broadcast: ${String(e)}`)
				}
				resolve()
			})
		})

		// UDP is connectionless and controllers never reply, so "Ok" only means we can transmit.
		this.updateStatus(InstanceStatus.Ok)
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
