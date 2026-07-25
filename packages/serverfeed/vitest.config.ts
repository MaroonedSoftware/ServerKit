import { defineProject } from 'vitest/config';
import swc from 'unplugin-swc';

export default defineProject({
  test: {
    globals: true,
    include: ['./tests/**/*.test.ts'],
    environment: 'node',
    // Reuse the worker between test files; these suites don't depend on per-file isolation.
    isolate: false,
  },
  plugins: [swc.vite()],
});
