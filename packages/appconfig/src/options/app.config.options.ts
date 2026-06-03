import { Injectable } from 'injectkit';

/**
 * Accessor for a boot-time snapshot of a configuration section — the ServerKit
 * analog of C#'s `IOptions<T>`.
 *
 * The value is captured once when the container is built and never changes for
 * the lifetime of the process. This is the same guarantee as injecting a typed
 * config object directly (e.g. `SlackConfig`); use it when a consumer never needs
 * to observe a reload.
 *
 * Declared as an abstract `@Injectable()` class so it can serve as a DI token.
 * Because InjectKit resolves by a runtime class identity (and generic type
 * arguments erase), each configuration section declares its own token by
 * subclassing this base — mirroring how `SlackConfig` / `Logger` are modeled:
 *
 * ```ts
 * @Injectable() export abstract class SlackOptions extends AppConfigOptions<SlackConfig> {}
 * ```
 *
 * @template T - The shape of the configuration section.
 */
@Injectable()
export abstract class AppConfigOptions<T> {
  /** The configuration value captured at container-build time. */
  abstract readonly value: T;
}

/**
 * Accessor for a per-request-stable view of a configuration section — the
 * ServerKit analog of C#'s `IOptionsSnapshot<T>`.
 *
 * Registered as a scoped service, so the value is resolved once per request
 * (ServerKit mints a scoped container per request in `serverKitContextMiddleware`)
 * and stays constant for the duration of that request, while picking up the
 * latest reloaded value at the start of the next one.
 *
 * Declare a per-section token by subclassing:
 *
 * ```ts
 * @Injectable() export abstract class SlackOptionsSnapshot extends AppConfigOptionsSnapshot<SlackConfig> {}
 * ```
 *
 * @template T - The shape of the configuration section.
 */
@Injectable()
export abstract class AppConfigOptionsSnapshot<T> {
  /** The configuration value for the current request scope. */
  abstract readonly value: T;
}

/**
 * Live accessor for a configuration section — the ServerKit analog of C#'s
 * `IOptionsMonitor<T>`.
 *
 * Registered as a singleton whose `current` value is swapped in place whenever
 * the underlying {@link AppConfigStore} reloads. Singletons should read
 * `current` at use-time (never cache it in a field) so they always observe the
 * latest value, and may subscribe via {@link AppConfigOptionsMonitor.onChange}
 * to actively react to a change — for example to rebuild a connection pool or
 * reconnect a client when a secret rotates.
 *
 * Declare a per-section token by subclassing:
 *
 * ```ts
 * @Injectable() export abstract class SlackOptionsMonitor extends AppConfigOptionsMonitor<SlackConfig> {}
 * ```
 *
 * @template T - The shape of the configuration section.
 */
@Injectable()
export abstract class AppConfigOptionsMonitor<T> {
  /** The latest configuration value. Read at use-time; do not cache in a field. */
  abstract readonly current: T;

  /**
   * Subscribes to value changes.
   *
   * The listener is invoked after a reload swaps in a structurally different
   * value; reloads that produce an identical value do not fire it. The listener
   * may be async — its rejection is reported and isolated so it cannot break the
   * swap or other listeners.
   *
   * @param listener - Called with the new value after each change.
   * @returns A function that removes the listener when called.
   */
  abstract onChange(listener: (value: T) => void | Promise<void>): () => void;
}
