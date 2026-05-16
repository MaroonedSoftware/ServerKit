import { glob } from 'node:fs/promises';
import { resolve } from 'node:path';
import type { AuthorizationModel } from '@maroonedsoftware/permissions';
import type { Check, CliContext } from '../../types.js';

/** Options for `permissionsSchemaCompiled`. */
export interface PermissionsSchemaCompiledOptions {
    /**
     * Path to `permissions.config.json`. Relative paths resolve against
     * `ctx.paths.repoRoot`. When omitted, the check walks up from `repoRoot`
     * looking for the config (matches the `pdsl` CLI default).
     */
    configPath?: string;
}

/**
 * Check that the TypeScript files generated from `.perm` sources are in sync
 * with the sources. Runs `compile({ dryRun: true })` from
 * `@maroonedsoftware/permissions-dsl` and fails when any output would be
 * rewritten or removed. `autoFix` runs the real `compile()`.
 *
 * Lazy-loads `@maroonedsoftware/permissions-dsl` — returns a clear failure if
 * the package isn't installed.
 */
export const permissionsSchemaCompiled = (options: PermissionsSchemaCompiledOptions = {}): Check => ({
    name: 'permissions schema compiled',
    run: async ctx => evaluatePermissionsCompile(ctx, options, { write: false }),
    autoFix: async ctx => evaluatePermissionsCompile(ctx, options, { write: true }),
});

const evaluatePermissionsCompile = async (
    ctx: CliContext,
    options: PermissionsSchemaCompiledOptions,
    { write }: { write: boolean },
): Promise<{ ok: boolean; message: string; fixHint?: string }> => {
    let dsl: typeof import('@maroonedsoftware/permissions-dsl');
    try {
        dsl = await import('@maroonedsoftware/permissions-dsl');
    } catch {
        return { ok: false, message: '`@maroonedsoftware/permissions-dsl` is not installed; add it as a dependency to use this check' };
    }

    const explicit = options.configPath;
    const configPath = explicit ? resolve(ctx.paths.repoRoot, explicit) : dsl.findConfig(ctx.paths.repoRoot);
    if (!configPath) {
        return {
            ok: false,
            message: `no permissions.config.json found under ${ctx.paths.repoRoot}`,
            fixHint: 'Create a permissions.config.json or pass `configPath` to permissionsSchemaCompiled().',
        };
    }

    let config: import('@maroonedsoftware/permissions-dsl').PermissionsConfig;
    try {
        ({ config } = await dsl.loadConfig(configPath));
    } catch (err) {
        return { ok: false, message: `failed to load ${configPath}: ${(err as Error).message}` };
    }

    try {
        const result = await dsl.compile(config, write ? {} : { dryRun: true });
        const drift = result.outputs.length + result.orphaned.length;
        if (drift === 0) {
            return { ok: true, message: `${result.namespaces.length} namespace(s), all up to date` };
        }
        if (write) {
            return { ok: true, message: `regenerated ${result.outputs.length} file(s), removed ${result.orphaned.length} orphan(s)` };
        }
        return {
            ok: false,
            message: `${result.outputs.length} regeneration(s) and ${result.orphaned.length} orphan(s) pending`,
            fixHint: 'Run `pdsl compile` or rerun this command with `--fix`.',
        };
    } catch (err) {
        if (err instanceof dsl.AggregateCompileError) {
            const summary = err.errors.map(e => e.message).join('\n\n');
            return { ok: false, message: summary };
        }
        if (err instanceof dsl.CompileError || err instanceof dsl.ParseError) {
            return { ok: false, message: err.message };
        }
        return { ok: false, message: (err as Error).message };
    }
};

/** Options for `permissionsFixturesPass`. */
export interface PermissionsFixturesPassOptions {
    /** Globs of `.perm.yaml` fixtures. Resolved against `ctx.paths.repoRoot`. */
    patterns: string[];
}

/**
 * Check that every assertion in every matched `.perm.yaml` fixture passes.
 * Mirrors `pdsl validate` but renders a single doctor-friendly line summary.
 * No `autoFix` — fixture failures need human judgment.
 */
export const permissionsFixturesPass = (options: PermissionsFixturesPassOptions): Check => ({
    name: 'permissions fixtures pass',
    run: async ctx => {
        let dsl: typeof import('@maroonedsoftware/permissions-dsl');
        try {
            dsl = await import('@maroonedsoftware/permissions-dsl');
        } catch {
            return { ok: false, message: '`@maroonedsoftware/permissions-dsl` is not installed; add it as a dependency to use this check' };
        }

        const files = new Set<string>();
        for (const pattern of options.patterns) {
            for await (const match of glob(pattern, { cwd: ctx.paths.repoRoot })) {
                files.add(resolve(ctx.paths.repoRoot, match));
            }
        }
        if (files.size === 0) {
            return { ok: false, message: `no fixtures matched ${options.patterns.join(' ')}` };
        }

        let totalFailed = 0;
        let totalPassed = 0;
        let failedFiles = 0;
        for (const file of files) {
            try {
                const fixture = await dsl.loadFixture(file);
                const report = await dsl.runFixture(fixture);
                totalPassed += report.summary.passed;
                totalFailed += report.summary.failed;
                if (report.summary.failed > 0) failedFiles++;
            } catch (err) {
                failedFiles++;
                totalFailed++;
                ctx.logger.debug(`${file}: ${(err as Error).message}`);
            }
        }

        if (totalFailed === 0) {
            return { ok: true, message: `${files.size} fixture(s), ${totalPassed} assertion(s) passed` };
        }
        return {
            ok: false,
            message: `${totalFailed} assertion(s) failed across ${failedFiles} fixture(s)`,
            fixHint: `Run \`pdsl validate '${options.patterns[0]}'\` for the full report.`,
        };
    },
});

/** Options for `permissionsModelLoads`. */
export interface PermissionsModelLoadsOptions {
    /**
     * Caller-supplied loader that constructs the project's `AuthorizationModel`.
     * Throws are caught and surfaced as a check failure — `AuthorizationModel`'s
     * constructor already validates names and cross-references.
     */
    loadModel: (ctx: CliContext) => Promise<AuthorizationModel>;
}

/**
 * Check that the project's `AuthorizationModel` constructs without throwing.
 * Surfaces duplicate-namespace, unknown-subject, and unresolved
 * `tupleToUserset` errors at doctor time instead of on the first runtime
 * Check call.
 */
export const permissionsModelLoads = (options: PermissionsModelLoadsOptions): Check => ({
    name: 'permissions model loads',
    run: async ctx => {
        try {
            const model = await options.loadModel(ctx);
            const count = model.namespaces().length;
            return { ok: true, message: `${count} namespace(s) loaded` };
        } catch (err) {
            return { ok: false, message: (err as Error).message };
        }
    },
});
