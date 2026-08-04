import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['tests/**/*.test.ts', 'src/**/*.test.ts'],
    // Type-check the tests too: the build tsconfig covers src/ only, so without
    // this a broken type in a test (or a `.test-d.ts` assertion) never fails.
    typecheck: {
      enabled: true,
      include: ['tests/**/*.test.ts', 'src/**/*.test.ts', 'tests/**/*.test-d.ts'],
      tsconfig: './tsconfig.tests.json',
    },
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.test.ts', 'src/**/types.ts'],
    },
  },
});
