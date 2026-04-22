import { defineProject } from 'vitest/config';
import swc from 'unplugin-swc';

export default defineProject({
  test: {
    globals: true,
    include: ['./tests/**/*.test.ts'],
    environment: 'node',
  },
  plugins: [swc.vite()],
});
