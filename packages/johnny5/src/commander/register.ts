import { Command } from 'commander';
import type { CliContext, CommandModule, DiscoveredCommand, OptionSpec } from '../types.js';

const applyOption = (cmd: Command, spec: OptionSpec): void => {
    if (spec.required) {
        cmd.requiredOption(spec.flags, spec.description, spec.default as string | undefined);
        return;
    }
    if (spec.default !== undefined) {
        cmd.option(spec.flags, spec.description, spec.default as string | boolean);
    } else {
        cmd.option(spec.flags, spec.description);
    }
};

const findOrCreateGroup = (parent: Command, name: string): Command => {
    const existing = parent.commands.find(c => c.name() === name);
    if (existing) return existing;
    return parent.command(name).description(`${name} commands`);
};

// Extract the long-name (or short-name) of a commander flags string and
// convert kebab-case to camelCase, matching commander's own option key
// derivation. e.g. `--org-name <name>` → 'orgName'.
const deriveOptionKey = (flags: string): string => {
    const tokens = flags.split(/[ ,]+/);
    const long = tokens.find(t => t.startsWith('--'));
    const target = long ?? tokens.find(t => t.startsWith('-'));
    if (!target) return flags;
    const stripped = target.replace(/^-+/, '');
    return stripped.replace(/-([a-z])/g, (_, c: string) => c.toUpperCase());
};

const attachLeaf = (parent: Command, leafName: string, mod: CommandModule, ctx: CliContext, sourceLabel: string): void => {
    const cmd = parent.command(leafName).description(mod.description);

    for (const arg of mod.args ?? []) {
        const argName = arg.variadic ? `${arg.name}...` : arg.name;
        if (arg.required) cmd.argument(`<${argName}>`, arg.description);
        else cmd.argument(`[${argName}]`, arg.description);
    }

    for (const opt of mod.options ?? []) {
        applyOption(cmd, opt);
    }

    if (mod.passthrough) cmd.allowUnknownOption(true).allowExcessArguments(true);

    cmd.action(async (...allArgs: unknown[]) => {
        // Commander passes positional args first, then the parsed options
        // object, then the Command instance. We slice off the last two.
        const commandInstance = allArgs[allArgs.length - 1] as Command;
        const opts = (allArgs[allArgs.length - 2] ?? {}) as Record<string, unknown>;
        const positional = allArgs.slice(0, allArgs.length - 2);

        const positionalStrings: string[] = positional.flatMap(p => (Array.isArray(p) ? p.map(String) : p == null ? [] : [String(p)]));
        const passthroughArgs = mod.passthrough ? commandInstance.args : positionalStrings;

        for (const optSpec of mod.options ?? []) {
            if (!optSpec.envVar) continue;
            const key = deriveOptionKey(optSpec.flags);
            if (opts[key] === undefined && process.env[optSpec.envVar] !== undefined) {
                opts[key] = process.env[optSpec.envVar];
            }
        }

        let finalOpts = opts;
        if (mod.interactive && ctx.isInteractive()) {
            finalOpts = (await mod.interactive(ctx, opts)) as Record<string, unknown>;
        }

        try {
            const exitCode = await mod.run(finalOpts, ctx, passthroughArgs);
            if (typeof exitCode === 'number' && exitCode !== 0) process.exit(exitCode);
        } catch (err) {
            ctx.logger.error(`[${sourceLabel}] ${(err as Error).message}`);
            if ((err as Error).stack) ctx.logger.debug((err as Error).stack ?? '');
            process.exit(1);
        }
    });
};

/**
 * Attach every discovered command to a commander `Program`, building intermediate
 * group nodes as needed. Core registrations are processed before plugin ones, so
 * a plugin that tries to claim a path already held by core throws with a
 * descriptive error.
 */
export const registerCommands = (program: Command, discovered: DiscoveredCommand[], ctx: CliContext): void => {
    const registeredPaths = new Map<string, { source: 'core' | 'plugin'; sourceName?: string }>();

    // Core first, then plugins — plugins can extend but not override.
    const sorted = [...discovered].sort((a, b) => {
        if (a.source === b.source) return 0;
        return a.source === 'core' ? -1 : 1;
    });

    for (const entry of sorted) {
        const key = entry.path.join(' ');
        const existing = registeredPaths.get(key);
        if (existing) {
            const incoming = entry.source === 'plugin' ? (entry.sourceName ?? 'unknown plugin') : 'core';
            const owner = existing.source === 'plugin' ? (existing.sourceName ?? 'unknown plugin') : 'core';
            throw new Error(`command "${key}" is already registered by ${owner}; ${incoming} cannot override it`);
        }
        registeredPaths.set(key, { source: entry.source, sourceName: entry.sourceName });

        let parent: Command = program;
        for (const segment of entry.path.slice(0, -1)) {
            parent = findOrCreateGroup(parent, segment);
        }
        const leafName = entry.path[entry.path.length - 1];
        if (!leafName) continue;
        const sourceLabel = entry.source === 'plugin' ? (entry.sourceName ?? 'plugin') : 'core';
        attachLeaf(parent, leafName, entry.module, ctx, sourceLabel);
    }
};
