import { fixupConfigRules, fixupPluginRules } from '@eslint/compat'
import typescriptEslint from '@typescript-eslint/eslint-plugin'
import unusedImports from 'eslint-plugin-unused-imports'
import tsParser from '@typescript-eslint/parser'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import js from '@eslint/js'
import { FlatCompat } from '@eslint/eslintrc'

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const compat = new FlatCompat({
	baseDirectory: __dirname,
	recommendedConfig: js.configs.recommended,
	allConfig: js.configs.all
})

export default [
	...fixupConfigRules(
		compat.extends(
			'eslint:recommended',
			'plugin:@typescript-eslint/recommended',
			'prettier',
			'plugin:import/recommended'
		)
	),
	{
		plugins: {
			'@typescript-eslint': fixupPluginRules(typescriptEslint),
			'unused-imports': unusedImports
		},

		languageOptions: {
			parser: tsParser
		},

		rules: {
			semi: ['error', 'never'],

			quotes: [
				'error',
				'single',
				{
					allowTemplateLiterals: true
				}
			],

			'jsx-quotes': ['error', 'prefer-single'],
			'@typescript-eslint/no-unused-vars': 'warn',
			'unused-imports/no-unused-imports': 'warn',
			'import/no-unresolved': 'off'
		}
	},
	{
		files: ['**/*.tsx'],

		rules: {
			quotes: ['error', 'single'],
			'jsx-quotes': ['error', 'prefer-single']
		}
	}
]
