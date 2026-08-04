import { defineProject } from 'vitest/config';

export default defineProject({
  test: {
    globals: true,
    include: ['./tests/**/*.test.ts'],
    // Type-check the tests too: the build tsconfig covers src/ only, so without
    // this a broken type in a test (or a `.test-d.ts` assertion) never fails.
    typecheck: {
      enabled: true,
      include: ['./tests/**/*.test.ts', './tests/**/*.test-d.ts'],
      tsconfig: './tsconfig.tests.json',
    },
    environment: 'node',
    // Reuse the worker between test files; these suites don't depend on per-file isolation.
    isolate: false,
  },
});
