import { defineProject } from 'vitest/config';
import swc from 'unplugin-swc';

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
    // Isolate each test file. oidc.provider and oidc.factor.service tests both vi.mock
    // openid-client with their own factory; with a shared module cache, src binds to
    // whichever mock loaded first and the other file's spies see no calls.
    isolate: true,
  },
  plugins: [swc.vite()],
});
