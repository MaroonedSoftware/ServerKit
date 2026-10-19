import { readFileSync } from 'node:fs';

/** Read a file from `tests/fixtures`. */
export function fixture(name: string): string {
  return readFileSync(new URL(`./fixtures/${name}`, import.meta.url), 'utf8');
}

/** The error `fn` throws, or a failed assertion when it returns. */
export function thrown(fn: () => unknown): unknown {
  try {
    fn();
  } catch (error) {
    return error;
  }
  throw new Error('expected the call to throw');
}

/** `value`, or a failed assertion when it is missing. */
export function present<T>(value: T | null | undefined): T {
  if (value === null || value === undefined) {
    throw new Error('expected a value');
  }
  return value;
}
