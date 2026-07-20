import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    name: 'e2e',
    include: ['src/tests/e2e/**/*.test.ts'],
    environment: 'node',
    globals: true,
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } },
    testTimeout: 60_000,
    hookTimeout: 30_000,
    reporters: ['verbose'],
    sequence: { shuffle: false },
  },
  resolve: {
    alias: { '@': path.resolve(__dirname, './src') },
  },
})
