import type ModuleInstance from './main.js'

export type VariablesSchema = {
	mode: string
	effect: string
	brightness: string
	brightness_filter: string
	target: string
	discovered_devices: string
}

export function UpdateVariableDefinitions(self: ModuleInstance): void {
	self.setVariableDefinitions({
		mode: { name: 'Last commanded mode (off / movie / playlist)' },
		effect: { name: 'Last commanded effect (handle or UUID)' },
		brightness: { name: 'Last commanded brightness (%)' },
		brightness_filter: { name: 'Last commanded brightness filter (enabled / disabled)' },
		target: { name: 'Default OSC target (device ID or wildcard)' },
		discovered_devices: { name: 'Devices found by the experimental scan' },
	})
}

export function UpdateVariableValues(self: ModuleInstance): void {
	const s = self.state
	self.setVariableValues({
		mode: s.mode,
		effect: s.effect,
		brightness: s.brightness === null ? '' : String(s.brightness),
		brightness_filter: s.brightnessFilter,
		target: self.defaultDeviceId() ?? 'invalid',
	})
}
