import { defineProject } from 'vitest/config';
import swc from 'unplugin-swc';

export default defineProject({
  test: {
    globals: true,
    include: ['./tests/**/*.test.ts'],
    environment: 'node',
    // Reuse the worker between test files; these suites don't depend on per-file isolation.
    isolate: false,
    // `KyselyLike` is a structural type with no `kysely` import behind it, so only a
    // real type check can prove it still matches Kysely. The build tsconfig covers
    // src/ alone, hence the separate tests tsconfig.
    typecheck: {
      enabled: true,
      include: ['./tests/**/*.test-d.ts'],
      tsconfig: './tsconfig.tests.json',
    },
  },
  plugins: [swc.vite()],
});
