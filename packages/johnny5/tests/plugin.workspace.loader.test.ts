import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadWorkspacePlugins } from '../src/index.js';
import { createMockContext } from './helpers.js';

interface FakePackageOptions {
    name: string;
    manifestRel?: string;
    manifestBody?: string;
    writeManifest?: boolean;
}

const writeFakePackage = async (root: string, dir: string, opts: FakePackageOptions): Promise<void> => {
    const pkgDir = path.join(root, dir);
    await mkdir(pkgDir, { recursive: true });
    const pkgJson: Record<string, unknown> = { name: opts.name };
    if (opts.manifestRel) pkgJson['johnny5'] = { commands: opts.manifestRel };
    await writeFile(path.join(pkgDir, 'package.json'), JSON.stringify(pkgJson));
    if (opts.manifestRel && opts.writeManifest !== false) {
        await writeFile(path.join(pkgDir, opts.manifestRel), opts.manifestBody ?? '');
    }
};

describe('loadWorkspacePlugins', () => {
    let repoRoot: string;

    beforeEach(async () => {
        repoRoot = await mkdtemp(path.join(tmpdir(), 'johnny5-plugins-'));
    });

    afterEach(async () => {
        await rm(repoRoot, { recursive: true, force: true });
    });

    it('returns an empty array when none of the configured roots exist', async () => {
        const plugins = await loadWorkspacePlugins(createMockContext({ repoRoot }), { repoRoot, roots: ['nope'] });
        expect(plugins).toEqual([]);
    });

    it('discovers a plugin manifest declared via package.json#johnny5.commands', async () => {
        const packagesDir = path.join(repoRoot, 'packages');
        await mkdir(packagesDir, { recursive: true });
        const manifestRel = 'plugin.mjs';
        await writeFakePackage(packagesDir, 'cool', {
            name: 'cool',
            manifestRel,
            manifestBody: `
                export default {
                    name: 'cool',
                    commands: [
                        {
                            path: ['cool', 'go'],
                            module: { description: 'do it', run: async () => 0 },
                        },
                    ],
                };
            `,
        });

        const plugins = await loadWorkspacePlugins(createMockContext({ repoRoot }), { repoRoot });
        expect(plugins).toHaveLength(1);
        expect(plugins[0]).toMatchObject({
            path: ['cool', 'go'],
            source: 'plugin',
            sourceName: 'cool',
        });
        expect(plugins[0]?.module.description).toBe('do it');
    });

    it('skips packages listed in excludePackages', async () => {
        const packagesDir = path.join(repoRoot, 'packages');
        await mkdir(packagesDir, { recursive: true });
        await writeFakePackage(packagesDir, 'a', {
            name: 'a',
            manifestRel: 'plugin.mjs',
            manifestBody: `export default { name: 'a', commands: [{ path: ['a'], module: { description: '', run: async () => 0 } }] };`,
        });
        await writeFakePackage(packagesDir, 'b', {
            name: 'b',
            manifestRel: 'plugin.mjs',
            manifestBody: `export default { name: 'b', commands: [{ path: ['b'], module: { description: '', run: async () => 0 } }] };`,
        });

        const plugins = await loadWorkspacePlugins(createMockContext({ repoRoot }), {
            repoRoot,
            excludePackages: ['a'],
        });
        expect(plugins).toHaveLength(1);
        expect(plugins[0]?.sourceName).toBe('b');
    });

    it('warns and skips when the manifest path is missing', async () => {
        const packagesDir = path.join(repoRoot, 'packages');
        await mkdir(packagesDir, { recursive: true });
        await writeFakePackage(packagesDir, 'gone', {
            name: 'gone',
            manifestRel: 'missing.mjs',
            writeManifest: false,
        });

        const ctx = createMockContext({ repoRoot });
        const plugins = await loadWorkspacePlugins(ctx, { repoRoot });
        expect(plugins).toEqual([]);
        expect(ctx.logger.warn).toHaveBeenCalledWith(expect.stringContaining('johnny5 plugin manifest missing for gone'));
    });

    it('warns and skips when the manifest has no commands array', async () => {
        const packagesDir = path.join(repoRoot, 'packages');
        await mkdir(packagesDir, { recursive: true });
        await writeFakePackage(packagesDir, 'bad', {
            name: 'bad',
            manifestRel: 'plugin.mjs',
            manifestBody: `export default { name: 'bad' };`,
        });

        const ctx = createMockContext({ repoRoot });
        const plugins = await loadWorkspacePlugins(ctx, { repoRoot });
        expect(plugins).toEqual([]);
        expect(ctx.logger.warn).toHaveBeenCalledWith(expect.stringContaining('has no commands array; skipping'));
    });

    it('warns and continues when a single plugin fails to import', async () => {
        const packagesDir = path.join(repoRoot, 'packages');
        await mkdir(packagesDir, { recursive: true });
        await writeFakePackage(packagesDir, 'broken', {
            name: 'broken',
            manifestRel: 'plugin.mjs',
            manifestBody: 'throw new Error("import boom");',
        });
        await writeFakePackage(packagesDir, 'good', {
            name: 'good',
            manifestRel: 'plugin.mjs',
            manifestBody: `export default { name: 'good', commands: [{ path: ['ok'], module: { description: '', run: async () => 0 } }] };`,
        });

        const ctx = createMockContext({ repoRoot });
        const plugins = await loadWorkspacePlugins(ctx, { repoRoot });
        expect(plugins).toHaveLength(1);
        expect(plugins[0]?.sourceName).toBe('good');
        expect(ctx.logger.warn).toHaveBeenCalledWith(expect.stringContaining('johnny5 plugin broken failed to load'));
    });

    it('ignores packages with no johnny5 field at all', async () => {
        const packagesDir = path.join(repoRoot, 'packages');
        await mkdir(packagesDir, { recursive: true });
        await writeFakePackage(packagesDir, 'plain', { name: 'plain' });
        const plugins = await loadWorkspacePlugins(createMockContext({ repoRoot }), { repoRoot });
        expect(plugins).toEqual([]);
    });

    it('ignores directories whose package.json is malformed', async () => {
        const packagesDir = path.join(repoRoot, 'packages');
        await mkdir(path.join(packagesDir, 'malformed'), { recursive: true });
        await writeFile(path.join(packagesDir, 'malformed', 'package.json'), '{not valid json');
        const plugins = await loadWorkspacePlugins(createMockContext({ repoRoot }), { repoRoot });
        expect(plugins).toEqual([]);
    });
});
