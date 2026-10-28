import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    // {ts,tsx}: .tsx tests are accepted (issue #12); rendering JSX needs a jsx setting in tsconfig.
    include: ['src/**/*.test.{ts,tsx}'],
    typecheck: { enabled: true, include: ['src/**/*.test-d.{ts,tsx}'] },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      exclude: [
        'src/**/*.test.{ts,tsx}',
        'src/**/*.test-d.{ts,tsx}',
        // A domain's shared test builders are test code, like *.test.ts.
        'src/**/test-support/**',
        'src/**/index.ts',
        'src/app/main.ts',
        'src/shared/stub.ts',
      ],
      thresholds: { lines: 90, functions: 90, branches: 85, statements: 90 },
    },
  },
});
