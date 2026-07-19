import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    name: 'integration',
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
