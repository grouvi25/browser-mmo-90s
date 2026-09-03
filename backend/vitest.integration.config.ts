import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    name: 'integration',
    // Интеграционные тесты чистят базу целиком (cleanDatabase), поэтому
    // им нужна своя. Без TEST_DATABASE_URL всё работает как раньше — по
    // DATABASE_URL, — и CI не меняется; локально переменная уводит прогон
    // на mmo90s_test, и рабочая база с сидом остаётся целой.
    env: {
      DATABASE_URL: process.env.TEST_DATABASE_URL ?? process.env.DATABASE_URL ?? '',
    },
    include: ['src/tests/integration/**/*.test.ts'],
    environment: 'node',
    globals: true,
    // Run integration tests sequentially to avoid DB conflicts
    pool: 'forks',
    poolOptions: {
      forks: { singleFork: true },
    },
    // Longer timeouts for DB operations
    testTimeout: 30_000,
    hookTimeout: 30_000,
    reporters: ['verbose'],
    // Each integration test gets a fresh setup
    sequence: {
      shuffle: false,
    },
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
})
