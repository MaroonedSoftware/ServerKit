import type { Check, CheckResult, CliContext, CommandModule } from '../types.js';

/** Options passed to `runChecks`. */
export interface DoctorOptions {
    /** When true, failing checks with an `autoFix` hook get a chance to remediate. */
    fix?: boolean;
}

/**
 * Run a list of doctor checks sequentially, rendering progress to stdout. Returns
 * a process exit code: `0` when every check passes (including via `autoFix` when
 * `--fix` is supplied), `1` when at least one check fails.
 */
export const runChecks = async (ctx: CliContext, checks: Check[], options: DoctorOptions): Promise<number> => {
    ctx.logger.info('Running doctor…\n');

    let failed = 0;
    let fixed = 0;

    for (const check of checks) {
        process.stdout.write(`  ${check.name.padEnd(36, ' ')} `);
        let result: CheckResult;
        try {
            result = await check.run(ctx);
        } catch (err) {
            result = { ok: false, message: `threw: ${(err as Error).message}` };
        }

        if (result.ok) {
            process.stdout.write(`\x1b[32m✓\x1b[0m ${result.message}\n`);
            continue;
        }

        process.stdout.write(`\x1b[31m✗\x1b[0m ${result.message}\n`);

        if (options.fix && check.autoFix) {
            process.stdout.write(`    ↻ attempting auto-fix… `);
            try {
                const fixResult = await check.autoFix(ctx);
                if (fixResult.ok) {
                    process.stdout.write(`\x1b[32m✓\x1b[0m ${fixResult.message}\n`);
                    fixed++;
                    continue;
                }
                process.stdout.write(`\x1b[31m✗\x1b[0m ${fixResult.message}\n`);
            } catch (err) {
                process.stdout.write(`\x1b[31m✗\x1b[0m ${(err as Error).message}\n`);
            }
        } else if (result.fixHint) {
            process.stdout.write(`    → ${result.fixHint}\n`);
        }
        failed++;
    }

    process.stdout.write('\n');
    if (failed === 0) {
        ctx.logger.success('All checks passed.');
        return 0;
    }
    if (options.fix && fixed > 0) {
        ctx.logger.info(`Auto-fixed ${fixed} issue(s); re-run \`doctor\` to confirm.`);
    }
    ctx.logger.error(`${failed} check(s) failed.`);
    return 1;
};

/**
 * Build the `CommandModule` for the built-in `doctor` subcommand from a set of
 * checks. `createCliApp` auto-registers this when `checks` is non-empty.
 */
export const buildDoctorCommand = (checks: Check[]): CommandModule<{ fix?: boolean }> => ({
    description: 'Run local-dev health checks',
    options: [{ flags: '--fix', description: 'Attempt auto-remediation for checks that support it' }],
    run: async (opts, ctx) => runChecks(ctx, checks, { fix: opts.fix === true }),
});
