import { resolve } from 'node:path'
import { defineConfig } from 'vitest/config'

// Workspace exports resolve to src via shield-source; there is no dist fallback,
// so cross-package imports need the same source alias the root suite applies.
export default defineConfig({
  resolve: {
    conditions: ['shield-source'],
    alias: [
      {
        find: '@shield/access',
        replacement: resolve(import.meta.dirname, '../access/src')
      }
    ]
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
    pool: 'forks',
    maxWorkers: 2,
    testTimeout: 30_000
  }
})
