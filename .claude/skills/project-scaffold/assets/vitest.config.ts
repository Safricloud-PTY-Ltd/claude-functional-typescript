import { defineConfig } from 'vitest/config';

// One root run over every package: each packages/<name>/vitest.config.ts is a project, and
// coverage is measured here across all of them.
export default defineConfig({
  test: {
    projects: ['packages/*'],
    coverage: {
      provider: 'v8',
      include: ['packages/*/src/**/*.{ts,tsx}'],
      exclude: [
        'packages/*/src/**/*.test.{ts,tsx}',
        'packages/*/src/**/*.test-d.{ts,tsx}',
        // A domain's shared test builders are test code, like *.test.ts.
        'packages/*/src/**/test-support/**',
        'packages/*/src/**/index.ts',
        // Each package's composition root wires and starts; there is nothing to unit-test.
        'packages/*/src/app/main.ts',
        'packages/shared/src/stub.ts',
      ],
      thresholds: { lines: 90, functions: 90, branches: 85, statements: 90 },
    },
  },
});
