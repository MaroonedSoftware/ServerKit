import { defineProject } from 'vitest/config';
import swc from 'unplugin-swc';

// Integration suites run against real (or emulated) backends — see
// tests/integration/README.md. They are gated on STORAGE_INTEGRATION and live
// in their own config so the unit tests' SDK mocks can never leak in.
export default defineProject({
  test: {
    globals: true,
    include: ['./tests/integration/**/*.test.ts'],
    environment: 'node',
    // Generous timeouts for container round-trips and multipart uploads.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
  plugins: [swc.vite()],
});
