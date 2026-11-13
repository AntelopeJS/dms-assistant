import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import { backendBoundary } from '../build/backend-boundary.ts'

export default defineConfig({
  root: fileURLToPath(new URL('.', import.meta.url)),
  plugins: [backendBoundary()],
  resolve: {
    alias: {
      // The host runtime only exists inside a generated Inertia workspace; the
      // tests substitute the slice of it this package imports.
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
