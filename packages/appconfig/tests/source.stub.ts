import type { AppConfigSource } from '../src/app.config.source.js';

/**
 * Completes a partial {@link AppConfigSource} so a test only has to declare the
 * members it actually exercises.
 *
 * Defaults are inert: `load` yields an empty layer, `get` reports a miss, and
 * `watch` returns a no-op disposer.
 *
 * @param partial - The members this test cares about.
 * @returns A source satisfying the full interface.
 */
export const stubSource = (partial: Partial<AppConfigSource> = {}): AppConfigSource => ({
  load: async () => ({}),
  get: async () => undefined,
  watch: () => () => {},
  ...partial,
});
