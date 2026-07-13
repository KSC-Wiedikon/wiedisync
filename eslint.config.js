import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'
import { defineConfig, globalIgnores } from 'eslint/config'

export default defineConfig([
  // Vendored UI catalogs (Aceternity, Magic UI, shadcn primitives) are third-party
  // source we install and don't author — they ship a deliberate `@ts-nocheck` and
  // their own hook idioms. Our own wrappers in src/components/*.tsx stay linted.
  globalIgnores([
    'dist',
    'src/components/aceternity/**',
    'src/components/magicui/**',
    'src/components/ui/**',
  ]),
  {
    files: ['**/*.{ts,tsx}'],
    extends: [
      js.configs.recommended,
      tseslint.configs.recommended,
      reactHooks.configs.flat.recommended,
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
    },
  },
])
