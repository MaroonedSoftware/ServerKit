import { describe, it, expect, vi } from 'vitest';
import type { Logger } from '@maroonedsoftware/logger';
import { AppConfigOptionsMonitorImpl } from '../../src/options/app.config.options.monitor.js';

/** A no-op logger whose `error` can be asserted on. */
function stubLogger(): Logger {
  return { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn(), trace: vi.fn() } as unknown as Logger;
}

/** Drains pending microtasks so async listener callbacks have run. */
const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe('AppConfigOptionsMonitorImpl', () => {
  it('exposes the initial value via current', () => {
    const monitor = new AppConfigOptionsMonitorImpl({ x: 1 }, stubLogger());
    expect(monitor.current).toEqual({ x: 1 });
  });

  it('updates current and notifies listeners on a changed value', async () => {
    const monitor = new AppConfigOptionsMonitorImpl({ x: 1 }, stubLogger());
    const listener = vi.fn();
    monitor.onChange(listener);

    monitor.update({ x: 2 });

    expect(monitor.current).toEqual({ x: 2 });
    await flush();
    expect(listener).toHaveBeenCalledWith({ x: 2 });
  });

  it('skips notification on a structurally-equal update', async () => {
    const monitor = new AppConfigOptionsMonitorImpl({ x: 1 }, stubLogger());
    const listener = vi.fn();
    monitor.onChange(listener);

    monitor.update({ x: 1 });

    await flush();
    expect(listener).not.toHaveBeenCalled();
  });

  it('returns a working unsubscribe', async () => {
    const monitor = new AppConfigOptionsMonitorImpl({ x: 1 }, stubLogger());
    const listener = vi.fn();
    const off = monitor.onChange(listener);
    off();

    monitor.update({ x: 2 });

    await flush();
    expect(listener).not.toHaveBeenCalled();
  });

  it('reports a throwing listener via logger.error without blocking other listeners or the swap', async () => {
    const logger = stubLogger();
    const monitor = new AppConfigOptionsMonitorImpl({ x: 1 }, logger);
    const good = vi.fn();
    monitor.onChange(() => {
      throw new Error('listener boom');
    });
    monitor.onChange(good);

    monitor.update({ x: 2 });

    expect(monitor.current).toEqual({ x: 2 });
    await flush();
    expect(good).toHaveBeenCalledWith({ x: 2 });
    expect(logger.error).toHaveBeenCalled();
  });

  it('reports a rejecting async listener via logger.error', async () => {
    const logger = stubLogger();
    const monitor = new AppConfigOptionsMonitorImpl({ x: 1 }, logger);
    monitor.onChange(() => Promise.reject(new Error('async boom')));

    monitor.update({ x: 2 });

    await flush();
    expect(logger.error).toHaveBeenCalled();
  });
});
