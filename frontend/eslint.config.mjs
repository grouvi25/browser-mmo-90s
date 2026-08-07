// =============================================================
// Правила статического анализа фронтенда.
//
// Проверки без типовой информации — типы закрывает отдельный шаг
// `tsc --noEmit`. Главная ценность здесь — правила хуков: они ловят
// то, что компилятор не видит (порядок вызовов, забытые зависимости).
// =============================================================
import js from '@eslint/js'
import globals from 'globals'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'playwright-report/**', 'test-results/**'] },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'smart'],
      'no-var': 'error',
      'prefer-const': 'error',
    },
  },

  {
    // Playwright-сценарии исполняются в Node, а не в браузере.
    files: ['tests/**/*.ts', '*.config.ts'],
    languageOptions: { globals: { ...globals.node } },
    // ({}, testInfo) — идиома фикстур Playwright
    rules: { 'no-empty-pattern': 'off' },
  },
)
