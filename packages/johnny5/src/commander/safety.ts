import type { CliContext, CommandModule, DangerousSpec, EnvironmentGuardSpec } from '../types.js';
import { prompts } from '../util/prompts.js';

const resolveEnvGuard = (mod: CommandModule): EnvironmentGuardSpec | null => {
    if (!mod.allowedEnvironments) return null;
    if (Array.isArray(mod.allowedEnvironments)) return { allowed: mod.allowedEnvironments };
    return mod.allowedEnvironments;
};

const resolveDangerous = (mod: CommandModule): DangerousSpec | null => {
    if (!mod.dangerous) return null;
    if (mod.dangerous === true) return {};
    return mod.dangerous;
};

const hasYesOption = (mod: CommandModule): boolean => (mod.options ?? []).some(o => /(^|[\s,])(-y|--yes)([\s,]|$)/.test(o.flags));

/**
 * Returns true when the env guard is satisfied or absent. Logs and returns
 * false when the current environment is not in the allowed list — the caller
 * should treat that as a refusal and exit non-zero.
 */
export const checkEnvironmentGuard = (mod: CommandModule, ctx: CliContext, pathLabel: string): boolean => {
    const guard = resolveEnvGuard(mod);
    if (!guard) return true;
    const variable = guard.variable ?? 'NODE_ENV';
    const current = ctx.env[variable];
    if (current !== undefined && guard.allowed.includes(current)) return true;
    const shown = current === undefined ? '(unset)' : current;
    ctx.logger.error(`Refusing to run "${pathLabel}" with ${variable}=${shown}. Allowed: ${guard.allowed.join(', ')}.`);
    return false;
};

/**
 * Resolves a destructive-command confirmation. Returns true when the command
 * should proceed. In non-interactive contexts the caller must pass `--yes`
 * (reflected in `userOptedIn`); otherwise the user is prompted.
 */
export const confirmDangerous = async (mod: CommandModule, ctx: CliContext, pathLabel: string, userOptedIn: boolean): Promise<boolean> => {
    const spec = resolveDangerous(mod);
    if (!spec) return true;
    if (userOptedIn) return true;
    if (!ctx.isInteractive()) {
        ctx.logger.error(`"${pathLabel}" is destructive; pass --yes to confirm in non-interactive mode.`);
        return false;
    }
    if (spec.confirm === 'typed') {
        const phrase = spec.phrase ?? pathLabel;
        const result = await prompts.text({ message: spec.message ?? `This is destructive. Type "${phrase}" to continue:` });
        if (prompts.isCancel(result)) return false;
        if (result !== phrase) {
            ctx.logger.warn('Confirmation did not match — aborting.');
            return false;
        }
        return true;
    }
    const result = await prompts.confirm({ message: spec.message ?? `Run destructive command "${pathLabel}"?`, initialValue: false });
    if (prompts.isCancel(result)) return false;
    return result === true;
};

/** Whether the command needs an injected `-y, --yes` option to be registered. */
export const needsYesOption = (mod: CommandModule): boolean => Boolean(mod.dangerous) && !hasYesOption(mod);
