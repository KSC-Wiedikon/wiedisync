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
    '.claude/**',
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
  // UI alignment guard rails (/kscw-ui → "Reviewer checklist"). `warn` while the
  // full sweep migrates the app; flip to `error` once `npm run lint` is clean.
  {
    files: ['src/**/*.tsx'],
    rules: {
      'no-restricted-syntax': ['warn',
        {
          // Cut-off text must carry its full value (TruncatedText does it for you).
          selector: "JSXOpeningElement:not(:has(JSXAttribute[name.name='title'])) > JSXAttribute[name.name='className'] Literal[value=/(^|\\s)truncate(\\s|$)/]",
          message: 'truncate without title — use <TruncatedText> or add title={fullText}.',
        },
        {
          selector: "JSXOpeningElement:not(:has(JSXAttribute[name.name='title'])) > JSXAttribute[name.name='className'] TemplateElement[value.raw=/(^|\\s)truncate(\\s|$)/]",
          message: 'truncate without title — use <TruncatedText> or add title={fullText}.',
        },
        {
          // A wrapped action group lands on the LEFT — use a toolbar line (ActivityRow `tools`).
          selector: "JSXAttribute[name.name='className'] Literal[value=/flex-wrap[^\"]*justify-between|justify-between[^\"]*flex-wrap/]",
          message: 'flex-wrap + justify-between: a wrapped group jumps left. Put actions on their own line (ActivityRow tools) or use a non-wrapping row with shrink-0.',
        },
        {
          // Hand-rolled icon buttons come out 32px and unlabeled.
          selector: "JSXOpeningElement[name.name='button'] > JSXAttribute[name.name='className'] Literal[value=/(^|\\s)rounded(-md|-lg)? p-(1|1\\.5|2)(\\s|$)/]",
          message: 'Hand-rolled icon button — use <IconButton label=…> (44px touch / 36px sm+).',
        },
      ],
    },
  },
])
