import { Logger } from '@maroonedsoftware/logger';
import { structurallyEqual } from '../helpers.js';
import { AppConfigOptionsMonitor } from './app.config.options.js';

/**
 * Concrete {@link AppConfigOptionsMonitor} backing the live (singleton) options
 * tier.
 *
 * Created and fed by {@link AppConfigOptionsManager}: it holds the latest value
 * for one configuration section and {@link AppConfigOptionsManager} calls
 * {@link AppConfigOptionsMonitorImpl.update} whenever the underlying store
 * reloads.
 *
 * @template T - The shape of the configuration section.
 */
export class AppConfigOptionsMonitorImpl<T> extends AppConfigOptionsMonitor<T> {
  private value: T;
  private readonly listeners = new Set<(value: T) => void | Promise<void>>();

  /**
   * @param initial - The value to serve until the first {@link AppConfigOptionsMonitorImpl.update}.
   * @param logger - Used to report listener failures.
   */
  constructor(
    initial: T,
    private readonly logger: Logger,
  ) {
    super();
    this.value = initial;
  }

  /**
   * The latest value for this section.
   */
  get current(): T {
    return this.value;
  }

  /**
   * Subscribes to value changes. See {@link AppConfigOptionsMonitor.onChange}.
   *
   * @param listener - Called with the new value after each change.
   * @returns A function that removes the listener when called.
   */
  onChange(listener: (value: T) => void | Promise<void>): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /**
   * Swaps in a new value and notifies listeners.
   *
   * A structurally-equal value is ignored so a secret re-fetched unchanged does
   * not bounce live consumers. The value is swapped before listeners run, so a
   * listener reading `current` sees the new value. Each listener is invoked in
   * isolation: a throw or rejection is reported via the logger and does not stop
   * the swap or the other listeners.
   *
   * @param next - The newly resolved value for this section.
   */
  update(next: T): void {
    if (structurallyEqual(this.value, next)) {
      return;
    }
    this.value = next;
    for (const listener of this.listeners) {
      Promise.resolve()
        .then(() => listener(next))
        .catch((err: unknown) => this.logger.error('AppConfigOptionsMonitor: onChange listener failed', err));
    }
  }
}
