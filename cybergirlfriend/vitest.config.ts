import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./tests/setup-env.ts'],
    include: [
      'tests/unit/**/*.test.ts',
      'tests/integration/**/*.test.ts',
      'server/**/*.test.ts',
    ],
    reporters: ['default', 'json'],
    outputFile: {
      json: 'test-results/vitest-results.json',
    },
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary', 'html'],
      reportsDirectory: 'coverage',
      include: ['server/**/*.ts', 'src/**/*.ts'],
      exclude: ['server/index.d.ts', '**/*.test.ts', '**/*.d.ts'],
    },
  },
});
