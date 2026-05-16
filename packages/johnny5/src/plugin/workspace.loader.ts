import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import type { CliContext, DiscoveredCommand, PluginManifest } from '../types.js';

interface WorkspacePackageJson {
    name?: string;
    johnny5?: {
        commands?: string;
    };
}

/** Options accepted by `loadWorkspacePlugins`. */
export interface WorkspacePluginOptions {
    repoRoot: string;
    /**
     * Workspace-relative directories whose immediate children are scanned for
     * `package.json` files. Defaults to `['apps', 'packages']`.
     */
    roots?: string[];
    /**
     * Package names to skip — typically the consumer's own CLI package whose
     * commands are loaded directly, not via plugin discovery.
     */
    excludePackages?: string[];
}

/**
 * Scan every workspace package in the configured roots for a `"johnny5"` field
 * in `package.json`. When present, the referenced file is dynamically imported
 * and expected to default-export a `PluginManifest`. Failures to load a single
 * plugin log a warning through `ctx.logger.warn` but don't abort the CLI.
 */
export const loadWorkspacePlugins = async (ctx: CliContext, options: WorkspacePluginOptions): Promise<DiscoveredCommand[]> => {
    const rootDirs = options.roots ?? ['apps', 'packages'];
    const exclude = new Set(options.excludePackages ?? []);
    const discovered: DiscoveredCommand[] = [];

    for (const rootRel of rootDirs) {
        const root = resolve(options.repoRoot, rootRel);
        if (!existsSync(root)) continue;
        for (const entry of readdirSync(root, { withFileTypes: true })) {
            if (!entry.isDirectory()) continue;
            const pkgPath = join(root, entry.name, 'package.json');
            if (!existsSync(pkgPath)) continue;

            let pkg: WorkspacePackageJson;
            try {
                pkg = JSON.parse(readFileSync(pkgPath, 'utf-8')) as WorkspacePackageJson;
            } catch {
                continue;
            }

            const commandsRel = pkg.johnny5?.commands;
            if (!commandsRel) continue;
            if (pkg.name && exclude.has(pkg.name)) continue;

            const manifestPath = resolve(root, entry.name, commandsRel);
            if (!existsSync(manifestPath)) {
                ctx.logger.warn(`johnny5 plugin manifest missing for ${pkg.name ?? entry.name}: ${manifestPath}`);
                continue;
            }

            try {
                const mod = (await import(pathToFileURL(manifestPath).href)) as { default: PluginManifest };
                const manifest = mod.default;
                if (!manifest || !Array.isArray(manifest.commands)) {
                    ctx.logger.warn(`johnny5 plugin ${pkg.name ?? entry.name} has no commands array; skipping`);
                    continue;
                }
                for (const cmd of manifest.commands) {
                    discovered.push({
                        path: cmd.path,
                        source: 'plugin',
                        sourceName: manifest.name ?? pkg.name,
                        module: cmd.module,
                    });
                }
            } catch (err) {
                ctx.logger.warn(`johnny5 plugin ${pkg.name ?? entry.name} failed to load: ${(err as Error).message}`);
            }
        }
    }

    return discovered;
};
