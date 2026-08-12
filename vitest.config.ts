import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'

export default defineConfig({
  resolve: {
    alias: {
      '@': fileURLToPath(new URL('./src', import.meta.url)),
    },
  },
  test: {
    globalSetup: ['./tests/setup/global.ts'],
    env: { TZ: 'Europe/Warsaw' },
    testTimeout: 20_000,
  },
})
