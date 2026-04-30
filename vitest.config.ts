import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Perf benches (tests/perf/**/*.bench.ts) are excluded from the default
    // run because they need an idle CPU to validate the latency SLA. Run them
    // explicitly via `npm run test:perf`.
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    setupFiles: ['./tests/setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/index.ts'],
    },
    testTimeout: 20000,
  },
});
