import type ModuleInstance from './main.js'

export type VariablesSchema = {
	mode: string
	effect: string
	effect_name: string
	playlist_name: string
	state_source: string
	brightness: string
	brightness_filter: string
	target: string
	discovered_devices: string
	device_name: string
	device_type: string
}

export function UpdateVariableDefinitions(self: ModuleInstance): void {
	self.setVariableDefinitions({
		mode: { name: 'Mode (off / movie / playlist)' },
		effect: { name: 'Effect handle (or UUID if not in the list)' },
		effect_name: { name: 'Effect name (needs a controller IP)' },
		playlist_name: { name: 'Playlist name (needs a controller IP)' },
		state_source: { name: 'Where state comes from: controller (read back) or assumed (last command sent)' },
		brightness: { name: 'Brightness (%)' },
		brightness_filter: { name: 'Brightness filter (enabled / disabled)' },
		target: { name: 'Default OSC target (device ID or wildcard)' },
		discovered_devices: { name: 'Devices found by the scan' },
		device_name: { name: 'Device name, as set in the Twinkly app (needs a controller IP)' },
		device_type: { name: 'Device type: Twinkly Pro or Twinkly, plus model code' },
	})
}

function deviceTypeLabel(family: 'pro' | 'consumer' | null, productCode: string): string {
	if (!family) return ''
	const name = family === 'pro' ? 'Twinkly Pro' : 'Twinkly'
	return productCode ? `${name} ${productCode}` : name
}

export function UpdateVariableValues(self: ModuleInstance): void {
	const s = self.state
	self.setVariableValues({
		mode: s.mode,
		effect: s.effect,
		effect_name: s.effectName,
		playlist_name: s.playlistName,
		state_source: s.source,
		brightness: s.brightness === null ? '' : String(s.brightness),
		brightness_filter: s.brightnessFilter,
		target: self.defaultDeviceId() ?? 'invalid',
		device_name: self.device?.deviceName ?? '',
		device_type: deviceTypeLabel(self.deviceFamily, self.device?.productCode ?? ''),
	})
}
