import { defineConfig } from 'vitest/config';

// Perf benches run serially on a dedicated worker so the latency SLA is
// measured without CPU contention from parallel test files.
export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['tests/perf/**/*.bench.ts'],
    setupFiles: ['./tests/setup.ts'],
    testTimeout: 120000,
    pool: 'forks',
    forks: {
      singleFork: true,
    },
  },
});
