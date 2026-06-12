import { register } from 'node:module';
import { fileURLToPath } from 'node:url';

/** Options for `registerTypescriptLoader`. */
export interface RegisterTypescriptLoaderOptions {
    /**
     * Path to the tsconfig swc-node should compile with, resolved against
     * `binUrl`. Defaults to `'../tsconfig.json'` — a bin living in
     * `<pkg>/bin/` next to `<pkg>/tsconfig.json`. Ignored when
     * `SWC_NODE_PROJECT` is already set in the environment.
     */
    tsconfig?: string;
}

/** Options for `runTypescriptBin`. */
export interface RunTypescriptBinOptions extends RegisterTypescriptLoaderOptions {
    /**
     * The TypeScript entry module to import once the loader is registered,
     * resolved against `binUrl`. Defaults to `'../src/index.ts'`.
     */
    entry?: string;
}

/**
 * Register the `@swc-node/register` ESM loader so a plain `.js` bin can import
 * TypeScript sources directly. Fixes three problems that
 * `import '@swc-node/register/esm-register'` leaves with every consumer:
 *
 * - the stock `esm-register` shim resolves the loader hook relative to
 *   `process.cwd()`, which breaks when the bin is invoked from outside its own
 *   package — here the hook is anchored to `binUrl` instead;
 * - swc-node discovers its tsconfig from cwd — `SWC_NODE_PROJECT` is pointed
 *   at the tsconfig derived from `binUrl` (unless already set);
 * - Node 26 emits DeprecationWarning DEP0205 for `module.register()` — the
 *   warning is suppressed narrowly, only around the `register` call.
 *
 * `@swc-node/register` is resolved from the package that owns the bin file, so
 * it must be installed there (johnny5 declares it as an optional peer).
 *
 * @param binUrl - `import.meta.url` of the calling bin file.
 */
export const registerTypescriptLoader = (binUrl: string, options: RegisterTypescriptLoaderOptions = {}): void => {
    process.env['SWC_NODE_PROJECT'] ??= fileURLToPath(new URL(options.tsconfig ?? '../tsconfig.json', binUrl));

    const previousNoDeprecation = process.noDeprecation;
    process.noDeprecation = true;
    try {
        register('@swc-node/register/esm', binUrl);
    } catch (err) {
        throw new Error(`could not register '@swc-node/register/esm' (resolved from ${binUrl}); is @swc-node/register installed in the package that owns this bin?`, {
            cause: err,
        });
    } finally {
        process.noDeprecation = previousNoDeprecation;
    }
};

/**
 * The canonical johnny5 bin shim: register the swc loader, then import the
 * TypeScript entry point. A consumer's executable reduces to:
 *
 * ```js
 * #!/usr/bin/env node
 * import { runTypescriptBin } from '@maroonedsoftware/johnny5/bin';
 * await runTypescriptBin(import.meta.url);
 * ```
 *
 * @param binUrl - `import.meta.url` of the calling bin file.
 * @returns The module namespace of the imported entry point.
 */
export const runTypescriptBin = async (binUrl: string, options: RunTypescriptBinOptions = {}): Promise<unknown> => {
    registerTypescriptLoader(binUrl, options);
    return import(new URL(options.entry ?? '../src/index.ts', binUrl).href);
};
