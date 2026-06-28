import { configDefaults, defineProject } from 'vitest/config';
import swc from 'unplugin-swc';

export default defineProject({
  test: {
    globals: true,
    include: ['./tests/**/*.test.ts'],
    // Integration suites have their own config (vitest.integration.config.ts) and
    // real backends; never run them as part of the default unit-test pass.
    exclude: [...configDefaults.exclude, './tests/integration/**'],
    setupFiles: './tests/setup.ts',
    environment: 'node',
    // Reuse the worker between test files; these suites don't depend on per-file isolation.
    isolate: false,
  },
  plugins: [swc.vite()],
});
