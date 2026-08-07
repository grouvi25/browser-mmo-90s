// =============================================================
// Правила статического анализа бэкенда.
//
// Проверки без типовой информации: они быстрые и не требуют
// поднимать TS-программу в CI. Типы и так проверяются отдельным
// шагом `tsc --noEmit`, дублировать его линтером незачем.
// =============================================================
import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'

export default tseslint.config(
  {
    ignores: [
      'dist/**', 'coverage/**', 'node_modules/**', 'prisma/generated/**',
      // нагрузочный сценарий исполняет k6 со своими глобалями (__ENV, __VU),
      // а не Node — линтовать его нашими правилами бессмысленно
      'src/tests/load/**',
    ],
  },

  js.configs.recommended,
  ...tseslint.configs.recommended,

  {
    files: ['**/*.ts'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.node },
    },
    rules: {
      // Неиспользованное — ошибка, но подчёркнутый префикс разрешает
      // намеренно опущенные аргументы и переменные.
      '@typescript-eslint/no-unused-vars': ['error', {
        argsIgnorePattern: '^_',
        varsIgnorePattern: '^_',
        caughtErrorsIgnorePattern: '^_',
      }],
      // any в проекте местами осознан (Prisma Json, внешние ответы),
      // поэтому предупреждение, а не блокировка сборки.
      '@typescript-eslint/no-explicit-any': 'warn',
      'no-console': ['warn', { allow: ['warn', 'error'] }],
      eqeqeq: ['error', 'smart'],
      'no-var': 'error',
      'prefer-const': 'error',
    },
  },

  {
    // Тесты, сиды и скрипты печатают в консоль по назначению.
    files: ['src/tests/**/*.ts', 'prisma/**/*.ts', 'scripts/**/*.ts', 'src/scripts/**/*.ts'],
    rules: { 'no-console': 'off' },
  },
)
