import { Injectable } from 'injectkit';
import { Logger } from '@maroonedsoftware/logger';
import { structurallyEqual } from '../helpers.js';
import { AppConfigStore } from './app.config.store.js';

/**
 * The single, unified accessor for a configuration section — the ServerKit
 * analog of C#'s options trio (`IOptions<T>`, `IOptionsSnapshot<T>`,
 * `IOptionsMonitor<T>`) collapsed into one injectable token.
 *
 * A section is always backed by a reloadable {@link import('./app.config.store.js').AppConfigStore},
 * so hot reload is the default rather than an add-on. The three members cover
 * the same ground as C#'s three interfaces:
 *
 * - {@link AppConfigSection.value} — a snapshot that is **stable for the lifetime
 *   of the scope it is resolved in**. Resolved from a per-request scoped
 *   container (as ServerKit mints in `serverKitContextMiddleware`), it behaves
 *   like `IOptionsSnapshot<T>`: constant within the request, picking up the
 *   latest reloaded value at the start of the next one. Resolved from the root
 *   container (a singleton dependency), it behaves like `IOptions<T>`: the
 *   boot-time value, frozen for the process.
 * - {@link AppConfigSection.current} — the latest value, always. The
 *   `IOptionsMonitor<T>.CurrentValue` analog. Read it at use-time (never cache
 *   it in a field) so a long-lived holder always observes the newest value.
 * - {@link AppConfigSection.onChange} — subscribe to changes, the
 *   `IOptionsMonitor<T>.OnChange` analog.
 *
 * Because InjectKit resolves by runtime class identity (generic type arguments
 * erase), each section declares its own token by subclassing this base — the
 * same pattern used for `SlackConfig` / `Logger`:
 *
 * ```ts
 * @Injectable() export abstract class SlackOptions extends AppConfigSection<SlackConfig> {}
 * ```
 *
 * Then wire it once with {@link import('./app.config.module.js').AppConfigModule}
 * and inject `SlackOptions` anywhere.
 *
 * > **Scope note.** A section token is registered as a *scoped* service, so
 * > inject it into request-scoped or transient services (the common case in a
 * > Koa app). A singleton that needs live config should read {@link current} /
 * > {@link onChange} — which stay correct regardless of scope — and must not
 * > rely on {@link value}, exactly as a C# singleton cannot consume
 * > `IOptionsSnapshot<T>`.
 *
 * @template T - The shape of the configuration section.
 */
@Injectable()
export abstract class AppConfigSection<T> {
  /**
   * The value for the resolving scope. Stable for that scope's lifetime —
   * per-request when resolved from a request scope, boot-frozen at root.
   */
  abstract readonly value: T;

  /** The latest value. Read at use-time; do not cache it in a field. */
  abstract readonly current: T;

  /**
   * Subscribes to value changes.
   *
   * The listener fires after a reload swaps in a structurally different value;
   * reloads that produce an identical value do not fire it. The listener may be
   * async — its rejection is reported and isolated so it cannot break the swap
   * or other listeners.
   *
   * @param listener - Called with the new value after each change.
   * @returns A function that removes the listener when called.
   */
  abstract onChange(listener: (value: T) => void | Promise<void>): () => void;
}

/**
 * Concrete {@link AppConfigSection} produced per resolving scope.
 *
 * Holds a frozen `value` captured when the scope first resolved the token, and
 * backs `current` / `onChange` directly with the singleton
 * {@link import('./app.config.store.js').AppConfigStore} so live reads and
 * subscriptions always observe the latest reload. The store is the singleton,
 * so even though this impl is created per scope, reads and subscriptions outlive
 * the scope that produced them.
 *
 * @template TRoot - The root configuration type held by the store.
 * @template K - The section key within `TRoot`.
 */
export class AppConfigSectionImpl<TRoot, K extends keyof TRoot & string> extends AppConfigSection<TRoot[K]> {
  /**
   * @param value - The scope snapshot, captured at construction.
   * @param store - The reloadable store backing `current` / `onChange`.
   * @param key - The section key this view projects from the root config.
   * @param logger - Used to report `onChange` listener failures.
   */
  constructor(
    readonly value: TRoot[K],
    private readonly store: AppConfigStore<TRoot>,
    private readonly key: K,
    private readonly logger: Logger,
  ) {
    super();
  }

  /** The latest value, sliced live from the store on every read. */
  get current(): TRoot[K] {
    return this.store.current.getAs<TRoot[K]>(this.key);
  }

  /**
   * Subscribes to the store and forwards this section's slice. A reload that
   * leaves the slice structurally unchanged is skipped, so a section does not
   * bounce when a different section (or an identical re-fetch) reloads. Each
   * listener is invoked in isolation: a throw or rejection is reported via the
   * logger and does not affect the swap or other listeners.
   *
   * See {@link AppConfigSection.onChange}.
   */
  onChange(listener: (value: TRoot[K]) => void | Promise<void>): () => void {
    let last = this.current;
    return this.store.subscribe(config => {
      const next = config.getAs<TRoot[K]>(this.key);
      if (structurallyEqual(last, next)) {
        return;
      }
      last = next;
      Promise.resolve()
        .then(() => listener(next))
        .catch((err: unknown) => this.logger.error('AppConfigSection: onChange listener failed', err));
    });
  }
}
