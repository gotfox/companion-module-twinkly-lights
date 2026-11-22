import { generateEslintConfig } from '@companion-module/tools/eslint/config.mjs'

const config = await generateEslintConfig({
	enableTypescript: true,
})

// Tests run against the compiled output and are not part of the shipped module
export default [{ ignores: ['test/**'] }, ...config]
