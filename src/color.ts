/** A solid color, each channel 0-255. */
export interface RgbColor {
	readonly red: number
	readonly green: number
	readonly blue: number
}

const BYTE_MAX = 255
const BITS_PER_BYTE = 8
const LIGHT_TEXT_THRESHOLD = 150
const BLACK = 0x000000
const WHITE = 0xffffff

export const clampByte = (n: number): number => Math.min(BYTE_MAX, Math.max(0, Math.round(n)))

/** Companion color pickers give a 0xRRGGBB number. Anything above 24 bits is ignored. */
export function rgbFromNumber(n: number): RgbColor {
	const value = Number.isFinite(n) ? Math.trunc(n) : 0
	return {
		red: (value >> (BITS_PER_BYTE * 2)) & BYTE_MAX,
		green: (value >> BITS_PER_BYTE) & BYTE_MAX,
		blue: value & BYTE_MAX,
	}
}

export const colorToNumber = (c: RgbColor): number =>
	(c.red << (BITS_PER_BYTE * 2)) | (c.green << BITS_PER_BYTE) | c.blue

/** Lowercase RRGGBB, for variables and logs. */
export const colorHex = (c: RgbColor): string =>
	[c.red, c.green, c.blue].map((v) => v.toString(16).padStart(2, '0')).join('')

export const sameColor = (a: RgbColor | null, b: RgbColor | null): boolean =>
	a !== null && b !== null && a.red === b.red && a.green === b.green && a.blue === b.blue

/** Black or white, whichever is easier to read on this background. */
export function contrastText(background: RgbColor): number {
	const luminance = 0.299 * background.red + 0.587 * background.green + 0.114 * background.blue
	return luminance > LIGHT_TEXT_THRESHOLD ? BLACK : WHITE
}

export interface ColorPreset {
	readonly id: string
	readonly label: string
	readonly color: RgbColor
}

/**
 * In rainbow order, then whites. Tuned by eye on Twinkly Pro pixels, whose green channel looks strong: the
 * warm colors carry far less green, and the whites lean away from green, than the textbook RGB values.
 */
export const COLOR_PRESETS: readonly ColorPreset[] = [
	{ id: 'red', label: 'Red', color: { red: 255, green: 0, blue: 0 } },
	{ id: 'orange', label: 'Orange', color: { red: 255, green: 25, blue: 0 } },
	{ id: 'amber', label: 'Amber', color: { red: 255, green: 48, blue: 0 } },
	{ id: 'gold', label: 'Gold', color: { red: 255, green: 70, blue: 0 } },
	{ id: 'yellow', label: 'Yellow', color: { red: 255, green: 130, blue: 0 } },
	{ id: 'lime', label: 'Lime', color: { red: 120, green: 255, blue: 0 } },
	{ id: 'green', label: 'Green', color: { red: 0, green: 255, blue: 0 } },
	{ id: 'mint', label: 'Mint', color: { red: 0, green: 255, blue: 40 } },
	{ id: 'cyan', label: 'Cyan', color: { red: 0, green: 255, blue: 255 } },
	{ id: 'sky_blue', label: 'Sky blue', color: { red: 0, green: 60, blue: 255 } },
	{ id: 'blue', label: 'Blue', color: { red: 0, green: 0, blue: 255 } },
	{ id: 'indigo', label: 'Indigo', color: { red: 64, green: 0, blue: 255 } },
	{ id: 'purple', label: 'Purple', color: { red: 100, green: 0, blue: 255 } },
	{ id: 'lavender', label: 'Lavender', color: { red: 150, green: 40, blue: 255 } },
	{ id: 'magenta', label: 'Magenta', color: { red: 255, green: 0, blue: 255 } },
	{ id: 'pink', label: 'Pink', color: { red: 255, green: 30, blue: 110 } },
	{ id: 'warm_white', label: 'Warm white', color: { red: 255, green: 110, blue: 30 } },
	{ id: 'cool_white', label: 'Cool white', color: { red: 130, green: 140, blue: 255 } },
	{ id: 'white', label: 'White', color: { red: 255, green: 255, blue: 255 } },
]
