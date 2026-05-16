import { InjectKitRegistry, type Container, type ScopedContainer } from 'injectkit';
import { AppConfig } from '@maroonedsoftware/appconfig';
import { ConsoleLogger, Logger } from '@maroonedsoftware/logger';
import type { ServerKitModule } from '@maroonedsoftware/koa';
import type { CliContext, CommandModule } from '../../types.js';

/** Options accepted by `bootstrapForCli`. */
export interface BootstrapForCliOptions<ConfigT extends AppConfig = AppConfig> {
    modules: ServerKitModule<ConfigT>[];
    config: ConfigT;
    logger?: Logger;
}

/** An InjectKit container and a `shutdown` hook that runs every module's `shutdown` in reverse order. */
export interface CliContainer {
    container: Container;
    shutdown: () => Promise<void>;
}

/**
 * Run each `module.setup(registry, config)` and build the InjectKit container.
 * Deliberately does NOT call `module.start()` — CLIs don't want background work
 * (HTTP listeners, job pollers) spinning up. Module `shutdown` hooks are
 * invoked when the returned `shutdown` is called.
 */
export const bootstrapForCli = async <ConfigT extends AppConfig = AppConfig>(
    options: BootstrapForCliOptions<ConfigT>,
): Promise<CliContainer> => {
    const registry = new InjectKitRegistry();

    registry.register(Logger).useInstance(options.logger ?? new ConsoleLogger());
    registry.register(AppConfig).useInstance(options.config);

    for (const module of options.modules) {
        if (module.setup) await module.setup(registry, options.config);
    }

    const container = registry.build();

    const shutdown = async (): Promise<void> => {
        for (const module of [...options.modules].reverse()) {
            if (!module.shutdown) continue;
            try {
                await module.shutdown(container);
            } catch {
                // Ignore individual module shutdown failures during teardown.
            }
        }
    };

    return { container, shutdown };
};

// Lazy, per-process bootstrap cache. Composite commands within a single
// invocation reuse the same container; subsequent invocations bootstrap fresh.
interface LazyBootstrap<ConfigT extends AppConfig> {
    modules: ServerKitModule<ConfigT>[];
    promise?: Promise<CliContainer>;
}

// State must live on globalThis under a Symbol.for key so that the main johnny5
// bundle and the /serverkit subpath bundle share it. tsup with `splitting:
// false` builds each entry independently, so module-scoped state would be
// duplicated — createCliApp would write to one copy and requireContainer would
// read from another. Symbol.for makes the WeakMap process-wide regardless of
// which bundle initialised it first.
const STATE_KEY = Symbol.for('@maroonedsoftware/johnny5/serverkit/state.v1');

interface Johnny5ServerkitState {
    containerByContext: WeakMap<CliContext, LazyBootstrap<AppConfig>>;
}

const getState = (): Johnny5ServerkitState => {
    const g = globalThis as unknown as Record<symbol, Johnny5ServerkitState | undefined>;
    if (!g[STATE_KEY]) {
        g[STATE_KEY] = { containerByContext: new WeakMap() };
    }
    return g[STATE_KEY] as Johnny5ServerkitState;
};

/**
 * Associate a list of ServerKit modules with a `CliContext`. The first call to
 * `getOrBootstrapContainer` for that context will lazily run their `setup`
 * hooks. `createCliApp` calls this automatically when `modules` is supplied.
 */
export const configureServerKitModules = <ConfigT extends AppConfig>(ctx: CliContext, modules: ServerKitModule<ConfigT>[]): void => {
    getState().containerByContext.set(ctx, { modules: modules as ServerKitModule<AppConfig>[] });
};

/**
 * Return the bootstrapped container for `ctx`, building it on the first call
 * and caching the promise for subsequent calls within the same process.
 * Throws if `configureServerKitModules` hasn't been called for this context.
 */
export const getOrBootstrapContainer = async (ctx: CliContext): Promise<CliContainer> => {
    const lazy = getState().containerByContext.get(ctx);
    if (!lazy) throw new Error('ServerKit modules have not been configured on this CliContext — call configureServerKitModules() in createCliApp first.');
    if (!lazy.promise) {
        lazy.promise = bootstrapForCli({
            modules: lazy.modules,
            config: ctx.config,
        });
    }
    return lazy.promise;
};

/** `CliContext` augmented with a scoped InjectKit container, handed to `requireContainer` handlers. */
export interface RequireContainerCtx extends CliContext {
    container: ScopedContainer;
}

/**
 * Wrap a command handler so it lazily bootstraps the ServerKit container and
 * receives a fresh scoped container per invocation. The root container is NOT
 * shut down between commands within the same process — call `bootstrapForCli`
 * directly when explicit teardown is required.
 */
export const requireContainer = <Opts = Record<string, unknown>>(
    handler: (opts: Opts, ctx: RequireContainerCtx, args: string[]) => Promise<number | void>,
): CommandModule<Opts>['run'] => {
    return async (opts, ctx, args) => {
        const { container } = await getOrBootstrapContainer(ctx);
        const scoped = container.createScopedContainer() as ScopedContainer;
        const enriched: RequireContainerCtx = Object.assign({}, ctx, { container: scoped });
        return handler(opts, enriched, args);
    };
};
