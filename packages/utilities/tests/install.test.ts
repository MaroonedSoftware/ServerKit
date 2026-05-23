import { afterEach, describe, expect, it, vi } from 'vitest';
import { installArrayMethod, installStringMethod } from '../src/internal/install.js';

const arrayProbe = '__serverkitInstallProbeArray';
const stringProbe = '__serverkitInstallProbeString';

afterEach(() => {
  delete (Array.prototype as Record<string, unknown>)[arrayProbe];
  delete (String.prototype as Record<string, unknown>)[stringProbe];
});

describe('installArrayMethod', () => {
  it('installs a non-enumerable, writable, configurable property when the name is free', () => {
    installArrayMethod(arrayProbe, function () {
      return 42;
    });
    const descriptor = Object.getOwnPropertyDescriptor(Array.prototype, arrayProbe);
    expect(descriptor?.enumerable).toBe(false);
    expect(descriptor?.writable).toBe(true);
    expect(descriptor?.configurable).toBe(true);
    expect(([] as Array<unknown> & { [arrayProbe]: () => number })[arrayProbe]()).toBe(42);
  });

  it('warns and skips when the name already exists on Array.prototype', () => {
    (Array.prototype as Record<string, unknown>)[arrayProbe] = () => 'existing';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    installArrayMethod(arrayProbe, function () {
      return 'new';
    });

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain(`Array.prototype.${arrayProbe}`);
    expect((Array.prototype as Record<string, () => string>)[arrayProbe]!()).toBe('existing');

    warn.mockRestore();
  });
});

describe('installStringMethod', () => {
  it('warns and skips when the name already exists on String.prototype', () => {
    (String.prototype as Record<string, unknown>)[stringProbe] = () => 'existing';
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);

    installStringMethod(stringProbe, function () {
      return 'new';
    });

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]![0]).toContain(`String.prototype.${stringProbe}`);

    warn.mockRestore();
  });
});
