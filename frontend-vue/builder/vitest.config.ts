import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import { backendBoundary } from '../build/backend-boundary.ts'

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [backendBoundary()],
  resolve: {
    alias: {
      '#dms/frontend-module': fileURLToPath(
        new URL('./tests/stubs/frontend-module.ts', import.meta.url),
      ),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
  },
})
